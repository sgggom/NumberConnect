import { commitArrangementLibrary, createArrangementIndexBuilder, writeArrangementBatch, loadArrangementDetails, loadActiveArrangementLibrary } from './arrangementDatabase';
import { parseArrangementLibraryRows } from './levelArrangement';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deleteBatchHistory, saveBatchResumePlan, loadBatchResumePlan, pendingBatchOrders, listBatchHistory, loadBatchHistoryResults, saveBatchHistory, type BatchHistoryEntry } from './configurationBatchHistory';
import { readConfigurationBatchSettings } from './configurationBatchSettings';

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange); });
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

it('stores the original task plan separately and resumes only unsaved positions, even for repeated IDs', async () => {
  const run = { ...entry('resume', 3), resumable: true };
  const tasks = [0, 1, 2].map((order) => ({ id: 'same-id', configuredId: 'same-id', groupId: order + 1, stage: 1 }));
  const plan = { id: run.id, tasks, board: { x: 800, y: 100, width: 360, height: 640 } };
  await saveBatchResumePlan(run, plan);
  tasks[0].groupId = 99;
  await saveBatchHistory({ ...run, saved: 1 }, { ...tasks[2], order: 2, status: '已通关' });
  const restored = await loadBatchResumePlan(run.id);
  expect(restored?.tasks[0].groupId).toBe(1);
  expect(restored?.board).toEqual(plan.board);
  expect(pendingBatchOrders(restored!.tasks, await loadBatchHistoryResults(run.id))).toEqual([0, 1]);
  await saveBatchHistory({ ...run, saved: 2 }, { ...tasks[0], order: 0, status: '已通关' });
  expect(pendingBatchOrders(restored!.tasks, await loadBatchHistoryResults(run.id))).toEqual([1]);
  await deleteBatchHistory(run.id);
  expect(await loadBatchResumePlan(run.id)).toBeUndefined();
});
it('upgrades existing version 1 histories without deleting their results', async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('number-connect-arranger-batch-history', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('runs', { keyPath: 'id' }).put(entry('legacy', 1));
      const results = request.result.createObjectStore('results', { keyPath: ['runId', 'order'] });
      results.createIndex('runId', 'runId');
      results.put({ runId: 'legacy', order: 0, id: 'old', status: '已通关' });
    };
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(request.error);
  });
  expect((await listBatchHistory())[0].id).toBe('legacy');
  expect((await loadBatchHistoryResults('legacy'))[0].id).toBe('old');
  expect(await loadBatchResumePlan('legacy')).toBeUndefined();
});

it('retains Excel source data across connections and removes only owned data when history is deleted', async () => {
  const manifest = (id: string) => ({ id, count: 1, name: 'test.xlsx', parameterHeaders: [], skippedRows: 0 });
  const json = JSON.stringify({ data: [[1, -2], [4, 3]] });
  const levels = parseArrangementLibraryRows([['关卡名', '关卡JSON', '路径JSON', '棋盘形状', '目标难度'], ['level_22_1_1', json, json, '正方形', 1]]).levels;
  await writeArrangementBatch('library', levels, createArrangementIndexBuilder());
  await commitArrangementLibrary(manifest('library'));
  await writeArrangementBatch('excel', levels, createArrangementIndexBuilder());
  await commitArrangementLibrary(manifest('excel'), false);
  const run = { ...entry('excel-run', 1), ownedLibrary: true, libraryId: 'excel', resumable: true };
  await saveBatchResumePlan(run, { id: run.id, tasks: [], board: { x: 0, y: 0, width: 300, height: 300 } });
  expect(await loadArrangementDetails('excel', [levels[0].id])).toHaveLength(1);
  await deleteBatchHistory(run.id);
  await expect(loadArrangementDetails('excel', [levels[0].id])).rejects.toThrow('找不到');
  expect(await loadArrangementDetails('library', [levels[0].id])).toHaveLength(1);
  expect((await loadActiveArrangementLibrary())?.id).toBe('library');
  await saveBatchHistory(entry('normal', 2));
  await deleteBatchHistory('normal');
  expect(await loadArrangementDetails('library', [levels[0].id])).toHaveLength(1);
});
