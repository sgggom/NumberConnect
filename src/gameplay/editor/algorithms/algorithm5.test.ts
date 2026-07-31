import { describe, expect, it } from 'vitest';
import { LevelEditorModel } from '../LevelEditorModel';
import { createAlgorithm4Selection, runAlgorithm4 } from './algorithm4';
import {
  calculateAlgorithm5RowColumnHiddenSkipProbability,
  createAlgorithm5Selection,
  findAlgorithm5RowColumnPeerIndexes,
  runAlgorithm5,
} from './algorithm5';
import {
  editorAlgorithmLabel,
  normalizeEditorAlgorithm,
  resolveEditorAlgorithmForShape,
} from './registry';

describe('editor algorithm 5', () => {
  it('keeps algorithm 4 path defaults with independent row-column skip settings', () => {
    const algorithm4 = createAlgorithm4Selection();
    const algorithm5 = createAlgorithm5Selection();
    expect(algorithm5).toMatchObject({
      id: 'algorithm-5',
      parameters: {
        targetCrossings: algorithm4.parameters.targetCrossings,
        turnProbability: algorithm4.parameters.turnProbability,
        earlyHiddenProbability: algorithm4.parameters.earlyHiddenProbability,
        middleHiddenProbability: algorithm4.parameters.middleHiddenProbability,
        lateHiddenProbability: algorithm4.parameters.lateHiddenProbability,
        earlyRowColumnHiddenSkipProbability: 0,
        middleRowColumnHiddenSkipProbability: 0,
        lateRowColumnHiddenSkipProbability: 0,
        maxHiddenRun: algorithm4.parameters.maxHiddenRun,
        maxVisibleRun: algorithm4.parameters.maxVisibleRun,
      },
    });

    const context = {
      rows: 3,
      columns: 3,
      activeCells: new Set(Array.from(
        { length: 9 },
        (_, index) => `${index % 3},${Math.floor(index / 3)}`,
      )),
      shape: 'square' as const,
      generationIndex: 41,
      searchMode: 'quality' as const,
    };

    expect(runAlgorithm5(context, algorithm5)?.path).toEqual(
      runAlgorithm4(context, algorithm4)?.path,
    );
  });

  it('counts every valid cell in the same row or column instead of nearby cells', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 4, y: 0 },
      { x: 1, y: 3 },
      { x: 4, y: 4 },
      { x: 2, y: 2 },
    ];

    expect(findAlgorithm5RowColumnPeerIndexes(path, 2)).toEqual([0, 4]);
    expect(findAlgorithm5RowColumnPeerIndexes(path, 1)).toEqual([3]);
    expect(calculateAlgorithm5RowColumnHiddenSkipProbability(60, 0, 8)).toBe(0);
    expect(calculateAlgorithm5RowColumnHiddenSkipProbability(60, 2, 8)).toBe(15);
    expect(calculateAlgorithm5RowColumnHiddenSkipProbability(60, 4, 8)).toBe(30);
    expect(calculateAlgorithm5RowColumnHiddenSkipProbability(60, 8, 8)).toBe(60);
  });

  it('normalizes, labels, and resolves algorithm 5 independently', () => {
    const normalized = normalizeEditorAlgorithm({
      id: 'algorithm-5',
      parameters: {
        targetCrossings: 120,
        turnProbability: -8,
        earlyHiddenProbability: 35,
        middleHiddenProbability: 55,
        lateHiddenProbability: 75,
        earlyRowColumnHiddenSkipProbability: 25,
        middleRowColumnHiddenSkipProbability: 50,
        lateRowColumnHiddenSkipProbability: 75,
        maxHiddenRun: 5,
        maxVisibleRun: 6,
      },
    });

    expect(normalized).toMatchObject({
      id: 'algorithm-5',
      parameters: {
        targetCrossings: 99,
        turnProbability: 0,
        earlyHiddenProbability: 35,
        middleHiddenProbability: 55,
        lateHiddenProbability: 75,
        earlyRowColumnHiddenSkipProbability: 25,
        middleRowColumnHiddenSkipProbability: 50,
        lateRowColumnHiddenSkipProbability: 75,
        maxHiddenRun: 5,
        maxVisibleRun: 6,
      },
    });
    expect(editorAlgorithmLabel('algorithm-5')).toBe('算法5');
    expect(resolveEditorAlgorithmForShape(createAlgorithm5Selection(), 'hex'))
      .toMatchObject({
        id: 'algorithm-5',
        parameters: { targetCrossings: 0 },
      });
  });

  it('saves algorithm 5 through the editor model', () => {
    const model = new LevelEditorModel();
    for (let index = 0; index < 5; index += 1) model.changeSize(-1);
    model.fill();
    model.setAlgorithm('algorithm-5');

    expect(model.generatePath()).toBe(true);
    expect(model.createLevel(505)?.algorithm).toMatchObject({
      id: 'algorithm-5',
      parameters: {
        pathMode: 'single-stroke-multiple-solutions',
        earlyHiddenProbability: 50,
        middleHiddenProbability: 50,
        lateHiddenProbability: 50,
      },
    });
  });
});
