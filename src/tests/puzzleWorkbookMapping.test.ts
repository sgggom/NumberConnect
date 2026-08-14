import { describe, expect, it } from 'vitest';
import readExcelFileNode from 'read-excel-file/node';
import { mode5StageLevelId } from '../gameplay/mode5/mode5Campaign';
import { parseMode5WorkbookSheets } from '../gameplay/mode5/mode5Workbook';

describe('puzzle workbook stage mapping', () => {
  it('maps displayed puzzle stages from the current workbook', async () => {
    const workbook = parseMode5WorkbookSheets(await readExcelFileNode('excel/关卡表.xlsx'));

    expect(workbook.campaign[0].formationIds).toEqual([1, 2, 3, 4]);
    expect(workbook.campaign[1].formationIds).toEqual([5, 6, 7, 8]);
    expect(mode5StageLevelId(workbook.campaign, 2, 1)).toBe(5);
    expect(mode5StageLevelId(workbook.campaign, 2, 4)).toBe(8);
  });
});
