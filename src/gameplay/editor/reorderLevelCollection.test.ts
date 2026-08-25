import { describe, expect, it } from 'vitest';
import { BoardShape, type LevelData } from '../../game/types';
import { reorderLevelCollection } from './reorderLevelCollection';

const makeLevel = (levelId: number): LevelData => ({
  levelId,
  boardShape: BoardShape.Square,
  rows: 1,
  columns: 1,
  activeCells: [{ x: levelId, y: 0 }],
  solutionPath: [{ x: levelId, y: 0 }],
});

const originalIds = (levels: ReadonlyArray<LevelData>): number[] => (
  levels.map((level) => level.activeCells[0].x)
);

describe('编辑器关卡目标位置排序', () => {
  const levels = [1, 2, 3, 4, 5].map(makeLevel);

  it('把关卡插入靠后目标位置，其他关卡依次前移', () => {
    const result = reorderLevelCollection(levels, 2, 5);
    expect(originalIds(result)).toEqual([1, 3, 4, 5, 2]);
    expect(result.map((level) => level.levelId)).toEqual([1, 2, 3, 4, 5]);
  });

  it('把关卡插入靠前目标位置，其他关卡依次后移', () => {
    expect(originalIds(reorderLevelCollection(levels, 5, 2))).toEqual([1, 5, 2, 3, 4]);
  });

  it('目标位置无效时保持原顺序', () => {
    expect(originalIds(reorderLevelCollection(levels, 3, 0))).toEqual([1, 2, 3, 4, 5]);
    expect(originalIds(reorderLevelCollection(levels, 3, 6))).toEqual([1, 2, 3, 4, 5]);
  });
});
