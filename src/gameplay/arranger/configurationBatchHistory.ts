import type { ConfigurationBatchTask } from './configurationBatchTasks';
import { deleteArrangementLibrary } from './arrangementDatabase';
import type { ConfigurationBatchSettings } from './configurationBatchSettings';
import type { ConfigurationBatchResult } from './ConfigurationBatchPanel';

export interface BatchHistoryEntry {
  id: string; createdAt: number; name: string; libraryId: string; scope: string;
  settings: ConfigurationBatchSettings; repetitions: number; total: number; saved: number;
  status: string; resumable?: boolean; ownedLibrary?: boolean;
  geometry: { boardWidth: number; boardHeight: number; viewportWidth: number; viewportHeight: number; pixelRatio: number };
}
export type BatchHistoryResult = ConfigurationBatchResult & { order: number };
export interface BatchResumePlan {
  id: string; tasks: ConfigurationBatchTask[];
  board: { x: number; y: number; width: number; height: number };
}
export function pendingBatchOrders(tasks: readonly ConfigurationBatchTask[], results: readonly BatchHistoryResult[]): number[] {
  const saved = new Set(results.map((result) => result.order));
  return tasks.flatMap((_, order) => saved.has(order) ? [] : [order]);
}
const DB = 'number-connect-arranger-batch-history';
const open = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB, 2);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains('runs')) request.result.createObjectStore('runs', { keyPath: 'id' });
    if (!request.result.objectStoreNames.contains('results')) request.result.createObjectStore('results', { keyPath: ['runId', 'order'] }).createIndex('runId', 'runId');
    request.result.createObjectStore('plans', { keyPath: 'id' });
  };
  request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  request.onblocked = () => reject(new Error('历史数据库被旧页面占用，请关闭旧页面后重试。'));
  request.onerror = () => reject(request.error);
});
async function transact<T>(mode: IDBTransactionMode, action: (tx: IDBTransaction) => () => T): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(['runs', 'results', 'plans'], mode);
      const result = action(tx);
      tx.oncomplete = () => resolve(result());
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('历史记录保存失败'));
    });
  } finally { db.close(); }
}
export function saveBatchHistory(entry: BatchHistoryEntry, result?: BatchHistoryResult): Promise<void> {
  return transact('readwrite', (tx) => {
    tx.objectStore('runs').put(entry);
    if (result) tx.objectStore('results').put({ ...result, runId: entry.id });
    return () => undefined;
  });
}
export function saveBatchResumePlan(entry: BatchHistoryEntry, plan: BatchResumePlan): Promise<void> {
  return transact('readwrite', (tx) => {
    tx.objectStore('runs').put(entry);
    tx.objectStore('plans').put(plan);
    return () => undefined;
  });
}
export function loadBatchResumePlan(id: string): Promise<BatchResumePlan | undefined> {
  return transact('readonly', (tx) => {
    const request = tx.objectStore('plans').get(id);
    return () => request.result;
  });
}
export function listBatchHistory(): Promise<BatchHistoryEntry[]> {
  return transact('readonly', (tx) => {
    const request = tx.objectStore('runs').getAll();
    return () => (request.result as BatchHistoryEntry[]).sort((a, b) => b.createdAt - a.createdAt);
  });
}
export function loadBatchHistoryResults(id: string): Promise<BatchHistoryResult[]> {
  return transact('readonly', (tx) => {
    const request = tx.objectStore('results').index('runId').getAll(id);
    return () => (request.result as BatchHistoryResult[]).sort((a, b) => a.order - b.order);
  });
}
export async function deleteBatchHistory(id: string): Promise<void> {
  return withBatchHistoryLock(id, async () => {
    const entry = (await listBatchHistory()).find((item) => item.id === id);
    await transact('readwrite', (tx) => {
      tx.objectStore('runs').delete(id);
      tx.objectStore('plans').delete(id);
      const cursor = tx.objectStore('results').index('runId').openCursor(id);
      cursor.onsuccess = () => { if (cursor.result) { cursor.result.delete(); cursor.result.continue(); } };
      return () => undefined;
    });
    if (entry?.ownedLibrary) await deleteArrangementLibrary(entry.libraryId);
  });
}
export function describeBatchSettings(settings: ConfigurationBatchSettings): string {
  const { player: p, weights: w } = settings;
  return `${settings.leftHand ? '左' : '右'}手 · ${settings.mode === 'thumb' ? '拇指' : '食指'} · 大小 ${settings.handSize}\n`
    + `推理：${{ low: '低（不预判）', medium: '中（2步）', high: '高（5步）' }[p.reasoning]}；平时观察 ${Math.round(p.normal * 100)}%；错误后观察 ${Math.round(p.afterError * 100)}%；观察推理 ${Math.round((p.reasoningObservation ?? 0) * 100)}%\n`
    + `权重：下一数字 ${w.nextNumber}；隐藏数字 ${w.hiddenNumber}；遮挡≥50%倍率 ${w.occludedMultiplier}；同方向 ${w.sameDirection}；靠近目标 ${w.closerTarget}\n`
    + `线程数：${settings.workerCount === undefined ? '未记录（旧版配置）' : settings.workerCount || '自动（逻辑核心数减1）'}`;
}

// The browser releases this lock automatically on refresh or tab close.
export async function withBatchHistoryLock<T>(id: string, action: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) return action();
  return navigator.locks.request(`arranger-batch:${id}`, { ifAvailable: true }, (lock) => {
    if (!lock) throw new Error('此记录正在另一个窗口计算，请先停止该窗口的任务。');
    return action();
  });
}
