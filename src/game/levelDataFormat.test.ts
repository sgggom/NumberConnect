import { describe, expect, it } from 'vitest';
import {
  decodeCompactLevelCollection,
  decodeCompactLevelData,
  encodeCompactLevelData,
} from './levelDataFormat';
import { BoardShape, type LevelData } from './types';

const makeLevel = (): LevelData => ({
  levelId: 1,
  boardShape: BoardShape.Square,
  rows: 3,
  columns: 3,
  activeCells: [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
    { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 },
    { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
  ],
  solutionPath: [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
    { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 },
    { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
  ],
  hiddenCells: [{ x: 1, y: 1 }, { x: 1, y: 2 }],
});

describe('compact level data format', () => {
  it('stores hidden values as negative integers and no metadata', () => {
    expect(encodeCompactLevelData(makeLevel())).toEqual({
      data: [
        [1, 2, 3],
        [6, -5, 4],
        [7, -8, 9],
      ],
    });
  });

  it('reconstructs the complete path and hidden cells from absolute values', () => {
    const decoded = decodeCompactLevelData({
      data: [
        [1, 2, 3],
        [6, -5, 4],
        [7, -8, 9],
      ],
    }, 4, true);

    expect(decoded).toMatchObject({
      levelId: 4,
      boardShape: BoardShape.Square,
      rows: 3,
      columns: 3,
      solutionPath: makeLevel().solutionPath,
      hiddenCells: [{ x: 1, y: 1 }, { x: 1, y: 2 }],
      custom: true,
    });
  });

  it('uses zero for positions outside the active path', () => {
    const decoded = decodeCompactLevelData({ data: [[1, 0], [0, -2]] }, 1, true);
    expect(decoded.activeCells).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    expect(decoded.solutionPath).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });

  it('accepts the single-level object shown by the format and rejects metadata', () => {
    expect(decodeCompactLevelCollection({ data: [[1]] }, true)).toHaveLength(1);
    expect(() => decodeCompactLevelData({ data: [[1]], rows: 1 }, 1, true))
      .toThrow('JSON 对象只能包含 data 字段');
  });

  it('rejects duplicate or discontinuous absolute values', () => {
    expect(() => decodeCompactLevelData({ data: [[1, -1]] }, 1, true)).toThrow('数字 1 重复');
    expect(() => decodeCompactLevelData({ data: [[1, 3], [0, 0]] }, 1, true))
      .toThrow('数字绝对值必须不重复且连续覆盖');
  });
});
