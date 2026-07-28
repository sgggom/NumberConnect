import { describe, expect, it } from 'vitest';
import { LevelEditorModel } from '../LevelEditorModel';
import { areEditorCellsNeighbors } from '../findEditorPath';
import { createAlgorithm2Selection, runAlgorithm2 } from './algorithm2';
import {
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
  it('keeps algorithm 2 path generation and copied defaults', () => {
    const algorithm2 = createAlgorithm2Selection();
    const algorithm4 = createAlgorithm4Selection();
    expect(algorithm4.parameters).toEqual(algorithm2.parameters);

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
    expect(result4?.targetHiddenCount).toBe(result2?.targetHiddenCount);
  });

  it('scatters independent seeds before growing adjacent hidden cells', () => {
    const path = Array.from({ length: 5 }, (_, y) =>
      Array.from({ length: 5 }, (_, offset) => ({
        x: y % 2 === 0 ? offset : 4 - offset,
        y,
      })),
    ).flat();
    const selection = createAlgorithm4Selection();
    selection.parameters = {
      ...selection.parameters,
      hiddenPercent: 52,
      maxHiddenRun: 4,
      maxVisibleRun: 12,
    };

    const result = selectAlgorithm4HiddenLayout(path, 'square', selection, 404);
    const seeds = path.filter((cell) => result.seedCells.has(keyOf(cell)));
    const expanded = path.filter((cell) =>
      result.hiddenCells.has(keyOf(cell)) && !result.seedCells.has(keyOf(cell)));

    expect(result.hiddenCells.size).toBe(result.targetCount);
    expect(seeds.length).toBeGreaterThan(1);
    expect(expanded.length).toBeGreaterThan(0);
    for (let left = 0; left < seeds.length; left += 1) {
      for (let right = left + 1; right < seeds.length; right += 1) {
        expect(areEditorCellsNeighbors(seeds[left], seeds[right], 'square')).toBe(false);
      }
    }
    expect(expanded.some((cell) =>
      seeds.some((seed) => areEditorCellsNeighbors(seed, cell, 'square')))).toBe(true);
    expect(result.hiddenCells.has(keyOf(path[0]))).toBe(false);
    expect(result.hiddenCells.has(keyOf(path[path.length - 1]))).toBe(false);
  });

  it('prioritizes displayed cells with the fewest surrounding hidden numbers', () => {
    const path = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 },
      { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
    ];
    const selection = createAlgorithm4Selection();
    selection.parameters = {
      ...selection.parameters,
      hiddenPercent: 33,
      maxHiddenRun: 3,
      maxVisibleRun: 9,
    };

    const result = selectAlgorithm4HiddenLayout(path, 'square', selection, 17);
    const visibleHiddenNeighborCounts = path
      .filter((cell) => !result.hiddenCells.has(keyOf(cell)))
      .map((visibleCell) => path.reduce((count, candidate) =>
        count + Number(
          result.hiddenCells.has(keyOf(candidate))
          && areEditorCellsNeighbors(visibleCell, candidate, 'square'),
        ), 0));

    expect(result.hiddenCells.has('1,1')).toBe(true);
    expect(
      Math.max(...visibleHiddenNeighborCounts) - Math.min(...visibleHiddenNeighborCounts),
    ).toBeLessThanOrEqual(1);
  });

  it('enforces numeric hidden and visible run limits while growing groups', () => {
    const path = Array.from({ length: 24 }, (_, x) => ({ x, y: 0 }));
    const selection = createAlgorithm4Selection();
    selection.parameters = {
      ...selection.parameters,
      hiddenPercent: 10,
      maxHiddenRun: 2,
      maxVisibleRun: 3,
    };

    const result = selectAlgorithm4HiddenLayout(path, 'rectangle', selection, 99);

    expect(result.hiddenCells.size).toBeGreaterThan(result.targetCount);
    expect(longestRun(path, result.hiddenCells, true)).toBeLessThanOrEqual(2);
    expect(longestRun(path, result.hiddenCells, false)).toBeLessThanOrEqual(3);
  });

  it('normalizes algorithm 4 independently and resolves hex crossing limits', () => {
    const normalized = normalizeEditorAlgorithm({
      id: 'algorithm-4',
      parameters: {
        targetCrossings: 120,
        turnProbability: -8,
        hiddenPercent: 95,
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
        hiddenPercent: 90,
        maxHiddenRun: 8,
        maxVisibleRun: 1,
      },
    });
    expect(editorAlgorithmLabel('algorithm-4')).toBe('算法4');
    expect(resolveEditorAlgorithmForShape(createAlgorithm4Selection(), 'hex'))
      .toMatchObject({
        id: 'algorithm-4',
        parameters: { targetCrossings: 0 },
      });
  });

  it('saves algorithm 4 and its copied parameters through the editor model', () => {
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
        hiddenPercent: 70,
        maxHiddenRun: 5,
        maxVisibleRun: 6,
      },
    });

    expect(model.generatePath()).toBe(true);
    expect(model.createLevel(404)?.algorithm).toMatchObject({
      id: 'algorithm-4',
      parameters: {
        pathMode: 'single-stroke-multiple-solutions',
        hiddenPercent: 70,
        maxHiddenRun: 5,
        maxVisibleRun: 6,
      },
    });
  });
});
