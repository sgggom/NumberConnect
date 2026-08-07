import { describe, expect, it } from 'vitest';
import {
  calculateAlgorithm7SpatialLoss,
  calculateAlgorithm7SpatialMetrics,
  calculateAlgorithm7DifficultyLoss,
  createAlgorithm7Selection,
  runAlgorithm7,
} from './algorithm7';
import {
  editorAlgorithmLabel,
  normalizeEditorAlgorithm,
  resolveEditorAlgorithmForShape,
} from './registry';

describe('editor algorithm 7 difficulty inversion', () => {
  it('strongly prefers an interleaved layout over two solid regions', () => {
    const path = Array.from({ length: 16 }, (_, index) => ({
      x: index % 4,
      y: Math.floor(index / 4),
    }));
    const clustered = new Set(path.flatMap((cell, index) => cell.x < 2 ? [index] : []));
    const interleaved = new Set(path.flatMap((cell, index) => (
      (cell.x + cell.y) % 2 === 0 ? [index] : []
    )));
    const clusteredMetrics = calculateAlgorithm7SpatialMetrics(path, clustered, 'square');
    const interleavedMetrics = calculateAlgorithm7SpatialMetrics(path, interleaved, 'square');

    expect(clusteredMetrics.largestHiddenComponentRatio).toBe(1);
    expect(clusteredMetrics.largestVisibleComponentRatio).toBe(1);
    expect(interleavedMetrics.mixedBoundaryRatio).toBe(1);
    expect(calculateAlgorithm7SpatialLoss(interleavedMetrics))
      .toBeLessThan(calculateAlgorithm7SpatialLoss(clusteredMetrics));
  });

  it('scores a target-shaped difficulty vector closer than a distant vector', () => {
    const targetLike = {
      averageScore: 0.32,
      percentile80Score: 1,
      peakScore: 2,
      errorRate: 0.08,
      hardStepRatio: 0.24,
      earlyScore: 0.22,
      middleScore: 0.4,
      lateScore: 0.27,
    };
    const distant = {
      averageScore: 2,
      percentile80Score: 3,
      peakScore: 5,
      errorRate: 0.5,
      hardStepRatio: 0.8,
      earlyScore: 2,
      middleScore: 2,
      lateScore: 2,
    };

    expect(calculateAlgorithm7DifficultyLoss(targetLike, 3))
      .toBeLessThan(calculateAlgorithm7DifficultyLoss(distant, 3));
  });

  it('normalizes, labels, and resolves its independent parameters', () => {
    const normalized = normalizeEditorAlgorithm({
      id: 'algorithm-7',
      parameters: {
        targetCrossings: 120,
        turnProbability: -1,
        targetDifficulty: 9,
        searchIterations: 99,
        minimumHiddenPercent: 45,
        maximumHiddenPercent: 20,
        maxHiddenRun: 20,
        maxVisibleRun: 0,
      },
    });

    expect(normalized).toMatchObject({
      id: 'algorithm-7',
      parameters: {
        targetCrossings: 99,
        turnProbability: 0,
        targetDifficulty: 5,
        searchIterations: 30,
        minimumHiddenPercent: 45,
        maximumHiddenPercent: 45,
        maxHiddenRun: 12,
        maxVisibleRun: 1,
      },
    });
    expect(editorAlgorithmLabel('algorithm-7')).toBe('算法7');
    expect(resolveEditorAlgorithmForShape(createAlgorithm7Selection(), 'hex'))
      .toMatchObject({ id: 'algorithm-7', parameters: { targetCrossings: 0 } });
  });

  it('generates a deterministic optimized layout inside the configured limits', () => {
    const selection = createAlgorithm7Selection();
    selection.parameters = {
      ...selection.parameters,
      targetCrossings: 0,
      searchIterations: 1,
      minimumHiddenPercent: 20,
      maximumHiddenPercent: 80,
      maxHiddenRun: 3,
      maxVisibleRun: 4,
    };
    const context = {
      rows: 3,
      columns: 3,
      activeCells: new Set(Array.from(
        { length: 9 },
        (_, index) => `${index % 3},${Math.floor(index / 3)}`,
      )),
      shape: 'square' as const,
      generationIndex: 707,
      searchMode: 'quality' as const,
    };

    const first = runAlgorithm7(context, selection);
    const second = runAlgorithm7(context, selection);
    expect(first).toEqual(second);
    expect(first?.path).toHaveLength(9);
    expect(first?.hiddenCells?.length).toBeGreaterThanOrEqual(2);
    expect(first?.hiddenCells?.length).toBeLessThanOrEqual(7);
    expect(first?.hiddenCells).not.toContainEqual(first?.path[0]);
    expect(first?.hiddenCells).not.toContainEqual(first?.path[8]);
  });
});
