import { describe, expect, it } from 'vitest';
import { BoardShape } from '../../game/types';
import {
  decodeClipboardLevelJson,
  looksLikeClipboardLevelJson,
} from './clipboardLevelJson';

const COMPLETE_LEVEL_JSON = JSON.stringify({
  data: [
    [32, -31, 30, 29, 18, 17, 16, -14],
    [34, 33, 28, 21, -22, -19, -15, 13],
    [35, 27, -26, -23, -20, -10, 11, 12],
    [-36, 37, 25, -24, 8, -9, 62, 63],
    [38, 40, 51, 50, 49, -7, -61, 64],
    [41, -39, -46, 52, -48, -60, 6, 1],
    [42, 45, -53, -47, 59, 57, -2, -5],
    [43, -44, 54, 55, -56, 58, 4, -3],
  ],
});

const SIX_BY_EIGHT_LEVEL_JSON = '{"data":[[39,38,-37,36,-35,-33],[-40,43,-44,45,32,34],[41,-42,-10,-12,46,-31],[8,9,11,13,-47,-30],[6,-7,18,-14,48,29],[5,1,19,-17,15,-28],[2,-4,21,-20,16,-27],[-3,22,-23,24,25,-26]]}';

describe('clipboard level JSON', () => {
  it('recognizes JSON-looking clipboard text', () => {
    expect(looksLikeClipboardLevelJson(` \n${COMPLETE_LEVEL_JSON}`)).toBe(true);
    expect(looksLikeClipboardLevelJson('[{"data":[[1]]}]')).toBe(true);
    expect(looksLikeClipboardLevelJson(
      `"${COMPLETE_LEVEL_JSON.replace(/"/g, '""')}"\r\n`,
    )).toBe(true);
    expect(looksLikeClipboardLevelJson('ordinary clipboard text')).toBe(false);
  });

  it('decodes a complete level with negative hidden values', () => {
    const level = decodeClipboardLevelJson(COMPLETE_LEVEL_JSON);

    expect(level).toMatchObject({
      boardShape: BoardShape.Square,
      rows: 8,
      columns: 8,
      custom: true,
      pathSource: 'manual',
    });
    expect(level.activeCells).toHaveLength(64);
    expect(level.solutionPath).toHaveLength(64);
    expect(level.hiddenCells).toHaveLength(25);
    expect(level.solutionPath[0]).toEqual({ x: 7, y: 5 });
    expect(level.solutionPath[63]).toEqual({ x: 7, y: 4 });
    expect(level.hiddenCells).toContainEqual({ x: 6, y: 6 });
    expect(level.hiddenCells).toContainEqual({ x: 1, y: 0 });
  });

  it('decodes JSON copied as a complete Excel cell', () => {
    const copiedCell = `"${COMPLETE_LEVEL_JSON.replace(/"/g, '""')}"\r\n`;
    const level = decodeClipboardLevelJson(copiedCell);

    expect(level.rows).toBe(8);
    expect(level.columns).toBe(8);
    expect(level.solutionPath).toHaveLength(64);
    expect(level.hiddenCells).toHaveLength(25);
  });

  it('decodes raw JSON with a trailing row break and JSON string wrappers', () => {
    expect(decodeClipboardLevelJson(`${COMPLETE_LEVEL_JSON}\r\n`).solutionPath)
      .toHaveLength(64);
    expect(decodeClipboardLevelJson(JSON.stringify(COMPLETE_LEVEL_JSON)).solutionPath)
      .toHaveLength(64);
  });

  it('decodes a 6×8 level copied from a spreadsheet cell', () => {
    const copiedCell = `"${SIX_BY_EIGHT_LEVEL_JSON.replace(/"/g, '""')}"\r\n`;
    const level = decodeClipboardLevelJson(copiedCell);

    expect(level.rows).toBe(8);
    expect(level.columns).toBe(6);
    expect(level.solutionPath).toHaveLength(48);
  });

  it('decodes rectangular levels with a one-cell side', () => {
    const level = decodeClipboardLevelJson('{"data":[[1,2]]}');

    expect(level).toMatchObject({
      boardShape: BoardShape.Rectangle,
      rows: 1,
      columns: 2,
    });
  });

  it('rejects invalid text and multi-level collections', () => {
    expect(() => decodeClipboardLevelJson('not json'))
      .toThrow('剪贴板文本不是有效的关卡 JSON');
    expect(() => decodeClipboardLevelJson('[{"data":[[1]]},{"data":[[1]]}]'))
      .toThrow('一次只能读取一个关卡 JSON');
  });
});
