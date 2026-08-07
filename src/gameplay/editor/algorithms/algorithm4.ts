import { createRandom } from '../../../game/random';
import { neighborCells } from '../../../game/topology';
import { BoardShape, cellKey, type Cell } from '../../../game/types';
import type { EditorShape } from '../types';
import { generateAlgorithm2Path } from './algorithm2';
import type {
  Algorithm4Selection,
  EditorAlgorithmContext,
  EditorAlgorithmResult,
} from './types';

export const createAlgorithm4Selection = (): Algorithm4Selection => ({
  id: 'algorithm-4',
  parameters: {
    topology: 'board-shape',
    pathMode: 'single-stroke-multiple-solutions',
    targetCrossings: 20,
    turnProbability: 40,
    earlyHiddenProbability: 50,
    middleHiddenProbability: 50,
    lateHiddenProbability: 50,
    earlyAdjacentHiddenSkipProbability: 0,
    middleAdjacentHiddenSkipProbability: 0,
    lateAdjacentHiddenSkipProbability: 0,
    maxHiddenRun: 3,
    maxVisibleRun: 4,
  },
});

const toCell = (key: string): Cell => {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
};

const boardShapeOf = (shape: EditorShape): BoardShape => {
  switch (shape) {
    case 'diamond': return BoardShape.Diamond;
    case 'rectangle': return BoardShape.Rectangle;
    case 'hex': return BoardShape.Hex;
    default: return BoardShape.Square;
  }
};

const canHideIndex = (
  pathCount: number,
  hiddenIndices: ReadonlySet<number>,
  index: number,
  maxHiddenRun: number,
): boolean => {
  if (index <= 0 || index >= pathCount - 1 || hiddenIndices.has(index)) return false;

  let runLength = 1;
  for (let cursor = index - 1; cursor >= 0 && hiddenIndices.has(cursor); cursor -= 1) {
    runLength += 1;
  }
  for (let cursor = index + 1; cursor < pathCount && hiddenIndices.has(cursor); cursor += 1) {
    runLength += 1;
  }
  return runLength <= Math.max(1, Math.floor(maxHiddenRun));
};

type Algorithm4Phase = 'early' | 'middle' | 'late';

interface Algorithm4PhaseSettings {
  hiddenProbability: number;
  adjacentHiddenSkipProbability: number;
}

const phaseForPathIndex = (index: number, pathCount: number): Algorithm4Phase => {
  const phaseSize = Math.max(1, Math.round(pathCount * 0.25));
  if (index < phaseSize) return 'early';
  if (index >= pathCount - phaseSize) return 'late';
  return 'middle';
};

const phaseSettingsFor = (
  selection: Algorithm4Selection,
  phase: Algorithm4Phase,
): Algorithm4PhaseSettings => {
  if (phase === 'early') {
    return {
      hiddenProbability: selection.parameters.earlyHiddenProbability,
      adjacentHiddenSkipProbability:
        selection.parameters.earlyAdjacentHiddenSkipProbability,
    };
  }
  if (phase === 'late') {
    return {
      hiddenProbability: selection.parameters.lateHiddenProbability,
      adjacentHiddenSkipProbability:
        selection.parameters.lateAdjacentHiddenSkipProbability,
    };
  }
  return {
    hiddenProbability: selection.parameters.middleHiddenProbability,
    adjacentHiddenSkipProbability:
      selection.parameters.middleAdjacentHiddenSkipProbability,
  };
};

export const calculateAlgorithm4AdjacentHiddenSkipProbability = (
  configuredProbability: number,
  adjacentHiddenCount: number,
  adjacentNeighborCount: number,
): number => {
  const totalNeighbors = Math.max(0, Math.floor(adjacentNeighborCount));
  if (totalNeighbors === 0) return 0;
  const hiddenNeighbors = Math.min(
    totalNeighbors,
    Math.max(0, Math.floor(adjacentHiddenCount)),
  );
  return Math.min(100, Math.max(0, configuredProbability))
    * hiddenNeighbors
    / totalNeighbors;
};

export interface Algorithm4HiddenSelection {
  hiddenCells: Set<string>;
}

export const selectAlgorithm4HiddenLayout = (
  path: ReadonlyArray<Cell>,
  shape: EditorShape,
  selection: Algorithm4Selection,
  seed: number,
): Algorithm4HiddenSelection => {
  if (path.length < 3) return { hiddenCells: new Set() };

  const random = createRandom(seed ^ 0x71c3a95d);
  const pathIndexByKey = new Map(path.map((cell, index) => [cellKey(cell), index]));
  const boardShape = boardShapeOf(shape);
  const spatialNeighbors = path.map((cell) => neighborCells(cell, boardShape)
    .map((neighbor) => pathIndexByKey.get(cellKey(neighbor)))
    .filter((index): index is number => index !== undefined));

  const hiddenIndices = new Set<number>();
  const adjacentHiddenCount = (index: number): number => (
    spatialNeighbors[index].reduce(
      (count, neighborIndex) => count + Number(hiddenIndices.has(neighborIndex)),
      0,
    )
  );
  const canHide = (index: number): boolean => canHideIndex(
    path.length,
    hiddenIndices,
    index,
    selection.parameters.maxHiddenRun,
  );
  const tryHide = (index: number): boolean => {
    if (!canHide(index)) return false;
    hiddenIndices.add(index);
    return true;
  };

  const visibleLimit = Math.max(1, Math.floor(selection.parameters.maxVisibleRun));
  let currentVisibleRun = 1;
  for (let index = 1; index < path.length - 1; index += 1) {
    const phase = phaseForPathIndex(index, path.length);
    const {
      hiddenProbability,
      adjacentHiddenSkipProbability,
    } = phaseSettingsFor(selection, phase);
    const lastCandidateBeforeVisibleEndpoint = index === path.length - 2;
    const mustHideForVisibleLimit = currentVisibleRun >= visibleLimit
      || (
        lastCandidateBeforeVisibleEndpoint
        && currentVisibleRun >= visibleLimit - 1
      );
    const selectedByProbability = random() * 100 < hiddenProbability;
    const surroundingHiddenCount = !mustHideForVisibleLimit && selectedByProbability
      ? adjacentHiddenCount(index)
      : 0;
    const actualSkipProbability = calculateAlgorithm4AdjacentHiddenSkipProbability(
      adjacentHiddenSkipProbability,
      surroundingHiddenCount,
      spatialNeighbors[index].length,
    );
    const skippedForAdjacentHidden = !mustHideForVisibleLimit
      && selectedByProbability
      && surroundingHiddenCount > 0
      && random() * 100 < actualSkipProbability;
    const hidden = (mustHideForVisibleLimit || (
      selectedByProbability && !skippedForAdjacentHidden
    )) && tryHide(index);
    currentVisibleRun = hidden ? 0 : currentVisibleRun + 1;
  }

  return {
    hiddenCells: new Set([...hiddenIndices].map((index) => cellKey(path[index]))),
  };
};

export const selectAlgorithm4HiddenCells = (
  path: ReadonlyArray<Cell>,
  shape: EditorShape,
  selection: Algorithm4Selection,
  seed: number,
): Set<string> => selectAlgorithm4HiddenLayout(path, shape, selection, seed).hiddenCells;

export const runAlgorithm4 = (
  context: EditorAlgorithmContext,
  selection: Algorithm4Selection,
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
  const hiddenCells = selectAlgorithm4HiddenCells(path, context.shape, selection, seed);
  context.onProgress?.(1);

  return {
    path,
    hiddenCells: [...hiddenCells].map(toCell),
  };
};
