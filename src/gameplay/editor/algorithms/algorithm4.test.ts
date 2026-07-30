import { describe, expect, it } from 'vitest';
import { LevelEditorModel } from '../LevelEditorModel';
import { areEditorCellsNeighbors } from '../findEditorPath';
import { createAlgorithm2Selection, runAlgorithm2 } from './algorithm2';
import {
  calculateAlgorithm4AdjacentHiddenSkipProbability,
  createAlgorithm4Selection,
  runAlgorithm4,
  selectAlgorithm4HiddenLayout,
} from './algorithm4';
import {
  editorAlgorithmLabel,
  normalizeEditorAlgorithm,
  resolveEditorAlgorithmForShape,
} from './registry';

const keyOf = (cell: { x: number; y: number }): string => `${cell.x},${cell.y}`;

const longestRun = (
  path: ReadonlyArray<{ x: number; y: number }>,
  hiddenCells: ReadonlySet<string>,
  hidden: boolean,
): number => {
  let longest = 0;
  let current = 0;
  path.forEach((cell) => {
    if (hiddenCells.has(keyOf(cell)) === hidden) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  });
  return longest;
};

describe('editor algorithm 4', () => {
  it('keeps algorithm 2 path generation with independent phase defaults', () => {
    const algorithm2 = createAlgorithm2Selection();
    const algorithm4 = createAlgorithm4Selection();
    expect(algorithm4.parameters).toMatchObject({
      targetCrossings: algorithm2.parameters.targetCrossings,
      turnProbability: algorithm2.parameters.turnProbability,
      earlyHiddenProbability: 50,
      middleHiddenProbability: 50,
      lateHiddenProbability: 50,
      earlyAdjacentHiddenSkipProbability: 0,
      middleAdjacentHiddenSkipProbability: 0,
      lateAdjacentHiddenSkipProbability: 0,
      maxHiddenRun: 3,
      maxVisibleRun: 4,
    });
    expect(algorithm4.parameters).not.toHaveProperty('hiddenPercent');

    const context = {
      rows: 3,
      columns: 3,
      activeCells: new Set(Array.from({ length: 9 }, (_, index) => `${index % 3},${Math.floor(index / 3)}`)),
      shape: 'square' as const,
      generationIndex: 41,
      searchMode: 'quality' as const,
    };

    const result2 = runAlgorithm2(context, algorithm2);
    const result4 = runAlgorithm4(context, algorithm4);
    expect(result4?.path).toEqual(result2?.path);
    expect(result4?.targetHiddenCount).toBeUndefined();
  });

  it('scales the configured skip probability by surrounding hidden ratio', () => {
    expect(calculateAlgorithm4AdjacentHiddenSkipProbability(60, 0, 8)).toBe(0);
    expect(calculateAlgorithm4AdjacentHiddenSkipProbability(60, 2, 8)).toBe(15);
    expect(calculateAlgorithm4AdjacentHiddenSkipProbability(60, 1, 3)).toBe(20);
    expect(calculateAlgorithm4AdjacentHiddenSkipProbability(60, 3, 3)).toBe(60);
    expect(calculateAlgorithm4AdjacentHiddenSkipProbability(60, 0, 0)).toBe(0);
  });

  it('applies independent hidden probabilities to the first, middle, and last phases', () => {
    const path = Array.from({ length: 12 }, (_, x) => ({ x, y: 0 }));
    const selection = createAlgorithm4Selection();
    selection.parameters = {
      ...selection.parameters,
      earlyHiddenProbability: 100,
      middleHiddenProbability: 0,
      lateHiddenProbability: 100,
      maxHiddenRun: 8,
      maxVisibleRun: 12,
    };

    const result = selectAlgorithm4HiddenLayout(path, 'rectangle', selection, 404);
    expect(path.flatMap((cell, index) => (
      result.hiddenCells.has(keyOf(cell)) ? [index] : []
    ))).toEqual([1, 2, 9, 10]);
  });

  it('uses independent 0–100 adjacent-hidden skip probabilities in each phase', () => {
    const path = Array.from({ length: 12 }, (_, x) => ({ x, y: 0 }));
    const selection = createAlgorithm4Selection();
    selection.parameters = {
      ...selection.parameters,
      earlyHiddenProbability: 100,
      middleHiddenProbability: 100,
      lateHiddenProbability: 100,
      earlyAdjacentHiddenSkipProbability: 0,
      middleAdjacentHiddenSkipProbability: 100,
      lateAdjacentHiddenSkipProbability: 0,
      maxHiddenRun: 8,
      maxVisibleRun: 12,
    };

    const result = selectAlgorithm4HiddenLayout(path, 'rectangle', selection, 17);
    expect(path.flatMap((cell, index) => (
      result.hiddenCells.has(keyOf(cell)) ? [index] : []
    ))).toEqual([1, 2, 3, 4, 6, 8, 9, 10]);
  });

  it('uses spatial hidden density without making adjacent hidden cells impossible', () => {
    const path = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 },
      { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
    ];
    const selection = createAlgorithm4Selection();
    selection.parameters = {
      ...selection.parameters,
      earlyHiddenProbability: 100,
      middleHiddenProbability: 100,
      lateHiddenProbability: 100,
      earlyAdjacentHiddenSkipProbability: 100,
      middleAdjacentHiddenSkipProbability: 100,
      lateAdjacentHiddenSkipProbability: 100,
      maxHiddenRun: 8,
      maxVisibleRun: 9,
    };

    const result = selectAlgorithm4HiddenLayout(path, 'square', selection, 73);
    const noSkipSelection = createAlgorithm4Selection();
    noSkipSelection.parameters = {
      ...selection.parameters,
      earlyAdjacentHiddenSkipProbability: 0,
      middleAdjacentHiddenSkipProbability: 0,
      lateAdjacentHiddenSkipProbability: 0,
    };
    const noSkip = selectAlgorithm4HiddenLayout(path, 'square', noSkipSelection, 73);
    const hidden = path.filter((cell) => result.hiddenCells.has(keyOf(cell)));
    expect(result.hiddenCells.size).toBeLessThan(noSkip.hiddenCells.size);
    expect(hidden.some((cell, left) => hidden.slice(left + 1).some(
      (candidate) => areEditorCellsNeighbors(cell, candidate, 'square'),
    ))).toBe(true);
  });

  it('enforces numeric hidden and visible run limits after probability selection', () => {
    const path = Array.from({ length: 24 }, (_, x) => ({ x, y: 0 }));
    const denseSelection = createAlgorithm4Selection();
    denseSelection.parameters = {
      ...denseSelection.parameters,
      earlyHiddenProbability: 100,
      middleHiddenProbability: 100,
      lateHiddenProbability: 100,
      maxHiddenRun: 2,
      maxVisibleRun: 12,
    };
    const sparseSelection = createAlgorithm4Selection();
    sparseSelection.parameters = {
      ...sparseSelection.parameters,
      earlyHiddenProbability: 0,
      middleHiddenProbability: 0,
      lateHiddenProbability: 0,
      earlyAdjacentHiddenSkipProbability: 100,
      middleAdjacentHiddenSkipProbability: 100,
      lateAdjacentHiddenSkipProbability: 100,
      maxHiddenRun: 2,
      maxVisibleRun: 3,
    };

    const dense = selectAlgorithm4HiddenLayout(path, 'rectangle', denseSelection, 99);
    const sparse = selectAlgorithm4HiddenLayout(path, 'rectangle', sparseSelection, 99);

    expect(longestRun(path, dense.hiddenCells, true)).toBeLessThanOrEqual(2);
    expect(longestRun(path, sparse.hiddenCells, false)).toBeLessThanOrEqual(3);
  });

  it('normalizes new parameters and migrates the removed hidden percentage', () => {
    const normalized = normalizeEditorAlgorithm({
      id: 'algorithm-4',
      parameters: {
        targetCrossings: 120,
        turnProbability: -8,
        hiddenPercent: 65,
        earlyHiddenProbability: -5,
        middleHiddenProbability: 120,
        earlySkipAdjacentHidden: '是',
        middleSkipAdjacentHidden: 1,
        lateSkipAdjacentHidden: 'invalid',
        maxHiddenRun: 30,
        maxVisibleRun: 0,
      },
    });

    expect(normalized).toMatchObject({
      id: 'algorithm-4',
      parameters: {
        topology: 'board-shape',
        pathMode: 'single-stroke-multiple-solutions',
        targetCrossings: 99,
        turnProbability: 0,
        earlyHiddenProbability: 0,
        middleHiddenProbability: 100,
        lateHiddenProbability: 65,
        earlyAdjacentHiddenSkipProbability: 100,
        middleAdjacentHiddenSkipProbability: 100,
        lateAdjacentHiddenSkipProbability: 0,
        maxHiddenRun: 8,
        maxVisibleRun: 1,
      },
    });
    expect(normalized.parameters).not.toHaveProperty('hiddenPercent');
    expect(editorAlgorithmLabel('algorithm-4')).toBe('算法4');
    expect(resolveEditorAlgorithmForShape(createAlgorithm4Selection(), 'hex'))
      .toMatchObject({
        id: 'algorithm-4',
        parameters: { targetCrossings: 0 },
      });
  });

  it('saves algorithm 4 phase parameters through the editor model', () => {
    const model = new LevelEditorModel();
    for (let index = 0; index < 5; index += 1) model.changeSize(-1);
    model.fill();
    model.setAlgorithm('algorithm-4');
    const selection = model.algorithmSelection;
    if (selection.id !== 'algorithm-4') throw new Error('算法4未正确加载。');
    model.setAlgorithmSelection({
      ...selection,
      parameters: {
        ...selection.parameters,
        earlyHiddenProbability: 35,
        middleHiddenProbability: 55,
        lateHiddenProbability: 75,
        earlyAdjacentHiddenSkipProbability: 25,
        middleAdjacentHiddenSkipProbability: 50,
        lateAdjacentHiddenSkipProbability: 75,
        maxHiddenRun: 5,
        maxVisibleRun: 6,
      },
    });

    expect(model.generatePath()).toBe(true);
    expect(model.createLevel(404)?.algorithm).toMatchObject({
      id: 'algorithm-4',
      parameters: {
        pathMode: 'single-stroke-multiple-solutions',
        earlyHiddenProbability: 35,
        middleHiddenProbability: 55,
        lateHiddenProbability: 75,
        earlyAdjacentHiddenSkipProbability: 25,
        middleAdjacentHiddenSkipProbability: 50,
        lateAdjacentHiddenSkipProbability: 75,
        maxHiddenRun: 5,
        maxVisibleRun: 6,
      },
    });
    expect(model.createLevel(404)?.algorithm?.parameters).not.toHaveProperty('hiddenPercent');
  });
});
