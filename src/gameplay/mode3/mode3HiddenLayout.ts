import { BoardShape, cellKey, type LevelData } from '../../game/types';
import {
  selectAlgorithm8HiddenLayout,
} from '../editor/algorithms/algorithm8';
import type { EditorShape } from '../editor/types';

export interface AdaptiveHiddenLayoutConfig {
  hiddenPercentRange: readonly [minimum: number, maximum: number];
  maxVisibleRun: number;
  maxHiddenRun: number;
}

/** 玩法3整局只调整算法8目标难度，以下三个配置始终固定。 */
export const MODE3_DIFFICULTY_CONFIG: AdaptiveHiddenLayoutConfig = {
  hiddenPercentRange: [20, 40],
  maxVisibleRun: 3,
  maxHiddenRun: 3,
};

/** 玩法4的索引0到9分别对应动态难度1到10。 */
export const MODE4_DIFFICULTY_CONFIGS: readonly AdaptiveHiddenLayoutConfig[] = [
  { hiddenPercentRange: [10, 15], maxVisibleRun: 5, maxHiddenRun: 2 },
  { hiddenPercentRange: [13, 18], maxVisibleRun: 5, maxHiddenRun: 2 },
  { hiddenPercentRange: [16, 21], maxVisibleRun: 4, maxHiddenRun: 2 },
  { hiddenPercentRange: [19, 24], maxVisibleRun: 4, maxHiddenRun: 2 },
  { hiddenPercentRange: [22, 27], maxVisibleRun: 3, maxHiddenRun: 3 },
  { hiddenPercentRange: [25, 30], maxVisibleRun: 3, maxHiddenRun: 3 },
  { hiddenPercentRange: [28, 33], maxVisibleRun: 2, maxHiddenRun: 4 },
  { hiddenPercentRange: [31, 36], maxVisibleRun: 2, maxHiddenRun: 4 },
  { hiddenPercentRange: [34, 39], maxVisibleRun: 2, maxHiddenRun: 5 },
  { hiddenPercentRange: [37, 42], maxVisibleRun: 2, maxHiddenRun: 5 },
] as const;

const normalizeDifficulty = (difficulty: number): number => (
  Math.max(1, Math.min(10, Math.floor(Number.isFinite(difficulty) ? difficulty : 1)))
);

export const resolveMode4DifficultyConfig = (
  difficulty: number,
): AdaptiveHiddenLayoutConfig => MODE4_DIFFICULTY_CONFIGS[normalizeDifficulty(difficulty) - 1];

export const mode3EditorShape = (shape: BoardShape): EditorShape => {
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

const createAdaptiveHiddenCells = (
  level: LevelData,
  difficulty: number,
  config: AdaptiveHiddenLayoutConfig,
): Set<string> => {
  const normalizedTargetDifficulty = normalizeDifficulty(difficulty);
  const effectiveHiddenPercent = hiddenPercentForLevel(level, config.hiddenPercentRange);

  // 算法8内部会自动执行“隐藏占比 + 目标难度”。这里先减去目标难度，
  // 确保最终隐藏占比严格落在当前玩法配置的区间内。
  const requestedHiddenPercent = Math.max(
    0,
    effectiveHiddenPercent - normalizedTargetDifficulty,
  );
  const hiddenIndices = selectAlgorithm8HiddenLayout(
    level.solutionPath,
    mode3EditorShape(level.boardShape),
    requestedHiddenPercent,
    normalizedTargetDifficulty,
    mode3HiddenSeed(level, normalizedTargetDifficulty),
    {
      maxVisibleRun: config.maxVisibleRun,
      maxHiddenRun: config.maxHiddenRun,
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
): Set<string> => createAdaptiveHiddenCells(level, difficulty, MODE3_DIFFICULTY_CONFIG);

/** 玩法4在玩法3算法流程上，额外按当前动态难度切换整套配置。 */
export const createMode4HiddenCells = (
  level: LevelData,
  difficulty: number,
): Set<string> => createAdaptiveHiddenCells(
  level,
  difficulty,
  resolveMode4DifficultyConfig(difficulty),
);
