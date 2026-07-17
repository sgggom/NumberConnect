import { BoardShape, type Cell } from '../../../game/types';
import { selectUnambiguousHiddenCells } from '../../../game/unambiguousHidden';
import { editorPathCrossingCellIndexes } from '../findEditorPath';
import type { EditorCell, EditorShape } from '../types';
import { generateAlgorithm2Path } from './algorithm2';
import type {
  Algorithm3Parameters,
  Algorithm3Selection,
  EditorAlgorithmContext,
  EditorAlgorithmResult,
} from './types';

export type Algorithm3HiddenFeature = 'endpoint' | 'straight' | 'turn' | 'crossing';

export const createAlgorithm3Selection = (): Algorithm3Selection => ({
  id: 'algorithm-3',
  parameters: {
    topology: 'board-shape',
    pathMode: 'single-stroke-no-luck-feature-hidden',
    targetCrossings: 20,
    turnProbability: 40,
    straightHiddenProbability: 50,
    turnHiddenProbability: 50,
    crossingHiddenProbability: 50,
    hiddenPercent: 50,
    maxHiddenClusterSize: 3,
  },
});

const projectCell = (cell: EditorCell, shape: EditorShape): EditorCell => {
  if (shape === 'diamond') {
    return {
      x: (cell.x - cell.y) * Math.SQRT1_2,
      y: (cell.x + cell.y) * Math.SQRT1_2,
    };
  }
  if (shape === 'hex') {
    return {
      x: cell.x * 0.8660254,
      y: cell.y + (cell.x % 2 === 0 ? 0 : 0.5),
    };
  }
  return cell;
};

const isStraightContinuation = (
  previous: EditorCell,
  current: EditorCell,
  next: EditorCell,
): boolean => {
  const incomingX = current.x - previous.x;
  const incomingY = current.y - previous.y;
  const outgoingX = next.x - current.x;
  const outgoingY = next.y - current.y;
  const cross = incomingX * outgoingY - incomingY * outgoingX;
  const dot = incomingX * outgoingX + incomingY * outgoingY;
  return Math.abs(cross) < 1e-7 && dot > 0;
};

export const classifyAlgorithm3HiddenFeatures = (
  path: ReadonlyArray<EditorCell>,
  shape: EditorShape,
): Algorithm3HiddenFeature[] => {
  const projected = path.map((cell) => projectCell(cell, shape));
  const crossingIndexes = editorPathCrossingCellIndexes(path, shape);
  return path.map((_, index) => {
    if (index === 0 || index === path.length - 1) return 'endpoint';
    if (crossingIndexes.has(index)) return 'crossing';
    return isStraightContinuation(projected[index - 1], projected[index], projected[index + 1])
      ? 'straight'
      : 'turn';
  });
};

export const algorithm3CandidateProbabilities = (
  path: ReadonlyArray<EditorCell>,
  shape: EditorShape,
  parameters: Pick<
    Algorithm3Parameters,
    'straightHiddenProbability' | 'turnHiddenProbability' | 'crossingHiddenProbability'
  >,
): number[] => classifyAlgorithm3HiddenFeatures(path, shape).map((feature) => {
  switch (feature) {
    case 'straight': return parameters.straightHiddenProbability;
    case 'turn': return parameters.turnHiddenProbability;
    case 'crossing': return parameters.crossingHiddenProbability;
    default: return 0;
  }
});

const boardShapeOf = (shape: EditorShape): BoardShape => {
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

export const runAlgorithm3 = (
  context: EditorAlgorithmContext,
  selection: Algorithm3Selection,
): EditorAlgorithmResult | null => {
  const path = generateAlgorithm2Path(context, selection.parameters);
  if (!path) return null;

  const seed = Math.imul(context.generationIndex + 1, 104729)
    ^ Math.imul(context.rows + 1, 73856093)
    ^ Math.imul(context.columns + 1, 19349663)
    ^ path.length
    ^ 0x3a17f19d;
  const hidden = selectUnambiguousHiddenCells(path, boardShapeOf(context.shape), {
    hiddenPercent: selection.parameters.hiddenPercent,
    maxHiddenRun: selection.parameters.maxHiddenClusterSize,
    maxHiddenClusterSize: selection.parameters.maxHiddenClusterSize,
    maxVisibleRun: Math.max(1, path.length),
    seed,
    attempts: 1,
    candidateProbabilities: algorithm3CandidateProbabilities(path, context.shape, selection.parameters),
  });

  return {
    path,
    hiddenCells: [...hidden.hiddenCells].map(toCell),
    targetHiddenCount: hidden.targetCount,
  };
};
