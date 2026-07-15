import { BoardShape, type Cell } from '../../../game/types';
import { selectUnambiguousHiddenCells } from '../../../game/unambiguousHidden';
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
    pathMode: 'single-stroke-no-luck',
    targetCrossings: 20,
    turnProbability: 40,
    hiddenPercent: 50,
    maxHiddenRun: 3,
    maxVisibleRun: 4,
  },
});

const boardShapeOf = (shape: EditorAlgorithmContext['shape']): BoardShape => {
  switch (shape) {
    case 'diamond': return BoardShape.Diamond;
    case 'rectangle': return BoardShape.Rectangle;
    case 'hex': return BoardShape.Hex;
    default: return BoardShape.Square;
  }
};

const toCell = (key: string): Cell => {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
};

export const runAlgorithm2 = (
  context: EditorAlgorithmContext,
  selection: Algorithm2Selection,
): EditorAlgorithmResult | null => {
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
        selection.parameters.targetCrossings,
        context.generationIndex,
        { crossingMode: 'maximum', ...(realtime ? { maxNodes: 6000 } : {}) },
      );
  const candidates: EditorCell[][] = [];
  const zeroCrossingLimit = selection.parameters.targetCrossings <= 0;
  const attempts = realtime
    ? 2
    : zeroCrossingLimit
      ? 3
      : context.activeCells.size <= 64 ? 5 : 4;
  const candidateNodeBudget = realtime ? 6000 : zeroCrossingLimit ? 15000 : 40000;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = findEditorPath(
      context.rows,
      context.columns,
      context.activeCells,
      context.shape,
      selection.parameters.targetCrossings,
      Math.imul(context.generationIndex + 1, 97) + attempt,
      {
        style: 'varied',
        crossingMode: 'maximum',
        turnProbability: selection.parameters.turnProbability,
        maxNodes: candidateNodeBudget,
      },
    );
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

  const path = randomizeEditorPath(
    selectedPath,
    context.shape,
    selection.parameters.targetCrossings,
    candidateSeed ^ 0xa511e9b3,
    selection.parameters.turnProbability,
  );

  const seed = Math.imul(context.generationIndex + 1, 104729)
    ^ Math.imul(context.rows + 1, 73856093)
    ^ Math.imul(context.columns + 1, 19349663)
    ^ path.length;
  const hidden = selectUnambiguousHiddenCells(path, boardShapeOf(context.shape), {
    hiddenPercent: selection.parameters.hiddenPercent,
    maxHiddenRun: selection.parameters.maxHiddenRun,
    maxVisibleRun: selection.parameters.maxVisibleRun,
    seed,
    ...(realtime ? { attempts: 2 } : {}),
  });

  return {
    path,
    hiddenCells: [...hidden.hiddenCells].map(toCell),
    targetHiddenCount: hidden.targetCount,
  };
};
