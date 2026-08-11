import { createRandom, shuffle } from '../../game/random';
import type { Cell } from '../../game/types';

export interface Mode4RandomHiddenLayoutOptions {
  maxVisibleRun: number;
  maxHiddenRun: number;
  firstNumberWindow?: number;
  maxHiddenInFirstWindow?: number;
}

interface RunMetrics {
  longestVisibleRun: number;
  longestHiddenRun: number;
}

interface CandidateScore extends RunMetrics {
  index: number;
  hiddenOverflow: number;
  visibleOverflow: number;
  nearestHiddenDistance: number;
  randomRank: number;
}

const calculateRunMetrics = (
  pathLength: number,
  hidden: ReadonlySet<number>,
): RunMetrics => {
  let longestVisibleRun = 0;
  let longestHiddenRun = 0;
  let visibleRun = 0;
  let hiddenRun = 0;

  for (let index = 0; index < pathLength; index += 1) {
    if (hidden.has(index)) {
      hiddenRun += 1;
      visibleRun = 0;
      longestHiddenRun = Math.max(longestHiddenRun, hiddenRun);
    } else {
      visibleRun += 1;
      hiddenRun = 0;
      longestVisibleRun = Math.max(longestVisibleRun, visibleRun);
    }
  }

  return { longestVisibleRun, longestHiddenRun };
};

const nearestHiddenDistance = (
  index: number,
  hidden: ReadonlySet<number>,
  pathLength: number,
): number => {
  if (hidden.size === 0) {
    // 第一个隐藏点优先靠近路径中部；中心有两个候选时由种子决定。
    return Math.min(index, pathLength - 1 - index);
  }
  return Math.min(...[...hidden].map((hiddenIndex) => Math.abs(index - hiddenIndex)));
};

/**
 * 玩法4的简单随机分散选点：
 * - 不接收目标难度，也不做体验评分；
 * - 每轮优先降低连续段超限，再拉开与已选隐藏点的路径距离；
 * - 完全同分时使用固定种子打散，因此同一关重玩稳定；
 * - 数字1和末尾固定显示，默认数字1～4最多隐藏1个。
 */
export const selectMode4RandomDispersedHiddenLayout = (
  path: ReadonlyArray<Cell>,
  hiddenPercent: number,
  seed: number,
  options: Mode4RandomHiddenLayoutOptions,
): Set<number> => {
  const pathLength = path.length;
  if (pathLength < 3 || hiddenPercent <= 0) return new Set<number>();

  const firstNumberWindow = Math.max(
    1,
    Math.min(pathLength, Math.floor(options.firstNumberWindow ?? 4)),
  );
  const allCandidates = Array.from(
    { length: pathLength - 2 },
    (_, offset) => offset + 1,
  );
  const firstWindowCandidates = allCandidates.filter(
    (index) => index < firstNumberWindow,
  ).length;
  const maxHiddenInFirstWindow = Math.max(
    0,
    Math.min(
      firstWindowCandidates,
      Math.floor(options.maxHiddenInFirstWindow ?? 1),
    ),
  );
  const maximumSelectableCount = allCandidates.length
    - firstWindowCandidates
    + maxHiddenInFirstWindow;
  const targetCount = Math.min(
    maximumSelectableCount,
    Math.max(0, Math.round(pathLength * Math.min(100, hiddenPercent) / 100)),
  );
  const maximumVisibleRun = Math.max(1, Math.floor(options.maxVisibleRun));
  const maximumHiddenRun = Math.max(1, Math.floor(options.maxHiddenRun));
  const hidden = new Set<number>();

  const randomizedCandidates = [...allCandidates];
  shuffle(randomizedCandidates, createRandom(seed ^ 0x4f1bbcdc));
  const randomRank = new Map(
    randomizedCandidates.map((index, rank) => [index, rank]),
  );

  while (hidden.size < targetCount) {
    const hiddenInFirstWindow = [...hidden].filter(
      (index) => index < firstNumberWindow,
    ).length;
    const candidates = allCandidates.filter((index) => (
      !hidden.has(index)
      && (
        index >= firstNumberWindow
        || hiddenInFirstWindow < maxHiddenInFirstWindow
      )
    ));
    if (candidates.length === 0) break;

    const scores = candidates.map((index): CandidateScore => {
      const projected = new Set(hidden).add(index);
      const runs = calculateRunMetrics(pathLength, projected);
      return {
        index,
        ...runs,
        hiddenOverflow: Math.max(0, runs.longestHiddenRun - maximumHiddenRun),
        visibleOverflow: Math.max(0, runs.longestVisibleRun - maximumVisibleRun),
        nearestHiddenDistance: nearestHiddenDistance(index, hidden, pathLength),
        randomRank: randomRank.get(index) ?? Number.MAX_SAFE_INTEGER,
      };
    });

    scores.sort((left, right) => (
      left.hiddenOverflow - right.hiddenOverflow
      || left.visibleOverflow - right.visibleOverflow
      || left.longestVisibleRun - right.longestVisibleRun
      || right.nearestHiddenDistance - left.nearestHiddenDistance
      || left.randomRank - right.randomRank
    ));
    hidden.add(scores[0].index);
  }

  return hidden;
};

export const calculateMode4RandomRunMetrics = calculateRunMetrics;
