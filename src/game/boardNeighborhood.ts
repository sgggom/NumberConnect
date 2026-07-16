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
  pointer?: BoardNeighborhoodPreviewPointer | null;
}

export const buildBoardNeighborhoodPreview = (
  level: NeighborhoodLevel,
  centerIndex: number,
  isVisible: (index: number) => boolean,
  displayNumber: (index: number) => number,
  clientX: number,
  clientY: number,
  options: BoardNeighborhoodPreviewOptions = {},
): BoardNeighborhoodPreview | undefined => {
  const center = level.solutionPath[centerIndex];
  if (!center) return undefined;

  const indexByCell = new Map(level.solutionPath.map((cell, index) => [cellKey(cell), index]));
  const projectedCenter = projectCell(center, level.boardShape);
  const seen = new Set<string>();
  const cells = [...neighborCells(center, level.boardShape), center].flatMap((cell) => {
    const key = cellKey(cell);
    const index = indexByCell.get(key);
    if (index === undefined || seen.has(key)) return [];
    seen.add(key);
    const projected = projectCell(cell, level.boardShape);
    return [{
      index,
      offsetX: projected.x - projectedCenter.x,
      offsetY: projected.y - projectedCenter.y,
      value: isVisible(index) ? displayNumber(index) : null,
      center: index === centerIndex,
    }];
  });

  const visibleIndices = new Set(cells.map((cell) => cell.index));
  const lines = (options.connectedNodePairs ?? []).flatMap(([fromIndex, toIndex]) => (
    visibleIndices.has(fromIndex) && visibleIndices.has(toIndex)
      ? [{ fromIndex, toIndex }]
      : []
  ));

  return {
    clientX,
    clientY,
    cells,
    lines,
    pointer: options.pointer ?? null,
  };
};
