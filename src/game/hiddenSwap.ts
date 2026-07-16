import { areNeighborCells } from './topology';
import { BoardShape, cellKey, type Cell } from './types';

export type HiddenSwapPair = readonly [firstIndex: number, secondIndex: number];

/**
 * Finds hidden runs of exactly two cells whose positions may be exchanged
 * without breaking the path between the visible cells on either side.
 */
export const findSwappableHiddenPairs = (
  solutionPath: ReadonlyArray<Cell>,
  hiddenCells: ReadonlySet<string>,
  shape: BoardShape,
): HiddenSwapPair[] => {
  const result: HiddenSwapPair[] = [];

  for (let firstIndex = 1; firstIndex < solutionPath.length - 2; firstIndex += 1) {
    const secondIndex = firstIndex + 1;
    if (!hiddenCells.has(cellKey(solutionPath[firstIndex]))) continue;
    if (!hiddenCells.has(cellKey(solutionPath[secondIndex]))) continue;
    if (hiddenCells.has(cellKey(solutionPath[firstIndex - 1]))) continue;
    if (hiddenCells.has(cellKey(solutionPath[secondIndex + 1]))) continue;

    const previous = solutionPath[firstIndex - 1];
    const first = solutionPath[firstIndex];
    const second = solutionPath[secondIndex];
    const next = solutionPath[secondIndex + 1];
    if (!areNeighborCells(previous, second, shape)) continue;
    if (!areNeighborCells(second, first, shape)) continue;
    if (!areNeighborCells(first, next, shape)) continue;

    result.push([firstIndex, secondIndex]);
    firstIndex = secondIndex;
  }

  return result;
};
