import { neighborCells } from './topology';
import { BoardShape, cellKey, type Cell } from './types';

interface IntervalCandidate {
  nodeIndices: number[];
  hiddenMask: bigint;
  authored: boolean;
}

interface AnchorInterval {
  candidates: IntervalCandidate[];
}

export interface PureLuckAlternative {
  alternativePath: Cell[];
  firstDifferenceIndex: number;
}

const sameSequence = (left: ReadonlyArray<number>, right: ReadonlyArray<number>): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const enumerateIntervalCandidates = (
  startIndex: number,
  endIndex: number,
  adjacency: ReadonlyArray<ReadonlyArray<number>>,
  hiddenIndices: ReadonlySet<number>,
): IntervalCandidate[] => {
  const requiredSteps = endIndex - startIndex;
  const authoredNodes = Array.from({ length: requiredSteps + 1 }, (_, offset) => startIndex + offset);
  const candidates: IntervalCandidate[] = [];
  const currentPath = [startIndex];
  const visited = new Set<number>(currentPath);

  const search = (current: number, stepsTaken: number, hiddenMask: bigint): void => {
    if (stepsTaken === requiredSteps) {
      if (current === endIndex) {
        candidates.push({
          nodeIndices: [...currentPath],
          hiddenMask,
          authored: sameSequence(currentPath, authoredNodes),
        });
      }
      return;
    }

    const finalStep = stepsTaken + 1 === requiredSteps;
    for (const next of adjacency[current]) {
      if (visited.has(next)) continue;
      if (finalStep ? next !== endIndex : !hiddenIndices.has(next)) continue;

      visited.add(next);
      currentPath.push(next);
      search(
        next,
        stepsTaken + 1,
        finalStep ? hiddenMask : hiddenMask | (1n << BigInt(next)),
      );
      currentPath.pop();
      visited.delete(next);
    }
  };

  search(startIndex, 0, 0n);
  return candidates.sort((left, right) => Number(left.authored) - Number(right.authored));
};
/**
 * Finds a second complete solution that is indistinguishable under the current
 * visible-number constraints. A result means the authored path contains a
 * case-1 (pure-luck) choice; no result means every other branch eventually
 * violates a visible number or makes the remaining board unsolvable.
 */
export const findPureLuckAlternative = (
  solutionPath: ReadonlyArray<Cell>,
  hiddenCells: ReadonlySet<string>,
  shape: BoardShape,
): PureLuckAlternative | null => {
  if (solutionPath.length < 3 || hiddenCells.size === 0) return null;

  const nodeIndexByKey = new Map(solutionPath.map((cell, index) => [cellKey(cell), index]));
  if (nodeIndexByKey.size !== solutionPath.length) return null;

  const adjacency = solutionPath.map((cell) => neighborCells(cell, shape)
    .map((neighbor) => nodeIndexByKey.get(cellKey(neighbor)))
    .filter((index): index is number => index !== undefined));
  const hiddenIndices = new Set<number>();
  solutionPath.forEach((cell, index) => {
    if (index > 0 && index < solutionPath.length - 1 && hiddenCells.has(cellKey(cell))) {
      hiddenIndices.add(index);
    }
  });
  if (hiddenIndices.size === 0) return null;

  const anchorIndices = solutionPath
    .map((_, index) => index)
    .filter((index) => !hiddenIndices.has(index));
  const intervals: AnchorInterval[] = [];
  for (let index = 0; index < anchorIndices.length - 1; index += 1) {
    const startIndex = anchorIndices[index];
    const endIndex = anchorIndices[index + 1];
    const candidates = enumerateIntervalCandidates(startIndex, endIndex, adjacency, hiddenIndices);
    if (candidates.length === 0) return null;
    intervals.push({ candidates });
  }

  let hiddenUniverse = 0n;
  hiddenIndices.forEach((index) => { hiddenUniverse |= 1n << BigInt(index); });
  const selected: IntervalCandidate[] = [];
  const failedStates = new Set<string>();

  const search = (intervalIndex: number, usedMask: bigint, differsFromAuthored: boolean): boolean => {
    if (intervalIndex === intervals.length) {
      return differsFromAuthored && usedMask === hiddenUniverse;
    }

    const stateKey = `${intervalIndex}:${usedMask.toString(36)}:${Number(differsFromAuthored)}`;
    if (failedStates.has(stateKey)) return false;

    for (const candidate of intervals[intervalIndex].candidates) {
      if ((candidate.hiddenMask & usedMask) !== 0n) continue;
      selected.push(candidate);
      if (search(
        intervalIndex + 1,
        usedMask | candidate.hiddenMask,
        differsFromAuthored || !candidate.authored,
      )) return true;
      selected.pop();
    }

    failedStates.add(stateKey);
    return false;
  };

  if (!search(0, 0n, false)) return null;

  const alternativeIndices = [selected[0].nodeIndices[0]];
  selected.forEach((candidate) => alternativeIndices.push(...candidate.nodeIndices.slice(1)));
  const firstDifferenceIndex = alternativeIndices.findIndex((nodeIndex, index) => nodeIndex !== index);
  if (firstDifferenceIndex <= 0 || firstDifferenceIndex >= solutionPath.length - 1) return null;

  return {
    alternativePath: alternativeIndices.map((index) => ({ ...solutionPath[index] })),
    firstDifferenceIndex,
  };
};
