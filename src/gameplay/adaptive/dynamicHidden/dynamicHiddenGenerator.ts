/**
 * Independent fork of editor algorithm 1 for runtime dynamic hidden layouts.
 * Keep this implementation isolated so changes here cannot alter the legacy generator.
 */
import { createRandom } from '../../../game/random';
import { BoardShape, type Cell } from '../../../game/types';
import {
  allocateDynamicTierTargets,
  dynamicHiddenProfileForDifficulty,
  dynamicTierTolerance,
  type DynamicHiddenProfile,
  type DynamicTargetTierCounts,
  type DynamicTierCounts,
} from './dynamicHiddenProfiles';
import {
  analyzeDynamicHiddenLayout,
  type DynamicStepAnalysis,
} from './dynamicStepAnalyzer';
import type { EditorShape } from '../../editor/types';
import { generateVariedPath } from '../../editor/algorithms/generateVariedPath';
import type {
  Algorithm1Selection,
  EditorAlgorithmContext,
  EditorAlgorithmResult,
} from '../../editor/algorithms/types';

export interface Algorithm1SpatialMetrics {
  hiddenComponentCount: number;
  visibleComponentCount: number;
  largestHiddenComponentRatio: number;
  largestVisibleComponentRatio: number;
  mixedBoundaryRatio: number;
}

export interface Algorithm1ExperienceMetrics {
  averageDifficulty: number;
  hardStepRatio: number;
  peakDifficulty: number;
}

export interface Algorithm1HiddenLayoutOptions {
  maxVisibleRun?: number;
  maxHiddenRun?: number;
  firstNumberWindow?: number;
  maxHiddenInFirstWindow?: number;
  /** 默认保持编辑器算法1原规则；玩法3/5传 false，直接使用配置表的最终占比。 */
  addTargetDifficultyPercent?: boolean;
  onProgress?: (progress: number) => void;
}

export const ALGORITHM1_MAX_HIDDEN_COMPONENT_RATIO = 0.4;
const ALGORITHM1_PREFERRED_HIDDEN_COMPONENT_RATIO = 0.25;
const ALGORITHM1_DEFAULT_MAX_VISIBLE_RUN = 8;
const ALGORITHM1_DEFAULT_MAX_HIDDEN_RUN = 4;

const DIFFICULTY_TARGETS = [
  { averageDifficulty: 0.02, hardStepRatio: 0.01, peakDifficulty: 0.3 },
  { averageDifficulty: 0.06, hardStepRatio: 0.04, peakDifficulty: 0.6 },
  { averageDifficulty: 0.12, hardStepRatio: 0.08, peakDifficulty: 1 },
  { averageDifficulty: 0.2, hardStepRatio: 0.14, peakDifficulty: 1.4 },
  { averageDifficulty: 0.3, hardStepRatio: 0.2, peakDifficulty: 1.9 },
  { averageDifficulty: 0.42, hardStepRatio: 0.27, peakDifficulty: 2.4 },
  { averageDifficulty: 0.56, hardStepRatio: 0.34, peakDifficulty: 3 },
  { averageDifficulty: 0.7, hardStepRatio: 0.4, peakDifficulty: 3.6 },
  { averageDifficulty: 0.84, hardStepRatio: 0.46, peakDifficulty: 4.2 },
  { averageDifficulty: 1, hardStepRatio: 0.52, peakDifficulty: 5 },
] as const;

export const createAlgorithm1Selection = (): Algorithm1Selection => ({
  id: 'algorithm-1',
  parameters: {
    topology: 'board-shape',
    pathMode: 'spatial-distribution-multiple-solutions',
    targetCrossings: 20,
    turnProbability: 40,
    hiddenPercent: 35,
    targetDifficulty: 6,
    maxVisibleRun: ALGORITHM1_DEFAULT_MAX_VISIBLE_RUN,
    maxHiddenRun: ALGORITHM1_DEFAULT_MAX_HIDDEN_RUN,
  },
});

const keyOf = (cell: Cell): string => `${cell.x},${cell.y}`;

const visualNeighborCells = (cell: Cell, shape: EditorShape): Cell[] => {
  if (shape === 'hex') {
    const offsets = cell.x % 2 === 0
      ? [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]]
      : [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]];
    return offsets.map(([x, y]) => ({ x: cell.x + x, y: cell.y + y }));
  }
  return [
    { x: cell.x - 1, y: cell.y },
    { x: cell.x + 1, y: cell.y },
    { x: cell.x, y: cell.y - 1 },
    { x: cell.x, y: cell.y + 1 },
  ];
};

const buildVisualNeighborIndexes = (
  path: ReadonlyArray<Cell>,
  shape: EditorShape,
): number[][] => {
  const indexByKey = new Map(path.map((cell, index) => [keyOf(cell), index]));
  return path.map((cell) => visualNeighborCells(cell, shape).flatMap((neighbor) => {
    const index = indexByKey.get(keyOf(neighbor));
    return index === undefined ? [] : [index];
  }));
};

export const calculateAlgorithm1SpatialMetrics = (
  path: ReadonlyArray<Cell>,
  hiddenIndices: ReadonlySet<number>,
  shape: EditorShape,
): Algorithm1SpatialMetrics => {
  const neighbors = buildVisualNeighborIndexes(path, shape);
  const componentSizes = (hiddenState: boolean): number[] => {
    const remaining = new Set(path.flatMap((_, index) => (
      hiddenIndices.has(index) === hiddenState ? [index] : []
    )));
    const sizes: number[] = [];
    while (remaining.size > 0) {
      const first = remaining.values().next().value as number;
      remaining.delete(first);
      const pending = [first];
      let size = 0;
      while (pending.length > 0) {
        const current = pending.pop() as number;
        size += 1;
        for (const neighbor of neighbors[current]) {
          if (!remaining.has(neighbor)) continue;
          remaining.delete(neighbor);
          pending.push(neighbor);
        }
      }
      sizes.push(size);
    }
    return sizes;
  };

  const hiddenComponents = componentSizes(true);
  const visibleComponents = componentSizes(false);
  let edgeCount = 0;
  let mixedBoundaryCount = 0;
  neighbors.forEach((cellNeighbors, index) => cellNeighbors.forEach((neighbor) => {
    if (neighbor <= index) return;
    edgeCount += 1;
    mixedBoundaryCount += Number(hiddenIndices.has(index) !== hiddenIndices.has(neighbor));
  }));
  const hiddenCount = hiddenIndices.size;
  const visibleCount = Math.max(0, path.length - hiddenCount);
  return {
    hiddenComponentCount: hiddenComponents.length,
    visibleComponentCount: visibleComponents.length,
    largestHiddenComponentRatio: hiddenCount === 0
      ? 0
      : Math.max(0, ...hiddenComponents) / hiddenCount,
    largestVisibleComponentRatio: visibleCount === 0
      ? 0
      : Math.max(0, ...visibleComponents) / visibleCount,
    mixedBoundaryRatio: edgeCount === 0 ? 0 : mixedBoundaryCount / edgeCount,
  };
};

export const calculateAlgorithm1SpatialLoss = (
  metrics: Algorithm1SpatialMetrics,
): number => (
  metrics.largestHiddenComponentRatio * 4
  + metrics.largestVisibleComponentRatio * 1.5
  - metrics.mixedBoundaryRatio * 2
);

interface Algorithm1ReasoningBranches {
  branchCount: number;
  validFirstChoiceCount: number;
}

const countAlgorithm1ReasoningBranches = (
  startIndex: number,
  targetIndex: number,
  hiddenIndices: ReadonlySet<number>,
  neighbors: ReadonlyArray<ReadonlyArray<number>>,
): Algorithm1ReasoningBranches => {
  const requiredMoves = targetIndex - startIndex;
  if (requiredMoves <= 1) return { branchCount: 0, validFirstChoiceCount: 0 };
  const visited = new Set([startIndex]);
  const validFirstChoices = new Set<number>();
  let branchCount = 0;
  const maximumTrackedBranches = 100;

  const search = (current: number, movesUsed: number, firstChoice?: number): void => {
    if (branchCount >= maximumTrackedBranches) return;
    const movesRemaining = requiredMoves - movesUsed;
    if (movesRemaining === 1) {
      if (neighbors[current].includes(targetIndex)) {
        branchCount += 1;
        if (firstChoice !== undefined) validFirstChoices.add(firstChoice);
      }
      return;
    }
    neighbors[current].forEach((neighbor) => {
      if (
        neighbor === targetIndex
        || neighbor <= startIndex
        || !hiddenIndices.has(neighbor)
        || visited.has(neighbor)
      ) {
        return;
      }
      visited.add(neighbor);
      search(neighbor, movesUsed + 1, firstChoice ?? neighbor);
      visited.delete(neighbor);
    });
  };

  search(startIndex, 0);
  return {
    branchCount,
    validFirstChoiceCount: validFirstChoices.size,
  };
};

const calculateAlgorithm1ExperienceMetricsWithNeighbors = (
  path: ReadonlyArray<Cell>,
  hiddenIndices: ReadonlySet<number>,
  neighbors: ReadonlyArray<ReadonlyArray<number>>,
): Algorithm1ExperienceMetrics => {
  const scores: number[] = [];
  for (let index = 0; index < path.length - 1; index += 1) {
    if (!hiddenIndices.has(index + 1)) {
      scores.push(0);
      continue;
    }
    const hiddenChoices = neighbors[index].filter((neighbor) => (
      neighbor > index && hiddenIndices.has(neighbor)
    )).length;
    let nextVisibleIndex = index + 1;
    while (nextVisibleIndex < path.length - 1 && hiddenIndices.has(nextVisibleIndex)) {
      nextVisibleIndex += 1;
    }
    const clueDistance = nextVisibleIndex - index;
    const reasoning = countAlgorithm1ReasoningBranches(
      index,
      nextVisibleIndex,
      hiddenIndices,
      neighbors,
    );
    const locallyImpossibleChoices = Math.max(
      0,
      hiddenChoices - reasoning.validFirstChoiceCount,
    );
    const alternativeValidChoices = Math.max(
      0,
      reasoning.validFirstChoiceCount - 1,
    );
    const extraReasoningBranches = Math.max(
      0,
      reasoning.branchCount - reasoning.validFirstChoiceCount,
    );
    const score = (
      locallyImpossibleChoices * (0.9 + Math.max(0, clueDistance - 2) * 0.18)
      + alternativeValidChoices * 0.25
      + extraReasoningBranches * 0.12
      + Math.max(0, clueDistance - 2) * 0.06
    );
    scores.push(Math.min(5, score));
  }
  const total = Math.max(1, scores.length);
  return {
    averageDifficulty: scores.reduce((sum, score) => sum + score, 0) / total,
    hardStepRatio: scores.filter((score) => score >= 1).length / total,
    peakDifficulty: Math.max(0, ...scores),
  };
};

export const calculateAlgorithm1ExperienceMetrics = (
  path: ReadonlyArray<Cell>,
  hiddenIndices: ReadonlySet<number>,
  shape: EditorShape,
): Algorithm1ExperienceMetrics => calculateAlgorithm1ExperienceMetricsWithNeighbors(
  path,
  hiddenIndices,
  buildVisualNeighborIndexes(path, shape),
);

export const calculateAlgorithm1ExperienceValue = (
  metrics: Algorithm1ExperienceMetrics,
): number => (
  metrics.averageDifficulty * 2.5
  + metrics.hardStepRatio * 2
  + metrics.peakDifficulty * 0.4
);

export const calculateAlgorithm1DifficultyLoss = (
  metrics: Algorithm1ExperienceMetrics,
  targetDifficulty: number,
  progress = 1,
): number => {
  const level = Math.max(1, Math.min(10, Math.floor(targetDifficulty)));
  const target = DIFFICULTY_TARGETS[level - 1];
  const scaledProgress = Math.max(0, Math.min(1, progress));
  return (
    Math.abs(metrics.averageDifficulty - target.averageDifficulty * scaledProgress) / 0.3 * 0.5
    + Math.abs(metrics.hardStepRatio - target.hardStepRatio * scaledProgress) / 0.2 * 0.3
    + Math.abs(metrics.peakDifficulty - target.peakDifficulty * scaledProgress) / 1.5 * 0.2
  );
};

const normalizedDifficulty = (targetDifficulty: number): number => (
  (Math.max(1, Math.min(10, Math.floor(targetDifficulty))) - 1) / 9
);

export const algorithm1EffectiveHiddenPercent = (
  requestedPercent: number,
  targetDifficulty: number,
): number => {
  const basePercent = Math.max(0, Math.min(100, requestedPercent));
  const difficultyPercent = Math.max(1, Math.min(10, Math.floor(targetDifficulty)));
  return Math.min(100, basePercent + difficultyPercent);
};

export const algorithm1AdjacentExpansionProbability = (targetDifficulty: number): number => (
  normalizedDifficulty(targetDifficulty) * 0.85
);

export const algorithm1AdjacentExpansionCount = (
  expansionCount: number,
  targetDifficulty: number,
): number => {
  const normalizedCount = Math.max(0, Math.floor(expansionCount));
  return Math.round(
    normalizedCount * algorithm1AdjacentExpansionProbability(targetDifficulty),
  );
};

export const algorithm1BaseSelectionCount = (targetCount: number): number => {
  const normalizedCount = Math.max(0, Math.floor(targetCount));
  return Math.min(normalizedCount, Math.ceil(normalizedCount * 0.1));
};

const isScheduledAdjacentExpansion = (
  expansionIndex: number,
  expansionCount: number,
  adjacentExpansionCount: number,
): boolean => {
  if (expansionCount <= 0 || adjacentExpansionCount <= 0) return false;
  const completedBefore = Math.floor(
    expansionIndex * adjacentExpansionCount / expansionCount,
  );
  const completedAfter = Math.floor(
    (expansionIndex + 1) * adjacentExpansionCount / expansionCount,
  );
  return completedAfter > completedBefore;
};

const minimumGraphDistance = (
  start: number,
  targets: ReadonlySet<number>,
  neighbors: ReadonlyArray<ReadonlyArray<number>>,
): number => {
  if (targets.size === 0) return 0;
  const visited = new Set([start]);
  let frontier = [start];
  let distance = 0;
  while (frontier.length > 0) {
    distance += 1;
    const nextFrontier: number[] = [];
    for (const current of frontier) {
      for (const neighbor of neighbors[current]) {
        if (targets.has(neighbor)) return distance;
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        nextFrontier.push(neighbor);
      }
    }
    frontier = nextFrontier;
  }
  return neighbors.length;
};

const secondRingHiddenCount = (
  index: number,
  hidden: ReadonlySet<number>,
  neighbors: ReadonlyArray<ReadonlyArray<number>>,
): number => {
  const secondRing = new Set<number>();
  neighbors[index].forEach((neighbor) => {
    neighbors[neighbor].forEach((secondNeighbor) => {
      if (secondNeighbor !== index && !neighbors[index].includes(secondNeighbor)) {
        secondRing.add(secondNeighbor);
      }
    });
  });
  return [...secondRing].filter((neighbor) => hidden.has(neighbor)).length;
};

interface Algorithm1HiddenComponentState {
  componentByIndex: number[];
  componentSizes: number[];
  largestSize: number;
}

interface Algorithm1ProjectedSpatialMetrics {
  largestHiddenComponentRatio: number;
  mixedBoundaryRatio: number;
}

const buildHiddenComponentState = (
  hidden: ReadonlySet<number>,
  neighbors: ReadonlyArray<ReadonlyArray<number>>,
): Algorithm1HiddenComponentState => {
  const componentByIndex = Array.from({ length: neighbors.length }, () => -1);
  const componentSizes: number[] = [];
  hidden.forEach((start) => {
    if (componentByIndex[start] !== -1) return;
    const componentId = componentSizes.length;
    const pending = [start];
    componentByIndex[start] = componentId;
    let size = 0;
    while (pending.length > 0) {
      const current = pending.pop() as number;
      size += 1;
      neighbors[current].forEach((neighbor) => {
        if (!hidden.has(neighbor) || componentByIndex[neighbor] !== -1) return;
        componentByIndex[neighbor] = componentId;
        pending.push(neighbor);
      });
    }
    componentSizes.push(size);
  });
  return {
    componentByIndex,
    componentSizes,
    largestSize: Math.max(0, ...componentSizes),
  };
};

const calculateMixedBoundaryCount = (
  hidden: ReadonlySet<number>,
  neighbors: ReadonlyArray<ReadonlyArray<number>>,
): number => neighbors.reduce((total, cellNeighbors, index) => (
  total + cellNeighbors.filter((neighbor) => (
    neighbor > index && hidden.has(index) !== hidden.has(neighbor)
  )).length
), 0);

const calculateProjectedSpatialMetrics = (
  candidate: number,
  hidden: ReadonlySet<number>,
  neighbors: ReadonlyArray<ReadonlyArray<number>>,
  componentState: Algorithm1HiddenComponentState,
  mixedBoundaryCount: number,
  edgeCount: number,
): Algorithm1ProjectedSpatialMetrics => {
  const adjacentComponents = new Set<number>();
  let directHiddenCount = 0;
  neighbors[candidate].forEach((neighbor) => {
    if (!hidden.has(neighbor)) return;
    directHiddenCount += 1;
    const componentId = componentState.componentByIndex[neighbor];
    if (componentId >= 0) adjacentComponents.add(componentId);
  });
  const mergedComponentSize = 1 + [...adjacentComponents].reduce((total, componentId) => (
    total + componentState.componentSizes[componentId]
  ), 0);
  const projectedMixedBoundaryCount = mixedBoundaryCount
    + (neighbors[candidate].length - directHiddenCount)
    - directHiddenCount;
  return {
    largestHiddenComponentRatio: Math.max(
      componentState.largestSize,
      mergedComponentSize,
    ) / Math.max(1, hidden.size + 1),
    mixedBoundaryRatio: edgeCount === 0 ? 0 : projectedMixedBoundaryCount / edgeCount,
  };
};

interface Algorithm1RunState {
  longestHiddenRun: number;
  longestVisibleRun: number;
  minimumAdditionalHiddenCount: number;
}

const calculateAlgorithm1RunState = (
  pathCount: number,
  hidden: ReadonlySet<number>,
  maximumVisibleRun: number,
): Algorithm1RunState => {
  let hiddenRun = 0;
  let visibleRun = 0;
  let longestHiddenRun = 0;
  let longestVisibleRun = 0;
  let minimumAdditionalHiddenCount = 0;
  const finishVisibleRun = (): void => {
    longestVisibleRun = Math.max(longestVisibleRun, visibleRun);
    minimumAdditionalHiddenCount += Math.floor(
      visibleRun / (maximumVisibleRun + 1),
    );
    visibleRun = 0;
  };

  for (let index = 0; index < pathCount; index += 1) {
    if (hidden.has(index)) {
      finishVisibleRun();
      hiddenRun += 1;
      longestHiddenRun = Math.max(longestHiddenRun, hiddenRun);
    } else {
      hiddenRun = 0;
      visibleRun += 1;
    }
  }
  finishVisibleRun();
  return {
    longestHiddenRun,
    longestVisibleRun,
    minimumAdditionalHiddenCount,
  };
};

/**
 * Selects exactly one new hidden number per pass using spatial rules only.
 * The first ten percent of selections are neutral, distributed base cells. Remaining
 * selections use a difficulty-derived quota for expansion beside those bases,
 * prefer local ambiguity and longer clue distances, and reject oversized
 * hidden components. A seeded choice among equal-quality cells avoids rigid
 * patterns without making the requested difficulty depend on lucky rolls.
 */
export const selectDynamicHiddenBaseLayout = (
  path: ReadonlyArray<Cell>,
  shape: EditorShape,
  requestedPercent: number,
  targetDifficulty: number,
  seed: number,
  options: Algorithm1HiddenLayoutOptions = {},
): Set<number> => {
  const availableCount = Math.max(0, path.length - 2);
  const firstNumberWindow = Math.max(
    1,
    Math.min(path.length, Math.floor(options.firstNumberWindow ?? 4)),
  );
  const firstWindowCandidateCount = Math.max(0, Math.min(
    availableCount,
    firstNumberWindow - 1,
  ));
  const maxHiddenInFirstWindow = Math.max(0, Math.min(
    firstWindowCandidateCount,
    Math.floor(options.maxHiddenInFirstWindow ?? 1),
  ));
  const maximumSelectableCount = availableCount
    - firstWindowCandidateCount
    + maxHiddenInFirstWindow;
  const normalizedPercent = options.addTargetDifficultyPercent === false
    ? Math.max(0, Math.min(100, requestedPercent))
    : algorithm1EffectiveHiddenPercent(requestedPercent, targetDifficulty);
  const targetCount = Math.min(
    maximumSelectableCount,
    Math.max(0, Math.round(path.length * normalizedPercent / 100)),
  );
  const hidden = new Set<number>();
  const baseHidden = new Set<number>();
  const maximumVisibleRun = Math.max(
    1,
    Math.floor(options.maxVisibleRun ?? ALGORITHM1_DEFAULT_MAX_VISIBLE_RUN),
  );
  const maximumHiddenRun = Math.max(
    1,
    Math.floor(options.maxHiddenRun ?? ALGORITHM1_DEFAULT_MAX_HIDDEN_RUN),
  );
  const neighbors = buildVisualNeighborIndexes(path, shape);
  const random = createRandom(seed ^ 0x6f29d417);
  const baseSelectionCount = algorithm1BaseSelectionCount(targetCount);
  const expansionCount = Math.max(0, targetCount - baseSelectionCount);
  const adjacentExpansionCount = algorithm1AdjacentExpansionCount(
    expansionCount,
    targetDifficulty,
  );
  const edgeCount = neighbors.reduce((total, cellNeighbors) => (
    total + cellNeighbors.length
  ), 0) / 2;

  for (let pass = 0; pass < targetCount; pass += 1) {
    const hiddenInFirstWindow = [...hidden].filter(
      (index) => index < firstNumberWindow,
    ).length;
    const allCandidates = Array.from(
      { length: availableCount },
      (_, offset) => offset + 1,
    ).filter((index) => (
      !hidden.has(index)
      && (
        index >= firstNumberWindow
        || hiddenInFirstWindow < maxHiddenInFirstWindow
      )
    ));

    const progress = (pass + 1) / Math.max(1, targetCount);
    const isBaseSelection = pass < baseSelectionCount;
    let candidates = allCandidates;
    if (isBaseSelection) {
      const neutralCandidates = allCandidates.filter((candidate) => {
        const metrics = calculateAlgorithm1ExperienceMetricsWithNeighbors(
          path,
          new Set(hidden).add(candidate),
          neighbors,
        );
        return metrics.peakDifficulty === 0;
      });
      if (neutralCandidates.length > 0) candidates = neutralCandidates;
    } else {
      const adjacentCandidates = allCandidates.filter((candidate) => (
        neighbors[candidate].some((neighbor) => baseHidden.has(neighbor))
      ));
      const nonAdjacentCandidates = allCandidates.filter((candidate) => (
        !neighbors[candidate].some((neighbor) => baseHidden.has(neighbor))
      ));
      const useAdjacentCandidate = adjacentCandidates.length > 0
        && isScheduledAdjacentExpansion(
          pass - baseSelectionCount,
          expansionCount,
          adjacentExpansionCount,
        );
      candidates = useAdjacentCandidate
        ? adjacentCandidates
        : nonAdjacentCandidates.length > 0
          ? nonAdjacentCandidates
          : allCandidates;
    }

    const componentState = buildHiddenComponentState(hidden, neighbors);
    const mixedBoundaryCount = calculateMixedBoundaryCount(hidden, neighbors);
    const projectedSpatialMetrics = new Map(allCandidates.map((candidate) => [
      candidate,
      calculateProjectedSpatialMetrics(
        candidate,
        hidden,
        neighbors,
        componentState,
        mixedBoundaryCount,
        edgeCount,
      ),
    ]));
    const withinComponentRatio = (
      source: ReadonlyArray<number>,
      maximumRatio: number,
    ): number[] => source.filter((candidate) => (
      (projectedSpatialMetrics.get(candidate)?.largestHiddenComponentRatio ?? 1)
        <= maximumRatio
    ));
    const preferredDistributedCandidates = withinComponentRatio(
      candidates,
      ALGORITHM1_PREFERRED_HIDDEN_COMPONENT_RATIO,
    );
    const allDistributedCandidates = withinComponentRatio(
      allCandidates,
      ALGORITHM1_PREFERRED_HIDDEN_COMPONENT_RATIO,
    );
    const preferredClusterSafeCandidates = withinComponentRatio(
      candidates,
      ALGORITHM1_MAX_HIDDEN_COMPONENT_RATIO,
    );
    const allClusterSafeCandidates = withinComponentRatio(
      allCandidates,
      ALGORITHM1_MAX_HIDDEN_COMPONENT_RATIO,
    );
    if (preferredDistributedCandidates.length > 0) {
      candidates = preferredDistributedCandidates;
    } else if (allDistributedCandidates.length > 0) {
      candidates = allDistributedCandidates;
    } else if (preferredClusterSafeCandidates.length > 0) {
      candidates = preferredClusterSafeCandidates;
    } else if (allClusterSafeCandidates.length > 0) {
      candidates = allClusterSafeCandidates;
    }

    const remainingSelections = targetCount - pass - 1;
    const runStateByCandidate = new Map(allCandidates.map((candidate) => [
      candidate,
      calculateAlgorithm1RunState(
        path.length,
        new Set(hidden).add(candidate),
        maximumVisibleRun,
      ),
    ]));
    const withinRunLimits = (source: ReadonlyArray<number>): number[] => source.filter(
      (candidate) => {
        const runState = runStateByCandidate.get(candidate) as Algorithm1RunState;
        return runState.longestHiddenRun <= maximumHiddenRun
          && runState.minimumAdditionalHiddenCount <= remainingSelections;
      },
    );
    const withinHiddenLimit = (source: ReadonlyArray<number>): number[] => source.filter(
      (candidate) => (
        (runStateByCandidate.get(candidate)?.longestHiddenRun ?? Number.POSITIVE_INFINITY)
          <= maximumHiddenRun
      ),
    );
    const preferredRunSafeCandidates = withinRunLimits(candidates);
    const clusterRunSafeCandidates = withinRunLimits(allClusterSafeCandidates);
    const allRunSafeCandidates = withinRunLimits(allCandidates);
    const preferredHiddenSafeCandidates = withinHiddenLimit(candidates);
    const clusterHiddenSafeCandidates = withinHiddenLimit(allClusterSafeCandidates);
    const allHiddenSafeCandidates = withinHiddenLimit(allCandidates);
    if (preferredRunSafeCandidates.length > 0) {
      candidates = preferredRunSafeCandidates;
    } else if (clusterRunSafeCandidates.length > 0) {
      candidates = clusterRunSafeCandidates;
    } else if (allRunSafeCandidates.length > 0) {
      candidates = allRunSafeCandidates;
    } else if (preferredHiddenSafeCandidates.length > 0) {
      candidates = preferredHiddenSafeCandidates;
    } else if (clusterHiddenSafeCandidates.length > 0) {
      candidates = clusterHiddenSafeCandidates;
    } else if (allHiddenSafeCandidates.length > 0) {
      candidates = allHiddenSafeCandidates;
    }

    const evaluatedCandidates = candidates.map((candidate) => {
      const projected = new Set(hidden).add(candidate);
      const directHiddenCount = neighbors[candidate]
        .filter((neighbor) => hidden.has(neighbor)).length;
      const distance = minimumGraphDistance(candidate, hidden, neighbors);
      const projectedSpatial = projectedSpatialMetrics.get(candidate) as Algorithm1ProjectedSpatialMetrics;
      const spatialLoss = (
        projectedSpatial.largestHiddenComponentRatio * 4
        - projectedSpatial.mixedBoundaryRatio * 2
      );
      const experienceMetrics = calculateAlgorithm1ExperienceMetricsWithNeighbors(
        path,
        projected,
        neighbors,
      );
      const difficultyLoss = calculateAlgorithm1DifficultyLoss(
        experienceMetrics,
        targetDifficulty,
        progress,
      );
      const adjacentBaseLoads = neighbors[candidate]
        .filter((neighbor) => baseHidden.has(neighbor))
        .map((baseIndex) => neighbors[baseIndex].filter((neighbor) => (
          hidden.has(neighbor) && !baseHidden.has(neighbor)
        )).length);
      const baseLoad = adjacentBaseLoads.length === 0
        ? 0
        : Math.min(...adjacentBaseLoads);
      const runState = runStateByCandidate.get(candidate) as Algorithm1RunState;
      const runLoss = (
        Math.max(0, runState.longestHiddenRun - maximumHiddenRun) * 50
        + Math.max(
          0,
          runState.minimumAdditionalHiddenCount - remainingSelections,
        ) * 50
        + (remainingSelections === 0
          ? Math.max(0, runState.longestVisibleRun - maximumVisibleRun) * 5
          : 0)
      );
      const baseLoss = (
            spatialLoss * 1.2
            + directHiddenCount * 8
            + secondRingHiddenCount(candidate, hidden, neighbors) * 1.5
            - distance * 0.8
            + runLoss
      );
      return {
        candidate,
        baseLoad,
        baseLoss,
        difficultyLoss,
        directHiddenCount,
        distance,
        experienceValue: calculateAlgorithm1ExperienceValue(experienceMetrics),
        runLoss,
        secondRingCount: secondRingHiddenCount(candidate, hidden, neighbors),
        spatialLoss,
      };
    });
    const experienceValues = evaluatedCandidates.map(({ experienceValue }) => experienceValue);
    const minimumExperience = Math.min(...experienceValues);
    const maximumExperience = Math.max(...experienceValues);
    const experienceRange = maximumExperience - minimumExperience;
    const difficultyRatio = normalizedDifficulty(targetDifficulty);
    const scoredCandidates = evaluatedCandidates.map((evaluation) => {
      const relativeExperience = experienceRange <= 1e-9
        ? 0.5
        : (evaluation.experienceValue - minimumExperience) / experienceRange;
      const relativeDifficultyLoss = Math.abs(relativeExperience - difficultyRatio);
      const loss = isBaseSelection
        ? evaluation.baseLoss
        : (
            relativeDifficultyLoss * 8
            + evaluation.difficultyLoss * 0.5
            + evaluation.spatialLoss * 0.35
            + evaluation.directHiddenCount * 0.45
            + evaluation.secondRingCount * 0.15
            + evaluation.baseLoad * 1.2
            - evaluation.distance * 0.05
            + evaluation.runLoss
          );
      return { candidate: evaluation.candidate, loss };
    }).sort((left, right) => left.loss - right.loss);

    const poolSize = Math.min(
      isBaseSelection ? 5 : 2,
      Math.max(1, Math.ceil(Math.sqrt(scoredCandidates.length) / 2)),
    );
    const pool = scoredCandidates.slice(0, poolSize);
    const bestLoss = pool[0]?.loss ?? 0;
    const weights = pool.map(({ loss }) => Math.exp(
      -(loss - bestLoss) / (isBaseSelection ? 0.75 : 0.12),
    ));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let cursor = random() * totalWeight;
    let selected = pool[pool.length - 1]?.candidate;
    for (let index = 0; index < pool.length; index += 1) {
      cursor -= weights[index];
      if (cursor > 0) continue;
      selected = pool[index].candidate;
      break;
    }

    if (selected !== undefined) {
      hidden.add(selected);
      if (isBaseSelection) baseHidden.add(selected);
    }
    options.onProgress?.((pass + 1) / Math.max(1, targetCount));
  }

  if (targetCount === 0) options.onProgress?.(1);
  return hidden;
};

export const runDynamicHiddenFork = (
  context: EditorAlgorithmContext,
  selection: Algorithm1Selection,
): EditorAlgorithmResult | null => {
  const fixedPath = context.fixedPath?.map((cell) => ({ ...cell }));
  const pathProgressWeight = fixedPath ? 0 : 0.34;
  const path = fixedPath ?? generateVariedPath({
    ...context,
    searchMode: context.activeCells.size > 81 ? 'realtime' : context.searchMode,
    onProgress: (progress) => context.onProgress?.(progress * pathProgressWeight),
  }, selection.parameters);
  if (!path) return null;
  context.onProgress?.(pathProgressWeight);
  if (context.generationPhase === 'path') {
    context.onProgress?.(1);
    return { path };
  }

  const seed = Math.imul(context.generationIndex + 1, 104729)
    ^ Math.imul(context.rows + 1, 73856093)
    ^ Math.imul(context.columns + 1, 19349663)
    ^ path.length
    ^ 0x2b7e1516;
  const hiddenIndices = selectDynamicHiddenBaseLayout(
    path,
    context.shape,
    selection.parameters.hiddenPercent,
    selection.parameters.targetDifficulty,
    seed,
    {
      maxVisibleRun: selection.parameters.maxVisibleRun,
      maxHiddenRun: selection.parameters.maxHiddenRun,
      onProgress: (progress) => context.onProgress?.(
        pathProgressWeight + progress * (1 - pathProgressWeight),
      ),
    },
  );
  context.onProgress?.(1);
  return {
    path,
    hiddenCells: [...hiddenIndices].map((index) => ({ ...path[index] })),
    targetHiddenCount: hiddenIndices.size,
  };
};

export const DYNAMIC_HIDDEN_ALGORITHM_VERSION = 'dynamic-hidden-v1';

export interface DynamicHiddenGenerationInput {
  path: Cell[];
  boardShape: BoardShape;
  targetDifficulty: number;
  seed: number;
  /**
   * Optional exact debug target. When present, its sum controls the hidden
   * quantity and the 0/1/2 counts replace the difficulty profile ratios.
   */
  targetTierCounts?: DynamicTargetTierCounts;
  /** Debug-only mode that keeps endpoints and the first-number rule as hard constraints. */
  safetyMode?: 'profile' | 'hard-boundaries';
  hiddenPercent?: number;
  maxVisibleRun?: number;
  maxHiddenRun?: number;
}

export interface DynamicHiddenGenerationReport {
  algorithmVersion: typeof DYNAMIC_HIDDEN_ALGORITHM_VERSION;
  requestedDifficulty: number;
  targetHiddenCount: number;
  targetTierCounts: DynamicTargetTierCounts;
  actualTierCounts: DynamicTierCounts;
  ambiguousStepCount: number;
  unsafeTier0Count: number;
  tier2OverRangeCount: number;
  longestTier2Run: number;
  peakActualScore: number;
  evaluatedCandidateCount: number;
  tierDistance: number;
  withinTargetTolerance: boolean;
  accepted: boolean;
  loss: number;
}

export interface DynamicHiddenGenerationResult {
  hiddenIndices: number[];
  report: DynamicHiddenGenerationReport;
}

interface DynamicLayoutEvaluation {
  hidden: Set<number>;
  analysis: DynamicStepAnalysis;
  targetTierCounts: DynamicTargetTierCounts;
  tierDistance: number;
  withinTargetTolerance: boolean;
  structurallySafe: boolean;
  accepted: boolean;
  loss: number;
}

const editorShapeForBoardShape = (shape: BoardShape): EditorShape => {
  if (shape === BoardShape.Hex) return 'hex';
  if (shape === BoardShape.Diamond) return 'diamond';
  if (shape === BoardShape.Rectangle) return 'rectangle';
  return 'square';
};

const sortedHiddenIndices = (hidden: ReadonlySet<number>): number[] => (
  [...hidden].sort((left, right) => left - right)
);

const hiddenLayoutKey = (hidden: ReadonlySet<number>): string => (
  sortedHiddenIndices(hidden).join(',')
);

const shuffleWith = <T>(values: ReadonlyArray<T>, random: () => number): T[] => {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
};

const tierDistanceFromTarget = (
  actual: DynamicTierCounts,
  target: DynamicTargetTierCounts,
): number => Math.ceil((
  Math.abs(actual[0] - target[0])
  + Math.abs(actual[1] - target[1])
  + Math.abs(actual[2] - target[2])
  + actual[3]
  ) / 2);

const normalizeExplicitTierTargets = (
  target: DynamicTargetTierCounts | undefined,
): DynamicTargetTierCounts | undefined => {
  if (target === undefined) return undefined;
  const normalize = (value: number): number => Math.max(
    0,
    Math.floor(Number.isFinite(value) ? value : 0),
  );
  return [normalize(target[0]), normalize(target[1]), normalize(target[2])];
};

const evaluateDynamicLayout = (
  input: DynamicHiddenGenerationInput,
  shape: EditorShape,
  hidden: Set<number>,
  profile: DynamicHiddenProfile,
  explicitTargetTierCounts?: DynamicTargetTierCounts,
): DynamicLayoutEvaluation => {
  const analysis = analyzeDynamicHiddenLayout(
    input.path,
    input.boardShape,
    hidden,
    profile.maxTier2ActualScore,
  );
  const targetTierCounts = explicitTargetTierCounts
    ?? allocateDynamicTierTargets(hidden.size, profile);
  const tierDistance = tierDistanceFromTarget(analysis.tierCounts, targetTierCounts);
  const tolerance = explicitTargetTierCounts === undefined
    ? dynamicTierTolerance(hidden.size)
    : 0;
  const runState = calculateAlgorithm1RunState(
    input.path.length,
    hidden,
    input.maxVisibleRun ?? profile.maxVisibleRun,
  );
  const firstWindowHiddenCount = sortedHiddenIndices(hidden).filter(
    (index) => index < profile.firstNumberWindow,
  ).length;
  const spatial = calculateAlgorithm1SpatialMetrics(input.path, hidden, shape);
  const ambiguityBudget = Math.max(
    2,
    Math.floor(hidden.size * profile.ambiguityRatio),
  );
  const unsafeTier0Allowance = Math.max(1, Math.ceil(hidden.size * 0.25));
  const preservesHardBoundaries = (
    !hidden.has(0)
    && !hidden.has(input.path.length - 1)
    && firstWindowHiddenCount <= profile.maxHiddenInFirstWindow
  );
  const usesExactTierTarget = explicitTargetTierCounts !== undefined;
  const usesHardBoundarySafety = usesExactTierTarget
    || input.safetyMode === 'hard-boundaries';
  const structurallySafe = preservesHardBoundaries && (
    usesHardBoundarySafety
    || (
      runState.longestHiddenRun <= (input.maxHiddenRun ?? profile.maxHiddenRun)
      && runState.longestVisibleRun <= (input.maxVisibleRun ?? profile.maxVisibleRun)
      && spatial.largestHiddenComponentRatio <= ALGORITHM1_MAX_HIDDEN_COMPONENT_RATIO
    )
  );
  const accepted = structurallySafe
    && tierDistance <= tolerance
    && analysis.tierCounts[3] === 0
    && (
      usesHardBoundarySafety
      || (
        analysis.tier2OverRangeCount === 0
        && analysis.longestTier2Run <= profile.maxConsecutiveTier2
        && analysis.ambiguousStepCount <= ambiguityBudget
        && analysis.unsafeTier0Count <= unsafeTier0Allowance
      )
    );
  const ambiguityOverflow = Math.max(0, analysis.ambiguousStepCount - ambiguityBudget);
  const unsafeTier0Overflow = Math.max(0, analysis.unsafeTier0Count - unsafeTier0Allowance);
  const hiddenRunOverflow = Math.max(
    0,
    runState.longestHiddenRun - (input.maxHiddenRun ?? profile.maxHiddenRun),
  );
  const visibleRunOverflow = Math.max(
    0,
    runState.longestVisibleRun - (input.maxVisibleRun ?? profile.maxVisibleRun),
  );
  const componentOverflow = Math.max(
    0,
    spatial.largestHiddenComponentRatio - ALGORITHM1_MAX_HIDDEN_COMPONENT_RATIO,
  );
  const loss = (
    tierDistance * 6
    + analysis.tierCounts[3] * 200
    + analysis.tier2OverRangeCount * 120
    + Math.max(0, analysis.longestTier2Run - profile.maxConsecutiveTier2) * 80
    + analysis.earlyTier2Count * 8
    + ambiguityOverflow * 30
    + analysis.ambiguousStepCount * 1.5
    + unsafeTier0Overflow * 18
    + analysis.unsafeTier0Count
    + hiddenRunOverflow * 100
    + visibleRunOverflow * 40
    + Math.max(0, firstWindowHiddenCount - profile.maxHiddenInFirstWindow) * 100
    + componentOverflow * 200
    + calculateAlgorithm1SpatialLoss(spatial) * 0.1
  );
  return {
    hidden,
    analysis,
    targetTierCounts,
    tierDistance,
    withinTargetTolerance: tierDistance <= tolerance,
    structurallySafe,
    accepted,
    loss,
  };
};

const compareEvaluations = (
  left: DynamicLayoutEvaluation,
  right: DynamicLayoutEvaluation,
): number => (
  Number(right.accepted) - Number(left.accepted)
  || Number(right.withinTargetTolerance) - Number(left.withinTargetTolerance)
  || left.loss - right.loss
  || hiddenLayoutKey(left.hidden).localeCompare(hiddenLayoutKey(right.hidden))
);

const createDynamicHiddenReport = (
  evaluation: DynamicLayoutEvaluation,
  profile: DynamicHiddenProfile,
  evaluatedCandidateCount: number,
  targetHiddenCount: number,
): DynamicHiddenGenerationReport => ({
  algorithmVersion: DYNAMIC_HIDDEN_ALGORITHM_VERSION,
  requestedDifficulty: profile.difficulty,
  targetHiddenCount,
  targetTierCounts: evaluation.targetTierCounts,
  actualTierCounts: evaluation.analysis.tierCounts,
  ambiguousStepCount: evaluation.analysis.ambiguousStepCount,
  unsafeTier0Count: evaluation.analysis.unsafeTier0Count,
  tier2OverRangeCount: evaluation.analysis.tier2OverRangeCount,
  longestTier2Run: evaluation.analysis.longestTier2Run,
  peakActualScore: evaluation.analysis.peakActualScore,
  evaluatedCandidateCount,
  tierDistance: evaluation.tierDistance,
  withinTargetTolerance: evaluation.withinTargetTolerance,
  accepted: evaluation.accepted,
  loss: Number(evaluation.loss.toFixed(4)),
});

const candidateRemovalOrder = (
  evaluation: DynamicLayoutEvaluation,
  random: () => number,
): number[] => {
  const surplusTier = [0, 1, 2].map((tier) => ({
    tier,
    surplus: evaluation.analysis.tierCounts[tier] - evaluation.targetTierCounts[tier],
  })).sort((left, right) => right.surplus - left.surplus || right.tier - left.tier)[0]?.tier ?? 0;
  const preferred = evaluation.analysis.steps
    .filter((step) => step.tier === surplusTier)
    .map((step) => step.targetIndex);
  const preferredSet = new Set(preferred);
  return [
    ...shuffleWith(preferred, random),
    ...shuffleWith(
      sortedHiddenIndices(evaluation.hidden).filter((index) => !preferredSet.has(index)),
      random,
    ),
  ];
};

/**
 * Generates a layout for a fixed path. The copied algorithm produces several
 * legal starting masks; exact 0/1/2-step analysis then guides deterministic
 * hide/show swaps toward the requested profile.
 */
export const generateDynamicHiddenLayout = (
  input: DynamicHiddenGenerationInput,
): DynamicHiddenGenerationResult => {
  const explicitTargetTierCounts = normalizeExplicitTierTargets(input.targetTierCounts);
  // Tier-count debugging is intentionally independent from the 1-10 selector.
  // A stable neutral profile supplies only the shared structural constraints.
  const profile = dynamicHiddenProfileForDifficulty(
    explicitTargetTierCounts === undefined ? input.targetDifficulty : 5,
  );
  const shape = editorShapeForBoardShape(input.boardShape);
  const explicitTargetHiddenCount = explicitTargetTierCounts?.reduce(
    (sum, count) => sum + count,
    0,
  );
  const hiddenPercent = explicitTargetHiddenCount === undefined
    ? input.hiddenPercent ?? profile.hiddenPercent
    : input.path.length === 0
      ? 0
      : explicitTargetHiddenCount / input.path.length * 100;
  const maxVisibleRun = input.maxVisibleRun ?? profile.maxVisibleRun;
  const maxHiddenRun = input.maxHiddenRun ?? profile.maxHiddenRun;
  const evaluations: DynamicLayoutEvaluation[] = [];
  const evaluatedKeys = new Set<string>();
  const evaluate = (hidden: Set<number>): void => {
    const key = hiddenLayoutKey(hidden);
    if (evaluatedKeys.has(key)) return;
    evaluatedKeys.add(key);
    evaluations.push(evaluateDynamicLayout(
      input,
      shape,
      hidden,
      profile,
      explicitTargetTierCounts,
    ));
  };

  const availableCount = Math.max(0, input.path.length - 2);
  const firstWindowCandidateCount = Math.max(0, Math.min(
    availableCount,
    profile.firstNumberWindow - 1,
  ));
  const maximumSelectableCount = availableCount
    - firstWindowCandidateCount
    + Math.min(profile.maxHiddenInFirstWindow, firstWindowCandidateCount);
  if (
    explicitTargetHiddenCount !== undefined
    && explicitTargetHiddenCount > maximumSelectableCount
  ) {
    evaluate(new Set<number>());
    const fallback = evaluations[0];
    return {
      hiddenIndices: [],
      report: createDynamicHiddenReport(
        fallback,
        profile,
        evaluations.length,
        explicitTargetHiddenCount,
      ),
    };
  }

  const explicitSearch = explicitTargetTierCounts !== undefined;
  const usesHardBoundarySafety = explicitSearch || input.safetyMode === 'hard-boundaries';
  const baseCandidateCount = explicitSearch
    ? input.path.length > 64 ? 8 : 12
    : profile.baseCandidateCount;
  for (let candidate = 0; candidate < baseCandidateCount; candidate += 1) {
    evaluate(selectDynamicHiddenBaseLayout(
      input.path,
      shape,
      hiddenPercent,
      profile.difficulty,
      input.seed ^ Math.imul(candidate + 1, 0x45d9f3b),
      {
        addTargetDifficultyPercent: false,
        maxVisibleRun,
        maxHiddenRun,
        firstNumberWindow: profile.firstNumberWindow,
        maxHiddenInFirstWindow: profile.maxHiddenInFirstWindow,
      },
    ));
    if (evaluations.some((evaluation) => evaluation.accepted)) break;
  }

  if (evaluations.length === 0) {
    evaluate(new Set<number>());
  }
  evaluations.sort(compareEvaluations);
  let best = evaluations[0];
  const random = createRandom(input.seed ^ 0x34c2a91d);
  const eligibleIndices = Array.from(
    { length: Math.max(0, input.path.length - 2) },
    (_value, index) => index + 1,
  );

  const localSearchRounds = explicitSearch
    ? input.path.length > 64 ? 4 : 6
    : profile.localSearchRounds;
  const explicitCandidateBudget = input.path.length > 64
    ? 28
    : input.path.length > 36
      ? 40
      : 64;
  for (let round = 0; round < localSearchRounds; round += 1) {
    const removalOrder = candidateRemovalOrder(best, random);
    const additionOrder = shuffleWith(
      eligibleIndices.filter((index) => !best.hidden.has(index)),
      random,
    );
    if (removalOrder.length === 0 || additionOrder.length === 0) break;
    const beforeCount = evaluations.length;
    const localCandidateCount = explicitSearch
      ? Math.min(explicitCandidateBudget, removalOrder.length * additionOrder.length)
      : profile.localCandidatesPerRound;
    const removalSpan = explicitSearch
      ? Math.min(removalOrder.length, Math.max(1, Math.ceil(Math.sqrt(localCandidateCount))))
      : removalOrder.length;
    const additionSpan = explicitSearch
      ? Math.min(additionOrder.length, Math.max(1, Math.ceil(localCandidateCount / removalSpan)))
      : additionOrder.length;
    for (let candidate = 0; candidate < localCandidateCount; candidate += 1) {
      const removeIndex = removalOrder[candidate % removalSpan];
      const addIndex = additionOrder[
        (Math.floor(candidate / removalSpan) + round) % additionSpan
      ];
      if (removeIndex === addIndex) continue;
      const mutated = new Set(best.hidden);
      mutated.delete(removeIndex);
      mutated.add(addIndex);
      const runState = calculateAlgorithm1RunState(input.path.length, mutated, maxVisibleRun);
      if (
        (!usesHardBoundarySafety && (
          runState.longestHiddenRun > maxHiddenRun
          || runState.longestVisibleRun > maxVisibleRun
        ))
        || sortedHiddenIndices(mutated).filter(
          (index) => index < profile.firstNumberWindow,
        ).length > profile.maxHiddenInFirstWindow
      ) continue;
      evaluate(mutated);
    }
    const localEvaluations = evaluations.slice(beforeCount).sort(compareEvaluations);
    if (localEvaluations[0] && compareEvaluations(localEvaluations[0], best) < 0) {
      best = localEvaluations[0];
    }
    if (best.accepted) break;
  }

  const report = createDynamicHiddenReport(
    best,
    profile,
    evaluations.length,
    explicitTargetHiddenCount ?? best.hidden.size,
  );
  return { hiddenIndices: sortedHiddenIndices(best.hidden), report };
};
