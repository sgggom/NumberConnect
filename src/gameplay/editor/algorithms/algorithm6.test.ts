import { describe, expect, it } from 'vitest';
import { LevelEditorModel } from '../LevelEditorModel';
import { createAlgorithm5Selection, runAlgorithm5 } from './algorithm5';
import { createAlgorithm6Selection, runAlgorithm6 } from './algorithm6';
import {
  editorAlgorithmLabel,
  normalizeEditorAlgorithm,
  resolveEditorAlgorithmForShape,
} from './registry';

describe('editor algorithm 6', () => {
  it('copies algorithm 5 defaults and generation behavior', () => {
    const algorithm5 = createAlgorithm5Selection();
    const algorithm6 = createAlgorithm6Selection();
    expect(algorithm6).toEqual({
      id: 'algorithm-6',
      parameters: algorithm5.parameters,
    });

    const context = {
      rows: 3,
      columns: 3,
      activeCells: new Set(Array.from(
        { length: 9 },
        (_, index) => `${index % 3},${Math.floor(index / 3)}`,
      )),
      shape: 'square' as const,
      generationIndex: 61,
      searchMode: 'quality' as const,
    };
    expect(runAlgorithm6(context, algorithm6)).toEqual(runAlgorithm5(context, algorithm5));
  });

  it('normalizes, labels, and resolves algorithm 6 independently', () => {
    const normalized = normalizeEditorAlgorithm({
      id: 'algorithm-6',
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
      id: 'algorithm-6',
      parameters: {
        targetCrossings: 99,
        turnProbability: 0,
        earlyHiddenProbability: 35,
        middleHiddenProbability: 55,
        lateHiddenProbability: 75,
      },
    });
    expect(editorAlgorithmLabel('algorithm-6')).toBe('算法6');
    expect(resolveEditorAlgorithmForShape(createAlgorithm6Selection(), 'hex'))
      .toMatchObject({ id: 'algorithm-6', parameters: { targetCrossings: 0 } });
  });

  it('saves algorithm 6 through the editor model', () => {
    const model = new LevelEditorModel();
    for (let index = 0; index < 5; index += 1) model.changeSize(-1);
    model.fill();
    model.setAlgorithm('algorithm-6');

    expect(model.generatePath()).toBe(true);
    expect(model.createLevel(606)?.algorithm).toMatchObject({
      id: 'algorithm-6',
      parameters: {
        pathMode: 'single-stroke-multiple-solutions',
        earlyHiddenProbability: 50,
        middleHiddenProbability: 50,
        lateHiddenProbability: 50,
      },
    });
  });
});
