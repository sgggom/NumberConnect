import { neighborCells, projectCell } from './topology';
import {
  cellKey,
  type BoardNeighborhoodPreview,
  type BoardNeighborhoodPreviewPointer,
  type BoardHoldScore,
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

export const scoreDigitCount = (score: number): number => {
  const normalizedScore = Math.max(0, Math.floor(score));
  return normalizedScore === 0 ? 0 : String(normalizedScore).length;
};

export interface DifficultyScoreBreakdown {
  feasibleChoiceCount: number;
  extraScore: number;
  actualScore: number;
  total: number;
  totalDigitScore: number;
  badgeScore: number;
}

export const calculateDifficultyScore = ({
  choiceQuantity,
  infeasibleChoiceCount,
  nextNumberDistance,
  reasoningBranchCount,
  hasObviousAnswer = false,
}: {
  choiceQuantity: number;
  infeasibleChoiceCount: number;
  nextNumberDistance: number;
  reasoningBranchCount: number;
  hasObviousAnswer?: boolean;
}): DifficultyScoreBreakdown => {
  const feasibleChoiceCount = Math.max(0, choiceQuantity - infeasibleChoiceCount);
  const extraScore = hasObviousAnswer
    ? 0
    : Number((Math.max(0, feasibleChoiceCount - 1) * 0.2).toFixed(1));
  const reasoningBranchScore = Math.max(0, reasoningBranchCount - 1);
  const actualScore = infeasibleChoiceCount * nextNumberDistance * reasoningBranchScore;
  const total = actualScore;
  const totalDigitScore = scoreDigitCount(total);
  const badgeScore = Number((totalDigitScore + extraScore).toFixed(1));
  return {
    feasibleChoiceCount,
    extraScore,
    actualScore,
    total,
    totalDigitScore,
    badgeScore,
  };
};

const countExactLengthBranches = (
  level: NeighborhoodLevel,
  startIndex: number,
  targetIndex: number,
  intermediateCount: number,
  isAvailable: (index: number) => boolean,
): number => {
  const indexByCell = new Map(
    level.solutionPath.map((cell, index) => [cellKey(cell), index]),
  );
  const neighborsByIndex = level.solutionPath.map((cell) => (
    neighborCells(cell, level.boardShape).flatMap((neighbor) => {
      const index = indexByCell.get(cellKey(neighbor));
      return index === undefined ? [] : [index];
    })
  ));

  const minimumStepsToTarget = Array.from(
    { length: level.solutionPath.length },
    () => Number.POSITIVE_INFINITY,
  );
  minimumStepsToTarget[targetIndex] = 0;
  const queue = [targetIndex];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    for (const neighbor of neighborsByIndex[current]) {
      if (minimumStepsToTarget[neighbor] !== Number.POSITIVE_INFINITY) continue;
      minimumStepsToTarget[neighbor] = minimumStepsToTarget[current] + 1;
      queue.push(neighbor);
    }
  }

  const visited = new Set([startIndex]);
  const search = (currentIndex: number, usedIntermediateCount: number): number => {
    const remainingIntermediateCount = intermediateCount - usedIntermediateCount;
    if (remainingIntermediateCount === 0) {
      return neighborsByIndex[currentIndex].includes(targetIndex) ? 1 : 0;
    }

    let branchCount = 0;
    for (const nextIndex of neighborsByIndex[currentIndex]) {
      if (
        nextIndex === targetIndex
        || visited.has(nextIndex)
        || !isAvailable(nextIndex)
      ) {
        continue;
      }
      const movesRemainingAfterNext = remainingIntermediateCount;
      if (minimumStepsToTarget[nextIndex] > movesRemainingAfterNext) continue;
      visited.add(nextIndex);
      branchCount += search(nextIndex, usedIntermediateCount + 1);
      visited.delete(nextIndex);
    }
    return branchCount;
  };

  return search(startIndex, 0);
};

export const countAvailableNeighborhoodChoices = (
  level: NeighborhoodLevel,
  centerIndex: number,
  isAvailable: (index: number) => boolean,
): number => {
  const centerCell = level.solutionPath[centerIndex];
  if (!centerCell) return 0;

  const indexByCell = new Map(
    level.solutionPath.map((cell, index) => [cellKey(cell), index]),
  );
  return neighborCells(centerCell, level.boardShape).reduce((count, neighbor) => {
    const neighborIndex = indexByCell.get(cellKey(neighbor));
    return count + (
      neighborIndex !== undefined && isAvailable(neighborIndex)
        ? 1
        : 0
    );
  }, 0);
};

export const calculateHeldCellScore = (
  level: NeighborhoodLevel,
  centerIndex: number,
  isAvailable: (index: number) => boolean,
  isVisible: (index: number) => boolean,
  displayNumber: (index: number) => number,
  isInfeasible: (index: number) => boolean = () => false,
): BoardHoldScore => {
  const centerCell = level.solutionPath[centerIndex];
  if (!centerCell) {
    return {
      choiceQuantity: 0,
      choiceScore: 0,
      feasibleChoiceCount: 0,
      extraScore: 0,
      nextNumberDistance: 0,
      reasoningBranchCount: 0,
      reasoningBranchScore: 0,
      actualScore: 0,
      total: 0,
      totalDigitScore: 0,
      badgeScore: 0,
    };
  }

  const indexByCell = new Map(
    level.solutionPath.map((cell, index) => [cellKey(cell), index]),
  );
  const hiddenChoiceIndices = neighborCells(centerCell, level.boardShape).flatMap((neighbor) => {
    const index = indexByCell.get(cellKey(neighbor));
    return index !== undefined && isAvailable(index) ? [index] : [];
  });
  const currentNumber = displayNumber(centerIndex);
  const nextVisible = level.solutionPath.reduce<
    { index: number; number: number } | undefined
  >(
    (next, _, index) => {
      if (!isVisible(index)) return next;
      const candidateNumber = displayNumber(index);
      if (candidateNumber <= currentNumber) return next;
      return next === undefined || candidateNumber < next.number
        ? { index, number: candidateNumber }
        : next;
    },
    undefined,
  );
  const nextNumberDistance = nextVisible === undefined
    ? 0
    : Math.max(0, nextVisible.number - currentNumber - 1);
  const immediateNextIndex = level.solutionPath.findIndex(
    (_, index) => displayNumber(index) === currentNumber + 1,
  );
  const immediateNextCell = level.solutionPath[immediateNextIndex];
  const immediateNextIsNeighbor = immediateNextCell
    ? neighborCells(centerCell, level.boardShape)
      .some((neighbor) => cellKey(neighbor) === cellKey(immediateNextCell))
    : false;
  const choiceIndices = new Set(hiddenChoiceIndices);
  if (immediateNextIsNeighbor) choiceIndices.add(immediateNextIndex);
  const choiceQuantity = choiceIndices.size;
  const choiceScore = [...choiceIndices].reduce(
    (count, candidateIndex) => count + Number(isInfeasible(candidateIndex)),
    0,
  );
  const hasObviousAnswer = immediateNextIndex >= 0
    && immediateNextIsNeighbor
    && isVisible(immediateNextIndex);
  const reasoningBranchCount = nextVisible === undefined
    ? 0
    : countExactLengthBranches(
      level,
      centerIndex,
      nextVisible.index,
      nextNumberDistance,
      isAvailable,
    );
  const reasoningBranchScore = Math.max(0, reasoningBranchCount - 1);
  const score = calculateDifficultyScore({
    choiceQuantity,
    infeasibleChoiceCount: choiceScore,
    nextNumberDistance,
    reasoningBranchCount,
    hasObviousAnswer,
  });

  return {
    choiceQuantity,
    choiceScore,
    nextNumberDistance,
    reasoningBranchCount,
    reasoningBranchScore,
    ...score,
  };
};

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
