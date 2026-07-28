import { describe, expect, it } from 'vitest';
import { PathCompletionSolver } from './pathCompletionSolver';
import { BoardShape } from './types';

describe('path completion solver', () => {
  it('accepts a non-authored edge when another complete path still exists', () => {
    const solver = new PathCompletionSolver([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ], BoardShape.Square);

    expect(solver.findCompletion({
      fixedPositions: new Map([[0, 0], [3, 3]]),
      requiredEdges: [[0, 2]],
      directedStep: { from: 0, to: 2, direction: 1 },
    })).toEqual([0, 2, 1, 3]);
  });

  it('rejects an adjacent edge when it makes the numbered remainder impossible', () => {
    const solver = new PathCompletionSolver([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 2 },
    ], BoardShape.Square);

    expect(solver.findCompletion({
      fixedPositions: new Map([[0, 0], [2, 2], [4, 4]]),
      requiredEdges: [[0, 3]],
      directedStep: { from: 0, to: 3, direction: 1 },
    })).toBeNull();
  });

  it('keeps all previously accepted edges in the completion', () => {
    const solver = new PathCompletionSolver([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ], BoardShape.Square);

    expect(solver.findCompletion({
      fixedPositions: new Map([[0, 0], [2, 1], [1, 2], [3, 3]]),
      requiredEdges: [[0, 2], [2, 1], [1, 3]],
    })).toEqual([0, 2, 1, 3]);
  });

  it('returns an isolated copy when reusing a cached completion state', () => {
    const solver = new PathCompletionSolver([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ], BoardShape.Square);
    const request = {
      fixedPositions: new Map([[0, 0], [3, 3]]),
      requiredEdges: [[0, 2] as const],
      directedStep: { from: 0, to: 2, direction: 1 as const },
    };

    const first = solver.findCompletion(request);
    expect(first).toEqual([0, 2, 1, 3]);
    if (first) first[0] = 99;
    expect(solver.findCompletion(request)).toEqual([0, 2, 1, 3]);
  });
});
