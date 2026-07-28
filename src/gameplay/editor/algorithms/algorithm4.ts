import { createRandom, shuffle } from '../../../game/random';
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
    hiddenPercent: 50,
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

const longestVisibleRun = (
  pathCount: number,
  hiddenIndices: ReadonlySet<number>,
): { start: number; length: number } => {
  let bestStart = 0;
  let bestLength = 0;
  let currentStart = 0;
  let currentLength = 0;

  for (let index = 0; index < pathCount; index += 1) {
    if (hiddenIndices.has(index)) {
      if (currentLength > bestLength) {
        bestStart = currentStart;
        bestLength = currentLength;
      }
      currentStart = index + 1;
      currentLength = 0;
    } else {
      currentLength += 1;
    }
  }

  if (currentLength > bestLength) return { start: currentStart, length: currentLength };
  return { start: bestStart, length: bestLength };
};

export interface Algorithm4HiddenSelection {
  hiddenCells: Set<string>;
  seedCells: Set<string>;
  targetCount: number;
}

export const selectAlgorithm4HiddenLayout = (
  path: ReadonlyArray<Cell>,
  shape: EditorShape,
  selection: Algorithm4Selection,
  seed: number,
): Algorithm4HiddenSelection => {
  const targetCount = Math.min(
    Math.max(0, path.length - 2),
    Math.max(0, Math.round(path.length * selection.parameters.hiddenPercent / 100)),
  );
  if (path.length < 3 || targetCount === 0) {
    return { hiddenCells: new Set(), seedCells: new Set(), targetCount };
  }

  const random = createRandom(seed ^ 0x71c3a95d);
  const candidates = Array.from({ length: path.length - 2 }, (_, index) => index + 1);
  shuffle(candidates, random);
  const candidateRank = new Map(candidates.map((index, rank) => [index, rank]));
  const candidateSet = new Set(candidates);
  const pathIndexByKey = new Map(path.map((cell, index) => [cellKey(cell), index]));
  const boardShape = boardShapeOf(shape);
  const allSpatialNeighbors = path.map((cell) => neighborCells(cell, boardShape)
    .map((neighbor) => pathIndexByKey.get(cellKey(neighbor)))
    .filter((index): index is number => index !== undefined));
  const hideableSpatialNeighbors = allSpatialNeighbors
    .map((neighbors) => neighbors.filter((index) => candidateSet.has(index)));

  const hiddenIndices = new Set<number>();
  const seedIndices = new Set<number>();
  const surroundingHiddenCounts = Array.from({ length: path.length }, () => 0);
  const hasHiddenNeighbor = (index: number): boolean => surroundingHiddenCounts[index] > 0;
  const chooseBalancedCandidate = (eligibleCandidates: ReadonlyArray<number>): number | undefined => {
    const legalCandidates = eligibleCandidates.filter((candidate) => canHideIndex(
      path.length,
      hiddenIndices,
      candidate,
      selection.parameters.maxHiddenRun,
    ));
    if (legalCandidates.length === 0) return undefined;

    const legalCandidateSet = new Set(legalCandidates);
    const serviceableVisibleCounts = new Map<number, number>();
    for (let index = 0; index < path.length; index += 1) {
      if (
        hiddenIndices.has(index)
        || !allSpatialNeighbors[index].some((neighborIndex) => legalCandidateSet.has(neighborIndex))
      ) {
        continue;
      }
      serviceableVisibleCounts.set(index, surroundingHiddenCounts[index]);
    }
    if (serviceableVisibleCounts.size === 0) {
      return [...legalCandidates].sort(
        (left, right) => (candidateRank.get(left) ?? 0) - (candidateRank.get(right) ?? 0),
      )[0];
    }

    const minimumVisibleCount = Math.min(...serviceableVisibleCounts.values());
    const countBucketCount = Math.max(...allSpatialNeighbors.map((neighbors) => neighbors.length)) + 2;
    const currentCountHistogram = Array.from({ length: countBucketCount }, () => 0);
    for (let index = 0; index < path.length; index += 1) {
      if (!hiddenIndices.has(index)) currentCountHistogram[surroundingHiddenCounts[index]] += 1;
    }
    return legalCandidates
      .map((candidate) => {
        const affectedCounts = allSpatialNeighbors[candidate]
          .filter((neighborIndex) => !hiddenIndices.has(neighborIndex))
          .map((neighborIndex) =>
            serviceableVisibleCounts.get(neighborIndex) ?? surroundingHiddenCounts[neighborIndex]);
        const resultingCountHistogram = [...currentCountHistogram];
        resultingCountHistogram[surroundingHiddenCounts[candidate]] -= 1;
        for (const neighborIndex of allSpatialNeighbors[candidate]) {
          if (hiddenIndices.has(neighborIndex)) continue;
          const currentCount = surroundingHiddenCounts[neighborIndex];
          resultingCountHistogram[currentCount] -= 1;
          resultingCountHistogram[currentCount + 1] += 1;
        }
        const resultingMinimum = resultingCountHistogram.findIndex((count) => count > 0);
        let resultingMaximum = resultingCountHistogram.length - 1;
        while (
          resultingMaximum > resultingMinimum
          && resultingCountHistogram[resultingMaximum] === 0
        ) {
          resultingMaximum -= 1;
        }
        const resultingVisibleCount = path.length - hiddenIndices.size - 1;
        const resultingTotal = resultingCountHistogram.reduce(
          (total, count, value) => total + count * value,
          0,
        );
        const resultingSquaredTotal = resultingCountHistogram.reduce(
          (total, count, value) => total + count * value ** 2,
          0,
        );
        const resultingAverage = resultingTotal / resultingVisibleCount;
        const resultingVariance = resultingSquaredTotal / resultingVisibleCount
          - resultingAverage ** 2;
        return {
          candidate,
          servesMinimumCount: affectedCounts.filter((count) => count === minimumVisibleCount).length,
          resultingSpread: resultingMaximum - resultingMinimum,
          resultingMaximum,
          resultingVariance,
        };
      })
      .filter(({ servesMinimumCount }) => servesMinimumCount > 0)
      .sort((left, right) =>
        left.resultingSpread - right.resultingSpread
        || left.resultingMaximum - right.resultingMaximum
        || right.servesMinimumCount - left.servesMinimumCount
        || left.resultingVariance - right.resultingVariance
        || (candidateRank.get(left.candidate) ?? 0) - (candidateRank.get(right.candidate) ?? 0))[0]
      ?.candidate;
  };
  const tryAdd = (index: number, asSeed: boolean): boolean => {
    if (!canHideIndex(
      path.length,
      hiddenIndices,
      index,
      selection.parameters.maxHiddenRun,
    )) {
      return false;
    }
    if (asSeed && hasHiddenNeighbor(index)) return false;
    hiddenIndices.add(index);
    for (const neighborIndex of allSpatialNeighbors[index]) {
      surroundingHiddenCounts[neighborIndex] += 1;
    }
    if (asSeed) seedIndices.add(index);
    return true;
  };

  // First scatter independent seeds. Reserving roughly half of the target for
  // growth guarantees that multi-cell hidden groups can form when space allows.
  const preferredSeedCount = Math.min(targetCount, Math.max(1, Math.floor(targetCount / 2)));
  let guard = path.length * 2;
  while (seedIndices.size < preferredSeedCount && guard > 0) {
    guard -= 1;
    const candidate = chooseBalancedCandidate(
      candidates.filter((index) => !hasHiddenNeighbor(index)),
    );
    if (candidate === undefined || !tryAdd(candidate, true)) break;
  }

  // Give every seed one chance to grow before filling the rest of the target
  // from the shared spatial frontier.
  const seedOrder = [...seedIndices];
  shuffle(seedOrder, random);
  for (const seedIndex of seedOrder) {
    if (hiddenIndices.size >= targetCount) break;
    const candidate = chooseBalancedCandidate(hideableSpatialNeighbors[seedIndex]);
    if (candidate !== undefined) tryAdd(candidate, false);
  }

  guard = path.length * 2;
  while (hiddenIndices.size < targetCount && guard > 0) {
    guard -= 1;
    const adjacentCandidate = chooseBalancedCandidate(
      candidates.filter((candidate) => hasHiddenNeighbor(candidate)),
    );
    if (adjacentCandidate !== undefined && tryAdd(adjacentCandidate, false)) continue;

    // If every existing group is blocked by the numeric hidden-run limit,
    // start another spatially independent group and continue growing from it.
    const nextSeed = chooseBalancedCandidate(
      candidates.filter((candidate) => !hasHiddenNeighbor(candidate)),
    );
    if (nextSeed === undefined || !tryAdd(nextSeed, true)) break;
  }

  // Hidden percentage is a target, while the visible-run limit is a hard
  // readability rule. Add the minimum required repairs even if that means the
  // final hidden count is slightly above the percentage target.
  const visibleLimit = Math.max(1, Math.floor(selection.parameters.maxVisibleRun));
  guard = path.length * 2;
  while (guard > 0) {
    guard -= 1;
    const run = longestVisibleRun(path.length, hiddenIndices);
    if (run.length <= visibleLimit) break;

    const repairCandidates = candidates
      .filter((candidate) => candidate >= run.start && candidate < run.start + run.length)
      .filter((candidate) => canHideIndex(
        path.length,
        hiddenIndices,
        candidate,
        selection.parameters.maxHiddenRun,
      ));
    const shortestResultingVisibleRun = repairCandidates.reduce(
      (shortest, candidate) => Math.min(
        shortest,
        Math.max(
          candidate - run.start,
          run.start + run.length - candidate - 1,
        ),
      ),
      Infinity,
    );
    const repair = chooseBalancedCandidate(repairCandidates.filter((candidate) =>
      Math.max(
        candidate - run.start,
        run.start + run.length - candidate - 1,
      ) === shortestResultingVisibleRun));
    if (repair === undefined) break;
    tryAdd(repair, !hasHiddenNeighbor(repair));
  }

  return {
    hiddenCells: new Set([...hiddenIndices].map((index) => cellKey(path[index]))),
    seedCells: new Set([...seedIndices].map((index) => cellKey(path[index]))),
    targetCount,
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
  const path = generateAlgorithm2Path(context, selection.parameters);
  if (!path) return null;

  const seed = Math.imul(context.generationIndex + 1, 104729)
    ^ Math.imul(context.rows + 1, 73856093)
    ^ Math.imul(context.columns + 1, 19349663)
    ^ path.length
    ^ 0x4f1bbcdc;
  const hiddenCells = selectAlgorithm4HiddenCells(path, context.shape, selection, seed);
  const targetHiddenCount = Math.min(
    Math.max(0, path.length - 2),
    Math.max(0, Math.round(path.length * selection.parameters.hiddenPercent / 100)),
  );

  return {
    path,
    hiddenCells: [...hiddenCells].map(toCell),
    targetHiddenCount,
  };
};
