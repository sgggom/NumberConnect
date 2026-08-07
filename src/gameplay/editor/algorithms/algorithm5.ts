import { createRandom } from '../../../game/random';
import { cellKey, type Cell } from '../../../game/types';
import type { EditorShape } from '../types';
import { generateAlgorithm2Path } from './algorithm2';
import type {
  Algorithm5Selection,
  EditorAlgorithmContext,
  EditorAlgorithmResult,
} from './types';

export const createAlgorithm5Selection = (): Algorithm5Selection => ({
  id: 'algorithm-5',
  parameters: {
    topology: 'board-shape',
    pathMode: 'single-stroke-multiple-solutions',
    targetCrossings: 20,
    turnProbability: 40,
    earlyHiddenProbability: 50,
    middleHiddenProbability: 50,
    lateHiddenProbability: 50,
    earlyRowColumnHiddenSkipProbability: 0,
    middleRowColumnHiddenSkipProbability: 0,
    lateRowColumnHiddenSkipProbability: 0,
    maxHiddenRun: 3,
    maxVisibleRun: 4,
  },
});

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
  for (let cursor = index - 1; cursor >= 0 && hiddenIndices.has(cursor); cursor -= 1) {
    runLength += 1;
  }
  for (let cursor = index + 1; cursor < pathCount && hiddenIndices.has(cursor); cursor += 1) {
    runLength += 1;
  }
  return runLength <= Math.max(1, Math.floor(maxHiddenRun));
};

type Algorithm5Phase = 'early' | 'middle' | 'late';

interface Algorithm5PhaseSettings {
  hiddenProbability: number;
  rowColumnHiddenSkipProbability: number;
}

const phaseForPathIndex = (index: number, pathCount: number): Algorithm5Phase => {
  const phaseSize = Math.max(1, Math.round(pathCount * 0.25));
  if (index < phaseSize) return 'early';
  if (index >= pathCount - phaseSize) return 'late';
  return 'middle';
};

const phaseSettingsFor = (
  selection: Algorithm5Selection,
  phase: Algorithm5Phase,
): Algorithm5PhaseSettings => {
  if (phase === 'early') {
    return {
      hiddenProbability: selection.parameters.earlyHiddenProbability,
      rowColumnHiddenSkipProbability:
        selection.parameters.earlyRowColumnHiddenSkipProbability,
    };
  }
  if (phase === 'late') {
    return {
      hiddenProbability: selection.parameters.lateHiddenProbability,
      rowColumnHiddenSkipProbability:
        selection.parameters.lateRowColumnHiddenSkipProbability,
    };
  }
  return {
    hiddenProbability: selection.parameters.middleHiddenProbability,
    rowColumnHiddenSkipProbability:
      selection.parameters.middleRowColumnHiddenSkipProbability,
  };
};

export const calculateAlgorithm5RowColumnHiddenSkipProbability = (
  configuredProbability: number,
  rowColumnHiddenCount: number,
  rowColumnCellCount: number,
): number => {
  const totalAlignedCells = Math.max(0, Math.floor(rowColumnCellCount));
  if (totalAlignedCells === 0) return 0;
  const hiddenAlignedCells = Math.min(
    totalAlignedCells,
    Math.max(0, Math.floor(rowColumnHiddenCount)),
  );
  return Math.min(100, Math.max(0, configuredProbability))
    * hiddenAlignedCells
    / totalAlignedCells;
};

export const findAlgorithm5RowColumnPeerIndexes = (
  path: ReadonlyArray<Cell>,
  index: number,
): number[] => {
  const current = path[index];
  if (!current) return [];
  return path.flatMap((cell, peerIndex) => (
    peerIndex !== index && (cell.x === current.x || cell.y === current.y)
      ? [peerIndex]
      : []
  ));
};

export interface Algorithm5HiddenSelection {
  hiddenCells: Set<string>;
}

export const selectAlgorithm5HiddenLayout = (
  path: ReadonlyArray<Cell>,
  _shape: EditorShape,
  selection: Algorithm5Selection,
  seed: number,
): Algorithm5HiddenSelection => {
  if (path.length < 3) return { hiddenCells: new Set() };

  const random = createRandom(seed ^ 0x71c3a95d);
  const rowColumnPeers = path.map((_, index) => (
    findAlgorithm5RowColumnPeerIndexes(path, index)
  ));
  const hiddenIndices = new Set<number>();
  const rowColumnHiddenCount = (index: number): number => (
    rowColumnPeers[index].reduce(
      (count, peerIndex) => count + Number(hiddenIndices.has(peerIndex)),
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
      rowColumnHiddenSkipProbability,
    } = phaseSettingsFor(selection, phase);
    const lastCandidateBeforeVisibleEndpoint = index === path.length - 2;
    const mustHideForVisibleLimit = currentVisibleRun >= visibleLimit
      || (
        lastCandidateBeforeVisibleEndpoint
        && currentVisibleRun >= visibleLimit - 1
      );
    const selectedByProbability = random() * 100 < hiddenProbability;
    const alignedHiddenCount = !mustHideForVisibleLimit && selectedByProbability
      ? rowColumnHiddenCount(index)
      : 0;
    const actualSkipProbability = calculateAlgorithm5RowColumnHiddenSkipProbability(
      rowColumnHiddenSkipProbability,
      alignedHiddenCount,
      rowColumnPeers[index].length,
    );
    const skippedForRowColumnHidden = !mustHideForVisibleLimit
      && selectedByProbability
      && alignedHiddenCount > 0
      && random() * 100 < actualSkipProbability;
    const hidden = (mustHideForVisibleLimit || (
      selectedByProbability && !skippedForRowColumnHidden
    )) && tryHide(index);
    currentVisibleRun = hidden ? 0 : currentVisibleRun + 1;
  }

  return {
    hiddenCells: new Set([...hiddenIndices].map((index) => cellKey(path[index]))),
  };
};

export const runAlgorithm5 = (
  context: EditorAlgorithmContext,
  selection: Algorithm5Selection,
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
  const hiddenCells = selectAlgorithm5HiddenLayout(path, context.shape, selection, seed);
  context.onProgress?.(1);

  return {
    path,
    hiddenCells: [...hiddenCells.hiddenCells].map(toCell),
  };
};
