import { PathCompletionSolver } from '../../game/pathCompletionSolver';
import { encodeCompactLevelCollection, encodeCompactLevelData } from '../../game/levelDataFormat';
import { BoardShape, type LevelData } from '../../game/types';
import { editorAlgorithmLabel } from './algorithms';
import {
  formatLevelBaseDataTsv,
  summarizeDifficultyScores,
} from './levelBaseDataTsv';
import { calculateEditorLevelMetrics } from './levelMetrics';
import {
  averageSimulatedPlayResults,
  simulateLevelPlay,
  type SimulatedPlayResult,
  type SimulationReasoningLevel,
} from './simulateLevelPlay';
import type { EditorShape } from './types';

export interface LevelCollectionTxtOptions {
  simulationRunCount: number;
  reasoningLevel: SimulationReasoningLevel;
  onProgress?: (completed: number, total: number, levelId: number) => void;
}

export const formatLevelListTxt = (
  levels: ReadonlyArray<LevelData>,
): string => JSON.stringify(Object.fromEntries(
  [...levels]
    .sort((left, right) => left.levelId - right.levelId)
    .map((level) => [`level_${level.levelId}`, encodeCompactLevelData(level)]),
));

const editorShapeOf = (shape: BoardShape): EditorShape => {
  if (shape === BoardShape.Diamond) return 'diamond';
  if (shape === BoardShape.Rectangle) return 'rectangle';
  if (shape === BoardShape.Hex) return 'hex';
  return 'square';
};

const shapeLabel = (shape: BoardShape): string => {
  if (shape === BoardShape.Diamond) return '菱形';
  if (shape === BoardShape.Rectangle) return '长方形';
  if (shape === BoardShape.Hex) return '蜂窝';
  return '正方形';
};

const average = (values: ReadonlyArray<number>): number => (
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
);

const simulateLevel = (
  level: LevelData,
  shape: EditorShape,
  runCount: number,
  reasoningLevel: SimulationReasoningLevel,
): SimulatedPlayResult => {
  const hiddenCellKeys = new Set((level.hiddenCells ?? []).map((cell) => `${cell.x},${cell.y}`));
  const completionSolver = new PathCompletionSolver(level.solutionPath, level.boardShape);
  const results = Array.from({ length: Math.max(1, Math.floor(runCount)) }, () => (
    simulateLevelPlay({
      path: level.solutionPath,
      hiddenCellKeys,
      shape,
      reasoningLevel,
      completionSolver,
    })
  ));
  return results.length === 1 ? results[0] : averageSimulatedPlayResults(results);
};

export const formatSimulatedLevelTsv = (
  level: LevelData,
  levelId: number,
  simulation: SimulatedPlayResult,
): string => {
  const shape = editorShapeOf(level.boardShape);
  const hiddenCellKeys = new Set((level.hiddenCells ?? []).map((cell) => `${cell.x},${cell.y}`));
  const metrics = calculateEditorLevelMetrics({
    path: level.solutionPath,
    hiddenCellKeys,
    shape,
  });
  const difficultyScores = summarizeDifficultyScores(
    simulation.steps.map((step) => step.difficultyScore),
  );
  return formatLevelBaseDataTsv({
    levelId,
    levelJson: JSON.stringify(encodeCompactLevelCollection([level])[0]),
    shape: shapeLabel(level.boardShape),
    rows: level.rows,
    columns: level.columns,
    cellCount: level.activeCells.length,
    algorithm: editorAlgorithmLabel(level.algorithm?.id),
    metrics,
    averageConnectableCount: average(
      simulation.steps.map((step) => step.connectableCount),
    ),
    directConnectRatio: average(
      simulation.steps.map((step) => step.directConnectRate ?? Number(step.directConnect)),
    ),
    averageDistanceToNextVisibleNumber: average(
      simulation.steps.map((step) => step.distanceToNextVisibleNumber),
    ),
    ...difficultyScores,
  });
};

export const formatLevelCollectionTxt = async (
  levels: ReadonlyArray<LevelData>,
  options: LevelCollectionTxtOptions,
): Promise<string> => {
  const rows: string[] = [];

  for (const [levelIndex, level] of levels.entries()) {
    const exportLevelId = levelIndex + 1;
    const shape = editorShapeOf(level.boardShape);
    const simulation = simulateLevel(
      level,
      shape,
      options.simulationRunCount,
      options.reasoningLevel,
    );
    rows.push(formatSimulatedLevelTsv(level, exportLevelId, simulation));

    options.onProgress?.(rows.length, levels.length, exportLevelId);
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  }

  return rows.join('\r\n');
};
