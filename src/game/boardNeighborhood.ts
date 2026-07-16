import { neighborCells, projectCell } from './topology';
import { cellKey, type BoardNeighborhoodPreview, type LevelData } from './types';

type NeighborhoodLevel = Pick<LevelData, 'boardShape' | 'solutionPath'>;

export const buildBoardNeighborhoodPreview = (
  level: NeighborhoodLevel,
  centerIndex: number,
  isVisible: (index: number) => boolean,
  displayNumber: (index: number) => number,
  clientX: number,
  clientY: number,
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
      offsetX: projected.x - projectedCenter.x,
      offsetY: projected.y - projectedCenter.y,
      value: isVisible(index) ? displayNumber(index) : null,
      center: index === centerIndex,
    }];
  });

  return { clientX, clientY, cells };
};
