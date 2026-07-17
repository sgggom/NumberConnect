import { neighborCells, projectCell } from './topology';
import {
  cellKey,
  type BoardNeighborhoodPreview,
  type BoardNeighborhoodPreviewPointer,
  type LevelData,
} from './types';

type NeighborhoodLevel = Pick<LevelData, 'boardShape' | 'solutionPath'>;

interface BoardNeighborhoodPreviewOptions {
  connectedNodePairs?: ReadonlyArray<readonly [number, number]>;
  focusRingDepth?: 1 | 2;
  pointer?: BoardNeighborhoodPreviewPointer | null;
  originClientX?: number;
  originClientY?: number;
}

export const buildBoardNeighborhoodPreview = (
  level: NeighborhoodLevel,
  centerIndex: number | null,
  isVisible: (index: number) => boolean,
  displayNumber: (index: number) => number,
  clientX: number,
  clientY: number,
  options: BoardNeighborhoodPreviewOptions = {},
): BoardNeighborhoodPreview | undefined => {
  if (level.solutionPath.length === 0) return undefined;
  if (centerIndex !== null && !level.solutionPath[centerIndex]) return undefined;

  const projectedCells = level.solutionPath.map((cell, index) => ({
    index,
    key: cellKey(cell),
    projected: projectCell(cell, level.boardShape),
  }));
  const minX = Math.min(...projectedCells.map(({ projected }) => projected.x));
  const maxX = Math.max(...projectedCells.map(({ projected }) => projected.x));
  const minY = Math.min(...projectedCells.map(({ projected }) => projected.y));
  const maxY = Math.max(...projectedCells.map(({ projected }) => projected.y));
  const boardCenter = {
    x: (minX + maxX) * 0.5,
    y: (minY + maxY) * 0.5,
  };
  const centerCell = centerIndex === null ? undefined : level.solutionPath[centerIndex];
  const focusRingKeys = new Set<string>();
  let ringFrontier = centerCell ? [centerCell] : [];
  const focusRingDepth = options.focusRingDepth ?? 1;
  for (let depth = 0; depth <= focusRingDepth; depth += 1) {
    ringFrontier.forEach((cell) => focusRingKeys.add(cellKey(cell)));
    ringFrontier = ringFrontier.flatMap((cell) => neighborCells(cell, level.boardShape));
  }
  const cells = projectedCells.map(({ index, key, projected }) => ({
    index,
    offsetX: projected.x - boardCenter.x,
    offsetY: projected.y - boardCenter.y,
    value: isVisible(index) ? displayNumber(index) : null,
    center: index === centerIndex,
    inFocusRing: focusRingKeys.has(key),
  }));

  const validIndices = new Set(cells.map((cell) => cell.index));
  const lines = (options.connectedNodePairs ?? []).flatMap(([fromIndex, toIndex]) => (
    validIndices.has(fromIndex) && validIndices.has(toIndex)
      ? [{ fromIndex, toIndex }]
      : []
  ));
  const center = centerIndex === null ? undefined : projectedCells[centerIndex];
  const pointer = center && options.pointer
    ? {
        ...options.pointer,
        offsetX: center.projected.x + options.pointer.offsetX - boardCenter.x,
        offsetY: center.projected.y + options.pointer.offsetY - boardCenter.y,
      }
    : null;

  return {
    clientX,
    clientY,
    originClientX: options.originClientX ?? clientX,
    originClientY: options.originClientY ?? clientY,
    cells,
    lines,
    pointer,
  };
};
