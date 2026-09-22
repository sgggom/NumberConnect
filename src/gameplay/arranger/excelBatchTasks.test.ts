import { expect, it } from 'vitest';
import { createArrangementLibraryRowParser, parseArrangementLibraryRows } from './levelArrangement';
import { createExcelBatchTasks } from './excelBatchTasks';
import { readArrangementWorkbookStream } from './streamArrangementWorkbook';
import { zipSync, strToU8 } from 'fflate';

it.each(['难度', '目标难度', 'difficulty'])('uses explicit %s values ahead of ID suffixes, including zero', (header) => {
  const parser = createArrangementLibraryRowParser(['关卡ID', '关卡数据', header], undefined, true);
  parser.addRow(['level_22_1_10', '{"data":[[1,-2],[4,3]]}', 0], 2);
  parser.addRow(['custom', '{"data":[[1,-2],[4,3]]}', 3], 3);
  expect(createExcelBatchTasks(parser.finish().levels, 'test.xlsx').map((task) => task.difficulty)).toEqual([0, 3]);
});

it.each([['关卡id', '关卡数据'], ['ID', 'data'], ['关卡名', '关卡JSON']])('reads two-column calculation workbooks: %s / %s', async (id, data) => {
  const rows = [[id, data], ['123', '{"data":[[1,-2],[4,3]]}'], ['123', '[[1,2],[4,-3]]']];
  const sheet = `<worksheet><sheetData>${rows.map((row, i) => `<row r="${i + 1}">${row.map((value, j) => `<c r="${j ? 'B' : 'A'}${i + 1}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const archive = zipSync({ 'xl/worksheets/sheet1.xml': strToU8(sheet) });
  const result = await readArrangementWorkbookStream(archive.buffer as ArrayBuffer, undefined, undefined, true);
  expect(result.skippedRows).toBe(0);
  expect(result.levels).toHaveLength(2);
  expect(result.levels[0].id).toBe('123');
  expect(result.levels[1].id).not.toBe('123');
  expect(result.levels.map((level) => level.levelData.data)).toEqual([[[1, -2], [4, 3]], [[1, 2], [4, -3]]]);
});

it('calculates every Excel record including all difficulties and duplicate names on the same path', () => {
  const grid = JSON.stringify({ data: [[1, -2], [4, 3]] });
  const rows = [
    ['关卡名', '关卡JSON', '路径JSON', '棋盘形状', '目标难度'],
    ['level_22_1_1', grid, grid, '正方形', 1],
    ['level_22_1_2', grid, grid, '正方形', 2],
    ['level_22_1_2', grid, grid, '正方形', 2],
    ['level_99_3_10', grid, grid, '正方形', 10],
  ];
  const { levels } = parseArrangementLibraryRows(rows);
  const tasks = createExcelBatchTasks(levels, 'all.xlsx');
  expect(tasks).toHaveLength(4);
  expect(tasks.map((task) => task.difficulty)).toEqual([1, 2, 2, 10]);
  expect(tasks.map((task) => task.groupId)).toEqual([2, 3, 4, 5]);
  expect(new Set(tasks.map((task) => task.id)).size).toBe(4);
  expect(tasks.every((task) => task.configuration === 'all.xlsx')).toBe(true);
});
