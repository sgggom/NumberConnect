import { createRandom, shuffle } from '../../../game/random';
import { BoardShape, cellKey, type Cell } from '../../../game/types';
import { largestHiddenClusterSize } from '../../../game/unambiguousHidden';
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
    pathMode: 'single-stroke-multiple-solutions-feature-hidden',
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

const canHideIndex = (
  pathCount: number,
  hiddenIndices: ReadonlySet<number>,
  index: number,
  maxHiddenRun: number,
): boolean => {
  if (index <= 0 || index >= pathCount - 1 || hiddenIndices.has(index)) return false;
  let runLength = 1;
  for (let cursor = index - 1; cursor >= 0 && hiddenIndices.has(cursor); cursor -= 1) runLength += 1;
  for (let cursor = index + 1; cursor < pathCount && hiddenIndices.has(cursor); cursor += 1) runLength += 1;
  return runLength <= Math.max(1, Math.floor(maxHiddenRun));
};

export interface Algorithm3HiddenSelection {
  hiddenCells: Set<string>;
  targetCount: number;
}

export const selectAlgorithm3HiddenCells = (
  path: ReadonlyArray<EditorCell>,
  shape: EditorShape,
  parameters: Pick<
    Algorithm3Parameters,
    | 'straightHiddenProbability'
    | 'turnHiddenProbability'
    | 'crossingHiddenProbability'
    | 'hiddenPercent'
    | 'maxHiddenClusterSize'
  >,
  seed: number,
): Algorithm3HiddenSelection => {
  const targetCount = Math.min(
    Math.max(0, path.length - 2),
    Math.max(0, Math.round(path.length * parameters.hiddenPercent / 100)),
  );
  if (targetCount === 0 || path.length < 3) {
    return { hiddenCells: new Set(), targetCount };
  }

  const probabilities = algorithm3CandidateProbabilities(path, shape, parameters);
  const random = createRandom(seed ^ 0x6c8e9cf5);
  const candidates: number[] = [];
  for (let index = 1; index < path.length - 1; index += 1) {
    const probability = Math.max(0, Math.min(100, Number(probabilities[index]) || 0));
    if (random() * 100 < probability) candidates.push(index);
  }
  shuffle(candidates, random);

  const hiddenIndices = new Set<number>();
  const boardShape = boardShapeOf(shape);
  const clusterLimit = Math.max(1, Math.floor(parameters.maxHiddenClusterSize));
  for (const index of candidates) {
    if (hiddenIndices.size >= targetCount) break;
    if (!canHideIndex(path.length, hiddenIndices, index, clusterLimit)) continue;
    const candidateHiddenCells = new Set(
      [...hiddenIndices, index].map((hiddenIndex) => cellKey(path[hiddenIndex])),
    );
    if (largestHiddenClusterSize(path, candidateHiddenCells, boardShape) > clusterLimit) continue;
    hiddenIndices.add(index);
  }

  return {
    hiddenCells: new Set([...hiddenIndices].map((index) => cellKey(path[index]))),
    targetCount,
  };
};

export const runAlgorithm3 = (
  context: EditorAlgorithmContext,
  selection: Algorithm3Selection,
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
    ^ 0x3a17f19d;
  const hidden = selectAlgorithm3HiddenCells(path, context.shape, selection.parameters, seed);
  context.onProgress?.(1);

  return {
    path,
    hiddenCells: [...hidden.hiddenCells].map(toCell),
    targetHiddenCount: hidden.targetCount,
  };
};
