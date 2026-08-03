import { describe, expect, it } from 'vitest';
import levelsJson from '../../public/levels/levels.json';
import { decodeCompactLevelCollection } from '../game/levelDataFormat';
import { findPureLuckAlternative } from '../game/pureLuck';
import { BoardShape, cellKey, type Cell } from '../game/types';
import { selectUnambiguousHiddenCells } from '../game/unambiguousHidden';

const ambiguousPath: Cell[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
];

describe('pure-luck detection', () => {
  it('finds a second complete solution when two hidden cells can swap order', () => {
    const hidden = new Set([cellKey(ambiguousPath[1]), cellKey(ambiguousPath[2])]);
    const alternative = findPureLuckAlternative(ambiguousPath, hidden, BoardShape.Square);

    expect(alternative).not.toBeNull();
    expect(alternative?.firstDifferenceIndex).toBe(1);
    expect(alternative?.alternativePath.map(cellKey)).toEqual(['0,0', '0,1', '1,0', '1,1']);
  });

  it('does not report branches that cannot form another complete solution', () => {
    const hidden = new Set([cellKey(ambiguousPath[1])]);
    expect(findPureLuckAlternative(ambiguousPath, hidden, BoardShape.Square)).toBeNull();
  });

  it('reveals a discriminator when the requested hidden density is ambiguous', () => {
    const result = selectUnambiguousHiddenCells(ambiguousPath, BoardShape.Square, {
      hiddenPercent: 100,
      maxHiddenRun: 8,
      maxVisibleRun: 8,
      seed: 12345,
    });

    expect(result.targetCount).toBe(2);
    expect(result.hiddenCells.size).toBe(1);
    expect(findPureLuckAlternative(ambiguousPath, result.hiddenCells, BoardShape.Square)).toBeNull();
  });

  it('produces unique hidden layouts for every built-in level path', () => {
    const levels = decodeCompactLevelCollection(levelsJson, false);
    levels.forEach((level, index) => {
      const result = selectUnambiguousHiddenCells(level.solutionPath, level.boardShape, {
        hiddenPercent: 35,
        maxHiddenRun: 3,
        maxVisibleRun: 4,
        seed: 9000 + index,
      });
      expect(findPureLuckAlternative(level.solutionPath, result.hiddenCells, level.boardShape)).toBeNull();
    });
  });
});
