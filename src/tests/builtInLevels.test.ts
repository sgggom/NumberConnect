import { describe, expect, it } from 'vitest';
import levelsJson from '../../public/levels/levels.json';
import {
  decodeCompactLevelCollection,
  encodeCompactLevelCollection,
} from '../game/levelDataFormat';

describe('built-in level collection', () => {
  it('is empty', () => {
    const levels = decodeCompactLevelCollection(levelsJson, false);

    expect(levels).toEqual([]);
    expect(encodeCompactLevelCollection(levels)).toEqual(levelsJson);
  });
});
