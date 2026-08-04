import { describe, expect, it } from 'vitest';
import {
  PLAY_BEAD_SHOWCASE_PATTERNS,
  loadPlayBeadShowcaseProgress,
  nextPlayBeadShowcasePattern,
  playBeadShowcaseColorsForBoard,
  playBeadShowcasePatternFor,
  shouldUsePlayBeadShowcase,
} from './playBeadShowcase';

describe('play bead showcase', () => {
  it('provides distinct, fully occupied 20 by 10 bead illustrations', () => {
    expect(PLAY_BEAD_SHOWCASE_PATTERNS).toHaveLength(4);
    expect(new Set(PLAY_BEAD_SHOWCASE_PATTERNS.map((pattern) => pattern.id)).size).toBe(4);
    PLAY_BEAD_SHOWCASE_PATTERNS.forEach((pattern) => {
      expect([pattern.width, pattern.height]).toEqual([20, 10]);
      expect(pattern.pixels).toHaveLength(200);
      expect(new Set(pattern.pixels.map(({ x, y }) => `${x},${y}`)).size).toBe(200);
      expect(pattern.pixels.every(({ x, y }) => x >= 0 && x < 20 && y >= 0 && y < 10)).toBe(true);
    });
  });

  it('selects a stable pattern from the level id', () => {
    expect(playBeadShowcasePatternFor(1).id).toBe('rainbow-whale-bay');
    expect(playBeadShowcasePatternFor(5).id).toBe('rainbow-whale-bay');
    expect(playBeadShowcasePatternFor(2).id).toBe('cloud-balloon-trip');
  });

  it('assigns one representative bead color to every board number', () => {
    const pixels = PLAY_BEAD_SHOWCASE_PATTERNS[1].pixels.slice(40, 76);
    expect(playBeadShowcaseColorsForBoard(pixels, 36)).toHaveLength(36);
    expect(playBeadShowcaseColorsForBoard(pixels, 96)).toHaveLength(96);
  });

  it('disables the showcase for editor playtests', () => {
    expect(shouldUsePlayBeadShowcase('editor-playtest')).toBe(false);
    expect(shouldUsePlayBeadShowcase('bead')).toBe(false);
    expect(shouldUsePlayBeadShowcase('collection')).toBe(false);
    expect(shouldUsePlayBeadShowcase('normal')).toBe(true);
    expect(shouldUsePlayBeadShowcase('daily')).toBe(true);
  });

  it('loads saved progress and advances to the next illustration', () => {
    const storage = {
      getItem: () => JSON.stringify({ patternId: 'cloud-balloon-trip', collected: 81 }),
      setItem: () => undefined,
    };
    expect(loadPlayBeadShowcaseProgress(storage)).toEqual({
      patternId: 'cloud-balloon-trip',
      collected: 81,
    });
    expect(nextPlayBeadShowcasePattern(PLAY_BEAD_SHOWCASE_PATTERNS[0]).id)
      .toBe('cloud-balloon-trip');
  });
});
