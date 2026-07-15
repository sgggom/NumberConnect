import type { LevelAlgorithmData } from '../../../game/types';
import type { EditorShape } from '../types';
import { createAlgorithm1Selection, runAlgorithm1 } from './algorithm1';
import { createAlgorithm2Selection, runAlgorithm2 } from './algorithm2';
import type {
  EditorAlgorithmContext,
  EditorAlgorithmDescriptor,
  EditorAlgorithmId,
  EditorAlgorithmSelection,
} from './types';

export const DEFAULT_EDITOR_ALGORITHM_ID: EditorAlgorithmId = 'algorithm-2';
const LEGACY_EDITOR_ALGORITHM_ID: EditorAlgorithmId = 'algorithm-1';

export const EDITOR_ALGORITHMS: readonly EditorAlgorithmDescriptor[] = [
  {
    id: 'algorithm-1',
    label: '算法1',
    description: '按当前棋盘的相邻规则生成一笔路径，交叉数量不会超过设置的上限。',
  },
  {
    id: 'algorithm-2',
    label: '算法2',
    description: '在不死局且交叉不超过上限的前提下随机选择方向和完整路径，并消除纯运气解。',
  },
];

export const createEditorAlgorithm = (id: EditorAlgorithmId): EditorAlgorithmSelection => {
  switch (id) {
    case 'algorithm-1':
      return createAlgorithm1Selection();
    case 'algorithm-2':
      return createAlgorithm2Selection();
  }
};

const normalizedInteger = (value: unknown, fallback: number, min: number, max: number): number =>
  Number.isFinite(Number(value))
    ? Math.max(min, Math.min(max, Math.floor(Number(value))))
    : fallback;

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
  if (value?.id === 'algorithm-2') {
    const defaults = createAlgorithm2Selection();
    return {
      ...defaults,
      parameters: {
        topology: 'board-shape',
        pathMode: 'single-stroke-no-luck',
        targetCrossings: normalizedInteger(
          value.parameters?.targetCrossings,
          defaults.parameters.targetCrossings,
          0,
          99,
        ),
        turnProbability: normalizedInteger(
          value.parameters?.turnProbability,
          defaults.parameters.turnProbability,
          0,
          100,
        ),
        hiddenPercent: normalizedInteger(
          value.parameters?.hiddenPercent,
          defaults.parameters.hiddenPercent,
          0,
          90,
        ),
        maxHiddenRun: normalizedInteger(
          value.parameters?.maxHiddenRun,
          defaults.parameters.maxHiddenRun,
          1,
          8,
        ),
        maxVisibleRun: normalizedInteger(
          value.parameters?.maxVisibleRun,
          defaults.parameters.maxVisibleRun,
          1,
          12,
        ),
      },
    };
  }
  return createEditorAlgorithm(LEGACY_EDITOR_ALGORITHM_ID);
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
    case 'algorithm-2':
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
    case 'algorithm-2':
      return runAlgorithm2(context, resolved);
  }
};

export const editorAlgorithmLabel = (id?: string): string =>
  EDITOR_ALGORITHMS.find((algorithm) => algorithm.id === id)?.label ?? '算法1';
