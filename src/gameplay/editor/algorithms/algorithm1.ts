import { findEditorPath } from '../findEditorPath';
import type { Algorithm1Selection, EditorAlgorithmContext, EditorAlgorithmResult } from './types';

export const createAlgorithm1Selection = (): Algorithm1Selection => ({
  id: 'algorithm-1',
  parameters: {
    topology: 'board-shape',
    pathMode: 'single-stroke',
    targetCrossings: 0,
  },
});

export const runAlgorithm1 = (
  context: EditorAlgorithmContext,
  selection: Algorithm1Selection,
): EditorAlgorithmResult | null => {
  const path = findEditorPath(
    context.rows,
    context.columns,
    context.activeCells,
    context.shape,
    selection.parameters.targetCrossings,
    context.generationIndex,
    { crossingMode: 'maximum' },
  );
  return path ? { path } : null;
};
