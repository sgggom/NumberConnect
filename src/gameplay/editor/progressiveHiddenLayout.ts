import { createRandom } from '../../game/random';
import type { EditorCell } from './types';

const DOUBLE_RUN_LIMITS = [0, 1, 1, 1, 2, 2, 2, 2, 2, 3] as const;
const TRIPLE_RUN_LIMITS = [0, 0, 0, 0, 0, 0, 0, 1, 1, 2] as const;

export interface ProgressiveHiddenLayoutOptions {
  path: ReadonlyArray<EditorCell>;
  segmentLengthMin: number;
  segmentLengthMax: number;
  difficulty: number;
  seed: number;
  maxVisibleRun: number;
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

export const progressiveHiddenExtraCount = (difficulty: number): number => (
  normalizedDifficulty(difficulty) - 1
);

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
): Set<number> | undefined => {
  const hidden = new Set<number>();
  const visit = (segmentIndex: number): boolean => {
    if (segmentIndex >= segments.length) return longestVisibleRun(pathLength, hidden) <= maxVisibleRun;
    const segment = segments[segmentIndex];
    const candidates = Array.from({ length: segment.length }, (_, offset) => segment.start + offset)
      .filter((index) => index > 0 && index < pathLength - 1)
      .filter((index) => !hidden.has(index - 1) && !hidden.has(index + 1))
      .map((index) => ({
        index,
        centerDistance: Math.abs(index - (segment.start + segment.end - 1) / 2),
        order: random(),
      }))
      .sort((left, right) => left.centerDistance - right.centerDistance || left.order - right.order);
    for (const { index } of candidates) {
      hidden.add(index);
      if (visit(segmentIndex + 1)) return true;
      hidden.delete(index);
    }
    return false;
  };
  return visit(0) ? hidden : undefined;
};

const validDifficultyCandidates = (
  pathLength: number,
  source: ReadonlySet<number>,
  difficulty: number,
): { continuous: number[]; isolated: number[] } => {
  const limits = progressiveHiddenRunLimits(difficulty);
  const hidden = new Set(source);
  const valid = Array.from({ length: Math.max(0, pathLength - 2) }, (_, offset) => offset + 1)
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

const difficultyCandidates = (
  pathLength: number,
  source: ReadonlySet<number>,
  difficulty: number,
): number[] => {
  const { continuous, isolated } = validDifficultyCandidates(pathLength, source, difficulty);
  return [...continuous, ...isolated];
};

const canCompleteDifficultyChain = (
  pathLength: number,
  source: ReadonlySet<number>,
  nextDifficulty: number,
  memo = new Map<string, boolean>(),
): boolean => {
  if (nextDifficulty > 10) return true;
  const stateKey = `${nextDifficulty}:${[...source].sort((left, right) => left - right).join(',')}`;
  const cached = memo.get(stateKey);
  if (cached !== undefined) return cached;
  const canComplete = difficultyCandidates(pathLength, source, nextDifficulty).some((candidate) => (
    canCompleteDifficultyChain(pathLength, new Set(source).add(candidate), nextDifficulty + 1, memo)
  ));
  memo.set(stateKey, canComplete);
  return canComplete;
};

const randomized = (values: ReadonlyArray<number>, random: () => number): number[] => values
  .map((candidate) => ({ candidate, order: random() }))
  .sort((left, right) => left.order - right.order)
  .map(({ candidate }) => candidate);

const addDifficultyHidden = (
  pathLength: number,
  source: ReadonlySet<number>,
  difficulty: number,
  maxVisibleRun: number,
  random: () => number,
): Set<number> => {
  const hidden = new Set(source);
  const { continuous, isolated } = validDifficultyCandidates(pathLength, hidden, difficulty);
  const ordered = [...randomized(continuous, random), ...randomized(isolated, random)];
  if (ordered.length === 0) throw new Error(`难度 ${difficulty} 无法在连续隐藏限制内增加额外隐藏数字。`);
  const selected = ordered.find((candidate) => (
    longestVisibleRun(pathLength, new Set(hidden).add(candidate)) <= maxVisibleRun
    && canCompleteDifficultyChain(pathLength, new Set(hidden).add(candidate), difficulty + 1)
  ));
  if (selected === undefined) throw new Error(`难度 ${difficulty} 的候选位置无法继续扩展到难度 10。`);
  hidden.add(selected);
  return hidden;
};

export const createProgressiveHiddenLayout = ({
  path,
  segmentLengthMin,
  segmentLengthMax,
  difficulty,
  seed,
  maxVisibleRun,
  previousHiddenCells,
}: ProgressiveHiddenLayoutOptions): EditorCell[] => {
  const level = normalizedDifficulty(difficulty);
  const segments = createProgressiveHiddenSegments(path.length, segmentLengthMin, segmentLengthMax, seed);
  const baseCount = segments.length;
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
      );
      if (candidate && canCompleteDifficultyChain(path.length, candidate, 2)) base = candidate;
    }
    if (!base) {
      throw new Error(
        `无法按分段长度区间 [${segmentLengthMin},${segmentLengthMax}] 生成可扩展到难度 10 的基础隐藏布局。`,
      );
    }
    hidden = base;
  }
  const expectedPreviousCount = baseCount + Math.max(0, level - 2);
  if (previous && hidden.size !== expectedPreviousCount) {
    throw new Error(`难度 ${level} 需要继承 ${expectedPreviousCount} 个隐藏数字，实际为 ${hidden.size} 个。`);
  }
  if (!previous) {
    for (let currentDifficulty = 2; currentDifficulty <= level; currentDifficulty += 1) {
      hidden = addDifficultyHidden(
        path.length,
        hidden,
        currentDifficulty,
        maxVisibleRun,
        createRandom(seed ^ Math.imul(currentDifficulty + 1, 104729)),
      );
    }
  } else if (level > 1) {
    hidden = addDifficultyHidden(path.length, hidden, level, maxVisibleRun, random);
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
