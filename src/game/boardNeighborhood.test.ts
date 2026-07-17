import { describe, expect, it } from 'vitest';
import { buildBoardNeighborhoodPreview } from './boardNeighborhood';
import { BoardShape, type Cell } from './types';

const squareCells = (size = 3): Cell[] => Array.from({ length: size }, (_, y) => (
  Array.from({ length: size }, (__, x) => ({ x, y }))
)).flat();

describe('board neighborhood preview', () => {
  it('shows the complete grid without revealing hidden values', () => {
    const solutionPath = squareCells();
    const visible = new Set([0, 4, 8]);
    const preview = buildBoardNeighborhoodPreview(
      { boardShape: BoardShape.Square, solutionPath },
      4,
      (index) => visible.has(index),
      (index) => index + 1,
      120,
      240,
      { originClientX: 100, originClientY: 200 },
    );

    expect(preview).toMatchObject({
      clientX: 120,
      clientY: 240,
      originClientX: 100,
      originClientY: 200,
    });
    expect(preview?.cells).toHaveLength(9);
    expect(preview?.cells.find((cell) => cell.center)).toMatchObject({
      offsetX: 0,
      offsetY: 0,
      value: 5,
    });
    expect(preview?.cells.filter((cell) => cell.value === null)).toHaveLength(6);
    expect(preview?.cells.map((cell) => cell.value)).not.toContain(2);
    expect(preview?.cells.filter((cell) => cell.inFocusRing)).toHaveLength(9);
  });

  it('keeps the complete grid when the focus is at a board edge', () => {
    const solutionPath = squareCells();
    const preview = buildBoardNeighborhoodPreview(
      { boardShape: BoardShape.Rectangle, solutionPath },
      0,
      () => true,
      (index) => index + 1,
      0,
      0,
    );

    expect(preview?.cells).toHaveLength(9);
    expect(preview?.cells.map((cell) => cell.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(preview?.cells.find((cell) => cell.center)).toMatchObject({
      index: 0,
      offsetX: -1,
      offsetY: -1,
    });
    expect(preview?.cells.filter((cell) => cell.inFocusRing)).toHaveLength(4);
  });

  it('keeps every grid cell but marks only the focused one-ring neighborhood', () => {
    const preview = buildBoardNeighborhoodPreview(
      { boardShape: BoardShape.Square, solutionPath: squareCells(5) },
      12,
      () => true,
      (index) => index + 1,
      0,
      0,
    );

    expect(preview?.cells).toHaveLength(25);
    expect(preview?.cells.filter((cell) => cell.inFocusRing).map((cell) => cell.index)).toEqual([
      6, 7, 8, 11, 12, 13, 16, 17, 18,
    ]);
  });

  it('supports an idle full-grid preview without a focused cell', () => {
    const preview = buildBoardNeighborhoodPreview(
      { boardShape: BoardShape.Square, solutionPath: squareCells() },
      null,
      () => true,
      (index) => index + 1,
      0,
      0,
      {
        connectedNodePairs: [[0, 1], [0, 99]],
        pointer: { fromIndex: 0, offsetX: 1, offsetY: 1 },
      },
    );

    expect(preview?.cells).toHaveLength(9);
    expect(preview?.cells.some((cell) => cell.center)).toBe(false);
    expect(preview?.cells.some((cell) => cell.inFocusRing)).toBe(false);
    expect(preview?.lines).toEqual([{ fromIndex: 0, toIndex: 1 }]);
    expect(preview?.pointer).toBeNull();
  });

  it('converts the touch pointer into full-grid coordinates', () => {
    const preview = buildBoardNeighborhoodPreview(
      { boardShape: BoardShape.Square, solutionPath: squareCells() },
      0,
      () => true,
      (index) => index + 1,
      0,
      0,
      { pointer: { fromIndex: 0, offsetX: 0.5, offsetY: 0.25 } },
    );

    expect(preview?.pointer).toEqual({
      fromIndex: 0,
      offsetX: -0.5,
      offsetY: -0.75,
    });
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
