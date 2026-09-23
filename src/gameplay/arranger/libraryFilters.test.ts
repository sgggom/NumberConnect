import { createTrimmedArrangementLibrary, commitArrangementLibrary, loadActiveArrangementLibrary, loadArrangementDetails, loadArrangementLibrary, loadArrangementRootLibrary } from './arrangementDatabase';
import { legacyLibraryFilterHeaders, legacyLibraryFilterValues } from './legacyLibraryFilters';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { matchesLibraryFilters, increasingErrorTrendLevelIds } from './libraryFilters';
import { parseArrangementLibraryRows, parseArrangementClipboardText, selectArrangementExportLevels } from './levelArrangement';
import { writeArrangementBatch, createArrangementIndexBuilder, loadArrangementFilterMatches, loadArrangementIndices } from './arrangementDatabase';
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange); });
afterEach(() => vi.unstubAllGlobals());
it('combines selected fields, compares numbers inclusively, and never treats missing values as zero', () => {
  const rules = [{ column: 0, operator: 'contains' as const, value: 'LEVEL' }, { column: 1, operator: 'gte' as const, value: '0' }];
  expect(matchesLibraryFilters(['level_1', '0'], rules)).toBe(true);
  expect(matchesLibraryFilters(['level_1', ''], rules)).toBe(false);
  expect(matchesLibraryFilters(['other', '2'], rules)).toBe(false);
  expect(matchesLibraryFilters(['3.5'], [{ column: 0, operator: 'lte', value: '3.5' }])).toBe(true);
  expect(matchesLibraryFilters(['3.50'], [{ column: 0, operator: 'eq', value: '3.5' }])).toBe(true);
  expect(matchesLibraryFilters([''], [{ column: 0, operator: 'empty', value: '' }])).toBe(true);
  expect(matchesLibraryFilters(['0'], [{ column: 0, operator: 'notEmpty', value: '' }])).toBe(true);
});
it('preserves every source header, filters across disk batch boundaries, and keeps raw rows out of indices', async () => {
  const headers = ['关卡名', '关卡JSON', '路径JSON', '棋盘形状', '目标难度', '错误次数', '自定义字段'];
  const json = JSON.stringify({ data: [[1, -2], [4, 3]] });
  const rows = Array.from({ length: 510 }, (_, i) => [`level_22_1_${i}`, json, json, '正方形', i, i / 10, i % 2 ? 'B' : 'A']);
  const parsed = parseArrangementLibraryRows([headers, ...rows]);
  expect(parsed.sourceHeaders).toEqual(headers);
  await writeArrangementBatch('a', parsed.levels, createArrangementIndexBuilder());
  const matches = await loadArrangementFilterMatches('a', [{ column: 5, operator: 'gte', value: '50' }, { column: 6, operator: 'eq', value: 'A' }]);
  expect([...matches].sort()).toEqual([500, 502, 504, 506, 508].map((i) => `level_22_1_${i}`));
  expect((await loadArrangementIndices('a'))[0]).not.toHaveProperty('sourceValues');
  expect(await loadArrangementFilterMatches('a', [{ column: 5, operator: 'gte', value: '100' }])).toEqual(new Set());
  expect((await loadArrangementFilterMatches('a', [])).size).toBe(510);
});

it('restores split path, difficulty and simulation keys for old cached libraries and uses them in disk filtering', async () => {
  const json = JSON.stringify({ data: [[1, -2], [4, 3]] });
  const parsed = parseArrangementLibraryRows([
    ['关卡名', '关卡JSON', '路径JSON', '棋盘形状', '目标难度', '实际路径交叉数量', '实际隐藏数', '错误次数'],
    ['level_22_1_1', json, json, '正方形', 1, 3, 1, 2.5],
  ]);
  const level = parsed.levels[0]; delete level.sourceValues;
  await writeArrangementBatch('legacy', [level], createArrangementIndexBuilder());
  const index = (await loadArrangementIndices('legacy'))[0];
  const headers = legacyLibraryFilterHeaders(parsed.parameterHeaders);
  for (const key of ['实际路径交叉数量','目标难度','实际隐藏数','错误次数','长连接数量','中连接数量','关卡JSON','路径JSON']) expect(headers).toContain(key);
  const values = legacyLibraryFilterValues(headers, parsed.parameterHeaders, index, level);
  expect(values[headers.indexOf('实际路径交叉数量')]).toBe('3');
  expect(values[headers.indexOf('实际隐藏数')]).toBe('1');
  expect(values[headers.indexOf('错误次数')]).toBe('2.5');
  expect(values[headers.indexOf('长连接数量')]).toBe('');
  expect(values[headers.indexOf('路径JSON')]).toBe('');
  const matched = await loadArrangementFilterMatches('legacy', [{ column: headers.indexOf('错误次数'), operator: 'gte', value: '2.5' }],
    (_, detail) => legacyLibraryFilterValues(headers, parsed.parameterHeaders, index, detail));
  expect([...matched]).toEqual(['level_22_1_1']);
});

it('compares only difficulties 1, 5 and 10 and retains every row of qualifying paths', () => {
  const json = JSON.stringify({ data: [[1, -2], [4, 3]] });
  const headers = ['关卡名', '关卡JSON', '路径JSON', '棋盘形状', '目标难度', '错误次数'];
  const row = (path: number, difficulty: number, errors: unknown) => [`level_22_${path}_${difficulty}`, json, json, '正方形', difficulty, errors];
  const levels = parseArrangementLibraryRows([headers,
    row(1, 10, 3), row(1, 1, 0), row(1, 5, 2), row(1, 2, 100), row(1, 3, ''),
    row(2, 1, 2), row(2, 5, 2), row(2, 10, 4),
    row(3, 1, 0), row(3, 5, ''), row(3, 10, 3),
    row(4, 1, 0), row(4, 5, 1),
    row(5, 1, 0), row(5, 5, 3), row(5, 10, 2),
  ]).levels;
  expect([...increasingErrorTrendLevelIds(levels)].sort()).toEqual(['level_22_1_1','level_22_1_10','level_22_1_2','level_22_1_3','level_22_1_5']);
});
it('does not mask non-increasing same-difficulty variants by averaging', () => {
  const json = JSON.stringify({ data: [[1, -2], [4, 3]] });
  const headers = ['关卡名', '关卡JSON', '路径JSON', '棋盘形状', '目标难度', '错误次数'];
  const row = (difficulty: number, errors: number) => [`level_22_1_${difficulty}`, json, json, '正方形', difficulty, errors];
  const levels = parseArrangementLibraryRows([headers, row(1, 1), row(1, 3), row(5, 2), row(5, 4), row(10, 5)]).levels;
  expect(increasingErrorTrendLevelIds(levels).size).toBe(0);
  levels[2].importedSimulation!.metrics.errors = 3.1;
  expect(increasingErrorTrendLevelIds(levels).size).toBe(5);
});

it('creates an independent persistent trimmed library and preserves the original data', async () => {
  const json = JSON.stringify({ data: [[1, -2], [4, 3]] });
  const parsed = parseArrangementLibraryRows([
    ['关卡名', '关卡JSON', '路径JSON', '棋盘形状', '目标难度', '错误次数'],
    ['level_22_1_1', json, json, '正方形', 1, 1],
    ['level_22_1_5', json, json, '正方形', 5, 2],
    ['level_22_1_10', json, json, '正方形', 10, 3],
    ['level_22_2_1', json, json, '正方形', 1, 3],
    ['level_22_2_2', json, json, '正方形', 2, 2],
  ]);
  const source = { id: 'source', name: 'test.xlsx', count: 5, skippedRows: 0,
    parameterHeaders: parsed.parameterHeaders, sourceHeaders: parsed.sourceHeaders };
  await writeArrangementBatch(source.id, parsed.levels, createArrangementIndexBuilder());
  await commitArrangementLibrary(source);
  const indices = await loadArrangementIndices(source.id);
  const accepted = increasingErrorTrendLevelIds(indices);
  const trimmed = await createTrimmedArrangementLibrary(source, indices.filter((level) => accepted.has(level.id)));
  expect(await loadArrangementRootLibrary(trimmed)).toEqual(source);
  expect(trimmed.count).toBe(3); expect(trimmed.sourceLibraryId).toBe(source.id);
  expect((await loadActiveArrangementLibrary())?.id).toBe(trimmed.id);
  expect(await loadArrangementLibrary(trimmed.id)).toEqual(trimmed);
  expect((await loadArrangementIndices(trimmed.id)).map((level) => level.id)).toEqual(['level_22_1_1', 'level_22_1_5', 'level_22_1_10']);
  expect(await loadArrangementDetails(trimmed.id, ['level_22_1_1'])).toEqual(await loadArrangementDetails(source.id, ['level_22_1_1']));
  expect(await loadArrangementIndices(source.id)).toHaveLength(5);
  const root = await loadArrangementRootLibrary(trimmed);
  const rootLevels = await loadArrangementIndices(root.id);
  const clipboardGroups = parseArrangementClipboardText('1\t[level_22_2_1]');
  const exported = selectArrangementExportLevels(clipboardGroups, rootLevels);
  expect(exported.map((level) => level.id)).toEqual(['level_22_2_1', 'level_22_2_2']);
  expect((await loadArrangementDetails(root.id, exported.map((level) => level.id))).every((detail) => !!detail.levelData)).toBe(true);
  expect((await loadActiveArrangementLibrary())?.id).toBe(trimmed.id);

  await expect(createTrimmedArrangementLibrary(source, [])).rejects.toThrow('没有符合条件');
  expect((await loadActiveArrangementLibrary())?.id).toBe(trimmed.id);
  await commitArrangementLibrary(source);
  expect((await loadActiveArrangementLibrary())?.id).toBe(source.id);
});

it('rejects missing or cyclic source links without silently cutting an incomplete subset', async () => {
  const source = { id: 'a', name: 'a', count: 0, parameterHeaders: [], skippedRows: 0, sourceLibraryId: 'missing' };
  await expect(loadArrangementRootLibrary(source)).rejects.toThrow('原库不存在');
  await commitArrangementLibrary({ ...source, sourceLibraryId: 'a' });
  await expect(loadArrangementRootLibrary({ ...source, sourceLibraryId: 'a' })).rejects.toThrow('原库关联异常');
});
