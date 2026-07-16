import { describe, expect, it } from 'vitest';
import { buildBoardNeighborhoodPreview } from './boardNeighborhood';
import { BoardShape, type Cell } from './types';

const squareCells = (): Cell[] => Array.from({ length: 3 }, (_, y) => (
  Array.from({ length: 3 }, (__, x) => ({ x, y }))
)).flat();

describe('board neighborhood preview', () => {
  it('shows the center and one square ring without revealing hidden values', () => {
    const solutionPath = squareCells();
    const visible = new Set([0, 4, 8]);
    const preview = buildBoardNeighborhoodPreview(
      { boardShape: BoardShape.Square, solutionPath },
      4,
      (index) => visible.has(index),
      (index) => index + 1,
      120,
      240,
    );

    expect(preview).toMatchObject({ clientX: 120, clientY: 240 });
    expect(preview?.cells).toHaveLength(9);
    expect(preview?.cells.find((cell) => cell.center)).toMatchObject({
      offsetX: 0,
      offsetY: 0,
      value: 5,
    });
    expect(preview?.cells.filter((cell) => cell.value === null)).toHaveLength(6);
    expect(preview?.cells.map((cell) => cell.value)).not.toContain(2);
  });

  it('returns only existing cells at a board edge', () => {
    const solutionPath = squareCells();
    const preview = buildBoardNeighborhoodPreview(
      { boardShape: BoardShape.Rectangle, solutionPath },
      0,
      () => true,
      (index) => index + 1,
      0,
      0,
    );

    expect(preview?.cells).toHaveLength(4);
    expect(preview?.cells.map((cell) => cell.value).sort((a, b) => Number(a) - Number(b))).toEqual([1, 2, 4, 5]);
  });

  it('ignores an invalid center index', () => {
    expect(buildBoardNeighborhoodPreview(
      { boardShape: BoardShape.Square, solutionPath: squareCells() },
      99,
      () => true,
      (index) => index + 1,
      0,
      0,
    )).toBeUndefined();
  });
});
