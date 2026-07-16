import { describe, expect, it } from 'vitest';
import { findSwappableHiddenPairs } from '../game/hiddenSwap';
import { BoardShape, cellKey, type Cell } from '../game/types';

const squareLoop: Cell[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
];

describe('swappable hidden pairs', () => {
  it('finds an exact two-cell hidden run when both orders remain adjacent', () => {
    const hidden = new Set([cellKey(squareLoop[1]), cellKey(squareLoop[2])]);

    expect(findSwappableHiddenPairs(squareLoop, hidden, BoardShape.Square)).toEqual([[1, 2]]);
  });

  it('does not treat a straight hidden run as swappable when the exchanged route breaks', () => {
    const straightPath: Cell[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ];
    const hidden = new Set([cellKey(straightPath[1]), cellKey(straightPath[2])]);

    expect(findSwappableHiddenPairs(straightPath, hidden, BoardShape.Square)).toEqual([]);
  });

  it('does not loosen a hidden run longer than two cells', () => {
    const longerPath: Cell[] = [
      ...squareLoop,
      { x: 2, y: 1 },
    ];
    const hidden = new Set([
      cellKey(longerPath[1]),
      cellKey(longerPath[2]),
      cellKey(longerPath[3]),
    ]);

    expect(findSwappableHiddenPairs(longerPath, hidden, BoardShape.Square)).toEqual([]);
  });
});
