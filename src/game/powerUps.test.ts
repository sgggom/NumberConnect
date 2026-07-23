import { describe, expect, it } from 'vitest';
import { cellKey, type Cell } from './types';
import { chooseWatercolorReveal, paintBucketRevealCells } from './powerUps';

const squarePath: Cell[] = Array.from({ length: 16 }, (_, index) => ({
  x: index % 4,
  y: Math.floor(index / 4),
}));

describe('power-up reveal selection', () => {
  it('selects a concealed cell with deterministic random bounds', () => {
    const concealed = new Set([cellKey(squarePath[2]), cellKey(squarePath[7])]);

    expect(chooseWatercolorReveal(squarePath, concealed, () => 0)).toEqual(squarePath[2]);
    expect(chooseWatercolorReveal(squarePath, concealed, () => 1)).toEqual(squarePath[7]);
    expect(chooseWatercolorReveal(squarePath, new Set(), () => 0)).toBeUndefined();
  });

  it('reveals only concealed cells inside the selected 3 by 3 area', () => {
    const concealed = new Set(squarePath.map(cellKey));
    concealed.delete('1,1');

    expect(paintBucketRevealCells(squarePath, concealed, { x: 1, y: 1 }).map(cellKey)).toEqual([
      '0,0', '1,0', '2,0',
      '0,1', '2,1',
      '0,2', '1,2', '2,2',
    ]);
  });

  it('clips the 3 by 3 area at the board edge', () => {
    const concealed = new Set(squarePath.map(cellKey));

    expect(paintBucketRevealCells(squarePath, concealed, { x: 0, y: 0 }).map(cellKey)).toEqual([
      '0,0', '1,0', '0,1', '1,1',
    ]);
  });
});
