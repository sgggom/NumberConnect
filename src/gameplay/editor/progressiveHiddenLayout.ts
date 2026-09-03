import { createRandom } from '../../game/random';
import type { EditorCell, EditorShape } from './types';

const DOUBLE_RUN_LIMITS = [0, 1, 1, 1, 2, 2, 2, 2, 2, 3] as const;
const TRIPLE_RUN_LIMITS = [0, 0, 0, 0, 0, 0, 0, 1, 1, 2] as const;
const EXTRA_HIDDEN_PERCENTAGES = [0, 3, 6, 9, 12, 15, 18, 21, 24, 27] as const;

export interface ProgressiveHiddenLayoutOptions {
  path: ReadonlyArray<EditorCell>;
  segmentLengthMin: number;
  segmentLengthMax: number;
  difficulty: number;
  seed: number;
  maxVisibleRun: number;
  shape?: EditorShape;
  deadlineAt?: number;
  previousHiddenCells?: ReadonlyArray<EditorCell>;
}

export interface ProgressiveHiddenRunLimits {
  doubleRuns: number;
  tripleRuns: number;
}

export interface ProgressiveHiddenSegment {
  start: number;
  end: number;
  length: number;
}

const normalizedDifficulty = (difficulty: number): number => (
  Math.max(1, Math.min(10, Math.floor(difficulty)))
);

const ensureBeforeDeadline = (deadlineAt?: number): void => {
  if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
    const error = new Error('隐藏难度链生成超时。');
    error.name = 'ProgressiveHiddenTimeoutError';
    throw error;
  }
};

export const progressiveHiddenExtraCount = (
  pathLength: number,
  difficulty: number,
): number => {
  const percentage = EXTRA_HIDDEN_PERCENTAGES[normalizedDifficulty(difficulty) - 1];
  return Math.ceil(Math.max(0, Math.floor(pathLength)) * percentage / 100);
};

export const progressiveHiddenRunLimits = (
  difficulty: number,
): ProgressiveHiddenRunLimits => {
  const index = normalizedDifficulty(difficulty) - 1;
  return {
    doubleRuns: DOUBLE_RUN_LIMITS[index],
    tripleRuns: TRIPLE_RUN_LIMITS[index],
  };
};

const normalizedSegmentLengths = (
  minimum: number,
  maximum: number,
): { minimum: number; maximum: number } => {
  const first = Math.max(1, Math.floor(minimum));
  const second = Math.max(1, Math.floor(maximum));
  return { minimum: Math.min(first, second), maximum: Math.max(first, second) };
};

export const createProgressiveHiddenSegments = (
  pathLength: number,
  segmentLengthMin: number,
  segmentLengthMax: number,
  seed: number,
): ProgressiveHiddenSegment[] => {
  const length = Math.max(0, Math.floor(pathLength));
  if (length === 0) return [];
  const { minimum, maximum } = normalizedSegmentLengths(segmentLengthMin, segmentLengthMax);
  if (length < minimum) return [{ start: 0, end: length, length }];

  const minimumSegments = Math.ceil(length / maximum);
  const maximumSegments = Math.floor(length / minimum);
  if (minimumSegments > maximumSegments) {
    throw new Error(`路径长度 ${length} 无法按分段长度区间 [${minimum},${maximum}] 完整分段。`);
  }

  const random = createRandom(seed ^ 0x2e95a1d3);
  const segmentCount = minimumSegments + Math.floor(
    random() * (maximumSegments - minimumSegments + 1),
  );
  const lengths = Array.from({ length: segmentCount }, () => minimum);
  let remaining = length - segmentCount * minimum;
  const order = Array.from({ length: segmentCount }, (_, index) => index)
    .map((index) => ({ index, order: random() }))
    .sort((left, right) => left.order - right.order)
    .map(({ index }) => index);
  while (remaining > 0) {
    let changed = false;
    for (const index of order) {
      if (remaining === 0) break;
      const capacity = maximum - lengths[index];
      if (capacity <= 0) continue;
      const addition = Math.min(capacity, remaining, 1 + Math.floor(random() * capacity));
      lengths[index] += addition;
      remaining -= addition;
      changed = true;
    }
    if (!changed) break;
  }

  let start = 0;
  return lengths.map((segmentLength) => {
    const segment = { start, end: start + segmentLength, length: segmentLength };
    start = segment.end;
    return segment;
  });
};

const keyOf = (cell: EditorCell): string => `${cell.x},${cell.y}`;

const spatialNeighborCells = (cell: EditorCell, shape: EditorShape): EditorCell[] => {
  if (shape === 'hex') {
    const offsets = cell.x % 2 === 0
      ? [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]]
      : [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]];
    return offsets.map(([x, y]) => ({ x: cell.x + x, y: cell.y + y }));
  }
  return [-1, 0, 1].flatMap((x) => [-1, 0, 1].flatMap((y) => (
    x === 0 && y === 0 ? [] : [{ x: cell.x + x, y: cell.y + y }]
  )));
};

const buildSpatialNeighborIndexes = (
  path: ReadonlyArray<EditorCell>,
  shape: EditorShape,
): number[][] => {
  const indexByKey = new Map(path.map((cell, index) => [keyOf(cell), index]));
  return path.map((cell) => spatialNeighborCells(cell, shape).flatMap((neighbor) => {
    const index = indexByKey.get(keyOf(neighbor));
    return index === undefined ? [] : [index];
  }));
};

const runLengths = (pathLength: number, hidden: ReadonlySet<number>): number[] => {
  const lengths: number[] = [];
  let current = 0;
  for (let index = 0; index < pathLength; index += 1) {
    if (hidden.has(index)) {
      current += 1;
    } else if (current > 0) {
      lengths.push(current);
      current = 0;
    }
  }
  if (current > 0) lengths.push(current);
  return lengths;
};

const longestVisibleRun = (pathLength: number, hidden: ReadonlySet<number>): number => {
  let longest = 0;
  let current = 0;
  for (let index = 0; index < pathLength; index += 1) {
    if (hidden.has(index)) current = 0;
    else {
      current += 1;
      longest = Math.max(longest, current);
    }
  }
  return longest;
};

const selectSegmentBaseHidden = (
  pathLength: number,
  segments: ReadonlyArray<ProgressiveHiddenSegment>,
  maxVisibleRun: number,
  random: () => number,
  deadlineAt?: number,
): Set<number> | undefined => {
  const hidden = new Set<number>();
  let previousHiddenIndex: number | undefined;
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    ensureBeforeDeadline(deadlineAt);
    const segment = segments[segmentIndex];
    const candidates = Array.from({ length: segment.length }, (_, offset) => segment.start + offset)
      .filter((index) => index > 0 && index < pathLength - 1)
      .filter((index) => previousHiddenIndex === undefined
        ? index <= maxVisibleRun
        : index - previousHiddenIndex - 1 <= maxVisibleRun && index - previousHiddenIndex > 1)
      .filter((index) => segmentIndex < segments.length - 1 || pathLength - index - 1 <= maxVisibleRun);
    if (candidates.length === 0) return undefined;
    const selected = candidates[Math.floor(random() * candidates.length)];
    hidden.add(selected);
    previousHiddenIndex = selected;
  }
  return longestVisibleRun(pathLength, hidden) <= maxVisibleRun ? hidden : undefined;
};

const validDifficultyCandidates = (
  pathLength: number,
  source: ReadonlySet<number>,
  difficulty: number,
  extraHiddenStartIndex: number,
): { continuous: number[]; isolated: number[] } => {
  const limits = progressiveHiddenRunLimits(difficulty);
  const hidden = new Set(source);
  const valid = Array.from({ length: Math.max(0, pathLength - 2) }, (_, offset) => offset + 1)
    .filter((index) => index >= extraHiddenStartIndex)
    .filter((index) => !hidden.has(index))
    .filter((candidate) => {
      const lengths = runLengths(pathLength, new Set(hidden).add(candidate));
      return Math.max(0, ...lengths) <= 3
        && lengths.filter((length) => length === 2).length <= limits.doubleRuns
        && lengths.filter((length) => length === 3).length <= limits.tripleRuns;
    });
  return {
    continuous: valid.filter((index) => hidden.has(index - 1) || hidden.has(index + 1)),
    isolated: valid.filter((index) => !hidden.has(index - 1) && !hidden.has(index + 1)),
  };
};

const compareDispersion = (
  left: number,
  right: number,
  hidden: ReadonlySet<number>,
): number => {
  const leftDistances = [...hidden].map((index) => Math.abs(left - index)).sort((a, b) => a - b);
  const rightDistances = [...hidden].map((index) => Math.abs(right - index)).sort((a, b) => a - b);
  for (let index = 0; index < leftDistances.length; index += 1) {
    if (leftDistances[index] !== rightDistances[index]) {
      return rightDistances[index] - leftDistances[index];
    }
  }
  return 0;
};

const spatialAmbiguityScore = (
  candidate: number,
  hidden: ReadonlySet<number>,
  neighbors: ReadonlyArray<ReadonlyArray<number>>,
): readonly [maximumHiddenChoices: number, multipleChoiceNeighbors: number, totalHiddenChoices: number] => {
  const affectedVisibleLoads = neighbors[candidate]
    .filter((index) => !hidden.has(index))
    .map((index) => 1 + neighbors[index].filter((neighbor) => hidden.has(neighbor)).length);
  return [
    Math.max(0, ...affectedVisibleLoads),
    affectedVisibleLoads.filter((load) => load > 1).length,
    affectedVisibleLoads.reduce((sum, load) => sum + load, 0),
  ];
};

const randomizedByDispersion = (
  values: ReadonlyArray<number>,
  hidden: ReadonlySet<number>,
  spatialNeighbors: ReadonlyArray<ReadonlyArray<number>>,
  random: () => number,
): number[] => values
  .map((candidate) => ({
    candidate,
    spatialScore: spatialAmbiguityScore(candidate, hidden, spatialNeighbors),
    order: random(),
  }))
  .sort((left, right) => {
    for (let index = 0; index < left.spatialScore.length; index += 1) {
      const difference = left.spatialScore[index] - right.spatialScore[index];
      if (difference !== 0) return difference;
    }
    return compareDispersion(left.candidate, right.candidate, hidden) || left.order - right.order;
  })
  .map(({ candidate }) => candidate);

const addDifficultyHidden = (
  pathLength: number,
  source: ReadonlySet<number>,
  difficulty: number,
  extraHiddenStartIndex: number,
  spatialNeighbors: ReadonlyArray<ReadonlyArray<number>>,
  random: () => number,
  deadlineAt?: number,
): Set<number> => {
  ensureBeforeDeadline(deadlineAt);
  const hidden = new Set(source);
  const { continuous, isolated } = validDifficultyCandidates(
    pathLength,
    hidden,
    difficulty,
    extraHiddenStartIndex,
  );
  const ordered = [
    ...randomizedByDispersion(continuous, hidden, spatialNeighbors, random),
    ...randomizedByDispersion(isolated, hidden, spatialNeighbors, random),
  ];
  if (ordered.length === 0) throw new Error(`难度 ${difficulty} 无法在连续隐藏限制内增加额外隐藏数字。`);
  const selected = ordered[0];
  hidden.add(selected);
  return hidden;
};

const addDifficultyHiddenToTarget = (
  pathLength: number,
  source: ReadonlySet<number>,
  difficulty: number,
  targetCount: number,
  extraHiddenStartIndex: number,
  spatialNeighbors: ReadonlyArray<ReadonlyArray<number>>,
  random: () => number,
  deadlineAt?: number,
): Set<number> => {
  let hidden = new Set(source);
  while (hidden.size < targetCount) {
    hidden = addDifficultyHidden(
      pathLength,
      hidden,
      difficulty,
      extraHiddenStartIndex,
      spatialNeighbors,
      random,
      deadlineAt,
    );
  }
  return hidden;
};

export const createProgressiveHiddenLayout = ({
  path,
  segmentLengthMin,
  segmentLengthMax,
  difficulty,
  seed,
  maxVisibleRun,
  shape = 'square',
  deadlineAt,
  previousHiddenCells,
}: ProgressiveHiddenLayoutOptions): EditorCell[] => {
  ensureBeforeDeadline(deadlineAt);
  const level = normalizedDifficulty(difficulty);
  const segments = createProgressiveHiddenSegments(path.length, segmentLengthMin, segmentLengthMax, seed);
  const baseCount = segments.length;
  const extraHiddenStartIndex = segments[0]?.end ?? path.length;
  const spatialNeighbors = buildSpatialNeighborIndexes(path, shape);
  const indexByKey = new Map(path.map((cell, index) => [keyOf(cell), index]));
  const previous = previousHiddenCells?.map((cell) => indexByKey.get(keyOf(cell)));
  if (previous?.some((index) => index === undefined)) {
    throw new Error('上一档隐藏布局包含不在当前路径中的格子。');
  }
  const random = createRandom(seed ^ 0x51f15e5d ^ Math.imul(level + 1, 104729));
  let hidden: Set<number>;
  if (previous) hidden = new Set(previous as number[]);
  else {
    let base: Set<number> | undefined;
    for (let attempt = 0; attempt < 32 && !base; attempt += 1) {
      const candidate = selectSegmentBaseHidden(
        path.length,
        segments,
        maxVisibleRun,
        createRandom(seed ^ 0x6f29d417 ^ Math.imul(attempt + 1, 2654435761)),
        deadlineAt,
      );
      if (candidate) base = candidate;
    }
    if (!base) {
      throw new Error(
        `无法按分段长度区间 [${segmentLengthMin},${segmentLengthMax}] 为每段放置一个基础隐藏。`,
      );
    }
    hidden = base;
  }
  const expectedPreviousCount = baseCount + progressiveHiddenExtraCount(path.length, level - 1);
  if (previous && hidden.size !== expectedPreviousCount) {
    throw new Error(`难度 ${level} 需要继承 ${expectedPreviousCount} 个隐藏数字，实际为 ${hidden.size} 个。`);
  }
  if (!previous) {
    for (let currentDifficulty = 2; currentDifficulty <= level; currentDifficulty += 1) {
      hidden = addDifficultyHiddenToTarget(
        path.length,
        hidden,
        currentDifficulty,
        baseCount + progressiveHiddenExtraCount(path.length, currentDifficulty),
        extraHiddenStartIndex,
        spatialNeighbors,
        createRandom(seed ^ Math.imul(currentDifficulty + 1, 104729)),
        deadlineAt,
      );
    }
  } else if (level > 1) {
    hidden = addDifficultyHiddenToTarget(
      path.length,
      hidden,
      level,
      baseCount + progressiveHiddenExtraCount(path.length, level),
      extraHiddenStartIndex,
      spatialNeighbors,
      random,
      deadlineAt,
    );
  }
  return [...hidden].sort((left, right) => left - right).map((index) => ({ ...path[index] }));
};

export const progressiveHiddenRunCounts = (
  path: ReadonlyArray<EditorCell>,
  hiddenCells: ReadonlyArray<EditorCell>,
): { singleRuns: number; doubleRuns: number; tripleRuns: number } => {
  const hiddenKeys = new Set(hiddenCells.map(keyOf));
  const lengths = runLengths(path.length, new Set(path.flatMap((cell, index) => (
    hiddenKeys.has(keyOf(cell)) ? [index] : []
  ))));
  return {
    singleRuns: lengths.filter((length) => length === 1).length,
    doubleRuns: lengths.filter((length) => length === 2).length,
    tripleRuns: lengths.filter((length) => length === 3).length,
  };
};
