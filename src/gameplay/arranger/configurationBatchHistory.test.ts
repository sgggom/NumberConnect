import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deleteBatchHistory, listBatchHistory, loadBatchHistoryResults, saveBatchHistory, type BatchHistoryEntry } from './configurationBatchHistory';
import { readConfigurationBatchSettings } from './configurationBatchSettings';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());
const entry = (id: string, createdAt: number): BatchHistoryEntry => ({ id, createdAt, name: '主玩法', libraryId: 'library',
  scope: '主玩法 · level1～level2 · 难度 0、1', settings: readConfigurationBatchSettings(), repetitions: 3,
  total: 2, saved: 0, status: '未完成', geometry: { boardWidth: 360, boardHeight: 640, viewportWidth: 1440, viewportHeight: 900, pixelRatio: 1 } });
it('persists partial runs across connections, preserves parameters, and orders results by task rather than completion', async () => {
  const run = entry('a', 1);
  await saveBatchHistory(run);
  await saveBatchHistory({ ...run, saved: 1 }, { order: 1, groupId: 1, stage: 2, id: 'b', configuredId: 'b', status: '已通关', repetitions: 3, completedRuns: 3 });
  await saveBatchHistory({ ...run, saved: 2, status: '计算完成' }, { order: 0, groupId: 1, stage: 1, id: 'a', configuredId: 'a', status: '未通关', repetitions: 3, completedRuns: 2 });
  await saveBatchHistory(entry('b', 2));
  const history = await listBatchHistory();
  expect(history.map((item) => item.id)).toEqual(['b', 'a']);
  expect(history[1]).toEqual({ ...run, saved: 2, status: '计算完成' });
  expect((await loadBatchHistoryResults('a')).map((row) => [row.id, row.completedRuns])).toEqual([['a', 2], ['b', 3]]);
  await deleteBatchHistory('a');
  expect(await loadBatchHistoryResults('a')).toEqual([]);
  expect((await listBatchHistory()).map((item) => item.id)).toEqual(['b']);
});
it('reports unavailable storage instead of claiming a save succeeded', async () => {
  vi.stubGlobal('indexedDB', undefined);
  await expect(saveBatchHistory(entry('a', 1))).rejects.toThrow();
});
