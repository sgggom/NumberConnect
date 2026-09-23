import { matchesLibraryFilters, type LibraryFilterRule } from './libraryFilters';
import type { ArrangementLibraryIndex, ArrangementLibraryLevel, ArrangementLevelGroup } from './levelArrangement';

const DATABASE = 'number-connect-arrangement-v2';
const STORES = ['indices', 'details', 'libraries', 'settings', 'drafts'] as const;
export const DATABASE_BATCH_SIZE = 250;

export interface ArrangementLibraryManifest {
  id: string;
  name: string;
  count: number;
  parameterHeaders: string[];
  sourceHeaders?: string[];
  sourceLibraryId?: string;
  skippedRows: number;
}

export interface ArrangementDraft {
  mode: 'main' | 'daily' | 'bead';
  configurations: Record<'main' | 'daily' | 'bead', { groups: ArrangementLevelGroup[]; selectedGroupId: number }>;
}

async function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') throw new Error('当前环境不支持关卡数据库，请使用支持 IndexedDB 的浏览器。');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      for (const name of STORES) request.result.createObjectStore(name);
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('关卡数据库被其他页面占用，请关闭旧页面后重试。'));
  });
}

async function transaction<T>(names: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = database.transaction(names, mode);
      let request: IDBRequest<T> | void;
      tx.oncomplete = () => resolve(request?.result as T);
      tx.onabort = () => reject(tx.error ?? new Error('关卡数据库写入已中止。'));
      tx.onerror = () => { /* Abort reports the final transaction error. */ };
      try { request = run(tx); }
      catch (error) { tx.abort(); reject(error); }
    });
  } finally { database.close(); }
}

const libraryRange = (id: string): IDBKeyRange => IDBKeyRange.bound([id], [id, []]);

/** The importer owns this interner; stable short keys avoid repeating grid JSON in every index. */
export function createArrangementIndexBuilder(): (level: ArrangementLibraryLevel) => ArrangementLibraryIndex {
  const boards = new Map<string, string>();
  const paths = new Map<string, string>();
  const intern = (map: Map<string, string>, value: string, prefix: string): string => {
    let key = map.get(value);
    if (!key) { key = `${prefix}${map.size}`; map.set(value, key); }
    return key;
  };
  return ({ levelData: _grid, parameterValues: _parameters, sourceValues: _source, ...index }) => ({
    ...index,
    boardKey: intern(boards, index.boardKey, 'b'),
    pathKey: intern(paths, index.pathKey, 'p'),
  });
}

export async function writeArrangementBatch(
  libraryId: string, levels: ArrangementLibraryLevel[], buildIndex: ReturnType<typeof createArrangementIndexBuilder>,
): Promise<void> {
  for (let offset = 0; offset < levels.length; offset += DATABASE_BATCH_SIZE) {
    const batch = levels.slice(offset, offset + DATABASE_BATCH_SIZE);
    await transaction(['indices', 'details'], 'readwrite', (tx) => {
      for (const level of batch) {
        tx.objectStore('indices').put(buildIndex(level), [libraryId, level.id]);
        tx.objectStore('details').put({ levelData: level.levelData, parameterValues: level.parameterValues, sourceValues: level.sourceValues }, [libraryId, level.id]);
      }
    });
  }
}

// Publish only after every batch succeeds. A failed import cannot replace the working library.
export async function commitArrangementLibrary(manifest: ArrangementLibraryManifest, activate = true): Promise<void> {
  await transaction(['libraries', 'settings'], 'readwrite', (tx) => {
    tx.objectStore('libraries').put(manifest, manifest.id);
    if (activate) tx.objectStore('settings').put(manifest, 'active');
  });
}

export async function deleteArrangementLibrary(id: string): Promise<void> {
  await transaction(['indices', 'details', 'libraries', 'drafts'], 'readwrite', (tx) => {
    tx.objectStore('indices').delete(libraryRange(id));
    tx.objectStore('details').delete(libraryRange(id));
    tx.objectStore('libraries').delete(id);
    tx.objectStore('drafts').delete(id);
  });
}

export const loadActiveArrangementLibrary = (): Promise<ArrangementLibraryManifest | undefined> =>
  transaction(['settings'], 'readonly', (tx) => tx.objectStore('settings').get('active'));

export async function loadArrangementIndices(id: string): Promise<ArrangementLibraryIndex[]> {
  const levels: ArrangementLibraryIndex[] = [];
  let lastId: string | undefined;
  const pathMetrics = new Map<string, ArrangementLibraryIndex['pathMetrics']>();
  while (true) {
    const range = lastId === undefined ? libraryRange(id) : IDBKeyRange.bound([id, lastId], [id, []], true);
    const batch: ArrangementLibraryIndex[] = await transaction(['indices'], 'readonly', (tx) =>
      tx.objectStore('indices').getAll(range, DATABASE_BATCH_SIZE));
    const needsUpgrade = batch.some((level) => level.pathMetrics.connectionCount === undefined);
    for (const level of batch) {
      const shared = pathMetrics.get(level.pathKey);
      if (shared) level.pathMetrics = shared;
      else pathMetrics.set(level.pathKey, level.pathMetrics);
      levels.push(level);
    }
    const missing = [...new Map(batch.filter((level) => level.pathMetrics.connectionCount === undefined)
      .map((level) => [level.pathKey, level])).values()];
    if (missing.length) {
      // Upgrade old lightweight indices one bounded batch at a time; never load all grids.
      const details = await loadArrangementDetails(id, missing.map((level) => level.id));
      missing.forEach((level, index) => {
        const cells = details[index].levelData.data.reduce((total, row) => total + row.filter((value) => value !== 0).length, 0);
        level.pathMetrics.connectionCount = Math.max(0, cells - 1);
      });
    }
    // Persist the shared metric on every variant, including later batches of the same path.
    if (needsUpgrade) await transaction(['indices'], 'readwrite', (tx) => {
      for (const level of batch) tx.objectStore('indices').put(level, [id, level.id]);
    });
    if (batch.length < DATABASE_BATCH_SIZE) break;
    lastId = batch[batch.length - 1].id;
  }
  return levels.sort((a, b) => a.sourceRow - b.sourceRow);
}

type Detail = Pick<ArrangementLibraryLevel, 'levelData' | 'parameterValues' | 'sourceValues'>;
export async function loadArrangementDetails(id: string, levelIds: readonly string[]): Promise<Detail[]> {
  if (levelIds.length > DATABASE_BATCH_SIZE) throw new Error('读取关卡数据超过单批限制。');
  let requests: IDBRequest<Detail | undefined>[] = [];
  await transaction(['details'], 'readonly', (tx) => {
    requests = levelIds.map((levelId) => tx.objectStore('details').get([id, levelId]));
  });
  return requests.map((request, index) => {
    if (!request.result) throw new Error(`找不到关卡数据：${levelIds[index]}，请重新导入关卡库。`);
    return request.result;
  });
}

export const saveArrangementDraft = (id: string, draft: ArrangementDraft): Promise<IDBValidKey> =>
  transaction(['drafts'], 'readwrite', (tx) => tx.objectStore('drafts').put(draft, id));
export const loadArrangementDraft = (id: string): Promise<ArrangementDraft | undefined> =>
  transaction(['drafts'], 'readonly', (tx) => tx.objectStore('drafts').get(id));

export async function importArrangementLibrary(file: File, onProgress?: (message: string) => void, activate = true): Promise<ArrangementLibraryManifest> {
  if (typeof Worker === 'undefined') throw new Error('当前环境不支持后台导入，请使用现代浏览器。');
  const id = crypto.randomUUID();
  const worker = new Worker(new URL('./arrangementLibrary.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<ArrangementLibraryManifest>((resolve, reject) => {
      worker.onmessage = (event) => {
        if (event.data.type === 'progress') onProgress?.(event.data.message);
        else if (event.data.type === 'complete') resolve(event.data.manifest);
        else reject(new Error(event.data.message ?? '关卡库导入失败。'));
      };
      worker.onerror = (event) => reject(new Error(event.message || '关卡库导入线程异常退出。'));
      worker.onmessageerror = () => reject(new Error('关卡库导入消息读取失败。'));
      worker.postMessage({ file, libraryId: id, activate });
    });
  } catch (error) {
    worker.terminate();
    await deleteArrangementLibrary(id).catch(() => undefined);
    throw error;
  } finally { worker.terminate(); }
}

/** Scan bounded disk batches; keep only matching IDs in memory. */
export async function loadArrangementFilterMatches(id: string, rules: LibraryFilterRule[], legacyValues?: (id: string, detail: Detail) => string[]): Promise<Set<string>> {
  const matches = new Set<string>();
  let lastId: string | undefined;
  while (true) {
    const range = lastId === undefined ? libraryRange(id) : IDBKeyRange.bound([id, lastId], [id, []], true);
    let keys: IDBRequest<IDBValidKey[]>;
    const rows = await transaction<Detail[]>(['details'], 'readonly', (tx) => {
      keys = tx.objectStore('details').getAllKeys(range, DATABASE_BATCH_SIZE);
      return tx.objectStore('details').getAll(range, DATABASE_BATCH_SIZE);
    });
    rows.forEach((row, i) => {
      const levelId = (keys!.result[i] as string[])[1];
      if (matchesLibraryFilters(row.sourceValues ?? legacyValues?.(levelId, row) ?? row.parameterValues, rules)) matches.add(levelId);
    });
    if (rows.length < DATABASE_BATCH_SIZE) break;
    lastId = (keys!.result.at(-1) as string[])[1];
  }
  return matches;
}

export const loadArrangementLibrary = (id: string): Promise<ArrangementLibraryManifest | undefined> =>
  transaction(['libraries'], 'readonly', (tx) => tx.objectStore('libraries').get(id));

/** Always recalculate a cut from its original library, including previously excluded paths. */
export async function loadArrangementRootLibrary(manifest: ArrangementLibraryManifest): Promise<ArrangementLibraryManifest> {
  const visited = new Set<string>();
  while (manifest.sourceLibraryId) {
    if (visited.has(manifest.id)) throw new Error('原库关联异常，请重新读取 Excel。');
    visited.add(manifest.id);
    const source = await loadArrangementLibrary(manifest.sourceLibraryId);
    if (!source) throw new Error('原库不存在，请重新读取 Excel。');
    manifest = source;
  }
  return manifest;
}

export async function createTrimmedArrangementLibrary(source: ArrangementLibraryManifest,
  levels: readonly ArrangementLibraryIndex[], onProgress?: (completed: number) => void): Promise<ArrangementLibraryManifest> {
  if (!levels.length) throw new Error('没有符合条件的路径，原库保持不变。');
  const id = crypto.randomUUID();
  const manifest: ArrangementLibraryManifest = { ...source, id, sourceLibraryId: source.id,
    name: `${source.name} · 错误趋势裁切库`, count: levels.length, skippedRows: 0 };
  const buildIndex = createArrangementIndexBuilder();
  try {
    for (let offset = 0; offset < levels.length; offset += DATABASE_BATCH_SIZE) {
      const batch = levels.slice(offset, offset + DATABASE_BATCH_SIZE);
      const details = await loadArrangementDetails(source.id, batch.map((level) => level.id));
      await writeArrangementBatch(id, batch.map((level, i) => ({ ...level, ...details[i] })), buildIndex);
      onProgress?.(offset + batch.length);
    }
    await commitArrangementLibrary(manifest);
    return manifest;
  } catch (error) {
    await deleteArrangementLibrary(id).catch(() => undefined);
    throw error;
  }
}
