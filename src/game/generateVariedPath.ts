import { areCellsNeighbors, findPath, randomizePath } from './pathGenerator';
import type { Cell } from './types';
import type { PathGenerationContext } from './pathGenerationTypes';

export interface VariedPathParameters {
  targetCrossings: number;
  turnProbability: number;
}

export const generateVariedPath = (
  context: PathGenerationContext,
  parameters: VariedPathParameters,
): Cell[] | null => {
  const reportProgress = (progress: number): void => context.onProgress?.(
    Math.max(0, Math.min(0.98, progress)),
  );
  const providedFallback = context.fallbackPath?.map((cell) => ({ ...cell }));
  const fallbackKeys = new Set(providedFallback?.map((cell) => `${cell.x},${cell.y}`));
  const hasValidFallback = providedFallback?.length === context.activeCells.size
    && fallbackKeys.size === context.activeCells.size
    && providedFallback.every((cell, index, path) => context.activeCells.has(`${cell.x},${cell.y}`)
      && (index === 0 || areCellsNeighbors(path[index - 1], cell, context.shape)));
  const realtime = context.searchMode === 'realtime';
  const fallbackPath = hasValidFallback
    ? providedFallback
    : findPath(
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
  const candidates: Cell[][] = [];
  const zeroCrossingLimit = parameters.targetCrossings <= 0;
  const attempts = realtime ? 2 : zeroCrossingLimit ? 3 : context.activeCells.size <= 64 ? 5 : 4;
  const candidateNodeBudget = realtime ? 6000 : zeroCrossingLimit ? 15000 : 40000;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const attemptStart = 0.16 + 0.58 * attempt / attempts;
    const attemptSpan = 0.58 / attempts;
    const candidate = findPath(
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
    if (candidate) candidates.push(candidate);
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

  const randomizedPath = randomizePath(
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
