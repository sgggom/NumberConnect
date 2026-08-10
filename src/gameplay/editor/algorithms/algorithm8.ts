import { createRandom } from '../../../game/random';
import type { Cell } from '../../../game/types';
import type { EditorShape } from '../types';
import { generateAlgorithm2Path } from './algorithm2';
import type {
  Algorithm8Selection,
  EditorAlgorithmContext,
  EditorAlgorithmResult,
} from './types';

export interface Algorithm8SpatialMetrics {
  hiddenComponentCount: number;
  visibleComponentCount: number;
  largestHiddenComponentRatio: number;
  largestVisibleComponentRatio: number;
  mixedBoundaryRatio: number;
}

export interface Algorithm8ExperienceMetrics {
  averageDifficulty: number;
  hardStepRatio: number;
  peakDifficulty: number;
}

export const ALGORITHM8_MAX_HIDDEN_COMPONENT_RATIO = 0.4;
const ALGORITHM8_PREFERRED_HIDDEN_COMPONENT_RATIO = 0.25;

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

export const createAlgorithm8Selection = (): Algorithm8Selection => ({
  id: 'algorithm-8',
  parameters: {
    topology: 'board-shape',
    pathMode: 'spatial-distribution-multiple-solutions',
    targetCrossings: 20,
    turnProbability: 40,
    hiddenPercent: 35,
    targetDifficulty: 6,
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

export const calculateAlgorithm8SpatialMetrics = (
  path: ReadonlyArray<Cell>,
  hiddenIndices: ReadonlySet<number>,
  shape: EditorShape,
): Algorithm8SpatialMetrics => {
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

export const calculateAlgorithm8SpatialLoss = (
  metrics: Algorithm8SpatialMetrics,
): number => (
  metrics.largestHiddenComponentRatio * 4
  + metrics.largestVisibleComponentRatio * 1.5
  - metrics.mixedBoundaryRatio * 2
);

interface Algorithm8ReasoningBranches {
  branchCount: number;
  validFirstChoiceCount: number;
}

const countAlgorithm8ReasoningBranches = (
  startIndex: number,
  targetIndex: number,
  hiddenIndices: ReadonlySet<number>,
  neighbors: ReadonlyArray<ReadonlyArray<number>>,
): Algorithm8ReasoningBranches => {
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

const calculateAlgorithm8ExperienceMetricsWithNeighbors = (
  path: ReadonlyArray<Cell>,
  hiddenIndices: ReadonlySet<number>,
  neighbors: ReadonlyArray<ReadonlyArray<number>>,
): Algorithm8ExperienceMetrics => {
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
    const reasoning = countAlgorithm8ReasoningBranches(
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

export const calculateAlgorithm8ExperienceMetrics = (
  path: ReadonlyArray<Cell>,
  hiddenIndices: ReadonlySet<number>,
  shape: EditorShape,
): Algorithm8ExperienceMetrics => calculateAlgorithm8ExperienceMetricsWithNeighbors(
  path,
  hiddenIndices,
  buildVisualNeighborIndexes(path, shape),
);

export const calculateAlgorithm8ExperienceValue = (
  metrics: Algorithm8ExperienceMetrics,
): number => (
  metrics.averageDifficulty * 2.5
  + metrics.hardStepRatio * 2
  + metrics.peakDifficulty * 0.4
);

export const calculateAlgorithm8DifficultyLoss = (
  metrics: Algorithm8ExperienceMetrics,
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

export const algorithm8AdjacentExpansionProbability = (targetDifficulty: number): number => (
  normalizedDifficulty(targetDifficulty) * 0.85
);

export const algorithm8AdjacentExpansionCount = (
  expansionCount: number,
  targetDifficulty: number,
): number => {
  const normalizedCount = Math.max(0, Math.floor(expansionCount));
  return Math.round(
    normalizedCount * algorithm8AdjacentExpansionProbability(targetDifficulty),
  );
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

interface Algorithm8HiddenComponentState {
  componentByIndex: number[];
  componentSizes: number[];
  largestSize: number;
}

interface Algorithm8ProjectedSpatialMetrics {
  largestHiddenComponentRatio: number;
  mixedBoundaryRatio: number;
}

const buildHiddenComponentState = (
  hidden: ReadonlySet<number>,
  neighbors: ReadonlyArray<ReadonlyArray<number>>,
): Algorithm8HiddenComponentState => {
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
  componentState: Algorithm8HiddenComponentState,
  mixedBoundaryCount: number,
  edgeCount: number,
): Algorithm8ProjectedSpatialMetrics => {
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

/**
 * Selects exactly one new hidden number per pass using spatial rules only.
 * The first ten selections are neutral, distributed base cells. Remaining
 * selections use a difficulty-derived quota for expansion beside those bases,
 * prefer local ambiguity and longer clue distances, and reject oversized
 * hidden components. A seeded choice among equal-quality cells avoids rigid
 * patterns without making the requested difficulty depend on lucky rolls.
 */
export const selectAlgorithm8HiddenLayout = (
  path: ReadonlyArray<Cell>,
  shape: EditorShape,
  requestedPercent: number,
  targetDifficulty: number,
  seed: number,
  onProgress?: (progress: number) => void,
): Set<number> => {
  const availableCount = Math.max(0, path.length - 2);
  const normalizedPercent = Math.max(0, Math.min(100, requestedPercent));
  const targetCount = Math.min(
    availableCount,
    Math.max(0, Math.round(path.length * normalizedPercent / 100)),
  );
  const hidden = new Set<number>();
  const baseHidden = new Set<number>();
  const neighbors = buildVisualNeighborIndexes(path, shape);
  const random = createRandom(seed ^ 0x6f29d417);
  const baseSelectionCount = Math.min(10, targetCount);
  const expansionCount = Math.max(0, targetCount - baseSelectionCount);
  const adjacentExpansionCount = algorithm8AdjacentExpansionCount(
    expansionCount,
    targetDifficulty,
  );
  const edgeCount = neighbors.reduce((total, cellNeighbors) => (
    total + cellNeighbors.length
  ), 0) / 2;

  for (let pass = 0; pass < targetCount; pass += 1) {
    const allCandidates = Array.from(
      { length: availableCount },
      (_, offset) => offset + 1,
    ).filter((index) => !hidden.has(index));

    const progress = (pass + 1) / Math.max(1, targetCount);
    const isBaseSelection = pass < baseSelectionCount;
    let candidates = allCandidates;
    if (isBaseSelection) {
      const neutralCandidates = allCandidates.filter((candidate) => {
        const metrics = calculateAlgorithm8ExperienceMetricsWithNeighbors(
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
      ALGORITHM8_PREFERRED_HIDDEN_COMPONENT_RATIO,
    );
    const allDistributedCandidates = withinComponentRatio(
      allCandidates,
      ALGORITHM8_PREFERRED_HIDDEN_COMPONENT_RATIO,
    );
    const preferredClusterSafeCandidates = withinComponentRatio(
      candidates,
      ALGORITHM8_MAX_HIDDEN_COMPONENT_RATIO,
    );
    const allClusterSafeCandidates = withinComponentRatio(
      allCandidates,
      ALGORITHM8_MAX_HIDDEN_COMPONENT_RATIO,
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

    const evaluatedCandidates = candidates.map((candidate) => {
      const projected = new Set(hidden).add(candidate);
      const directHiddenCount = neighbors[candidate]
        .filter((neighbor) => hidden.has(neighbor)).length;
      const distance = minimumGraphDistance(candidate, hidden, neighbors);
      const projectedSpatial = projectedSpatialMetrics.get(candidate) as Algorithm8ProjectedSpatialMetrics;
      const spatialLoss = (
        projectedSpatial.largestHiddenComponentRatio * 4
        - projectedSpatial.mixedBoundaryRatio * 2
      );
      const experienceMetrics = calculateAlgorithm8ExperienceMetricsWithNeighbors(
        path,
        projected,
        neighbors,
      );
      const difficultyLoss = calculateAlgorithm8DifficultyLoss(
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
      const baseLoss = (
            spatialLoss * 1.2
            + directHiddenCount * 8
            + secondRingHiddenCount(candidate, hidden, neighbors) * 1.5
            - distance * 0.8
      );
      return {
        candidate,
        baseLoad,
        baseLoss,
        difficultyLoss,
        directHiddenCount,
        distance,
        experienceValue: calculateAlgorithm8ExperienceValue(experienceMetrics),
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
    onProgress?.((pass + 1) / Math.max(1, targetCount));
  }

  if (targetCount === 0) onProgress?.(1);
  return hidden;
};

export const runAlgorithm8 = (
  context: EditorAlgorithmContext,
  selection: Algorithm8Selection,
): EditorAlgorithmResult | null => {
  const fixedPath = context.fixedPath?.map((cell) => ({ ...cell }));
  const pathProgressWeight = fixedPath ? 0 : 0.34;
  const path = fixedPath ?? generateAlgorithm2Path({
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
  const hiddenIndices = selectAlgorithm8HiddenLayout(
    path,
    context.shape,
    selection.parameters.hiddenPercent,
    selection.parameters.targetDifficulty,
    seed,
    (progress) => context.onProgress?.(
      pathProgressWeight + progress * (1 - pathProgressWeight),
    ),
  );
  context.onProgress?.(1);
  return {
    path,
    hiddenCells: [...hiddenIndices].map((index) => ({ ...path[index] })),
    targetHiddenCount: hiddenIndices.size,
  };
};
