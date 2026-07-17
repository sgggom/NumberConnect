import { findPureLuckAlternative } from './pureLuck';
import { createRandom, shuffle } from './random';
import { selectHiddenCells } from './hidden';
import { neighborCells } from './topology';
import { BoardShape, cellKey, type Cell } from './types';

export interface UnambiguousHiddenOptions {
  hiddenPercent: number;
  maxHiddenRun: number;
  maxVisibleRun: number;
  seed: number;
  attempts?: number;
  /** Per-path-index selection probability in percent. Missing indexes are 0%. */
  candidateProbabilities?: ReadonlyArray<number>;
  /** Maximum size of a spatially connected hidden-cell component. */
  maxHiddenClusterSize?: number;
}

export interface UnambiguousHiddenResult {
  hiddenCells: Set<string>;
  targetCount: number;
  repairedCount: number;
}

const hiddenIndexSet = (
  solutionPath: ReadonlyArray<Cell>,
  hiddenCells: ReadonlySet<string>,
): Set<number> => {
  const result = new Set<number>();
  solutionPath.forEach((cell, index) => {
    if (hiddenCells.has(cellKey(cell))) result.add(index);
  });
  return result;
};

const canHideIndex = (
  pathCount: number,
  hidden: ReadonlySet<number>,
  index: number,
  maxHiddenRun: number,
): boolean => {
  if (index <= 0 || index >= pathCount - 1 || hidden.has(index)) return false;
  let runLength = 1;
  for (let cursor = index - 1; cursor >= 0 && hidden.has(cursor); cursor -= 1) runLength += 1;
  for (let cursor = index + 1; cursor < pathCount && hidden.has(cursor); cursor += 1) runLength += 1;
  return runLength <= Math.max(1, maxHiddenRun);
};

export const largestHiddenClusterSize = (
  solutionPath: ReadonlyArray<Cell>,
  hiddenCells: ReadonlySet<string>,
  shape: BoardShape,
): number => {
  const cellsByKey = new Map(solutionPath.map((cell) => [cellKey(cell), cell]));
  const remaining = new Set([...hiddenCells].filter((key) => cellsByKey.has(key)));
  let largest = 0;

  while (remaining.size > 0) {
    const startKey = remaining.values().next().value as string;
    remaining.delete(startKey);
    const queue = [cellsByKey.get(startKey)!];
    let size = 0;
    while (queue.length > 0) {
      const cell = queue.pop()!;
      size += 1;
      neighborCells(cell, shape).forEach((neighbor) => {
        const key = cellKey(neighbor);
        if (!remaining.delete(key)) return;
        queue.push(cellsByKey.get(key)!);
      });
    }
    largest = Math.max(largest, size);
  }

  return largest;
};

const canHideCandidate = (
  solutionPath: ReadonlyArray<Cell>,
  shape: BoardShape,
  hiddenIndices: ReadonlySet<number>,
  index: number,
  maxHiddenRun: number,
  maxHiddenClusterSize?: number,
): boolean => {
  if (!canHideIndex(solutionPath.length, hiddenIndices, index, maxHiddenRun)) return false;
  if (maxHiddenClusterSize === undefined) return true;
  const hiddenCells = new Set([...hiddenIndices].map((hiddenIndex) => cellKey(solutionPath[hiddenIndex])));
  hiddenCells.add(cellKey(solutionPath[index]));
  return largestHiddenClusterSize(solutionPath, hiddenCells, shape)
    <= Math.max(1, Math.floor(maxHiddenClusterSize));
};

interface ProbabilityHiddenSelection {
  hiddenCells: Set<string>;
  eligibleIndices: Set<number>;
}

const selectProbabilityHiddenCells = (
  solutionPath: ReadonlyArray<Cell>,
  shape: BoardShape,
  candidateProbabilities: ReadonlyArray<number>,
  targetCount: number,
  maxHiddenRun: number,
  maxHiddenClusterSize: number | undefined,
  seed: number,
): ProbabilityHiddenSelection => {
  const random = createRandom(seed ^ 0x6c8e9cf5);
  const eligibleIndices = new Set<number>();
  for (let index = 1; index < solutionPath.length - 1; index += 1) {
    const probability = Math.max(0, Math.min(100, Number(candidateProbabilities[index]) || 0));
    if (random() * 100 < probability) eligibleIndices.add(index);
  }

  const candidates = [...eligibleIndices];
  shuffle(candidates, random);
  const hiddenIndices = new Set<number>();
  for (const index of candidates) {
    if (hiddenIndices.size >= targetCount) break;
    if (canHideCandidate(
      solutionPath,
      shape,
      hiddenIndices,
      index,
      maxHiddenRun,
      maxHiddenClusterSize,
    )) {
      hiddenIndices.add(index);
    }
  }

  return {
    hiddenCells: new Set([...hiddenIndices].map((index) => cellKey(solutionPath[index]))),
    eligibleIndices,
  };
};

const visibleRunAt = (pathCount: number, hidden: ReadonlySet<number>, index: number): number => {
  let start = index;
  let end = index;
  while (start > 0 && !hidden.has(start - 1)) start -= 1;
  while (end < pathCount - 1 && !hidden.has(end + 1)) end += 1;
  return end - start + 1;
};

const repairCandidate = (
  solutionPath: ReadonlyArray<Cell>,
  shape: BoardShape,
  initialHidden: ReadonlySet<string>,
  targetCount: number,
  maxHiddenRun: number,
  maxHiddenClusterSize: number | undefined,
  seed: number,
  allowedIndices?: ReadonlySet<number>,
): Set<string> => {
  const hidden = new Set(initialHidden);
  let guard = solutionPath.length;

  while (guard > 0) {
    guard -= 1;
    const alternative = findPureLuckAlternative(solutionPath, hidden, shape);
    if (!alternative) break;
    if (!hidden.delete(cellKey(solutionPath[alternative.firstDifferenceIndex]))) {
      hidden.clear();
      break;
    }
  }

  const random = createRandom(seed ^ 0x45d9f3b);
  const tieBreak = Array.from({ length: solutionPath.length }, () => random());
  while (hidden.size < targetCount) {
    const hiddenIndices = hiddenIndexSet(solutionPath, hidden);
    const candidates = Array.from({ length: solutionPath.length - 2 }, (_, index) => index + 1)
      .filter((index) => (allowedIndices?.has(index) ?? true)
        && canHideCandidate(
          solutionPath,
          shape,
          hiddenIndices,
          index,
          maxHiddenRun,
          maxHiddenClusterSize,
        ))
      .sort((left, right) => visibleRunAt(solutionPath.length, hiddenIndices, right)
        - visibleRunAt(solutionPath.length, hiddenIndices, left)
        || tieBreak[left] - tieBreak[right]);
    let added = false;
    for (const index of candidates) {
      const key = cellKey(solutionPath[index]);
      hidden.add(key);
      if (!findPureLuckAlternative(solutionPath, hidden, shape)) {
        added = true;
        break;
      }
      hidden.delete(key);
    }
    if (!added) break;
  }

  return hidden;
};

/**
 * Generates a hidden-number layout whose visible anchors make the authored
 * full-board path unique. If the requested hidden density is impossible, the
 * function keeps extra numbers visible instead of leaving a guess-only fork.
 */
export const selectUnambiguousHiddenCells = (
  solutionPath: ReadonlyArray<Cell>,
  shape: BoardShape,
  options: UnambiguousHiddenOptions,
): UnambiguousHiddenResult => {
  const percentTarget = Math.min(
    Math.max(0, solutionPath.length - 2),
    Math.max(0, Math.round((solutionPath.length * options.hiddenPercent) / 100)),
  );
  const visibleLimit = Math.max(1, Math.floor(options.maxVisibleRun));
  const visibleRunTarget = options.hiddenPercent <= 0
    ? 0
    : Math.max(0, Math.ceil((solutionPath.length - visibleLimit) / (visibleLimit + 1)));
  const targetCount = Math.min(
    Math.max(0, solutionPath.length - 2),
    Math.max(percentTarget, visibleRunTarget),
  );
  if (targetCount === 0 || solutionPath.length < 3) {
    return { hiddenCells: new Set(), targetCount, repairedCount: 0 };
  }

  const attempts = Math.max(1, Math.min(32, Math.floor(options.attempts ?? 16)));
  let best = new Set<string>();
  let bestRepairedCount = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const attemptSeed = (options.seed + Math.imul(attempt, 104729)) | 0;
    const probabilitySelection = options.candidateProbabilities
      ? selectProbabilityHiddenCells(
          solutionPath,
          shape,
          options.candidateProbabilities,
          targetCount,
          options.maxHiddenRun,
          options.maxHiddenClusterSize,
          attemptSeed,
        )
      : undefined;
    const initial = probabilitySelection?.hiddenCells ?? selectHiddenCells(
      [...solutionPath],
      options.hiddenPercent,
      options.maxHiddenRun,
      options.maxVisibleRun,
      attemptSeed,
    );
    if (!findPureLuckAlternative(solutionPath, initial, shape)) {
      return { hiddenCells: initial, targetCount, repairedCount: 0 };
    }

    const repaired = repairCandidate(
      solutionPath,
      shape,
      initial,
      targetCount,
      options.maxHiddenRun,
      options.maxHiddenClusterSize,
      attemptSeed,
      probabilitySelection?.eligibleIndices,
    );
    const repairedCount = Math.max(0, initial.size - repaired.size);
    if (repaired.size > best.size || (repaired.size === best.size && repairedCount < bestRepairedCount)) {
      best = repaired;
      bestRepairedCount = repairedCount;
    }
    if (best.size >= targetCount) break;
  }

  const guaranteed = findPureLuckAlternative(solutionPath, best, shape) ? new Set<string>() : best;
  return {
    hiddenCells: guaranteed,
    targetCount,
    repairedCount: Number.isFinite(bestRepairedCount) ? bestRepairedCount : 0,
  };
};
