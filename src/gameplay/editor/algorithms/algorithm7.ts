import { PathCompletionSolver } from '../../../game/pathCompletionSolver';
import { createRandom } from '../../../game/random';
import { BoardShape, type Cell } from '../../../game/types';
import {
  simulateLevelPlay,
  type SimulatedPlayResult,
} from '../simulateLevelPlay';
import { areEditorCellsNeighbors } from '../findEditorPath';
import type { EditorShape } from '../types';
import { generateAlgorithm2Path } from './algorithm2';
import type {
  Algorithm7Selection,
  EditorAlgorithmContext,
  EditorAlgorithmResult,
} from './types';

export interface Algorithm7DifficultyMetrics {
  averageScore: number;
  percentile80Score: number;
  peakScore: number;
  errorRate: number;
  hardStepRatio: number;
  earlyScore: number;
  middleScore: number;
  lateScore: number;
}

export interface Algorithm7SpatialMetrics {
  hiddenComponentCount: number;
  visibleComponentCount: number;
  largestHiddenComponentRatio: number;
  largestVisibleComponentRatio: number;
  mixedBoundaryRatio: number;
}

export interface Algorithm7OptimizedLayout {
  hiddenIndices: Set<number>;
  metrics: Algorithm7DifficultyMetrics;
  spatialMetrics: Algorithm7SpatialMetrics;
  loss: number;
}

interface DifficultyTarget {
  averageScore: number;
  percentile80Score: number;
  peakScore: number;
  errorRate: number;
  hardStepRatio: number;
}

const DIFFICULTY_TARGETS: readonly DifficultyTarget[] = [
  { averageScore: 0.02, percentile80Score: 0, peakScore: 0.4, errorRate: 0, hardStepRatio: 0.03 },
  { averageScore: 0.12, percentile80Score: 0.5, peakScore: 1.2, errorRate: 0.03, hardStepRatio: 0.12 },
  { averageScore: 0.32, percentile80Score: 1, peakScore: 2, errorRate: 0.08, hardStepRatio: 0.24 },
  { averageScore: 0.62, percentile80Score: 1.5, peakScore: 3, errorRate: 0.15, hardStepRatio: 0.36 },
  { averageScore: 1, percentile80Score: 2.2, peakScore: 4, errorRate: 0.24, hardStepRatio: 0.5 },
];

export const createAlgorithm7Selection = (): Algorithm7Selection => ({
  id: 'algorithm-7',
  parameters: {
    topology: 'board-shape',
    pathMode: 'difficulty-inversion-multiple-solutions',
    targetCrossings: 20,
    turnProbability: 40,
    targetDifficulty: 3,
    searchIterations: 8,
    minimumHiddenPercent: 30,
    maximumHiddenPercent: 75,
    maxHiddenRun: 5,
    maxVisibleRun: 6,
  },
});

const boardShapeFor = (shape: EditorShape): BoardShape => {
  if (shape === 'diamond') return BoardShape.Diamond;
  if (shape === 'rectangle') return BoardShape.Rectangle;
  if (shape === 'hex') return BoardShape.Hex;
  return BoardShape.Square;
};

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

export const calculateAlgorithm7SpatialMetrics = (
  path: ReadonlyArray<Cell>,
  hiddenIndices: ReadonlySet<number>,
  shape: EditorShape,
): Algorithm7SpatialMetrics => {
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

export const calculateAlgorithm7SpatialLoss = (
  metrics: Algorithm7SpatialMetrics,
): number => (
  Math.max(0, metrics.largestHiddenComponentRatio - 0.45) * 3
  + Math.max(0, metrics.largestVisibleComponentRatio - 0.45) * 3
  + Math.max(0, 0.38 - metrics.mixedBoundaryRatio) * 2
);

const percentile = (values: ReadonlyArray<number>, ratio: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
};

const average = (values: ReadonlyArray<number>): number => (
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
);

const phaseAverage = (
  values: ReadonlyArray<number>,
  startRatio: number,
  endRatio: number,
): number => {
  const start = Math.floor(values.length * startRatio);
  const end = Math.max(start + 1, Math.ceil(values.length * endRatio));
  return average(values.slice(start, end));
};

export const summarizeAlgorithm7Difficulty = (
  simulation: SimulatedPlayResult,
): Algorithm7DifficultyMetrics => {
  const scores = simulation.steps.map((step) => step.difficultyScore);
  return {
    averageScore: average(scores),
    percentile80Score: percentile(scores, 0.8),
    peakScore: scores.length === 0 ? 0 : Math.max(...scores),
    errorRate: simulation.errorCount / Math.max(1, simulation.totalSteps),
    hardStepRatio: scores.filter((score) => score >= 1).length / Math.max(1, scores.length),
    earlyScore: phaseAverage(scores, 0, 0.25),
    middleScore: phaseAverage(scores, 0.25, 0.75),
    lateScore: phaseAverage(scores, 0.75, 1),
  };
};

const summarizeStructuralDifficulty = (
  path: ReadonlyArray<Cell>,
  hiddenIndices: ReadonlySet<number>,
  shape: EditorShape,
): Algorithm7DifficultyMetrics => {
  const scores: number[] = [];
  const errorProbabilities: number[] = [];
  for (let index = 0; index < path.length - 1; index += 1) {
    if (!hiddenIndices.has(index + 1)) {
      scores.push(0);
      errorProbabilities.push(0);
      continue;
    }
    const candidates = path.slice(index + 1).filter((cell, offset) => (
      hiddenIndices.has(index + 1 + offset)
      && areEditorCellsNeighbors(path[index], cell, shape)
    ));
    let nextVisibleIndex = index + 1;
    while (nextVisibleIndex < path.length - 1 && hiddenIndices.has(nextVisibleIndex)) {
      nextVisibleIndex += 1;
    }
    const wrongCandidateCount = Math.max(0, candidates.length - 1);
    const clueDistance = Math.max(1, nextVisibleIndex - index);
    const score = wrongCandidateCount === 0
      ? 0
      : Math.min(5, 1 + (wrongCandidateCount - 1) * 0.25 + Math.max(0, clueDistance - 2) * 0.15);
    scores.push(Number(score.toFixed(2)));
    errorProbabilities.push(wrongCandidateCount / Math.max(1, candidates.length));
  }
  return {
    averageScore: average(scores),
    percentile80Score: percentile(scores, 0.8),
    peakScore: scores.length === 0 ? 0 : Math.max(...scores),
    errorRate: average(errorProbabilities),
    hardStepRatio: scores.filter((score) => score >= 1).length / Math.max(1, scores.length),
    earlyScore: phaseAverage(scores, 0, 0.25),
    middleScore: phaseAverage(scores, 0.25, 0.75),
    lateScore: phaseAverage(scores, 0.75, 1),
  };
};

const normalizedDistance = (actual: number, target: number, scale: number): number => (
  Math.abs(actual - target) / Math.max(0.05, scale)
);

export const calculateAlgorithm7DifficultyLoss = (
  metrics: Algorithm7DifficultyMetrics,
  targetDifficulty: number,
): number => {
  const level = Math.max(1, Math.min(5, Math.floor(targetDifficulty)));
  const target = DIFFICULTY_TARGETS[level - 1];
  const targetPhase = Math.max(0.05, target.averageScore);
  const profilePenalty = (
    normalizedDistance(metrics.earlyScore, targetPhase * 0.7, 0.5)
    + normalizedDistance(metrics.middleScore, targetPhase * 1.25, 0.7)
    + normalizedDistance(metrics.lateScore, targetPhase * 0.85, 0.5)
  ) * 0.12;
  return (
    normalizedDistance(metrics.averageScore, target.averageScore, 0.5) * 0.22
    + normalizedDistance(metrics.percentile80Score, target.percentile80Score, 1) * 0.22
    + normalizedDistance(metrics.peakScore, target.peakScore, 1.5) * 0.12
    + normalizedDistance(metrics.errorRate, target.errorRate, 0.12) * 0.24
    + normalizedDistance(metrics.hardStepRatio, target.hardStepRatio, 0.2) * 0.2
    + profilePenalty
  );
};

const hiddenPercent = (hiddenIndices: ReadonlySet<number>, pathCount: number): number => (
  hiddenIndices.size * 100 / Math.max(1, pathCount)
);

const hiddenRunAt = (hidden: ReadonlySet<number>, index: number): number => {
  let run = hidden.has(index) ? 1 : 0;
  for (let cursor = index - 1; cursor >= 0 && hidden.has(cursor); cursor -= 1) run += 1;
  for (let cursor = index + 1; hidden.has(cursor); cursor += 1) run += 1;
  return run;
};

const canAddHidden = (
  hidden: ReadonlySet<number>,
  index: number,
  pathCount: number,
  maxHiddenRun: number,
): boolean => (
  index > 0
  && index < pathCount - 1
  && !hidden.has(index)
  && hiddenRunAt(new Set([...hidden, index]), index) <= maxHiddenRun
);

const repairRuns = (
  source: ReadonlySet<number>,
  pathCount: number,
  maxHiddenRun: number,
  maxVisibleRun: number,
): Set<number> => {
  const hidden = new Set([...source].filter((index) => index > 0 && index < pathCount - 1));
  let hiddenRun = 0;
  for (let index = 0; index < pathCount; index += 1) {
    if (!hidden.has(index)) {
      hiddenRun = 0;
      continue;
    }
    hiddenRun += 1;
    if (hiddenRun > maxHiddenRun) {
      hidden.delete(index);
      hiddenRun = 0;
    }
  }

  for (let pass = 0; pass < pathCount; pass += 1) {
    let runStart = 0;
    let repaired = false;
    for (let index = 0; index <= pathCount; index += 1) {
      if (index < pathCount && !hidden.has(index)) continue;
      const runLength = index - runStart;
      if (runLength > maxVisibleRun) {
        const preferred = Math.min(index - 1, runStart + maxVisibleRun);
        const candidates = Array.from(
          { length: Math.max(0, index - runStart) },
          (_, offset) => preferred - offset,
        );
        const candidate = candidates.find((value) => (
          value >= runStart
          && canAddHidden(hidden, value, pathCount, maxHiddenRun)
        ));
        if (candidate !== undefined) {
          hidden.add(candidate);
          repaired = true;
          break;
        }
      }
      runStart = index + 1;
    }
    if (!repaired) break;
  }
  return hidden;
};

const createInitialLayout = (
  path: ReadonlyArray<Cell>,
  shape: EditorShape,
  selection: Algorithm7Selection,
  random: () => number,
): Set<number> => {
  const pathCount = path.length;
  const levelRatio = (selection.parameters.targetDifficulty - 1) / 4;
  const targetPercent = selection.parameters.minimumHiddenPercent
    + (selection.parameters.maximumHiddenPercent - selection.parameters.minimumHiddenPercent)
      * (0.3 + levelRatio * 0.55);
  const hidden = new Set<number>();
  const neighbors = buildVisualNeighborIndexes(path, shape);
  for (let index = 1; index < pathCount - 1; index += 1) {
    const assignedNeighbors = neighbors[index].filter((neighbor) => neighbor < index);
    const hiddenNeighborCount = assignedNeighbors.reduce(
      (count, neighbor) => count + Number(hidden.has(neighbor)),
      0,
    );
    const visibleNeighborCount = assignedNeighbors.length - hiddenNeighborCount;
    const spatiallyAdjustedPercent = Math.max(
      5,
      Math.min(95, targetPercent + (visibleNeighborCount - hiddenNeighborCount) * 12),
    );
    if (random() * 100 < spatiallyAdjustedPercent) hidden.add(index);
  }
  return repairRuns(
    hidden,
    pathCount,
    selection.parameters.maxHiddenRun,
    selection.parameters.maxVisibleRun,
  );
};

const mutateLayout = (
  source: ReadonlySet<number>,
  path: ReadonlyArray<Cell>,
  shape: EditorShape,
  selection: Algorithm7Selection,
  random: () => number,
): Set<number> => {
  const pathCount = path.length;
  const hidden = new Set(source);
  const interiorCount = Math.max(0, pathCount - 2);
  if (interiorCount === 0) return hidden;
  const randomInterior = (): number => 1 + Math.floor(random() * interiorCount);
  const mutation = random();
  if (mutation < 0.25) {
    const index = randomInterior();
    if (hidden.has(index)) hidden.delete(index);
    else hidden.add(index);
  } else if (mutation < 0.55) {
    const hiddenValues = [...hidden];
    const visibleValues = Array.from(
      { length: interiorCount },
      (_, offset) => offset + 1,
    ).filter((index) => !hidden.has(index));
    if (hiddenValues.length > 0) {
      hidden.delete(hiddenValues[Math.floor(random() * hiddenValues.length)]);
    }
    if (visibleValues.length > 0) {
      hidden.add(visibleValues[Math.floor(random() * visibleValues.length)]);
    }
  } else {
    const neighbors = buildVisualNeighborIndexes(path, shape);
    const sameStateNeighborCount = (index: number): number => neighbors[index].reduce(
      (count, neighbor) => count + Number(hidden.has(index) === hidden.has(neighbor)),
      0,
    );
    const denseHidden = [...hidden]
      .sort((left, right) => sameStateNeighborCount(right) - sameStateNeighborCount(left));
    const denseVisible = Array.from(
      { length: interiorCount },
      (_, offset) => offset + 1,
    )
      .filter((index) => !hidden.has(index))
      .sort((left, right) => sameStateNeighborCount(right) - sameStateNeighborCount(left));
    const selectDense = (values: ReadonlyArray<number>): number | undefined => {
      const poolSize = Math.max(1, Math.min(values.length, Math.ceil(Math.sqrt(values.length))));
      return values[Math.floor(random() * poolSize)];
    };
    const hiddenToShow = selectDense(denseHidden);
    const visibleToHide = selectDense(denseVisible);
    if (hiddenToShow !== undefined) hidden.delete(hiddenToShow);
    if (visibleToHide !== undefined) hidden.add(visibleToHide);
  }

  let repaired = repairRuns(
    hidden,
    pathCount,
    selection.parameters.maxHiddenRun,
    selection.parameters.maxVisibleRun,
  );
  const minimumCount = Math.round(pathCount * selection.parameters.minimumHiddenPercent / 100);
  const maximumCount = Math.round(pathCount * selection.parameters.maximumHiddenPercent / 100);
  for (let attempt = 0; repaired.size < minimumCount && attempt < pathCount * 2; attempt += 1) {
    const index = randomInterior();
    if (canAddHidden(repaired, index, pathCount, selection.parameters.maxHiddenRun)) {
      repaired.add(index);
    }
  }
  while (repaired.size > maximumCount && repaired.size > 0) {
    const values = [...repaired];
    repaired.delete(values[Math.floor(random() * values.length)]);
  }
  return repairRuns(
    repaired,
    pathCount,
    selection.parameters.maxHiddenRun,
    selection.parameters.maxVisibleRun,
  );
};

const layoutSeed = (hiddenIndices: ReadonlySet<number>, baseSeed: number): number => {
  let result = baseSeed >>> 0;
  [...hiddenIndices].sort((left, right) => left - right).forEach((index) => {
    result = Math.imul(result ^ index, 16777619) >>> 0;
  });
  return result;
};

export const optimizeAlgorithm7HiddenLayout = (
  path: ReadonlyArray<Cell>,
  shape: EditorShape,
  selection: Algorithm7Selection,
  seed: number,
  onProgress?: (progress: number) => void,
): Algorithm7OptimizedLayout => {
  const random = createRandom(seed ^ 0x6f29d417);
  const usesExactSimulation = path.length <= 64;
  const completionSolver = usesExactSimulation
    ? new PathCompletionSolver([...path], boardShapeFor(shape))
    : undefined;
  const evaluate = (hiddenIndices: Set<number>): Algorithm7OptimizedLayout => {
    const metrics = completionSolver
      ? summarizeAlgorithm7Difficulty(simulateLevelPlay({
          path,
          hiddenCellKeys: new Set([...hiddenIndices].map((index) => keyOf(path[index]))),
          shape,
          reasoningLevel: 'medium',
          random: createRandom(layoutSeed(hiddenIndices, seed)),
          completionSolver,
        }))
      : summarizeStructuralDifficulty(path, hiddenIndices, shape);
    const percent = hiddenPercent(hiddenIndices, path.length);
    const spatialMetrics = calculateAlgorithm7SpatialMetrics(path, hiddenIndices, shape);
    const percentPenalty = percent < selection.parameters.minimumHiddenPercent
      ? (selection.parameters.minimumHiddenPercent - percent) / 10
      : percent > selection.parameters.maximumHiddenPercent
        ? (percent - selection.parameters.maximumHiddenPercent) / 10
        : 0;
    return {
      hiddenIndices: new Set(hiddenIndices),
      metrics,
      spatialMetrics,
      loss: calculateAlgorithm7DifficultyLoss(
        metrics,
        selection.parameters.targetDifficulty,
      ) + calculateAlgorithm7SpatialLoss(spatialMetrics) + percentPenalty,
    };
  };

  let current = evaluate(createInitialLayout(path, shape, selection, random));
  let best = current;
  const iterations = Math.max(1, Math.floor(selection.parameters.searchIterations));
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const candidateLayout = iteration > 0 && iteration % 6 === 0
      ? createInitialLayout(path, shape, selection, random)
      : mutateLayout(current.hiddenIndices, path, shape, selection, random);
    const candidate = evaluate(candidateLayout);
    if (candidate.loss < best.loss) best = candidate;
    const temperature = Math.max(0.08, 1 - iteration / iterations);
    if (
      candidate.loss <= current.loss
      || random() < Math.exp((current.loss - candidate.loss) / temperature)
    ) {
      current = candidate;
    }
    onProgress?.((iteration + 1) / iterations);
  }
  return best;
};

export const runAlgorithm7 = (
  context: EditorAlgorithmContext,
  selection: Algorithm7Selection,
): EditorAlgorithmResult | null => {
  const path = generateAlgorithm2Path({
    ...context,
    searchMode: context.activeCells.size > 81 ? 'realtime' : context.searchMode,
    onProgress: (progress) => context.onProgress?.(progress * 0.34),
  }, selection.parameters);
  if (!path) return null;
  context.onProgress?.(0.34);

  const seed = Math.imul(context.generationIndex + 1, 104729)
    ^ Math.imul(context.rows + 1, 73856093)
    ^ Math.imul(context.columns + 1, 19349663)
    ^ path.length
    ^ 0x2b7e1516;
  const optimized = optimizeAlgorithm7HiddenLayout(
    path,
    context.shape,
    selection,
    seed,
    (progress) => context.onProgress?.(0.34 + progress * 0.66),
  );
  context.onProgress?.(1);
  return {
    path,
    hiddenCells: [...optimized.hiddenIndices].map((index) => ({ ...path[index] })),
    targetHiddenCount: optimized.hiddenIndices.size,
  };
};
