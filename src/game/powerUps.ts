import { cellKey, type Cell } from './types';

export type PowerUpId = 'watercolor-brush' | 'paint-bucket';

export const chooseWatercolorReveal = (
  solutionPath: ReadonlyArray<Cell>,
  concealedCellKeys: ReadonlySet<string>,
  random: () => number = Math.random,
): Cell | undefined => {
  const candidates = solutionPath.filter((cell) => concealedCellKeys.has(cellKey(cell)));
  if (candidates.length === 0) return undefined;
  const randomValue = Math.max(0, Math.min(0.999999999, random()));
  return { ...candidates[Math.floor(randomValue * candidates.length)] };
};

export const paintBucketRevealCells = (
  solutionPath: ReadonlyArray<Cell>,
  concealedCellKeys: ReadonlySet<string>,
  center: Cell,
): Cell[] => solutionPath
  .filter((cell) => (
    concealedCellKeys.has(cellKey(cell))
    && Math.abs(cell.x - center.x) <= 1
    && Math.abs(cell.y - center.y) <= 1
  ))
  .map((cell) => ({ ...cell }));
