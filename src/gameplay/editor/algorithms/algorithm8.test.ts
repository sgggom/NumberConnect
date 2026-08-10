import { describe, expect, it } from 'vitest';
import {
  ALGORITHM8_MAX_HIDDEN_COMPONENT_RATIO,
  algorithm8AdjacentExpansionCount,
  algorithm8AdjacentExpansionProbability,
  calculateAlgorithm8ExperienceMetrics,
  calculateAlgorithm8ExperienceValue,
  calculateAlgorithm8SpatialLoss,
  calculateAlgorithm8SpatialMetrics,
  calculateAlgorithm8DifficultyLoss,
  createAlgorithm8Selection,
  runAlgorithm8,
  selectAlgorithm8HiddenLayout,
} from './algorithm8';
import {
  editorAlgorithmLabel,
  normalizeEditorAlgorithm,
  resolveEditorAlgorithmForShape,
} from './registry';

describe('editor algorithm 8 spatial hidden selection', () => {
  it('strongly prefers an interleaved layout over two solid regions', () => {
    const path = Array.from({ length: 16 }, (_, index) => ({
      x: index % 4,
      y: Math.floor(index / 4),
    }));
    const clustered = new Set(path.flatMap((cell, index) => cell.x < 2 ? [index] : []));
    const interleaved = new Set(path.flatMap((cell, index) => (
      (cell.x + cell.y) % 2 === 0 ? [index] : []
    )));
    const clusteredMetrics = calculateAlgorithm8SpatialMetrics(path, clustered, 'square');
    const interleavedMetrics = calculateAlgorithm8SpatialMetrics(path, interleaved, 'square');

    expect(clusteredMetrics.largestHiddenComponentRatio).toBe(1);
    expect(clusteredMetrics.largestVisibleComponentRatio).toBe(1);
    expect(interleavedMetrics.mixedBoundaryRatio).toBe(1);
    expect(calculateAlgorithm8SpatialLoss(interleavedMetrics))
      .toBeLessThan(calculateAlgorithm8SpatialLoss(clusteredMetrics));
  });

  it('normalizes, labels, and resolves its independent parameters', () => {
    const normalized = normalizeEditorAlgorithm({
      id: 'algorithm-8',
      parameters: {
        targetCrossings: 120,
        turnProbability: -1,
        hiddenPercent: 120,
        targetDifficulty: 99,
      },
    });

    expect(normalized).toMatchObject({
      id: 'algorithm-8',
      parameters: {
        targetCrossings: 99,
        turnProbability: 0,
        hiddenPercent: 100,
        targetDifficulty: 10,
      },
    });
    expect(editorAlgorithmLabel('algorithm-8')).toBe('算法8');
    expect(resolveEditorAlgorithmForShape(createAlgorithm8Selection(), 'hex'))
      .toMatchObject({ id: 'algorithm-8', parameters: { targetCrossings: 0 } });
  });

  it('generates a deterministic optimized layout inside the configured limits', () => {
    const selection = createAlgorithm8Selection();
    selection.parameters = {
      ...selection.parameters,
      targetCrossings: 0,
      hiddenPercent: 44,
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

    const pathOnly = runAlgorithm8({ ...context, generationPhase: 'path' }, selection);
    expect(pathOnly?.hiddenCells).toBeUndefined();
    const hiddenContext = {
      ...context,
      generationPhase: 'hidden' as const,
      fixedPath: pathOnly?.path,
    };
    const first = runAlgorithm8(hiddenContext, selection);
    const second = runAlgorithm8(hiddenContext, selection);
    expect(first).toEqual(second);
    expect(first?.path).toEqual(pathOnly?.path);
    expect(first?.path).toHaveLength(9);
    expect(first?.hiddenCells).toHaveLength(4);
    expect(first?.hiddenCells).not.toContainEqual(first?.path[0]);
    expect(first?.hiddenCells).not.toContainEqual(first?.path[8]);
  });

  it('adds exactly one distinct hidden number per requested pass', () => {
    const path = Array.from({ length: 9 }, (_, index) => ({
      x: index % 3,
      y: Math.floor(index / 3),
    }));

    expect(selectAlgorithm8HiddenLayout(path, 'square', 0, 3, 8).size).toBe(0);
    expect(selectAlgorithm8HiddenLayout(path, 'square', 33, 3, 8).size).toBe(3);
    expect(selectAlgorithm8HiddenLayout(path, 'square', 100, 3, 8).size).toBe(7);
  });

  it('scores experience metrics against the selected difficulty target', () => {
    const easy = { averageDifficulty: 0.03, hardStepRatio: 0.02, peakDifficulty: 0.4 };
    const hard = { averageDifficulty: 0.9, hardStepRatio: 0.48, peakDifficulty: 4 };

    expect(calculateAlgorithm8DifficultyLoss(easy, 1))
      .toBeLessThan(calculateAlgorithm8DifficultyLoss(hard, 1));
    expect(calculateAlgorithm8DifficultyLoss(hard, 10))
      .toBeLessThan(calculateAlgorithm8DifficultyLoss(easy, 10));
  });

  it('increases the probability of expanding beside base hidden cells with difficulty', () => {
    const probabilities = Array.from(
      { length: 10 },
      (_, index) => algorithm8AdjacentExpansionProbability(index + 1),
    );

    expect(probabilities[0]).toBe(0);
    expect(probabilities[9]).toBe(0.85);
    probabilities.slice(1).forEach((probability, index) => {
      expect(probability).toBeGreaterThan(probabilities[index]);
    });

    const counts = Array.from(
      { length: 10 },
      (_, index) => algorithm8AdjacentExpansionCount(20, index + 1),
    );
    expect(counts[0]).toBe(0);
    expect(counts[9]).toBe(17);
    counts.slice(1).forEach((count, index) => {
      expect(count).toBeGreaterThanOrEqual(counts[index]);
    });
  });

  it('keeps the first ten base selections difficulty-neutral', () => {
    const path = Array.from({ length: 36 }, (_, index) => {
      const y = Math.floor(index / 6);
      const offset = index % 6;
      return { x: y % 2 === 0 ? offset : 5 - offset, y };
    });
    const hidden = selectAlgorithm8HiddenLayout(path, 'square', 28, 10, 808);

    expect(hidden.size).toBe(10);
    expect(calculateAlgorithm8ExperienceMetrics(path, hidden, 'square').peakDifficulty).toBe(0);
  });

  it('produces a clearly harder experience at difficulty ten than difficulty one', () => {
    const path = Array.from({ length: 64 }, (_, index) => {
      const y = Math.floor(index / 8);
      const offset = index % 8;
      return { x: y % 2 === 0 ? offset : 7 - offset, y };
    });
    const easy = selectAlgorithm8HiddenLayout(path, 'square', 45, 1, 909);
    const hard = selectAlgorithm8HiddenLayout(path, 'square', 45, 10, 909);
    const easyValue = calculateAlgorithm8ExperienceValue(
      calculateAlgorithm8ExperienceMetrics(path, easy, 'square'),
    );
    const hardValue = calculateAlgorithm8ExperienceValue(
      calculateAlgorithm8ExperienceMetrics(path, hard, 'square'),
    );

    expect(hardValue).toBeGreaterThan(easyValue);
  });

  it('keeps directly selected layouts below the hidden cluster limit', () => {
    const path = Array.from({ length: 64 }, (_, index) => {
      const y = Math.floor(index / 8);
      const offset = index % 8;
      return { x: y % 2 === 0 ? offset : 7 - offset, y };
    });
    const hard = selectAlgorithm8HiddenLayout(path, 'square', 35, 10, 1008);
    const metrics = calculateAlgorithm8SpatialMetrics(path, hard, 'square');

    expect(hard.size).toBe(22);
    expect(metrics.largestHiddenComponentRatio)
      .toBeLessThanOrEqual(ALGORITHM8_MAX_HIDDEN_COMPONENT_RATIO);
  });
});
