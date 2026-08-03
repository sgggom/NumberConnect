import { describe, expect, it } from 'vitest';
import levelsJson from '../../public/levels/levels.json';
import {
  decodeCompactLevelCollection,
  encodeCompactLevelCollection,
} from '../game/levelDataFormat';
import { BoardShape } from '../game/types';

describe('built-in level collection', () => {
  it('contains the 90 validated levels exported from the new workbook', () => {
    const levels = decodeCompactLevelCollection(levelsJson, false);
    const sizeCounts = levels.reduce<Record<string, number>>((counts, level) => {
      const size = `${level.rows}×${level.columns}`;
      counts[size] = (counts[size] ?? 0) + 1;
      return counts;
    }, {});

    expect(levels).toHaveLength(90);
    expect(levels.map((level) => level.levelId)).toEqual(
      Array.from({ length: 90 }, (_, index) => index + 1),
    );
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
    expect(encodeCompactLevelCollection(levels)).toEqual(levelsJson);
  });
});
