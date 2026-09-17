import { simulateLevelPlay } from './simulateLevelPlay';
import type { EditorCell, EditorShape } from './types';

export const HIDDEN_DIFFICULTY_COUNT_HEADERS = [
  '0档隐藏数量（0≤分数<1）',
  '1档隐藏数量（1≤分数<2）',
  '2档隐藏数量（分数≥2）',
] as const;

export type HiddenDifficultyCounts = [number, number, number];

export const countHiddenDifficultyScores = (scores: ReadonlyArray<number>): HiddenDifficultyCounts => {
  const counts: HiddenDifficultyCounts = [0, 0, 0];
  for (const score of scores) counts[score < 1 ? 0 : score < 2 ? 1 : 2] += 1;
  return counts;
};

/** Count each hidden destination once along the authored path, as in the configuration workbook. */
export const calculateHiddenDifficultyCounts = ({ path, hiddenCellKeys, shape }: {
  path: ReadonlyArray<EditorCell>;
  hiddenCellKeys: ReadonlySet<string>;
  shape: EditorShape;
}): HiddenDifficultyCounts => {
  if (hiddenCellKeys.size === 0) return [0, 0, 0];
  // Candidates follow path order. Low reasoning and random=0 always select the
  // authored next cell, avoiding retries, alternate paths and averaged scores.
  // The original simulator still performs all difficulty/completion checks.
  const simulation = simulateLevelPlay({
    path, hiddenCellKeys, shape, reasoningLevel: 'low', random: () => 0,
  });
  return countHiddenDifficultyScores(
    simulation.steps.filter((step) => !step.directConnect).map((step) => step.difficultyScore),
  );
};
