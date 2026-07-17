import { describe, expect, it } from 'vitest';
import { simulateLevelPlay } from './simulateLevelPlay';

const keyOf = (cell: { x: number; y: number }): string => `${cell.x},${cell.y}`;

describe('editor level play simulation', () => {
  it('finishes a fully visible path without random decisions or errors', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ];

    expect(simulateLevelPlay({
      path,
      hiddenCellKeys: new Set(),
      shape: 'square',
      random: () => 0.99,
    })).toEqual({
      totalSteps: 1,
      errorCount: 0,
      steps: [{
        stepNumber: 1,
        outcome: 'complete',
        startNumber: 1,
        endNumber: 4,
        attemptedCells: path,
        length: 3,
        turnCount: 2,
        filledHiddenCount: 0,
        forkCount: 0,
      }],
    });
  });

  it('ends a step on a wrong hidden choice, excludes it, and resumes', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ];
    const hidden = new Set([keyOf(path[1]), keyOf(path[3])]);

    const result = simulateLevelPlay({
      path,
      hiddenCellKeys: hidden,
      shape: 'square',
      random: () => 0.99,
    });

    expect(result.totalSteps).toBe(2);
    expect(result.errorCount).toBe(1);
    expect(result.steps).toEqual([
      {
        stepNumber: 1,
        outcome: 'error',
        startNumber: 1,
        endNumber: 1,
        attemptedCells: [path[0], path[3]],
        length: 1,
        turnCount: 0,
        filledHiddenCount: 0,
        forkCount: 1,
      },
      {
        stepNumber: 2,
        outcome: 'complete',
        startNumber: 1,
        endNumber: 5,
        attemptedCells: path,
        length: 4,
        turnCount: 2,
        filledHiddenCount: 2,
        forkCount: 0,
      },
    ]);
  });

  it('filters a candidate that cannot reach the next visible number in the required steps', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const hidden = new Set([keyOf(path[1]), keyOf(path[4])]);

    const result = simulateLevelPlay({
      path,
      hiddenCellKeys: hidden,
      shape: 'square',
      random: () => 0.99,
    });

    expect(result.errorCount).toBe(0);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({
      outcome: 'complete',
      forkCount: 1,
      attemptedCells: path,
    });
  });

  it('requires exactly two intermediate cells after choosing a+1 in a three-hidden-cell interval', () => {
    const path = [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 1 },
      { x: 4, y: 1 },
      { x: 3, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
      { x: 0, y: 0 },
    ];
    const hidden = new Set([
      keyOf(path[1]),
      keyOf(path[2]),
      keyOf(path[3]),
      keyOf(path[10]),
    ]);

    const result = simulateLevelPlay({
      path,
      hiddenCellKeys: hidden,
      shape: 'square',
      random: () => 0.99,
    });

    expect(result.errorCount).toBe(0);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({
      outcome: 'complete',
      forkCount: 1,
      filledHiddenCount: 4,
      attemptedCells: path,
    });
  });

  it('rejects a branch that becomes a dead end before reaching the next visible number', () => {
    const path = [
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 7, y: 6 },
      { x: 7, y: 7 },
      { x: 7, y: 8 },
      { x: 6, y: 9 },
      { x: 5, y: 9 },
      { x: 4, y: 9 },
      { x: 3, y: 9 },
      { x: 2, y: 8 },
      { x: 2, y: 7 },
      { x: 2, y: 6 },
      { x: 3, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 6 },
      { x: 3, y: 7 },
    ];
    const hidden = new Set([
      ...path.slice(1, 6).map(keyOf),
      ...path.slice(13).map(keyOf),
    ]);

    const result = simulateLevelPlay({
      path,
      hiddenCellKeys: hidden,
      shape: 'square',
      random: () => 0.99,
    });

    expect(result.errorCount).toBe(0);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({
      outcome: 'complete',
      attemptedCells: path,
    });
    expect(result.steps[0].forkCount).toBeGreaterThanOrEqual(1);
  });

  it('rejects a branch that strands a remaining cell before reaching the next visible number', () => {
    const path = [
      { x: 6, y: 5 },
      { x: 7, y: 4 },
      { x: 8, y: 4 },
      { x: 9, y: 5 },
      { x: 9, y: 6 },
      { x: 9, y: 7 },
      { x: 8, y: 8 },
      { x: 7, y: 8 },
      { x: 6, y: 9 },
      { x: 5, y: 10 },
      { x: 4, y: 10 },
      { x: 3, y: 10 },
      { x: 2, y: 10 },
      { x: 1, y: 9 },
      { x: 1, y: 8 },
      { x: 1, y: 7 },
      { x: 1, y: 6 },
      { x: 2, y: 5 },
      { x: 2, y: 4 },
      { x: 3, y: 3 },
      { x: 4, y: 3 },
      { x: 5, y: 4 },
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 6 },
      { x: 3, y: 7 },
    ];
    const hidden = new Set([
      ...path.slice(1, 7).map(keyOf),
      ...path.slice(22).map(keyOf),
    ]);

    const result = simulateLevelPlay({
      path,
      hiddenCellKeys: hidden,
      shape: 'square',
      random: () => 0.99,
    });

    expect(result.errorCount).toBe(0);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({
      outcome: 'complete',
      attemptedCells: path,
    });
    expect(result.steps[0].forkCount).toBeGreaterThanOrEqual(1);
  });

  it('predicts through the next visible number beyond the old two-cell horizon', () => {
    const path = [
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 7, y: 6 },
      { x: 7, y: 7 },
      { x: 7, y: 8 },
      { x: 6, y: 9 },
      { x: 5, y: 9 },
      { x: 4, y: 9 },
      { x: 3, y: 9 },
      { x: 2, y: 8 },
      { x: 2, y: 7 },
      { x: 2, y: 6 },
      { x: 3, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 6 },
      { x: 3, y: 7 },
      { x: 3, y: 8 },
    ];
    const hidden = new Set([
      ...path.slice(1, 6).map(keyOf),
      ...path.slice(13).map(keyOf),
    ]);

    const result = simulateLevelPlay({
      path,
      hiddenCellKeys: hidden,
      shape: 'square',
      random: () => 0.99,
    });

    expect(result.errorCount).toBe(0);
    expect(result.steps[0]).toMatchObject({
      outcome: 'complete',
      attemptedCells: path,
    });
  });

  it('prefers a viable candidate near visible numbers closest to the number being filled', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
      { x: 0, y: 1 },
    ];
    const hidden = new Set([keyOf(path[1]), keyOf(path[2]), keyOf(path[7])]);

    const result = simulateLevelPlay({
      path,
      hiddenCellKeys: hidden,
      shape: 'square',
      random: () => 0.99,
    });

    expect(result.errorCount).toBe(0);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({
      outcome: 'complete',
      forkCount: 2,
      filledHiddenCount: 3,
    });
  });

  it('always follows a visible next number instead of guessing a hidden neighbor', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ];
    const hidden = new Set([keyOf(path[3])]);

    const result = simulateLevelPlay({
      path,
      hiddenCellKeys: hidden,
      shape: 'square',
      random: () => 0.99,
    });

    expect(result.errorCount).toBe(0);
    expect(result.steps[0].forkCount).toBe(0);
  });

  it('treats either valid order of two swappable hidden cells as correct', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ];
    const hidden = new Set([keyOf(path[1]), keyOf(path[2])]);

    const result = simulateLevelPlay({
      path,
      hiddenCellKeys: hidden,
      shape: 'square',
      random: () => 0.99,
    });

    expect(result.totalSteps).toBe(1);
    expect(result.errorCount).toBe(0);
    expect(result.steps[0]).toMatchObject({
      length: 3,
      filledHiddenCount: 2,
      forkCount: 1,
      outcome: 'complete',
    });
  });
});
