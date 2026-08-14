import type { LevelAlgorithmData } from '../../../game/types';
import type { EditorShape } from '../types';
import { createAlgorithm1Selection, runAlgorithm1 } from './algorithm1';
import { createAlgorithm2Selection, runAlgorithm2 } from './algorithm2';
import { createAlgorithm3Selection, runAlgorithm3 } from './algorithm3';
import { createAlgorithm4Selection, runAlgorithm4 } from './algorithm4';
import { createAlgorithm5Selection, runAlgorithm5 } from './algorithm5';
import { createAlgorithm6Selection, runAlgorithm6 } from './algorithm6';
import { createAlgorithm7Selection, runAlgorithm7 } from './algorithm7';
import { createAlgorithm8Selection, runAlgorithm8 } from './algorithm8';
import type {
  EditorAlgorithmContext,
  EditorAlgorithmDescriptor,
  EditorAlgorithmId,
  EditorAlgorithmSelection,
} from './types';

export const DEFAULT_EDITOR_ALGORITHM_ID: EditorAlgorithmId = 'algorithm-8';
const LEGACY_EDITOR_ALGORITHM_ID: EditorAlgorithmId = 'algorithm-1';

export const EDITOR_ALGORITHMS: readonly EditorAlgorithmDescriptor[] = [
  {
    id: 'algorithm-8',
    label: '算法8',
    description: '难度会额外增加同值百分点的隐藏数字，再用基准点、局部分岔、线索距离和邻近扩展配额生成布局。',
  },
];

export const createEditorAlgorithm = (id: EditorAlgorithmId): EditorAlgorithmSelection => {
  switch (id) {
    case 'algorithm-1':
      return createAlgorithm1Selection();
    case 'algorithm-2':
      return createAlgorithm2Selection();
    case 'algorithm-3':
      return createAlgorithm3Selection();
    case 'algorithm-4':
      return createAlgorithm4Selection();
    case 'algorithm-5':
      return createAlgorithm5Selection();
    case 'algorithm-6':
      return createAlgorithm6Selection();
    case 'algorithm-7':
      return createAlgorithm7Selection();
    case 'algorithm-8':
      return createAlgorithm8Selection();
  }
};

const normalizedInteger = (value: unknown, fallback: number, min: number, max: number): number =>
  Number.isFinite(Number(value))
    ? Math.max(min, Math.min(max, Math.floor(Number(value))))
    : fallback;

const normalizedLegacySkipProbability = (value: unknown, fallback: number): number => {
  if (typeof value === 'boolean') return value ? 100 : 0;
  if (value === 1 || value === '1') return 100;
  if (value === 0 || value === '0') return 0;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['true', 'yes', '是'].includes(normalized)) return 100;
  if (['false', 'no', '否'].includes(normalized)) return 0;
  return fallback;
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
  if (value?.id === 'algorithm-2') {
    const defaults = createAlgorithm2Selection();
    return {
      ...defaults,
      parameters: {
        topology: 'board-shape',
        pathMode: 'single-stroke-multiple-solutions',
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
  if (value?.id === 'algorithm-3') {
    const defaults = createAlgorithm3Selection();
    return {
      ...defaults,
      parameters: {
        topology: 'board-shape',
        pathMode: 'single-stroke-multiple-solutions-feature-hidden',
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
        straightHiddenProbability: normalizedInteger(
          value.parameters?.straightHiddenProbability,
          defaults.parameters.straightHiddenProbability,
          0,
          100,
        ),
        turnHiddenProbability: normalizedInteger(
          value.parameters?.turnHiddenProbability,
          defaults.parameters.turnHiddenProbability,
          0,
          100,
        ),
        crossingHiddenProbability: normalizedInteger(
          value.parameters?.crossingHiddenProbability,
          defaults.parameters.crossingHiddenProbability,
          0,
          100,
        ),
        hiddenPercent: normalizedInteger(
          value.parameters?.hiddenPercent,
          defaults.parameters.hiddenPercent,
          0,
          100,
        ),
        maxHiddenClusterSize: normalizedInteger(
          value.parameters?.maxHiddenClusterSize ?? value.parameters?.maxHiddenRun,
          defaults.parameters.maxHiddenClusterSize,
          1,
          8,
        ),
      },
    };
  }
  if (value?.id === 'algorithm-4') {
    const defaults = createAlgorithm4Selection();
    const legacyHiddenProbability = normalizedInteger(
      value.parameters?.hiddenPercent,
      defaults.parameters.earlyHiddenProbability,
      0,
      100,
    );
    return {
      ...defaults,
      parameters: {
        topology: 'board-shape',
        pathMode: 'single-stroke-multiple-solutions',
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
        earlyHiddenProbability: normalizedInteger(
          value.parameters?.earlyHiddenProbability,
          legacyHiddenProbability,
          0,
          100,
        ),
        middleHiddenProbability: normalizedInteger(
          value.parameters?.middleHiddenProbability,
          legacyHiddenProbability,
          0,
          100,
        ),
        lateHiddenProbability: normalizedInteger(
          value.parameters?.lateHiddenProbability,
          legacyHiddenProbability,
          0,
          100,
        ),
        earlyAdjacentHiddenSkipProbability: normalizedInteger(
          value.parameters?.earlyAdjacentHiddenSkipProbability,
          normalizedLegacySkipProbability(
            value.parameters?.earlySkipAdjacentHidden,
            defaults.parameters.earlyAdjacentHiddenSkipProbability,
          ),
          0,
          100,
        ),
        middleAdjacentHiddenSkipProbability: normalizedInteger(
          value.parameters?.middleAdjacentHiddenSkipProbability,
          normalizedLegacySkipProbability(
            value.parameters?.middleSkipAdjacentHidden,
            defaults.parameters.middleAdjacentHiddenSkipProbability,
          ),
          0,
          100,
        ),
        lateAdjacentHiddenSkipProbability: normalizedInteger(
          value.parameters?.lateAdjacentHiddenSkipProbability,
          normalizedLegacySkipProbability(
            value.parameters?.lateSkipAdjacentHidden,
            defaults.parameters.lateAdjacentHiddenSkipProbability,
          ),
          0,
          100,
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
  if (value?.id === 'algorithm-5') {
    const defaults = createAlgorithm5Selection();
    const legacyHiddenProbability = normalizedInteger(
      value.parameters?.hiddenPercent,
      defaults.parameters.earlyHiddenProbability,
      0,
      100,
    );
    return {
      ...defaults,
      parameters: {
        topology: 'board-shape',
        pathMode: 'single-stroke-multiple-solutions',
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
        earlyHiddenProbability: normalizedInteger(
          value.parameters?.earlyHiddenProbability,
          legacyHiddenProbability,
          0,
          100,
        ),
        middleHiddenProbability: normalizedInteger(
          value.parameters?.middleHiddenProbability,
          legacyHiddenProbability,
          0,
          100,
        ),
        lateHiddenProbability: normalizedInteger(
          value.parameters?.lateHiddenProbability,
          legacyHiddenProbability,
          0,
          100,
        ),
        earlyRowColumnHiddenSkipProbability: normalizedInteger(
          value.parameters?.earlyRowColumnHiddenSkipProbability
            ?? value.parameters?.earlyAdjacentHiddenSkipProbability,
          normalizedLegacySkipProbability(
            value.parameters?.earlySkipAdjacentHidden,
            defaults.parameters.earlyRowColumnHiddenSkipProbability,
          ),
          0,
          100,
        ),
        middleRowColumnHiddenSkipProbability: normalizedInteger(
          value.parameters?.middleRowColumnHiddenSkipProbability
            ?? value.parameters?.middleAdjacentHiddenSkipProbability,
          normalizedLegacySkipProbability(
            value.parameters?.middleSkipAdjacentHidden,
            defaults.parameters.middleRowColumnHiddenSkipProbability,
          ),
          0,
          100,
        ),
        lateRowColumnHiddenSkipProbability: normalizedInteger(
          value.parameters?.lateRowColumnHiddenSkipProbability
            ?? value.parameters?.lateAdjacentHiddenSkipProbability,
          normalizedLegacySkipProbability(
            value.parameters?.lateSkipAdjacentHidden,
            defaults.parameters.lateRowColumnHiddenSkipProbability,
          ),
          0,
          100,
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
  if (value?.id === 'algorithm-6') {
    const defaults = createAlgorithm6Selection();
    const legacyHiddenProbability = normalizedInteger(
      value.parameters?.hiddenPercent,
      defaults.parameters.earlyHiddenProbability,
      0,
      100,
    );
    return {
      id: 'algorithm-6',
      parameters: {
        topology: 'board-shape',
        pathMode: 'single-stroke-multiple-solutions',
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
        earlyHiddenProbability: normalizedInteger(
          value.parameters?.earlyHiddenProbability,
          legacyHiddenProbability,
          0,
          100,
        ),
        middleHiddenProbability: normalizedInteger(
          value.parameters?.middleHiddenProbability,
          legacyHiddenProbability,
          0,
          100,
        ),
        lateHiddenProbability: normalizedInteger(
          value.parameters?.lateHiddenProbability,
          legacyHiddenProbability,
          0,
          100,
        ),
        earlyRowColumnHiddenSkipProbability: normalizedInteger(
          value.parameters?.earlyRowColumnHiddenSkipProbability
            ?? value.parameters?.earlyAdjacentHiddenSkipProbability,
          normalizedLegacySkipProbability(
            value.parameters?.earlySkipAdjacentHidden,
            defaults.parameters.earlyRowColumnHiddenSkipProbability,
          ),
          0,
          100,
        ),
        middleRowColumnHiddenSkipProbability: normalizedInteger(
          value.parameters?.middleRowColumnHiddenSkipProbability
            ?? value.parameters?.middleAdjacentHiddenSkipProbability,
          normalizedLegacySkipProbability(
            value.parameters?.middleSkipAdjacentHidden,
            defaults.parameters.middleRowColumnHiddenSkipProbability,
          ),
          0,
          100,
        ),
        lateRowColumnHiddenSkipProbability: normalizedInteger(
          value.parameters?.lateRowColumnHiddenSkipProbability
            ?? value.parameters?.lateAdjacentHiddenSkipProbability,
          normalizedLegacySkipProbability(
            value.parameters?.lateSkipAdjacentHidden,
            defaults.parameters.lateRowColumnHiddenSkipProbability,
          ),
          0,
          100,
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
  if (value?.id === 'algorithm-7') {
    const defaults = createAlgorithm7Selection();
    const minimumHiddenPercent = normalizedInteger(
      value.parameters?.minimumHiddenPercent,
      defaults.parameters.minimumHiddenPercent,
      0,
      90,
    );
    const maximumHiddenPercent = normalizedInteger(
      value.parameters?.maximumHiddenPercent,
      defaults.parameters.maximumHiddenPercent,
      minimumHiddenPercent,
      90,
    );
    return {
      id: 'algorithm-7',
      parameters: {
        topology: 'board-shape',
        pathMode: 'difficulty-inversion-multiple-solutions',
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
        targetDifficulty: normalizedInteger(
          value.parameters?.targetDifficulty,
          defaults.parameters.targetDifficulty,
          1,
          5,
        ),
        searchIterations: normalizedInteger(
          value.parameters?.searchIterations,
          defaults.parameters.searchIterations,
          1,
          30,
        ),
        minimumHiddenPercent,
        maximumHiddenPercent,
        maxHiddenRun: normalizedInteger(
          value.parameters?.maxHiddenRun,
          defaults.parameters.maxHiddenRun,
          1,
          12,
        ),
        maxVisibleRun: normalizedInteger(
          value.parameters?.maxVisibleRun,
          defaults.parameters.maxVisibleRun,
          1,
          16,
        ),
      },
    };
  }
  if (value?.id === 'algorithm-8') {
    const defaults = createAlgorithm8Selection();
    return {
      id: 'algorithm-8',
      parameters: {
        topology: 'board-shape',
        pathMode: 'spatial-distribution-multiple-solutions',
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
          100,
        ),
        targetDifficulty: normalizedInteger(
          value.parameters?.targetDifficulty,
          defaults.parameters.targetDifficulty,
          1,
          10,
        ),
        maxVisibleRun: normalizedInteger(
          value.parameters?.maxVisibleRun,
          defaults.parameters.maxVisibleRun,
          1,
          99,
        ),
        maxHiddenRun: normalizedInteger(
          value.parameters?.maxHiddenRun,
          defaults.parameters.maxHiddenRun,
          1,
          99,
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
    case 'algorithm-3':
      return shape === 'hex'
        ? {
            ...selection,
            parameters: {
              ...selection.parameters,
              targetCrossings: 0,
              crossingHiddenProbability: 0,
            },
          }
        : selection;
    case 'algorithm-4':
      return shape === 'hex'
        ? {
            ...selection,
            parameters: { ...selection.parameters, targetCrossings: 0 },
          }
        : selection;
    case 'algorithm-5':
      return shape === 'hex'
        ? {
            ...selection,
            parameters: { ...selection.parameters, targetCrossings: 0 },
          }
        : selection;
    case 'algorithm-6':
      return shape === 'hex'
        ? {
            ...selection,
            parameters: { ...selection.parameters, targetCrossings: 0 },
          }
        : selection;
    case 'algorithm-7':
      return shape === 'hex'
        ? {
            ...selection,
            parameters: { ...selection.parameters, targetCrossings: 0 },
          }
        : selection;
    case 'algorithm-8':
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
  context.onProgress?.(0);
  const resolved = resolveEditorAlgorithmForShape(selection, context.shape);
  switch (resolved.id) {
    case 'algorithm-1':
      return runAlgorithm1(context, resolved);
    case 'algorithm-2':
      return runAlgorithm2(context, resolved);
    case 'algorithm-3':
      return runAlgorithm3(context, resolved);
    case 'algorithm-4':
      return runAlgorithm4(context, resolved);
    case 'algorithm-5':
      return runAlgorithm5(context, resolved);
    case 'algorithm-6':
      return runAlgorithm6(context, resolved);
    case 'algorithm-7':
      return runAlgorithm7(context, resolved);
    case 'algorithm-8':
      return runAlgorithm8(context, resolved);
  }
};

export const editorAlgorithmLabel = (id?: string): string =>
  /^algorithm-[1-8]$/.test(id ?? '') ? `算法${id?.slice(-1)}` : '算法8';
