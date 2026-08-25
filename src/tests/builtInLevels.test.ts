import { describe, expect, it } from 'vitest';
import levelsJson from '../../public/levels/levels.json';
import beadLevelsJson from '../../public/levels/bead-levels.json';
import mode3LevelsJson from '../../public/levels/mode3-levels.json';
import {
  decodeCompactLevelCollection,
  encodeCompactLevelCollection,
} from '../game/levelDataFormat';
import { BoardShape } from '../game/types';

describe('built-in level collection', () => {
  it('contains the 9 bundled campaign levels', () => {
    const levels = decodeCompactLevelCollection(levelsJson, false);
    const sizeCounts = levels.reduce<Record<string, number>>((counts, level) => {
      const size = `${level.rows}×${level.columns}`;
      counts[size] = (counts[size] ?? 0) + 1;
      return counts;
    }, {});

    expect(levels).toHaveLength(9);
    expect(levels.map((level) => level.levelId)).toEqual(
      Array.from({ length: 9 }, (_, index) => index + 1),
    );
    expect(levels.filter((level) => level.boardShape === BoardShape.Square)).toHaveLength(5);
    expect(levels.filter((level) => level.boardShape === BoardShape.Rectangle)).toHaveLength(4);
    expect(sizeCounts).toEqual({
      '1×5': 1,
      '5×1': 1,
      '3×5': 1,
      '5×4': 1,
      '5×5': 1,
      '6×6': 4,
    });
    expect(encodeCompactLevelCollection(levels)).toEqual(levelsJson);
  });

  it('keeps the 90 rectangular levels in the bead gameplay pool', () => {
    const levels = decodeCompactLevelCollection(beadLevelsJson, false);
    const sizeCounts = levels.reduce<Record<string, number>>((counts, level) => {
      const size = `${level.rows}×${level.columns}`;
      counts[size] = (counts[size] ?? 0) + 1;
      return counts;
    }, {});

    expect(levels).toHaveLength(90);
    expect(levels.every((level) => level.boardShape === BoardShape.Rectangle)).toBe(true);
    expect(sizeCounts).toEqual({
      '8×6': 10,
      '9×6': 10,
      '10×6': 10,
      '9×7': 10,
      '10×7': 10,
      '11×7': 10,
      '10×8': 10,
      '11×8': 10,
      '12×8': 10,
    });
  });

  it('keeps the 24 supplied levels in the gameplay 3 pool', () => {
    const levels = decodeCompactLevelCollection(mode3LevelsJson, false);
    const sizeCounts = levels.reduce<Record<string, number>>((counts, level) => {
      const size = `${level.rows}×${level.columns}`;
      counts[size] = (counts[size] ?? 0) + 1;
      return counts;
    }, {});

    expect(levels).toHaveLength(24);
    expect(levels.map((level) => level.levelId)).toEqual(
      Array.from({ length: 24 }, (_, index) => index + 1),
    );
    expect(sizeCounts).toEqual({
      '3×3': 1,
      '4×4': 1,
      '5×5': 1,
      '6×6': 3,
      '7×6': 4,
      '8×6': 8,
      '7×5': 2,
      '8×5': 2,
      '9×6': 1,
      '5×6': 1,
    });
    expect(encodeCompactLevelCollection(levels)).toEqual(Object.values(mode3LevelsJson));
  });
});
