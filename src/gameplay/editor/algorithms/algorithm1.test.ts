import { describe, expect, it } from 'vitest';
import {
  ALGORITHM1_MAX_HIDDEN_COMPONENT_RATIO,
  algorithm1AdjacentExpansionCount,
  algorithm1AdjacentExpansionProbability,
  algorithm1BaseSelectionCount,
  algorithm1EffectiveHiddenPercent,
  calculateAlgorithm1ExperienceMetrics,
  calculateAlgorithm1ExperienceValue,
  calculateAlgorithm1SpatialLoss,
  calculateAlgorithm1SpatialMetrics,
  calculateAlgorithm1DifficultyLoss,
  createAlgorithm1Selection,
  runAlgorithm1,
  selectAlgorithm1HiddenLayout,
} from './algorithm1';
import { calculateEditorLevelMetrics } from '../levelMetrics';
import {
  editorAlgorithmLabel,
  normalizeEditorAlgorithm,
  resolveEditorAlgorithmForShape,
} from './registry';

describe('editor algorithm 1 spatial hidden selection', () => {
  it('strongly prefers an interleaved layout over two solid regions', () => {
    const path = Array.from({ length: 16 }, (_, index) => ({
      x: index % 4,
      y: Math.floor(index / 4),
    }));
    const clustered = new Set(path.flatMap((cell, index) => cell.x < 2 ? [index] : []));
    const interleaved = new Set(path.flatMap((cell, index) => (
      (cell.x + cell.y) % 2 === 0 ? [index] : []
    )));
    const clusteredMetrics = calculateAlgorithm1SpatialMetrics(path, clustered, 'square');
    const interleavedMetrics = calculateAlgorithm1SpatialMetrics(path, interleaved, 'square');

    expect(clusteredMetrics.largestHiddenComponentRatio).toBe(1);
    expect(clusteredMetrics.largestVisibleComponentRatio).toBe(1);
    expect(interleavedMetrics.mixedBoundaryRatio).toBe(1);
    expect(calculateAlgorithm1SpatialLoss(interleavedMetrics))
      .toBeLessThan(calculateAlgorithm1SpatialLoss(clusteredMetrics));
  });

  it('normalizes, labels, and resolves its independent parameters', () => {
    const normalized = normalizeEditorAlgorithm({
      id: 'algorithm-1',
      parameters: {
        targetCrossings: 120,
        turnProbability: -1,
        hiddenPercent: 120,
        targetDifficulty: 99,
        maxVisibleRun: 120,
        maxHiddenRun: 0,
      },
    });

    expect(normalized).toMatchObject({
      id: 'algorithm-1',
      parameters: {
        targetCrossings: 99,
        turnProbability: 0,
        hiddenPercent: 100,
        targetDifficulty: 10,
        maxVisibleRun: 99,
        maxHiddenRun: 1,
      },
    });
    expect(editorAlgorithmLabel('algorithm-1')).toBe('算法1');
    expect(resolveEditorAlgorithmForShape(createAlgorithm1Selection(), 'hex'))
      .toMatchObject({ id: 'algorithm-1', parameters: { targetCrossings: 0 } });
  });

  it('generates a deterministic optimized layout inside the configured limits', () => {
    const selection = createAlgorithm1Selection();
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

    const pathOnly = runAlgorithm1({ ...context, generationPhase: 'path' }, selection);
    expect(pathOnly?.hiddenCells).toBeUndefined();
    const hiddenContext = {
      ...context,
      generationPhase: 'hidden' as const,
      fixedPath: pathOnly?.path,
    };
    const first = runAlgorithm1(hiddenContext, selection);
    const second = runAlgorithm1(hiddenContext, selection);
    expect(first).toEqual(second);
    expect(first?.path).toEqual(pathOnly?.path);
    expect(first?.path).toHaveLength(9);
    expect(first?.hiddenCells).toHaveLength(5);
    expect(first?.hiddenCells).not.toContainEqual(first?.path[0]);
    expect(first?.hiddenCells).not.toContainEqual(first?.path[8]);
  });

  it('adds one distinct hidden number per pass up to the first-four limit', () => {
    const path = Array.from({ length: 9 }, (_, index) => ({
      x: index % 3,
      y: Math.floor(index / 3),
    }));

    expect(selectAlgorithm1HiddenLayout(path, 'square', 0, 3, 8).size).toBe(0);
    expect(selectAlgorithm1HiddenLayout(path, 'square', 33, 3, 8).size).toBe(3);
    const fullyRequested = selectAlgorithm1HiddenLayout(path, 'square', 100, 3, 8);
    expect(fullyRequested.size).toBe(5);
    expect([...fullyRequested].filter((index) => index < 4)).toHaveLength(1);
  });

  it('hides at most one of numbers 1 through 4 for every seed', () => {
    const path = Array.from({ length: 16 }, (_, index) => ({
      x: index % 4,
      y: Math.floor(index / 4),
    }));

    for (let seed = 0; seed < 50; seed += 1) {
      const hidden = selectAlgorithm1HiddenLayout(path, 'square', 100, 10, seed);
      expect([...hidden].filter((index) => index < 4)).toHaveLength(1);
    }
  });

  it('adds the difficulty level as extra hidden percentage points', () => {
    const path = Array.from({ length: 64 }, (_, index) => {
      const y = Math.floor(index / 8);
      const offset = index % 8;
      return { x: y % 2 === 0 ? offset : 7 - offset, y };
    });

    expect(algorithm1EffectiveHiddenPercent(35, 1)).toBe(36);
    expect(algorithm1EffectiveHiddenPercent(35, 6)).toBe(41);
    expect(algorithm1EffectiveHiddenPercent(35, 10)).toBe(45);
    expect(algorithm1EffectiveHiddenPercent(95, 10)).toBe(100);
    expect(selectAlgorithm1HiddenLayout(path, 'square', 35, 1, 108).size).toBe(23);
    expect(selectAlgorithm1HiddenLayout(path, 'square', 35, 10, 108).size).toBe(29);
  });

  it('can keep the requested percentage final while difficulty only shapes the layout', () => {
    const path = Array.from({ length: 64 }, (_, index) => {
      const y = Math.floor(index / 8);
      const offset = index % 8;
      return { x: y % 2 === 0 ? offset : 7 - offset, y };
    });

    const easy = selectAlgorithm1HiddenLayout(path, 'square', 35, 1, 118, {
      addTargetDifficultyPercent: false,
    });
    const hard = selectAlgorithm1HiddenLayout(path, 'square', 35, 10, 118, {
      addTargetDifficultyPercent: false,
    });

    expect(easy.size).toBe(22);
    expect(hard.size).toBe(22);
  });

  it('applies the configured longest visible and hidden run limits', () => {
    const path = Array.from({ length: 64 }, (_, index) => {
      const y = Math.floor(index / 8);
      const offset = index % 8;
      return { x: y % 2 === 0 ? offset : 7 - offset, y };
    });
    const hidden = selectAlgorithm1HiddenLayout(path, 'square', 35, 6, 208, {
      maxVisibleRun: 5,
      maxHiddenRun: 2,
    });
    const metrics = calculateEditorLevelMetrics({
      path,
      hiddenCellKeys: new Set([...hidden].map((index) => (
        `${path[index].x},${path[index].y}`
      ))),
      shape: 'square',
    });

    expect(hidden.size).toBe(26);
    expect(metrics.longestVisibleRun).toBeLessThanOrEqual(5);
    expect(metrics.longestHiddenRun).toBeLessThanOrEqual(2);
  });

  it('scores experience metrics against the selected difficulty target', () => {
    const easy = { averageDifficulty: 0.03, hardStepRatio: 0.02, peakDifficulty: 0.4 };
    const hard = { averageDifficulty: 0.9, hardStepRatio: 0.48, peakDifficulty: 4 };

    expect(calculateAlgorithm1DifficultyLoss(easy, 1))
      .toBeLessThan(calculateAlgorithm1DifficultyLoss(hard, 1));
    expect(calculateAlgorithm1DifficultyLoss(hard, 10))
      .toBeLessThan(calculateAlgorithm1DifficultyLoss(easy, 10));
  });

  it('increases the probability of expanding beside base hidden cells with difficulty', () => {
    const probabilities = Array.from(
      { length: 10 },
      (_, index) => algorithm1AdjacentExpansionProbability(index + 1),
    );

    expect(probabilities[0]).toBe(0);
    expect(probabilities[9]).toBe(0.85);
    probabilities.slice(1).forEach((probability, index) => {
      expect(probability).toBeGreaterThan(probabilities[index]);
    });

    const counts = Array.from(
      { length: 10 },
      (_, index) => algorithm1AdjacentExpansionCount(20, index + 1),
    );
    expect(counts[0]).toBe(0);
    expect(counts[9]).toBe(17);
    counts.slice(1).forEach((count, index) => {
      expect(count).toBeGreaterThanOrEqual(counts[index]);
    });
  });

  it('uses the first ten percent of hidden selections as base cells', () => {
    expect(algorithm1BaseSelectionCount(0)).toBe(0);
    expect(algorithm1BaseSelectionCount(1)).toBe(1);
    expect(algorithm1BaseSelectionCount(10)).toBe(1);
    expect(algorithm1BaseSelectionCount(11)).toBe(2);
    expect(algorithm1BaseSelectionCount(64)).toBe(7);
    expect(algorithm1BaseSelectionCount(100)).toBe(10);
  });

  it('produces a clearly harder experience at difficulty ten than difficulty one', () => {
    const path = Array.from({ length: 64 }, (_, index) => {
      const y = Math.floor(index / 8);
      const offset = index % 8;
      return { x: y % 2 === 0 ? offset : 7 - offset, y };
    });
    const easy = selectAlgorithm1HiddenLayout(path, 'square', 45, 1, 909);
    const hard = selectAlgorithm1HiddenLayout(path, 'square', 45, 10, 909);
    const easyValue = calculateAlgorithm1ExperienceValue(
      calculateAlgorithm1ExperienceMetrics(path, easy, 'square'),
    );
    const hardValue = calculateAlgorithm1ExperienceValue(
      calculateAlgorithm1ExperienceMetrics(path, hard, 'square'),
    );

    expect(hardValue).toBeGreaterThan(easyValue);
  });

  it('keeps directly selected layouts below the hidden cluster limit', () => {
    const path = Array.from({ length: 64 }, (_, index) => {
      const y = Math.floor(index / 8);
      const offset = index % 8;
      return { x: y % 2 === 0 ? offset : 7 - offset, y };
    });
    const hard = selectAlgorithm1HiddenLayout(path, 'square', 35, 10, 1008);
    const metrics = calculateAlgorithm1SpatialMetrics(path, hard, 'square');

    expect(hard.size).toBe(29);
    expect(metrics.largestHiddenComponentRatio)
      .toBeLessThanOrEqual(ALGORITHM1_MAX_HIDDEN_COMPONENT_RATIO);
  });
});


