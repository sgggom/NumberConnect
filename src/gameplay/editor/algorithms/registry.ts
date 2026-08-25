import type { LevelAlgorithmData } from '../../../game/types';
import type { EditorShape } from '../types';
import { createAlgorithm1Selection, runAlgorithm1 } from './algorithm1';
import type { EditorAlgorithmContext, EditorAlgorithmDescriptor, EditorAlgorithmId, EditorAlgorithmSelection } from './types';

export const DEFAULT_EDITOR_ALGORITHM_ID: EditorAlgorithmId = 'algorithm-1';

export const EDITOR_ALGORITHMS: readonly EditorAlgorithmDescriptor[] = [{
  id: 'algorithm-1',
  label: '算法1',
  description: '难度会额外增加同值百分点的隐藏数字，再用基准点、局部分岔、线索距离和邻近扩展配额生成布局。',
}];

export const createEditorAlgorithm = (_id: EditorAlgorithmId): EditorAlgorithmSelection => createAlgorithm1Selection();

const normalizedInteger = (value: unknown, fallback: number, min: number, max: number): number => (
  Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Math.floor(Number(value)))) : fallback
);

export const normalizeEditorAlgorithm = (value?: LevelAlgorithmData): EditorAlgorithmSelection => {
  const defaults = createAlgorithm1Selection();
  const parameters = value?.id === 'algorithm-1' || value?.id === 'algorithm-8' ? value.parameters : undefined;
  return {
    id: 'algorithm-1',
    parameters: {
      topology: 'board-shape',
      pathMode: 'spatial-distribution-multiple-solutions',
      targetCrossings: normalizedInteger(parameters?.targetCrossings, defaults.parameters.targetCrossings, 0, 99),
      turnProbability: normalizedInteger(parameters?.turnProbability, defaults.parameters.turnProbability, 0, 100),
      hiddenPercent: normalizedInteger(parameters?.hiddenPercent, defaults.parameters.hiddenPercent, 0, 100),
      targetDifficulty: normalizedInteger(parameters?.targetDifficulty, defaults.parameters.targetDifficulty, 1, 10),
      maxVisibleRun: normalizedInteger(parameters?.maxVisibleRun, defaults.parameters.maxVisibleRun, 1, 99),
      maxHiddenRun: normalizedInteger(parameters?.maxHiddenRun, defaults.parameters.maxHiddenRun, 1, 99),
    },
  };
};

export const resolveEditorAlgorithmForShape = (
  selection: EditorAlgorithmSelection,
  shape: EditorShape,
): EditorAlgorithmSelection => shape === 'hex'
  ? { ...selection, parameters: { ...selection.parameters, targetCrossings: 0 } }
  : selection;

export const runEditorAlgorithm = (selection: EditorAlgorithmSelection, context: EditorAlgorithmContext) => {
  context.onProgress?.(0);
  return runAlgorithm1(context, resolveEditorAlgorithmForShape(selection, context.shape));
};

export const editorAlgorithmLabel = (_id?: string): string => '算法1';
