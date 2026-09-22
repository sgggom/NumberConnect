import type { ConfigurationBatchSettings } from './configurationBatchSettings';
import type { ConfigurationBatchResult } from './ConfigurationBatchPanel';

export interface BatchHistoryEntry {
  id: string; createdAt: number; name: string; libraryId: string; scope: string;
  settings: ConfigurationBatchSettings; repetitions: number; total: number; saved: number;
  status: string;
  geometry: { boardWidth: number; boardHeight: number; viewportWidth: number; viewportHeight: number; pixelRatio: number };
}
export type BatchHistoryResult = ConfigurationBatchResult & { order: number };
const DB = 'number-connect-arranger-batch-history';
const open = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('runs', { keyPath: 'id' });
    request.result.createObjectStore('results', { keyPath: ['runId', 'order'] }).createIndex('runId', 'runId');
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function transact<T>(mode: IDBTransactionMode, action: (tx: IDBTransaction) => () => T): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(['runs', 'results'], mode);
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
export function deleteBatchHistory(id: string): Promise<void> {
  return transact('readwrite', (tx) => {
    tx.objectStore('runs').delete(id);
    const cursor = tx.objectStore('results').index('runId').openCursor(id);
    cursor.onsuccess = () => { if (cursor.result) { cursor.result.delete(); cursor.result.continue(); } };
    return () => undefined;
  });
}
export function describeBatchSettings(settings: ConfigurationBatchSettings): string {
  const { player: p, weights: w } = settings;
  return `${settings.leftHand ? '左' : '右'}手 · ${settings.mode === 'thumb' ? '拇指' : '食指'} · 大小 ${settings.handSize}\n`
    + `推理：${{ low: '低（不预判）', medium: '中（2步）', high: '高（5步）' }[p.reasoning]}；平时观察 ${Math.round(p.normal * 100)}%；错误后观察 ${Math.round(p.afterError * 100)}%；观察推理 ${Math.round((p.reasoningObservation ?? 0) * 100)}%\n`
    + `权重：下一数字 ${w.nextNumber}；隐藏数字 ${w.hiddenNumber}；遮挡≥50%倍率 ${w.occludedMultiplier}；同方向 ${w.sameDirection}；靠近目标 ${w.closerTarget}\n`
    + `线程数：${settings.workerCount === undefined ? '未记录（旧版配置）' : settings.workerCount || '自动（逻辑核心数减1）'}`;
}
