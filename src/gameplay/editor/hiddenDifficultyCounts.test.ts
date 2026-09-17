import { describe, expect, it } from 'vitest';
import { decodeCompactLevelData } from '../../game/levelDataFormat';
import { calculateHiddenDifficultyCounts, countHiddenDifficultyScores } from './hiddenDifficultyCounts';

describe('hidden difficulty counts', () => {
  it('puts fractional scores and boundary values in the confirmed bands', () => {
    expect(countHiddenDifficultyScores([0, 0.2, 0.999, 1, 1.2, 1.999, 2, 2.4, 3])).toEqual([3, 3, 3]);
    expect(countHiddenDifficultyScores([])).toEqual([0, 0, 0]);
  });

  it('scores each authored hidden position once, excluding visible cells and alternate attempts', () => {
    // Workbook regression: positions 13 and 14 score 2 and 1, respectively.
    const level = decodeCompactLevelData({ data: [
      [0, 21, -13, -14, 0],
      [20, 11, 12, -16, 15],
      [-10, 19, 18, 17, 1],
      [-9, 6, 5, -4, 2],
      [0, 8, 7, 3, 0],
    ] }, 1, false);
    const path = level.solutionPath;
    const hiddenCellKeys = new Set(level.hiddenCells!.map((cell) => `${cell.x},${cell.y}`));
    const snapshot = structuredClone(path);
    expect(calculateHiddenDifficultyCounts({ path, hiddenCellKeys, shape: 'square' })).toEqual([4, 1, 1]);
    expect(calculateHiddenDifficultyCounts({ path, hiddenCellKeys, shape: 'square' })).toEqual([4, 1, 1]);
    expect(path).toEqual(snapshot);
    expect(hiddenCellKeys.size).toBe(6);
    expect(calculateHiddenDifficultyCounts({ path, hiddenCellKeys: new Set(), shape: 'square' })).toEqual([0, 0, 0]);
  });
});
