import { describe, expect, it } from 'vitest';
import {
  buildBoardNeighborhoodPreview,
  calculateHeldCellScore,
  countAvailableNeighborhoodChoices,
  scoreDigitCount,
} from './boardNeighborhood';
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

describe('available neighborhood choices', () => {
  it('counts only available cells surrounding the held cell', () => {
    const available = new Set([0, 1, 2, 3, 5, 8]);

    expect(countAvailableNeighborhoodChoices(
      { boardShape: BoardShape.Square, solutionPath: squareCells() },
      4,
      (index) => available.has(index),
    )).toBe(6);
  });

  it('does not count available cells outside the held cell neighborhood', () => {
    const available = new Set([0, 3, 15]);

    expect(countAvailableNeighborhoodChoices(
      { boardShape: BoardShape.Square, solutionPath: squareCells(4) },
      5,
      (index) => available.has(index),
    )).toBe(1);
  });

  it('returns zero for an invalid held cell', () => {
    expect(countAvailableNeighborhoodChoices(
      { boardShape: BoardShape.Square, solutionPath: squareCells() },
      99,
      () => true,
    )).toBe(0);
  });
});

describe('held cell score', () => {
  it('converts the raw score into its digit count', () => {
    expect([0, 1, 9, 10, 99, 100].map(scoreDigitCount)).toEqual([0, 1, 1, 2, 2, 3]);
  });

  it('multiplies the choice count by the amount of numbers between visible numbers', () => {
    const solutionPath = squareCells();
    const available = new Set([0, 1, 2, 3, 5]);
    const visibleNumbers = new Set([5, 8]);

    expect(calculateHeldCellScore(
      { boardShape: BoardShape.Square, solutionPath },
      4,
      (index) => available.has(index),
      (index) => visibleNumbers.has(index + 1),
      (index) => index + 1,
      (index) => index === 0 || index === 1 || index === 2,
    )).toEqual({
      choiceQuantity: 5,
      choiceScore: 3,
      feasibleChoiceCount: 2,
      extraScore: 0.4,
      nextNumberDistance: 2,
      reasoningBranchCount: 4,
      reasoningBranchScore: 3,
      actualScore: 18,
      total: 18,
      totalDigitScore: 2,
      badgeScore: 2.4,
    });
  });

  it('scores zero when the next number is already displayed', () => {
    expect(calculateHeldCellScore(
      { boardShape: BoardShape.Square, solutionPath: squareCells() },
      4,
      (index) => index !== 5,
      (index) => index === 4 || index === 5,
      (index) => index + 1,
    )).toEqual({
      choiceQuantity: 8,
      choiceScore: 0,
      feasibleChoiceCount: 8,
      extraScore: 0,
      nextNumberDistance: 0,
      reasoningBranchCount: 1,
      reasoningBranchScore: 0,
      actualScore: 0,
      total: 0,
      totalDigitScore: 0,
      badgeScore: 0,
    });
  });

  it('does not include the next displayed number when it is outside the surrounding ring', () => {
    const solutionPath = squareCells(4);
    const available = new Set([0, 1, 2, 6]);

    expect(calculateHeldCellScore(
      { boardShape: BoardShape.Square, solutionPath },
      5,
      (index) => available.has(index),
      (index) => index === 5 || index === 15,
      (index) => index + 1,
    )).toEqual({
      choiceQuantity: 4,
      choiceScore: 0,
      feasibleChoiceCount: 4,
      extraScore: 0.8,
      nextNumberDistance: 9,
      reasoningBranchCount: 0,
      reasoningBranchScore: 0,
      actualScore: 0,
      total: 0,
      totalDigitScore: 0,
      badgeScore: 0.8,
    });
  });

  it('does not count a nearby target number when the immediate next number is hidden', () => {
    const solutionPath = squareCells();

    expect(calculateHeldCellScore(
      { boardShape: BoardShape.Square, solutionPath },
      4,
      (index) => index === 5,
      (index) => index === 4 || index === 7,
      (index) => index + 1,
    )).toEqual({
      choiceQuantity: 1,
      choiceScore: 0,
      feasibleChoiceCount: 1,
      extraScore: 0.2,
      nextNumberDistance: 2,
      reasoningBranchCount: 0,
      reasoningBranchScore: 0,
      actualScore: 0,
      total: 0,
      totalDigitScore: 0,
      badgeScore: 0.2,
    });
  });

  it('counts the immediate next number when it is displayed and adjacent', () => {
    const solutionPath = squareCells();

    expect(calculateHeldCellScore(
      { boardShape: BoardShape.Square, solutionPath },
      4,
      () => false,
      (index) => index === 4 || index === 5,
      (index) => index + 1,
    )).toEqual({
      choiceQuantity: 1,
      choiceScore: 0,
      feasibleChoiceCount: 1,
      extraScore: 0,
      nextNumberDistance: 0,
      reasoningBranchCount: 1,
      reasoningBranchScore: 0,
      actualScore: 0,
      total: 0,
      totalDigitScore: 0,
      badgeScore: 0,
    });
  });

  it('counts every exact-length path to the next displayed number', () => {
    const solutionPath: Cell[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 0, y: 1 },
    ];

    expect(calculateHeldCellScore(
      { boardShape: BoardShape.Rectangle, solutionPath },
      0,
      (index) => index === 1 || index === 2 || index === 4,
      (index) => index === 0 || index === 3,
      (index) => index + 1,
      (index) => index === 4,
    )).toEqual({
      choiceQuantity: 2,
      choiceScore: 1,
      feasibleChoiceCount: 1,
      extraScore: 0.2,
      nextNumberDistance: 2,
      reasoningBranchCount: 1,
      reasoningBranchScore: 0,
      actualScore: 0,
      total: 0,
      totalDigitScore: 0,
      badgeScore: 0.2,
    });
  });
});
