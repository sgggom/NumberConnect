import { describe, expect, it } from 'vitest';
import { findPureLuckAlternative } from '../../../game/pureLuck';
import { BoardShape, cellKey } from '../../../game/types';
import { largestHiddenClusterSize, selectUnambiguousHiddenCells } from '../../../game/unambiguousHidden';
import { LevelEditorModel } from '../LevelEditorModel';
import { normalizeEditorAlgorithm, resolveEditorAlgorithmForShape } from './registry';
import {
  algorithm3CandidateProbabilities,
  classifyAlgorithm3HiddenFeatures,
  createAlgorithm3Selection,
  runAlgorithm3,
} from './algorithm3';

describe('editor algorithm 3', () => {
  it('classifies straight, turn, and crossing candidates with crossing priority', () => {
    const mixedPath = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
    ];
    const crossingPath = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    ];

    expect(classifyAlgorithm3HiddenFeatures(mixedPath, 'square')).toEqual([
      'endpoint', 'straight', 'turn', 'endpoint',
    ]);
    expect(classifyAlgorithm3HiddenFeatures(crossingPath, 'square')).toEqual([
      'endpoint', 'crossing', 'crossing', 'endpoint',
    ]);
    expect(algorithm3CandidateProbabilities(mixedPath, 'square', {
      straightHiddenProbability: 80,
      turnHiddenProbability: 35,
      crossingHiddenProbability: 95,
    })).toEqual([0, 80, 35, 0]);
  });

  it('uses feature probabilities as candidate gates before the global hidden limit', () => {
    const path = Array.from({ length: 8 }, (_, x) => ({ x, y: 0 }));
    const result = selectUnambiguousHiddenCells(path, BoardShape.Square, {
      hiddenPercent: 90,
      maxHiddenRun: 1,
      maxVisibleRun: path.length,
      seed: 17,
      attempts: 1,
      candidateProbabilities: [0, 100, 0, 100, 0, 100, 0, 0],
    });

    expect(result.hiddenCells).toEqual(new Set(['1,0', '3,0', '5,0']));
  });

  it('keeps the configured maximum spatial hidden-cluster size and a unique path', () => {
    const path = Array.from({ length: 8 }, (_, x) => ({ x, y: 0 }));
    const result = selectUnambiguousHiddenCells(path, BoardShape.Square, {
      hiddenPercent: 90,
      maxHiddenRun: 2,
      maxVisibleRun: path.length,
      seed: 29,
      attempts: 1,
      candidateProbabilities: path.map((_, index) => index === 0 || index === path.length - 1 ? 0 : 100),
      maxHiddenClusterSize: 2,
    });

    expect(largestHiddenClusterSize(path, result.hiddenCells, BoardShape.Square)).toBeLessThanOrEqual(2);
    expect(findPureLuckAlternative(path, result.hiddenCells, BoardShape.Square)).toBeNull();
  });

  it('groups spatial neighbors even when their numbers are not consecutive', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const nonConsecutiveNeighbors = new Set(['1,0', '1,1']);
    expect(largestHiddenClusterSize(path, nonConsecutiveNeighbors, BoardShape.Square)).toBe(2);

    const result = selectUnambiguousHiddenCells(path, BoardShape.Square, {
      hiddenPercent: 100,
      maxHiddenRun: 8,
      maxVisibleRun: path.length,
      seed: 41,
      attempts: 1,
      candidateProbabilities: [0, 100, 0, 100, 0],
      maxHiddenClusterSize: 1,
    });
    expect(largestHiddenClusterSize(path, result.hiddenCells, BoardShape.Square)).toBeLessThanOrEqual(1);
  });

  it('normalizes and preserves algorithm 3 parameters', () => {
    const normalized = normalizeEditorAlgorithm({
      id: 'algorithm-3',
      parameters: {
        targetCrossings: 120,
        turnProbability: -5,
        straightHiddenProbability: 35,
        turnHiddenProbability: 70,
        crossingHiddenProbability: 101,
        hiddenPercent: 105,
        maxHiddenClusterSize: 500,
      },
    });

    expect(normalized).toMatchObject({
      id: 'algorithm-3',
      parameters: {
        targetCrossings: 99,
        turnProbability: 0,
        straightHiddenProbability: 35,
        turnHiddenProbability: 70,
        crossingHiddenProbability: 100,
        hiddenPercent: 100,
        maxHiddenClusterSize: 8,
      },
    });

    const hexSelection = resolveEditorAlgorithmForShape(createAlgorithm3Selection(), 'hex');
    expect(hexSelection).toMatchObject({
      id: 'algorithm-3',
      parameters: { targetCrossings: 0, crossingHiddenProbability: 0 },
    });
  });

  it('runs on algorithm 2 path generation and emits a fixed no-luck hidden layout', () => {
    const selection = createAlgorithm3Selection();
    selection.parameters = {
      ...selection.parameters,
      targetCrossings: 0,
      straightHiddenProbability: 100,
      turnHiddenProbability: 0,
      crossingHiddenProbability: 0,
      hiddenPercent: 90,
      maxHiddenClusterSize: 2,
    };
    const activeCells = new Set(Array.from({ length: 8 }, (_, x) => `${x},0`));
    const result = runAlgorithm3({
      rows: 1,
      columns: 8,
      activeCells,
      shape: 'rectangle',
      generationIndex: 11,
      searchMode: 'realtime',
    }, selection);

    expect(result?.path).toHaveLength(8);
    const hidden = new Set(result?.hiddenCells?.map(cellKey));
    expect(hidden.size).toBeGreaterThan(0);
    expect(largestHiddenClusterSize(result?.path ?? [], hidden, BoardShape.Rectangle)).toBeLessThanOrEqual(2);
    expect(findPureLuckAlternative(result?.path ?? [], hidden, BoardShape.Rectangle)).toBeNull();
  });

  it('saves algorithm 3 and its hidden-selection parameters through the editor model', () => {
    const model = new LevelEditorModel();
    for (let index = 0; index < 5; index += 1) model.changeSize(-1);
    model.fill();
    model.setAlgorithm('algorithm-3');
    const selection = model.algorithmSelection;
    if (selection.id !== 'algorithm-3') throw new Error('算法3未正确加载。');
    model.setAlgorithmSelection({
      ...selection,
      parameters: {
        ...selection.parameters,
        straightHiddenProbability: 80,
        turnHiddenProbability: 65,
        crossingHiddenProbability: 30,
        hiddenPercent: 55,
        maxHiddenClusterSize: 2,
      },
    });

    expect(model.generatePath()).toBe(true);
    const level = model.createLevel(303);
    expect(level?.algorithm).toMatchObject({
      id: 'algorithm-3',
      parameters: {
        straightHiddenProbability: 80,
        turnHiddenProbability: 65,
        crossingHiddenProbability: 30,
        hiddenPercent: 55,
        maxHiddenClusterSize: 2,
      },
    });
    const hidden = new Set(level?.hiddenCells?.map(cellKey));
    expect(largestHiddenClusterSize(level?.solutionPath ?? [], hidden, BoardShape.Square)).toBeLessThanOrEqual(2);
    expect(findPureLuckAlternative(level?.solutionPath ?? [], hidden, BoardShape.Square)).toBeNull();
  });
});
