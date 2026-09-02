export type DynamicDifficultyTier = 0 | 1 | 2 | 3;

export type DynamicTierCounts = readonly [number, number, number, number];
export type DynamicTargetTierCounts = readonly [number, number, number];

export interface DynamicHiddenProfile {
  difficulty: number;
  hiddenPercent: number;
  tierRatios: readonly [number, number, number];
  maxVisibleRun: number;
  maxHiddenRun: number;
  firstNumberWindow: number;
  maxHiddenInFirstWindow: number;
  maxTier2ActualScore: number;
  maxConsecutiveTier2: number;
  ambiguityRatio: number;
  baseCandidateCount: number;
  localSearchRounds: number;
  localCandidatesPerRound: number;
}

interface DynamicProfileAnchor {
  difficulty: number;
  tierRatios: readonly [number, number, number];
  ambiguityRatio: number;
}

const PROFILE_ANCHORS: readonly DynamicProfileAnchor[] = [
  { difficulty: 1, tierRatios: [0.86, 0.14, 0], ambiguityRatio: 0 },
  { difficulty: 5, tierRatios: [0.73, 0.23, 0.04], ambiguityRatio: 0.01 },
  { difficulty: 10, tierRatios: [0.66, 0.23, 0.11], ambiguityRatio: 0.03 },
];

const clampDifficulty = (value: number): number => (
  Math.max(1, Math.min(10, Math.round(Number.isFinite(value) ? value : 1)))
);

const interpolate = (from: number, to: number, progress: number): number => (
  from + (to - from) * progress
);

const interpolateAnchor = (difficulty: number): {
  tierRatios: readonly [number, number, number];
  ambiguityRatio: number;
} => {
  const upperIndex = PROFILE_ANCHORS.findIndex((anchor) => anchor.difficulty >= difficulty);
  const upper = PROFILE_ANCHORS[Math.max(0, upperIndex)];
  if (upper.difficulty === difficulty) {
    return { tierRatios: upper.tierRatios, ambiguityRatio: upper.ambiguityRatio };
  }
  const lower = PROFILE_ANCHORS[Math.max(0, upperIndex - 1)] ?? upper;
  if (lower.difficulty === upper.difficulty) {
    return { tierRatios: upper.tierRatios, ambiguityRatio: upper.ambiguityRatio };
  }
  const progress = (difficulty - lower.difficulty) / (upper.difficulty - lower.difficulty);
  return {
    tierRatios: [
      interpolate(lower.tierRatios[0], upper.tierRatios[0], progress),
      interpolate(lower.tierRatios[1], upper.tierRatios[1], progress),
      interpolate(lower.tierRatios[2], upper.tierRatios[2], progress),
    ],
    ambiguityRatio: interpolate(lower.ambiguityRatio, upper.ambiguityRatio, progress),
  };
};

export const dynamicHiddenProfileForDifficulty = (
  requestedDifficulty: number,
): DynamicHiddenProfile => {
  const difficulty = clampDifficulty(requestedDifficulty);
  const interpolated = interpolateAnchor(difficulty);
  return {
    difficulty,
    // This is the forked algorithm-1 baseline (35%) plus the selected 1-10 difficulty.
    hiddenPercent: 35 + difficulty,
    tierRatios: interpolated.tierRatios,
    maxVisibleRun: 8,
    maxHiddenRun: difficulty <= 3 ? 3 : 4,
    firstNumberWindow: 4,
    maxHiddenInFirstWindow: 1,
    maxTier2ActualScore: 40,
    maxConsecutiveTier2: 1,
    ambiguityRatio: interpolated.ambiguityRatio,
    baseCandidateCount: 3,
    localSearchRounds: 2,
    localCandidatesPerRound: 4,
  };
};

export const allocateDynamicTierTargets = (
  hiddenCount: number,
  profile: Pick<DynamicHiddenProfile, 'tierRatios'>,
): DynamicTargetTierCounts => {
  const count = Math.max(0, Math.floor(hiddenCount));
  const raw = profile.tierRatios.map((ratio) => Math.max(0, ratio) * count);
  const allocated = raw.map((value) => Math.floor(value));
  let remaining = count - allocated.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (let cursor = 0; remaining > 0; cursor += 1) {
    allocated[order[cursor % order.length].index] += 1;
    remaining -= 1;
  }
  return [allocated[0], allocated[1], allocated[2]];
};

export const dynamicTierTolerance = (hiddenCount: number): number => (
  Math.max(2, Math.ceil(Math.max(0, hiddenCount) * 0.15))
);
