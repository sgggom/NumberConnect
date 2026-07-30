import type { EditorLevelMetrics } from './levelMetrics';

export interface LevelBaseDataExport {
  levelId: number;
  shape: string;
  rows: number;
  columns: number;
  cellCount: number;
  levelJson: string;
  algorithm: string;
  metrics: EditorLevelMetrics;
  averageConnectableCount: number;
  directConnectRatio: number;
  averageDistanceToNextVisibleNumber: number;
  averageStepDifficultyScore: number;
  earlyAverageDifficultyScore: number;
  middleAverageDifficultyScore: number;
  lateAverageDifficultyScore: number;
}

const roundedAverage = (value: number): number => Math.round(value * 100) / 100;

export interface DifficultyScoreAverages {
  averageStepDifficultyScore: number;
  earlyAverageDifficultyScore: number;
  middleAverageDifficultyScore: number;
  lateAverageDifficultyScore: number;
}

const average = (values: ReadonlyArray<number>): number => (
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
);

export const summarizeDifficultyScores = (
  scores: ReadonlyArray<number>,
): DifficultyScoreAverages => {
  if (scores.length === 0) {
    return {
      averageStepDifficultyScore: 0,
      earlyAverageDifficultyScore: 0,
      middleAverageDifficultyScore: 0,
      lateAverageDifficultyScore: 0,
    };
  }

  const phaseSize = Math.max(1, Math.round(scores.length * 0.25));
  const middleStart = Math.min(phaseSize, scores.length);
  const middleEnd = Math.max(middleStart, scores.length - phaseSize);
  const middleScores = scores.slice(middleStart, middleEnd);
  return {
    averageStepDifficultyScore: average(scores),
    earlyAverageDifficultyScore: average(scores.slice(0, phaseSize)),
    middleAverageDifficultyScore: average(middleScores.length > 0 ? middleScores : scores),
    lateAverageDifficultyScore: average(scores.slice(Math.max(0, scores.length - phaseSize))),
  };
};

export const formatLevelBaseDataTsv = ({
  levelId,
  shape,
  rows,
  columns,
  cellCount,
  levelJson,
  algorithm,
  metrics,
  averageConnectableCount,
  directConnectRatio,
  averageDistanceToNextVisibleNumber,
  averageStepDifficultyScore,
  earlyAverageDifficultyScore,
  middleAverageDifficultyScore,
  lateAverageDifficultyScore,
}: LevelBaseDataExport): string => {
  const hiddenPercent = Math.round(metrics.hiddenRatio * 1000) / 10;
  const directConnectPercent = Math.round(directConnectRatio * 1000) / 10;
  const values = [
    levelId,
    levelJson,
    shape,
    rows,
    columns,
    cellCount,
    algorithm,
    metrics.hiddenCount,
    `${hiddenPercent}%`,
    metrics.straightContinuations,
    metrics.rightAngleTurns,
    metrics.acuteAngleTurns,
    metrics.obtuseAngleTurns,
    metrics.pathCrossings,
    metrics.longestHiddenRun,
    metrics.longestVisibleRun,
    roundedAverage(averageConnectableCount),
    `${directConnectPercent}%`,
    roundedAverage(averageDistanceToNextVisibleNumber),
    roundedAverage(averageStepDifficultyScore),
    roundedAverage(earlyAverageDifficultyScore),
    roundedAverage(middleAverageDifficultyScore),
    roundedAverage(lateAverageDifficultyScore),
  ];

  return values.join('\t');
};
