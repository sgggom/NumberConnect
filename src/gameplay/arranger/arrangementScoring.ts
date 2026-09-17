import type { ArrangementLibraryIndex } from './levelArrangement';

export type ArrangementPreference = 'large' | 'medium' | 'small' | 'random';
export interface ArrangementPreferences {
  laterHiddenNeighborPreference?: ArrangementPreference;
  crossingComplexityPreference?: ArrangementPreference;
  straightPreference?: ArrangementPreference;
  occlusionPreference?: ArrangementPreference;
}

export const ARRANGEMENT_WEIGHTS = { laterHiddenNeighbor: 0.4, crossingComplexity: 0.25, straight: 0.25, occlusion: 0.1 } as const;

export const straightRatio = (level: ArrangementLibraryIndex): number | undefined => {
  const { rightAngleRatio, acuteAngleRatio, obtuseAngleRatio, connectionCount } = level.pathMetrics;
  if (connectionCount !== undefined && connectionCount < 2) return 0;
  const ratios = [rightAngleRatio, acuteAngleRatio, obtuseAngleRatio];
  if (ratios.some((value) => value === undefined || !Number.isFinite(value))) return undefined;
  return Math.max(0, Math.min(1, 1 - rightAngleRatio! - acuteAngleRatio! - obtuseAngleRatio!));
};

export const crossingDensity = (level: ArrangementLibraryIndex): number | undefined => {
  const { crossings, connectionCount } = level.pathMetrics;
  if (crossings === undefined || connectionCount === undefined) return undefined;
  return connectionCount > 0 ? crossings / connectionCount : 0;
};

type ReadMetric = (level: ArrangementLibraryIndex) => number | undefined;
const normalizedMetric = (levels: readonly ArrangementLibraryIndex[], read: ReadMetric): ReadMetric | undefined => {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const level of levels) {
    const value = read(level);
    // Incomplete metrics must not make missing data look like an ideal zero.
    if (value === undefined || !Number.isFinite(value)) return undefined;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  return maximum === minimum ? () => 0.5 : (level) => (read(level)! - minimum) / (maximum - minimum);
};

/** Scores use one common candidate pool; earlier criteria never eliminate candidates. */
export function scoreArrangementCandidates(levels: readonly ArrangementLibraryIndex[], preferences: ArrangementPreferences): Float64Array {
  const scores = new Float64Array(levels.length);
  if (!levels.length) return scores;
  const criteria: Array<{ preference?: ArrangementPreference; weight: number; read?: ReadMetric }> = [];
  if (preferences.crossingComplexityPreference && preferences.crossingComplexityPreference !== 'random') {
    const count = normalizedMetric(levels, (level) => level.pathMetrics.crossings);
    const density = normalizedMetric(levels, crossingDensity);
    criteria.push({ preference: preferences.crossingComplexityPreference, weight: ARRANGEMENT_WEIGHTS.crossingComplexity,
      read: count && density ? (level) => (count(level)! + density(level)!) / 2 : undefined });
  }
  for (const [preference, weight, read] of [
    [preferences.laterHiddenNeighborPreference, ARRANGEMENT_WEIGHTS.laterHiddenNeighbor, (level: ArrangementLibraryIndex) => level.difficultyMetrics.laterHiddenNeighborCount],
    [preferences.straightPreference, ARRANGEMENT_WEIGHTS.straight, straightRatio],
    [preferences.occlusionPreference, ARRANGEMENT_WEIGHTS.occlusion, (level: ArrangementLibraryIndex) => level.pathMetrics.consecutiveOcclusionCount],
  ] as const) {
    if (preference && preference !== 'random') criteria.push({ preference, weight, read: normalizedMetric(levels, read) });
  }
  let totalWeight = 0;
  for (const { preference, weight, read } of criteria) {
    if (!read || !preference || preference === 'random') continue;
    totalWeight += weight;
    levels.forEach((level, index) => {
      const value = read(level)!;
      const match = preference === 'large' ? value : preference === 'small' ? 1 - value : 1 - 2 * Math.abs(value - 0.5);
      scores[index] += match * weight;
    });
  }
  if (totalWeight) scores.forEach((score, index) => { scores[index] = 100 * score / totalWeight; });
  return scores;
}
