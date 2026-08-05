import { describe, expect, it, vi } from 'vitest';
import {
  PLAY_PUZZLE_PATTERNS,
  advancePlayPuzzleProgress,
  loadPlayPuzzleProgress,
  nextPlayPuzzlePattern,
  puzzlePieceCount,
  savePlayPuzzleProgress,
} from './playPuzzleShowcase';

describe('play puzzle showcase', () => {
  it('owns a separate set of puzzle artwork and piece counts', () => {
    expect(PLAY_PUZZLE_PATTERNS).toHaveLength(14);
    expect(new Set(PLAY_PUZZLE_PATTERNS.map((pattern) => pattern.id)).size).toBe(14);
    expect(PLAY_PUZZLE_PATTERNS.every((pattern) => puzzlePieceCount(pattern) === 4)).toBe(true);
  });

  it('advances one puzzle piece without exceeding the current picture', () => {
    const pattern = PLAY_PUZZLE_PATTERNS[0];
    expect(advancePlayPuzzleProgress(pattern, { patternId: pattern.id, revealed: 2 }).revealed).toBe(3);
    expect(advancePlayPuzzleProgress(pattern, { patternId: pattern.id, revealed: 4 }).revealed).toBe(4);
  });

  it('loads, saves, and rotates puzzle progress independently', () => {
    const setItem = vi.fn();
    const storage = {
      getItem: () => JSON.stringify({ patternId: 'fj23', revealed: 2 }),
      setItem,
    };
    expect(loadPlayPuzzleProgress(storage)).toEqual({ patternId: 'fj23', revealed: 2 });
    savePlayPuzzleProgress({ patternId: 'fj23', revealed: 3 }, storage);
    expect(setItem).toHaveBeenCalledWith(
      'number-connect.play-puzzle-showcase.v1',
      JSON.stringify({ patternId: 'fj23', revealed: 3 }),
    );
    expect(nextPlayPuzzlePattern(PLAY_PUZZLE_PATTERNS[0]).id).toBe('fj23');
  });
});
