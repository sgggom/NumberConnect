import { BoardShape, cellKey, type LevelData } from '../../game/types';
import { selectAlgorithm1HiddenLayout } from '../editor/algorithms/algorithm1';
import type { EditorShape } from '../editor/types';

export interface Mode5HiddenLayoutConfig {
  hiddenPercentRange: readonly [minimum: number, maximum: number];
  maxVisibleRun: number;
  maxHiddenRun: number;
}

/** 玩法5独立配置表；当前以玩法4参数作为初始版本。 */
export const MODE5_DIFFICULTY_CONFIGS: readonly Mode5HiddenLayoutConfig[] = [
  { hiddenPercentRange: [20, 26], maxVisibleRun: 4, maxHiddenRun: 2 },
  { hiddenPercentRange: [26, 32], maxVisibleRun: 4, maxHiddenRun: 2 },
  { hiddenPercentRange: [32, 37], maxVisibleRun: 4, maxHiddenRun: 2 },
  { hiddenPercentRange: [37, 42], maxVisibleRun: 3, maxHiddenRun: 2 },
  { hiddenPercentRange: [42, 46], maxVisibleRun: 3, maxHiddenRun: 2 },
  { hiddenPercentRange: [46, 50], maxVisibleRun: 3, maxHiddenRun: 3 },
  { hiddenPercentRange: [50, 53], maxVisibleRun: 3, maxHiddenRun: 3 },
  { hiddenPercentRange: [53, 56], maxVisibleRun: 2, maxHiddenRun: 3 },
  { hiddenPercentRange: [56, 58], maxVisibleRun: 2, maxHiddenRun: 3 },
  { hiddenPercentRange: [58, 60], maxVisibleRun: 2, maxHiddenRun: 3 },
] as const;

const normalizeMode5Difficulty = (difficulty: number): number => (
  Math.max(1, Math.min(10, Math.floor(Number.isFinite(difficulty) ? difficulty : 1)))
);

export const resolveMode5DifficultyConfig = (
  difficulty: number,
): Mode5HiddenLayoutConfig => MODE5_DIFFICULTY_CONFIGS[normalizeMode5Difficulty(difficulty) - 1];

/** 算法1种子与玩法3/4分离，玩法5可以独立修改生成结果。 */
export const mode5Algorithm1Seed = (level: LevelData, difficulty: number): number => (
  Math.imul(level.levelId + 1, 130363)
  ^ Math.imul(level.rows + 1, 92837111)
  ^ Math.imul(level.columns + 1, 689287499)
  ^ Math.imul(normalizeMode5Difficulty(difficulty) + 1, 433494437)
  ^ level.solutionPath.length
  ^ 0x27d4eb2f
) | 0;

/** @deprecated 使用 mode5Algorithm1Seed；保留旧导出以兼容现有调用。 */
export const mode5RandomHiddenSeed = (level: LevelData): number => mode5Algorithm1Seed(level, 1);

const mode5EditorShape = (shape: BoardShape): EditorShape => {
  if (shape === BoardShape.Hex) return 'hex';
  if (shape === BoardShape.Diamond) return 'diamond';
  if (shape === BoardShape.Rectangle) return 'rectangle';
  return 'square';
};

const mode5HiddenPercentSeed = (level: LevelData): number => (
  Math.imul(level.levelId + 1, 1597334677)
  ^ Math.imul(level.rows + 1, 3812015801)
  ^ Math.imul(level.columns + 1, 958282163)
  ^ Math.imul(level.solutionPath.length + 1, 1103515245)
  ^ 0x5bd1e995
) | 0;

export const mode5HiddenPercentForLevel = (
  level: LevelData,
  range: readonly [number, number],
): number => {
  const minimum = Math.max(0, Math.min(100, Math.floor(Math.min(...range))));
  const maximum = Math.max(minimum, Math.min(100, Math.floor(Math.max(...range))));
  return minimum + ((mode5HiddenPercentSeed(level) >>> 0) % (maximum - minimum + 1));
};

export const mode5EffectiveHiddenPercent = (
  level: LevelData,
  difficulty: number,
): number => mode5HiddenPercentForLevel(
  level,
  resolveMode5DifficultyConfig(difficulty).hiddenPercentRange,
);

export const createMode5HiddenCells = (
  level: LevelData,
  difficulty: number,
): Set<string> => {
  const normalizedDifficulty = normalizeMode5Difficulty(difficulty);
  const config = resolveMode5DifficultyConfig(difficulty);
  const hiddenPercent = mode5HiddenPercentForLevel(level, config.hiddenPercentRange);
  const hiddenIndices = selectAlgorithm1HiddenLayout(
    level.solutionPath,
    mode5EditorShape(level.boardShape),
    hiddenPercent,
    normalizedDifficulty,
    mode5Algorithm1Seed(level, normalizedDifficulty),
    {
      maxVisibleRun: config.maxVisibleRun,
      maxHiddenRun: config.maxHiddenRun,
      // 配置表给出的占比就是最终占比；难度只控制算法1的布局结构。
      addTargetDifficultyPercent: false,
    },
  );
  return new Set([...hiddenIndices].map((index) => cellKey(level.solutionPath[index])));
};

/** 第一大关直接采用配表正负数定义的显隐；后续大关才交给算法1。 */
export const createMode5StageHiddenCells = (
  level: LevelData,
  difficulty: number,
  useConfiguredBoard: boolean,
): Set<string> => (
  useConfiguredBoard
    ? new Set((level.hiddenCells ?? []).map(cellKey))
    : createMode5HiddenCells(level, difficulty)
);
