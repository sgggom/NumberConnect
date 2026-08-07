import { selectHiddenCells } from '../../../game/hidden';
import type { Cell } from '../../../game/types';
import { areEditorCellsNeighbors, findEditorPath, randomizeEditorPath } from '../findEditorPath';
import type { EditorCell } from '../types';
import type {
  Algorithm2Selection,
  EditorAlgorithmContext,
  EditorAlgorithmResult,
} from './types';

export const createAlgorithm2Selection = (): Algorithm2Selection => ({
  id: 'algorithm-2',
  parameters: {
    topology: 'board-shape',
    pathMode: 'single-stroke-multiple-solutions',
    targetCrossings: 20,
    turnProbability: 40,
    hiddenPercent: 50,
    maxHiddenRun: 3,
    maxVisibleRun: 4,
  },
});

const toCell = (key: string): Cell => {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
};

export const generateAlgorithm2Path = (
  context: EditorAlgorithmContext,
  parameters: Pick<Algorithm2Selection['parameters'], 'targetCrossings' | 'turnProbability'>,
): EditorCell[] | null => {
  const reportProgress = (progress: number): void => context.onProgress?.(
    Math.max(0, Math.min(0.98, progress)),
  );
  const providedFallback = context.fallbackPath?.map((cell) => ({ ...cell }));
  const fallbackKeys = new Set(providedFallback?.map((cell) => `${cell.x},${cell.y}`));
  const hasValidFallback = providedFallback?.length === context.activeCells.size
    && fallbackKeys.size === context.activeCells.size
    && providedFallback.every((cell, index, path) => context.activeCells.has(`${cell.x},${cell.y}`)
      && (index === 0 || areEditorCellsNeighbors(path[index - 1], cell, context.shape)));
  const realtime = context.searchMode === 'realtime';
  const fallbackPath = hasValidFallback
    ? providedFallback
    : findEditorPath(
        context.rows,
        context.columns,
        context.activeCells,
        context.shape,
        parameters.targetCrossings,
        context.generationIndex,
        {
          crossingMode: 'maximum',
          startMode: 'any',
          ...(realtime ? { maxNodes: 6000 } : {}),
          onProgress: (progress) => reportProgress(progress * 0.16),
        },
      );
  reportProgress(0.16);
  const candidates: EditorCell[][] = [];
  const zeroCrossingLimit = parameters.targetCrossings <= 0;
  const attempts = realtime
    ? 2
    : zeroCrossingLimit
      ? 3
      : context.activeCells.size <= 64 ? 5 : 4;
  const candidateNodeBudget = realtime ? 6000 : zeroCrossingLimit ? 15000 : 40000;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const attemptStart = 0.16 + 0.58 * attempt / attempts;
    const attemptSpan = 0.58 / attempts;
    const candidate = findEditorPath(
      context.rows,
      context.columns,
      context.activeCells,
      context.shape,
      parameters.targetCrossings,
      Math.imul(context.generationIndex + 1, 97) + attempt,
      {
        style: 'varied',
        crossingMode: 'maximum',
        startMode: 'any',
        turnProbability: parameters.turnProbability,
        maxNodes: candidateNodeBudget,
        onProgress: (progress) => reportProgress(attemptStart + attemptSpan * progress),
      },
    );
    reportProgress(attemptStart + attemptSpan);
    if (!candidate) continue;
    candidates.push(candidate);
  }

  const candidateSeed = (
    Math.imul(context.generationIndex + 1, 2654435761)
    ^ Math.imul(context.rows + 1, 73856093)
    ^ Math.imul(context.columns + 1, 19349663)
  ) >>> 0;
  const selectedPath = candidates.length > 0
    ? candidates[candidateSeed % candidates.length]
    : fallbackPath;
  if (!selectedPath) return null;

  const randomizedPath = randomizeEditorPath(
    selectedPath,
    context.shape,
    parameters.targetCrossings,
    candidateSeed ^ 0xa511e9b3,
    parameters.turnProbability,
    (progress) => reportProgress(0.74 + progress * 0.24),
  );
  reportProgress(0.98);
  return randomizedPath;
};

export const runAlgorithm2 = (
  context: EditorAlgorithmContext,
  selection: Algorithm2Selection,
): EditorAlgorithmResult | null => {
  const path = context.fixedPath?.map((cell) => ({ ...cell }))
    ?? generateAlgorithm2Path(context, selection.parameters);
  if (!path) return null;
  context.onProgress?.(0.98);
  if (context.generationPhase === 'path') {
    context.onProgress?.(1);
    return { path };
  }

  const seed = Math.imul(context.generationIndex + 1, 104729)
    ^ Math.imul(context.rows + 1, 73856093)
    ^ Math.imul(context.columns + 1, 19349663)
    ^ path.length
    ^ 0x4f1bbcdc;
  const hiddenCells = selectHiddenCells(
    [...path],
    selection.parameters.hiddenPercent,
    selection.parameters.maxHiddenRun,
    selection.parameters.maxVisibleRun,
    seed,
  );
  const targetHiddenCount = Math.min(
    Math.max(0, path.length - 2),
    Math.max(0, Math.round(path.length * selection.parameters.hiddenPercent / 100)),
  );
  context.onProgress?.(1);

  return {
    path,
    hiddenCells: [...hiddenCells].map(toCell),
    targetHiddenCount,
  };
};
