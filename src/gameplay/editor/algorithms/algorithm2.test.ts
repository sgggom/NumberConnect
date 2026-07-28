import { describe, expect, it } from 'vitest';
import { findPureLuckAlternative } from '../../../game/pureLuck';
import { BoardShape, cellKey } from '../../../game/types';
import { LevelEditorModel } from '../LevelEditorModel';
import { createAlgorithm2Selection, runAlgorithm2 } from './algorithm2';
import {
  EDITOR_ALGORITHMS,
  editorAlgorithmLabel,
  normalizeEditorAlgorithm,
  resolveEditorAlgorithmForShape,
} from './registry';

describe('editor algorithm 2 multiple-solution behavior', () => {
  it('uses ordinary hidden rules without enforcing uniqueness', () => {
    const selection = createAlgorithm2Selection();
    selection.parameters = {
      ...selection.parameters,
      targetCrossings: 0,
      hiddenPercent: 90,
      maxHiddenRun: 8,
      maxVisibleRun: 4,
    };
    const result = runAlgorithm2({
      rows: 2,
      columns: 2,
      activeCells: new Set(['0,0', '1,0', '0,1', '1,1']),
      shape: 'square',
      generationIndex: 17,
      searchMode: 'quality',
    }, selection);
    const hidden = new Set(result?.hiddenCells?.map(cellKey));

    expect(result?.path).toHaveLength(4);
    expect(hidden.size).toBe(2);
    expect(findPureLuckAlternative(
      result?.path ?? [],
      hidden,
      BoardShape.Square,
    )).not.toBeNull();
  });

  it('normalizes and preserves algorithm 2 settings', () => {
    const normalized = normalizeEditorAlgorithm({
      id: 'algorithm-2',
      parameters: {
        targetCrossings: 120,
        turnProbability: -8,
        hiddenPercent: 95,
        maxHiddenRun: 30,
        maxVisibleRun: 0,
      },
    });

    expect(EDITOR_ALGORITHMS.map(({ id }) => id)).toEqual([
      'algorithm-1',
      'algorithm-2',
      'algorithm-3',
      'algorithm-4',
    ]);
    expect(normalized).toMatchObject({
      id: 'algorithm-2',
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
    expect(editorAlgorithmLabel('algorithm-2')).toBe('算法2');
    expect(resolveEditorAlgorithmForShape(createAlgorithm2Selection(), 'hex'))
      .toMatchObject({
        id: 'algorithm-2',
        parameters: { targetCrossings: 0 },
      });
  });

  it('saves algorithm 2 with its multiple-solution path mode', () => {
    const model = new LevelEditorModel();
    for (let index = 0; index < 5; index += 1) model.changeSize(-1);
    model.fill();
    model.setAlgorithm('algorithm-2');
    const selection = model.algorithmSelection;
    if (selection.id !== 'algorithm-2') throw new Error('算法2未正确加载。');
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
    expect(model.createLevel(202)?.algorithm).toMatchObject({
      id: 'algorithm-2',
      parameters: {
        pathMode: 'single-stroke-multiple-solutions',
        hiddenPercent: 70,
        maxHiddenRun: 5,
        maxVisibleRun: 6,
      },
    });
  });
});
