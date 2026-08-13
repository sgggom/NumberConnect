import { describe, expect, it } from 'vitest';
import type { SheetData } from 'read-excel-file/browser';
import readExcelFileNode from 'read-excel-file/node';
import { parseMode5WorkbookSheets } from './mode5Workbook';

describe('玩法5 Excel 关卡配表', () => {
  it('读取当前关卡表中的7个大关和26个阶段', async () => {
    const result = parseMode5WorkbookSheets(await readExcelFileNode('excel/关卡表.xlsx'));
    expect(result.campaign).toHaveLength(7);
    expect(result.levels).toHaveLength(26);
    expect(result.campaign.map((level) => level.formationIds)).toEqual([
      [1, 2],
      [3, 4, 5, 6],
      [7, 8, 9, 10],
      [11, 12, 13, 14],
      [15, 16, 17, 18],
      [19, 20, 21, 22],
      [23, 24, 25, 26],
    ]);
    expect(result.levels[0].algorithm).toBeUndefined();
    expect(result.levels[1].algorithm).toBeUndefined();
    expect(result.levels[0].hiddenCells).toEqual([]);
    expect(result.levels[1].hiddenCells).toEqual([
      result.levels[1].solutionPath[1],
      result.levels[1].solutionPath[6],
    ]);
    expect(result.levels[2].algorithm?.id).toBe('algorithm-8');
  });

  it('按关卡 sheet 的顺序解析阶段并查找阵型数据', () => {
    const result = parseMode5WorkbookSheets([
      {
        sheet: '关卡',
        data: [
          ['id', 'data'],
          [1, '[2,1]'],
          [2, '[3]'],
        ] as SheetData,
      },
      {
        sheet: '阵型',
        data: [
          ['id', 'data'],
          [1, '[[1,2,3,4]]'],
          [2, '[[1,2],[4,3]]'],
          [3, '[[1,2,3]]'],
        ] as SheetData,
      },
    ]);

    expect(result.campaign).toEqual([
      { id: 1, formationIds: [2, 1], stageLevelIds: [1, 2] },
      { id: 2, formationIds: [3], stageLevelIds: [3] },
    ]);
    expect(result.levels).toHaveLength(3);
    expect(result.levels[0]).toMatchObject({ levelId: 1, rows: 2, columns: 2 });
    expect(result.levels[1]).toMatchObject({ levelId: 2, rows: 1, columns: 4 });
    expect(result.levels[0].algorithm).toBeUndefined();
    expect(result.levels[1].algorithm).toBeUndefined();
    expect(result.levels[2].algorithm?.id).toBe('algorithm-8');
  });

  it('拒绝不存在的阵型引用', () => {
    expect(() => parseMode5WorkbookSheets([
      { sheet: '关卡', data: [['id', 'data'], [1, '[9]']] as SheetData },
      { sheet: '阵型', data: [['id', 'data'], [1, '[[1]]']] as SheetData },
    ])).toThrow('不存在的阵型 9');
  });
});
