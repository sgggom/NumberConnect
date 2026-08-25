import { BoardShape, cellKey, type LevelData } from '../../game/types';
import {
  selectAlgorithm1HiddenLayout,
} from '../../game/algorithm1HiddenLayout';
import type { BoardPathShape } from '../../game/pathGenerationTypes';
import { selectMode4RandomDispersedHiddenLayout } from './mode4RandomHiddenLayout';

export interface AdaptiveHiddenLayoutConfig {
  hiddenPercentRange: readonly [minimum: number, maximum: number];
  maxVisibleRun: number;
  maxHiddenRun: number;
}

/** 玩法3整局只调整算法1目标难度，以下三个配置始终固定。 */
export const MODE3_DIFFICULTY_CONFIG: AdaptiveHiddenLayoutConfig = {
  hiddenPercentRange: [20, 40],
  maxVisibleRun: 3,
  maxHiddenRun: 3,
};

/** 玩法4的索引0到9分别对应动态难度1到10。 */
export const MODE4_DIFFICULTY_CONFIGS: readonly AdaptiveHiddenLayoutConfig[] = [
  { hiddenPercentRange: [10, 15], maxVisibleRun: 5, maxHiddenRun: 2 },
  { hiddenPercentRange: [15, 20], maxVisibleRun: 5, maxHiddenRun: 2 },
  { hiddenPercentRange: [20, 25], maxVisibleRun: 4, maxHiddenRun: 2 },
  { hiddenPercentRange: [25, 30], maxVisibleRun: 4, maxHiddenRun: 2 },
  { hiddenPercentRange: [30, 35], maxVisibleRun: 3, maxHiddenRun: 3 },
  { hiddenPercentRange: [35, 40], maxVisibleRun: 3, maxHiddenRun: 3 },
  { hiddenPercentRange: [40, 45], maxVisibleRun: 2, maxHiddenRun: 4 },
  { hiddenPercentRange: [45, 50], maxVisibleRun: 2, maxHiddenRun: 4 },
  { hiddenPercentRange: [50, 55], maxVisibleRun: 2, maxHiddenRun: 5 },
  { hiddenPercentRange: [55, 60], maxVisibleRun: 2, maxHiddenRun: 5 },
] as const;

const normalizeDifficulty = (difficulty: number): number => (
  Math.max(1, Math.min(10, Math.floor(Number.isFinite(difficulty) ? difficulty : 1)))
);

export const resolveMode4DifficultyConfig = (
  difficulty: number,
): AdaptiveHiddenLayoutConfig => MODE4_DIFFICULTY_CONFIGS[normalizeDifficulty(difficulty) - 1];

export const mode3PathShape = (shape: BoardShape): BoardPathShape => {
  if (shape === BoardShape.Hex) return 'hex';
  if (shape === BoardShape.Diamond) return 'diamond';
  if (shape === BoardShape.Rectangle) return 'rectangle';
  return 'square';
};

export const mode3HiddenSeed = (level: LevelData, difficulty: number): number => (
  Math.imul(level.levelId + 1, 104729)
  ^ Math.imul(level.rows + 1, 73856093)
  ^ Math.imul(level.columns + 1, 19349663)
  ^ Math.imul(Math.floor(difficulty) + 1, 83492791)
  ^ level.solutionPath.length
  ^ 0x3a8f05c1
) | 0;

/** 玩法4随机序列只由关卡决定，不包含难度；档位差异只能来自配置值。 */
export const mode4RandomHiddenSeed = (level: LevelData): number => (
  Math.imul(level.levelId + 1, 104729)
  ^ Math.imul(level.rows + 1, 73856093)
  ^ Math.imul(level.columns + 1, 19349663)
  ^ level.solutionPath.length
  ^ 0x53c9e4ab
) | 0;

const hiddenPercentSeed = (level: LevelData): number => (
  Math.imul(level.levelId + 1, 2654435761)
  ^ Math.imul(level.rows + 1, 2246822519)
  ^ Math.imul(level.columns + 1, 3266489917)
  ^ Math.imul(level.solutionPath.length + 1, 668265263)
  ^ 0x16d4b4f3
) | 0;

/**
 * 在闭区间内按关卡种子选出稳定百分比。
 * 难度不是种子的一部分：玩法3难度升降时不会偷偷改变隐藏占比。
 */
export const hiddenPercentForLevel = (
  level: LevelData,
  range: readonly [number, number],
): number => {
  const minimum = Math.max(0, Math.min(100, Math.floor(Math.min(...range))));
  const maximum = Math.max(minimum, Math.min(100, Math.floor(Math.max(...range))));
  return minimum + ((hiddenPercentSeed(level) >>> 0) % (maximum - minimum + 1));
};

export const mode3EffectiveHiddenPercent = (level: LevelData): number => (
  hiddenPercentForLevel(level, MODE3_DIFFICULTY_CONFIG.hiddenPercentRange)
);

export const mode4EffectiveHiddenPercent = (
  level: LevelData,
  difficulty: number,
): number => hiddenPercentForLevel(
  level,
  resolveMode4DifficultyConfig(difficulty).hiddenPercentRange,
);

const createMode3Algorithm1HiddenCells = (
  level: LevelData,
  difficulty: number,
): Set<string> => {
  const normalizedTargetDifficulty = normalizeDifficulty(difficulty);
  const effectiveHiddenPercent = mode3EffectiveHiddenPercent(level);

  // 玩法3的配置区间就是最终隐藏占比。关闭算法1编辑器默认的“+目标难度%”，
  // 让目标难度只调整隐藏位置结构，不再改变隐藏总量。
  const hiddenIndices = selectAlgorithm1HiddenLayout(
    level.solutionPath,
    mode3PathShape(level.boardShape),
    effectiveHiddenPercent,
    normalizedTargetDifficulty,
    mode3HiddenSeed(level, normalizedTargetDifficulty),
    {
      maxVisibleRun: MODE3_DIFFICULTY_CONFIG.maxVisibleRun,
      maxHiddenRun: MODE3_DIFFICULTY_CONFIG.maxHiddenRun,
      addTargetDifficultyPercent: false,
    },
  );
  return new Set([...hiddenIndices].map((index) => cellKey(level.solutionPath[index])));
};

/**
 * 玩法3始终用完整路径重新计算隐藏格，不读取关卡自带的 hiddenCells。
 * 相同关卡和难度使用相同种子，因此重玩布局稳定；难度变化后下一局才会变化。
 */
export const createMode3HiddenCells = (
  level: LevelData,
  difficulty: number,
): Set<string> => createMode3Algorithm1HiddenCells(level, difficulty);

/**
 * 玩法4不使用算法1难度评分。当前档位只负责选择配置，隐藏位置由同一套
 * 关卡固定随机序列分散生成；数字1～4最多隐藏1个。
 */
export const createMode4HiddenCells = (
  level: LevelData,
  difficulty: number,
): Set<string> => {
  const config = resolveMode4DifficultyConfig(difficulty);
  const effectiveHiddenPercent = hiddenPercentForLevel(level, config.hiddenPercentRange);
  const hiddenIndices = selectMode4RandomDispersedHiddenLayout(
    level.solutionPath,
    effectiveHiddenPercent,
    mode4RandomHiddenSeed(level),
    {
      maxVisibleRun: config.maxVisibleRun,
      maxHiddenRun: config.maxHiddenRun,
      firstNumberWindow: 4,
      maxHiddenInFirstWindow: 1,
    },
  );
  return new Set([...hiddenIndices].map((index) => cellKey(level.solutionPath[index])));
};
