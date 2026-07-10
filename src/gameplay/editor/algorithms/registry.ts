import type { LevelAlgorithmData } from '../../../game/types';
import type { EditorShape } from '../types';
import { createAlgorithm1Selection, runAlgorithm1 } from './algorithm1';
import type {
  EditorAlgorithmContext,
  EditorAlgorithmDescriptor,
  EditorAlgorithmId,
  EditorAlgorithmSelection,
} from './types';

export const DEFAULT_EDITOR_ALGORITHM_ID: EditorAlgorithmId = 'algorithm-1';

export const EDITOR_ALGORITHMS: readonly EditorAlgorithmDescriptor[] = [
  {
    id: 'algorithm-1',
    label: '算法1',
    description: '按当前棋盘的相邻规则生成一笔路径，并以指定交叉数量为搜索目标。',
  },
];

export const createEditorAlgorithm = (id: EditorAlgorithmId): EditorAlgorithmSelection => {
  switch (id) {
    case 'algorithm-1':
      return createAlgorithm1Selection();
  }
};

export const normalizeEditorAlgorithm = (
  value?: LevelAlgorithmData,
): EditorAlgorithmSelection => {
  if (value?.id === 'algorithm-1') {
    const defaults = createAlgorithm1Selection();
    return {
      ...defaults,
      parameters: {
        topology: value.parameters?.topology === 'board-shape'
          ? 'board-shape'
          : defaults.parameters.topology,
        pathMode: value.parameters?.pathMode === 'single-stroke'
          ? 'single-stroke'
          : defaults.parameters.pathMode,
        targetCrossings: Number.isFinite(Number(value.parameters?.targetCrossings))
          ? Math.max(0, Math.min(99, Math.floor(Number(value.parameters.targetCrossings))))
          : defaults.parameters.targetCrossings,
      },
    };
  }
  return createEditorAlgorithm(DEFAULT_EDITOR_ALGORITHM_ID);
};

export const resolveEditorAlgorithmForShape = (
  selection: EditorAlgorithmSelection,
  shape: EditorShape,
): EditorAlgorithmSelection => {
  switch (selection.id) {
    case 'algorithm-1':
      return shape === 'hex'
        ? {
            ...selection,
            parameters: { ...selection.parameters, targetCrossings: 0 },
          }
        : selection;
  }
};

export const runEditorAlgorithm = (
  selection: EditorAlgorithmSelection,
  context: EditorAlgorithmContext,
) => {
  const resolved = resolveEditorAlgorithmForShape(selection, context.shape);
  switch (resolved.id) {
    case 'algorithm-1':
      return runAlgorithm1(context, resolved);
  }
};

export const editorAlgorithmLabel = (id?: string): string =>
  EDITOR_ALGORITHMS.find((algorithm) => algorithm.id === id)?.label ?? '算法1';
