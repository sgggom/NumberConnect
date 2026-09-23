import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createImportedSimulationParser } from './importedSimulationResults';
import { METRIC_COLUMNS } from './configurationBatchMetrics';
import { parseArrangementLibraryRows } from './levelArrangement';
import { createArrangementIndexBuilder, loadArrangementIndices, writeArrangementBatch } from './arrangementDatabase';

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange); });
afterEach(() => vi.unstubAllGlobals());
const json = JSON.stringify({ data: [[1, -2], [4, 3]] });
it('reads appended BC:BR simulation results and persists them per difficulty in the library index', async () => {
  const headers: unknown[] = ['关卡名', '关卡JSON', '路径JSON', '棋盘形状', '目标难度'];
  headers.length = 54;
  headers.push('id', '难度', '模拟次数', '通关次数', ...METRIC_COLUMNS.map(([, title]) => title), '状态');
  const row = (difficulty: number) => {
    const id = `level_56_1_${difficulty}`;
    const values: unknown[] = [id, json, json, '长方形', difficulty]; values.length = 54;
    values.push(id, difficulty, 10, 10, 30, 6, 5, 2, 1, 0, 0, 1, 0, 5.5, 1.5, '已通关（10/10次）');
    return values;
  };
  const result = parseArrangementLibraryRows([headers, row(1), row(2)]);
  const expected = { total: 30, hidden: 6, singleCertain: 5, singleMisleading: 2, twoGapOne: 1, twoGapTwo: 0,
    longConnections: 0, mediumConnections: 1, multiple: 0, bottlenecks: 5.5, errors: 1.5 };
  expect(result.levels[0].importedSimulation).toEqual({ metrics: expected, status: '已通关（10/10次）', repetitions: 10, completedRuns: 10 });
  expect(result.parameterHeaders).not.toContain('空1必中数量');
  await writeArrangementBatch('import', result.levels, createArrangementIndexBuilder());
  const loaded = await loadArrangementIndices('import');
  expect(loaded.map((level) => level.importedSimulation?.metrics)).toEqual([expected, expected]);
  expect(loaded.map((level) => level.difficultyId)).toEqual([1, 2]);
});
it('matches by header rather than position and keeps missing values distinct from zero', () => {
  const parser = createImportedSimulationParser([' 错误次数 ', '长连接数量', '中连接数量', '卡点', '状态']);
  const result = parser.parse([0, '', null, 2.35, '已通关'], 'level_1');
  expect(result?.metrics).toEqual({ errors: 0, bottlenecks: 2.35 });
  expect(parser.parse(['', '', '', '', ''], 'level_1')).toBeUndefined();
  expect(parser.parse(['#N/A', -2, 'NaN', 'Infinity', '失败'], 'level_1')?.metrics).toEqual({});
});
it('does not attach another ID or difficulty result to the row', () => {
  const parser = createImportedSimulationParser(['id', '难度', '错误次数']);
  expect(parser.parse(['other', 1, 2], 'level_1', 1)).toBeUndefined();
  expect(parser.parse(['level_1', 2, 2], 'level_1', 1)).toBeUndefined();
  expect(parser.parse(['level_1', 1, 2], 'level_1', 1)?.metrics.errors).toBe(2);
});
it('does not turn old editor statistics into arranger simulation results', () => {
  const parser = createImportedSimulationParser(['中推理平均错误数', '每关跑关次数']);
  expect(parser.parse([3, 100], 'level_1')).toBeUndefined();
  expect(parser.columns.size).toBe(0);
});
