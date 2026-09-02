import { describe, expect, it } from 'vitest';
import { calculateCompletionAwareScore } from '../../../game/completionAwareScore';
import { BoardShape, cellKey, type Cell } from '../../../game/types';
import { selectAlgorithm1HiddenLayout } from '../../editor/algorithms/algorithm1';
import {
  generateDynamicHiddenLayout,
  selectDynamicHiddenBaseLayout,
} from './dynamicHiddenGenerator';
import {
  allocateDynamicTierTargets,
  dynamicHiddenProfileForDifficulty,
} from './dynamicHiddenProfiles';
import { analyzeDynamicHiddenLayout } from './dynamicStepAnalyzer';

const snakePath = (columns: number, rows: number): Cell[] => Array.from(
  { length: columns * rows },
  (_value, index) => {
    const y = Math.floor(index / columns);
    const offset = index % columns;
    return { x: y % 2 === 0 ? offset : columns - 1 - offset, y };
  },
);

describe('dynamic hidden layout generator', () => {
  it('starts from an isolated copy that preserves algorithm 1 output', () => {
    const path = snakePath(8, 8);
    const options = {
      addTargetDifficultyPercent: false,
      maxVisibleRun: 7,
      maxHiddenRun: 3,
    } as const;

    for (const difficulty of [1, 5, 10]) {
      for (const seed of [17, 108, 909]) {
        expect(selectDynamicHiddenBaseLayout(
          path,
          'square',
          41,
          difficulty,
          seed,
          options,
        )).toEqual(selectAlgorithm1HiddenLayout(
          path,
          'square',
          41,
          difficulty,
          seed,
          options,
        ));
      }
    }
  });

  it('interpolates the initial 1/5/10 difficulty profiles', () => {
    expect(dynamicHiddenProfileForDifficulty(1)).toMatchObject({
      difficulty: 1,
      hiddenPercent: 36,
      tierRatios: [0.86, 0.14, 0],
    });
    expect(dynamicHiddenProfileForDifficulty(5)).toMatchObject({
      difficulty: 5,
      hiddenPercent: 40,
      tierRatios: [0.73, 0.23, 0.04],
    });
    expect(dynamicHiddenProfileForDifficulty(10)).toMatchObject({
      difficulty: 10,
      hiddenPercent: 45,
      tierRatios: [0.66, 0.23, 0.11],
    });
    expect(allocateDynamicTierTargets(25, dynamicHiddenProfileForDifficulty(5)))
      .toEqual([18, 6, 1]);
  });

  it('replays every hidden decision with the runtime score formula', () => {
    const path = snakePath(4, 4);
    const hidden = new Set([2, 5, 7, 10, 13]);
    const analysis = analyzeDynamicHiddenLayout(path, BoardShape.Square, hidden);

    expect(analysis.steps.map((step) => step.targetIndex)).toEqual([...hidden]);
    expect(analysis.tierCounts.reduce((sum, count) => sum + count, 0)).toBe(hidden.size);
    analysis.steps.forEach((step) => {
      expect(step.score.feasibleChoiceCount).toBeGreaterThanOrEqual(1);
      expect(step.tier).toBe(step.score.totalDigitScore);
    });

    const centerIndex = 1;
    const replayedStep = analysis.steps.find((step) => step.centerIndex === centerIndex);
    const runtimeScore = calculateCompletionAwareScore({
      cells: path,
      boardShape: BoardShape.Square,
      centerIndex,
      availableIndices: [...hidden].filter((index) => index > centerIndex),
      visibleIndices: path.flatMap((_cell, index) => (
        index <= centerIndex || !hidden.has(index) ? [index] : []
      )),
      displayNumbers: path.map((_cell, index) => index + 1),
      fixedPositions: path.flatMap((_cell, index) => (
        index <= centerIndex || !hidden.has(index) ? [[index, index] as const] : []
      )),
      requiredEdges: [[0, 1]],
      solutionOrder: path.map((_cell, index) => index),
    });
    expect(replayedStep?.score).toEqual(runtimeScore);
  });

  it('is deterministic and computes both hidden quantity and positions', () => {
    const path = snakePath(6, 6);
    const input = {
      path,
      boardShape: BoardShape.Square,
      targetDifficulty: 6,
      seed: 20260901,
    };
    const first = generateDynamicHiddenLayout(input);
    const second = generateDynamicHiddenLayout(input);

    expect(second).toEqual(first);
    expect(first.hiddenIndices).toHaveLength(Math.round(path.length * 0.41));
    expect(first.hiddenIndices).not.toContain(0);
    expect(first.hiddenIndices).not.toContain(path.length - 1);
    expect(new Set(first.hiddenIndices).size).toBe(first.hiddenIndices.length);
    expect(first.report.actualTierCounts.reduce((sum, count) => sum + count, 0))
      .toBe(first.hiddenIndices.length);
    expect(first.report.accepted).toBe(true);
    expect(first.hiddenIndices.map((index) => cellKey(path[index])))
      .toHaveLength(first.hiddenIndices.length);
  });

  it('raises the generated hidden count with the requested difficulty', () => {
    const path = snakePath(6, 6);
    const easy = generateDynamicHiddenLayout({
      path,
      boardShape: BoardShape.Square,
      targetDifficulty: 1,
      seed: 7788,
    });
    const hard = generateDynamicHiddenLayout({
      path,
      boardShape: BoardShape.Square,
      targetDifficulty: 10,
      seed: 7788,
    });

    expect(hard.hiddenIndices.length).toBeGreaterThan(easy.hiddenIndices.length);
    expect(easy.report.accepted).toBe(true);
    expect(hard.report.accepted).toBe(true);
  });

  it('hides at most one of numbers 1 through 4 in final dynamic layouts', () => {
    const path = snakePath(5, 5);
    for (let difficulty = 1; difficulty <= 10; difficulty += 1) {
      const result = generateDynamicHiddenLayout({
        path,
        boardShape: BoardShape.Square,
        targetDifficulty: difficulty,
        seed: 31000 + difficulty,
      });
      expect(result.hiddenIndices.filter((index) => index < 4).length).toBeLessThanOrEqual(1);
    }
  });

  it('uses explicit 0/1/2 targets to control both hidden quantity and tier counts', () => {
    const path = snakePath(6, 6);
    const result = generateDynamicHiddenLayout({
      path,
      boardShape: BoardShape.Square,
      targetDifficulty: 5,
      targetTierCounts: [6, 2, 0],
      seed: 20260901,
    });

    expect(result.report.targetHiddenCount).toBe(8);
    expect(result.hiddenIndices).toHaveLength(8);
    expect(result.report.targetTierCounts).toEqual([6, 2, 0]);
    expect(result.report.actualTierCounts).toEqual([6, 2, 0, 0]);
    expect(result.report.tierDistance).toBe(0);
    expect(result.report.accepted).toBe(true);
    expect(result.hiddenIndices).not.toContain(0);
    expect(result.hiddenIndices).not.toContain(path.length - 1);
    expect(result.hiddenIndices.filter((index) => index < 4).length).toBeLessThanOrEqual(1);
  });

  it('keeps explicit tier-count generation independent from the difficulty selector', () => {
    const path = snakePath(6, 6);
    const sharedInput = {
      path,
      boardShape: BoardShape.Square,
      targetTierCounts: [10, 3, 1] as const,
      seed: 90210,
    };

    const difficultyOne = generateDynamicHiddenLayout({
      ...sharedInput,
      targetDifficulty: 1,
    });
    const difficultyTen = generateDynamicHiddenLayout({
      ...sharedInput,
      targetDifficulty: 10,
    });

    expect(difficultyTen).toEqual(difficultyOne);
    expect(difficultyOne.report.targetTierCounts).toEqual([10, 3, 1]);
    expect(difficultyOne.hiddenIndices).toHaveLength(14);
  });

  it('supports hard-boundary-only safety for difficulty debugging on tiny guide paths', () => {
    const path = snakePath(4, 1);
    const result = generateDynamicHiddenLayout({
      path,
      boardShape: BoardShape.Square,
      targetDifficulty: 4,
      safetyMode: 'hard-boundaries',
      seed: 49001,
    });

    expect(result.report.accepted).toBe(true);
    expect(result.hiddenIndices).toHaveLength(1);
    expect(result.hiddenIndices).not.toContain(0);
    expect(result.hiddenIndices).not.toContain(path.length - 1);
    expect(result.hiddenIndices.filter((index) => index < 4).length).toBeLessThanOrEqual(1);
  });

  it('reports an unreachable explicit target without breaking hard boundaries', () => {
    const path = snakePath(5, 5);
    const result = generateDynamicHiddenLayout({
      path,
      boardShape: BoardShape.Square,
      targetDifficulty: 5,
      targetTierCounts: [path.length, 0, 0],
      seed: 74123,
    });

    expect(result.report.targetHiddenCount).toBe(path.length);
    expect(result.report.accepted).toBe(false);
    expect(result.report.withinTargetTolerance).toBe(false);
    expect(result.hiddenIndices.length).toBeLessThan(path.length);
    expect(result.hiddenIndices).not.toContain(0);
    expect(result.hiddenIndices).not.toContain(path.length - 1);
    expect(result.hiddenIndices.filter((index) => index < 4).length).toBeLessThanOrEqual(1);
  });
});
