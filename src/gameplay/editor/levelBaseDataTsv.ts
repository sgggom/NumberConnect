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
  averageReasoningDepth: number;
}

const roundedAverage = (value: number): number => Math.round(value * 100) / 100;

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
  averageReasoningDepth,
}: LevelBaseDataExport): string => {
  const hiddenPercent = Math.round(metrics.hiddenRatio * 1000) / 10;
  const directConnectPercent = Math.round(directConnectRatio * 1000) / 10;
  const values = [
    levelId,
    shape,
    rows,
    columns,
    cellCount,
    levelJson,
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
    roundedAverage(averageReasoningDepth),
  ];

  return values.join('\t');
};
