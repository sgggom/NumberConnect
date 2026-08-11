import { cellKey, type LevelData } from '../../game/types';
import { selectMode5RandomDispersedHiddenLayout } from './mode5RandomHiddenLayout';

export interface Mode5HiddenLayoutConfig {
  hiddenPercentRange: readonly [minimum: number, maximum: number];
  maxVisibleRun: number;
  maxHiddenRun: number;
}

/** 玩法5独立配置表；当前以玩法4参数作为初始版本。 */
export const MODE5_DIFFICULTY_CONFIGS: readonly Mode5HiddenLayoutConfig[] = [
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

const normalizeMode5Difficulty = (difficulty: number): number => (
  Math.max(1, Math.min(10, Math.floor(Number.isFinite(difficulty) ? difficulty : 1)))
);

export const resolveMode5DifficultyConfig = (
  difficulty: number,
): Mode5HiddenLayoutConfig => MODE5_DIFFICULTY_CONFIGS[normalizeMode5Difficulty(difficulty) - 1];

/** 随机种子与玩法3/4分离，玩法5可以独立修改生成结果。 */
export const mode5RandomHiddenSeed = (level: LevelData): number => (
  Math.imul(level.levelId + 1, 130363)
  ^ Math.imul(level.rows + 1, 92837111)
  ^ Math.imul(level.columns + 1, 689287499)
  ^ level.solutionPath.length
  ^ 0x27d4eb2f
) | 0;

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
  const config = resolveMode5DifficultyConfig(difficulty);
  const hiddenPercent = mode5HiddenPercentForLevel(level, config.hiddenPercentRange);
  const hiddenIndices = selectMode5RandomDispersedHiddenLayout(
    level.solutionPath,
    hiddenPercent,
    mode5RandomHiddenSeed(level),
    {
      maxVisibleRun: config.maxVisibleRun,
      maxHiddenRun: config.maxHiddenRun,
      firstNumberWindow: 4,
      maxHiddenInFirstWindow: 1,
    },
  );
  return new Set([...hiddenIndices].map((index) => cellKey(level.solutionPath[index])));
};
