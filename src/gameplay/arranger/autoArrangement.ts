import type {
  ArrangementBoardFamily,
  ArrangementLevelGroup,
  ArrangementPathFamily,
} from './levelArrangement';

export interface AutoArrangementStage {
  formationIds: number[];
  difficultyIds: number[];
}

export interface AutoArrangementConfig {
  levelCount: number;
  boardsPerLevel: number;
  pathRepeatInterval: number;
  occlusionPreference: AutoArrangementOcclusionPreference;
  stages: AutoArrangementStage[];
  randomSource?: () => number;
}

export type AutoArrangementOcclusionPreference = 'large' | 'medium' | 'small' | 'random';

export const DEFAULT_AUTO_ARRANGEMENT_FORM = {
  levelCount: 400,
  boardsPerLevel: 4,
  pathRepeatInterval: 100,
  occlusionPreference: 'random' as const,
  stages: [
    { formationRange: '44,45,54', difficultyRange: '3,4,5' },
    { formationRange: '44,45,54,55,56', difficultyRange: '3,4,5' },
    { formationRange: '44,45,54,55,56,57,66', difficultyRange: '4,5,6' },
    { formationRange: '67,68,77,78,79,88,89', difficultyRange: '5,6,7' },
  ],
} as const;

const parseNumericIdRange = (value: string, label: string): number[] => {
  const ids = new Set<number>();
  value.split(/[,，\s]+/).filter(Boolean).forEach((part) => {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start > end) throw new Error(`${label}范围“${part}”起始值不能大于结束值。`);
      for (let id = start; id <= end; id += 1) ids.add(id);
      return;
    }
    if (!/^\d+$/.test(part)) throw new Error(`无法识别${label}范围“${part}”。`);
    ids.add(Number(part));
  });
  if (ids.size === 0) throw new Error(`每个阶段至少需要选择一个${label}。`);
  return [...ids].sort((left, right) => left - right);
};

export const parseFormationIdRange = (value: string): number[] => parseNumericIdRange(value, '阵型');
export const parseDifficultyIdRange = (value: string): number[] => parseNumericIdRange(value, '难度');

export const generateAutoArrangement = (
  families: ReadonlyArray<ArrangementBoardFamily>,
  config: AutoArrangementConfig,
): ArrangementLevelGroup[] => {
  if (!Number.isInteger(config.levelCount) || config.levelCount < 1) {
    throw new Error('生成关卡数必须是大于 0 的整数。');
  }
  if (!Number.isInteger(config.boardsPerLevel) || config.boardsPerLevel < 1) {
    throw new Error('每关棋盘数量必须是大于 0 的整数。');
  }
  if (!Number.isInteger(config.pathRepeatInterval) || config.pathRepeatInterval < 0) {
    throw new Error('相同路径重复间隔必须是非负整数。');
  }
  const stages = [...config.stages];
  if (stages.length !== config.boardsPerLevel) {
    throw new Error(`每关 ${config.boardsPerLevel} 个棋盘时，必须配置 ${config.boardsPerLevel} 个棋盘阶段。`);
  }

  const familyById = new Map(families.flatMap((family) => (
    family.representative.formationId === undefined ? [] : [[family.representative.formationId, family] as const]
  )));
  const lastUsedLevel = new Map<string, number>();
  const groups: ArrangementLevelGroup[] = [];
  const stagePools = stages.map((stage, stageIndex) => {
    const missingIds = stage.formationIds.filter((id) => !familyById.has(id));
    if (missingIds.length > 0) throw new Error(`阶段 ${stageIndex + 1} 找不到阵型：${missingIds.join('、')}。`);
    const availableDifficultyIds = new Set(stage.formationIds.flatMap((id) => familyById.get(id)!.paths.flatMap((path) => (
      path.difficulties.flatMap((difficulty) => {
        const difficultyId = difficulty.representative.difficultyId ?? difficulty.difficulty;
        return difficultyId === undefined ? [] : [difficultyId];
      })
    ))));
    const missingDifficultyIds = stage.difficultyIds.filter((id) => !availableDifficultyIds.has(id));
    if (missingDifficultyIds.length > 0) {
      throw new Error(`阶段 ${stageIndex + 1} 找不到难度：${missingDifficultyIds.join('、')}。`);
    }
    const candidates = stage.formationIds.flatMap((id) => familyById.get(id)!.paths.flatMap((path) => (
      path.difficulties.flatMap((difficulty) => {
        const difficultyId = difficulty.representative.difficultyId ?? difficulty.difficulty;
        if (difficultyId === undefined || !stage.difficultyIds.includes(difficultyId)) return [];
        return difficulty.variants.map((level) => ({
        level,
        pathKey: `${id}:${path.key}`,
        }));
      })
    )));
    if (candidates.length === 0) throw new Error(`阶段 ${stageIndex + 1} 没有可用关卡。`);
    return candidates;
  });

  const eligibleLevelIds = new Set(stagePools.flatMap((pool) => pool.map(({ level }) => level.id)));
  const maximumLevelCount = Math.min(
    Math.floor(eligibleLevelIds.size / config.boardsPerLevel),
    ...stagePools.map((pool) => new Set(pool.map(({ level }) => level.id)).size),
  );
  if (maximumLevelCount < config.levelCount) {
    throw new Error(`当前阶段范围最多可生成 ${maximumLevelCount} 关，无法生成 ${config.levelCount} 关。`);
  }

  const usedLevelIds = new Set<string>();
  const random = config.randomSource ?? Math.random;
  for (let levelNumber = 1; levelNumber <= config.levelCount; levelNumber += 1) {
    const levelIds: string[] = [];
    for (let stageIndex = 0; stageIndex < stagePools.length; stageIndex += 1) {
      const pool = stagePools[stageIndex];
      const selection = findAvailableLevel(
        pool,
        levelNumber,
        config.pathRepeatInterval,
        lastUsedLevel,
        usedLevelIds,
        config.occlusionPreference,
        random,
      );
      if (!selection) {
        throw new Error(`第 ${levelNumber} 关的阶段 ${stageIndex + 1} 无法满足路径间隔 ${config.pathRepeatInterval}，请扩大阵型范围或减小间隔。`);
      }
      levelIds.push(selection.level.id);
      usedLevelIds.add(selection.level.id);
      lastUsedLevel.set(selection.pathKey, levelNumber);
    }
    groups.push({ id: levelNumber, levelIds });
  }
  return groups;
};

const findAvailableLevel = (
  candidates: ReadonlyArray<{ level: ArrangementPathFamily['difficulties'][number]['variants'][number]; pathKey: string }>,
  levelNumber: number,
  interval: number,
  lastUsedLevel: ReadonlyMap<string, number>,
  usedLevelIds: ReadonlySet<string>,
  preference: AutoArrangementOcclusionPreference,
  random: () => number,
): (typeof candidates)[number] | undefined => {
  const available = candidates.filter((candidate) => {
    if (usedLevelIds.has(candidate.level.id)) return false;
    const lastUsed = lastUsedLevel.get(candidate.pathKey);
    return lastUsed === undefined || levelNumber - lastUsed >= interval;
  });
  if (available.length === 0) return undefined;
  if (preference === 'random') return available[Math.floor(random() * available.length) % available.length];

  const score = (candidate: (typeof candidates)[number]): number => (
    candidate.level.pathMetrics.consecutiveOcclusionCount ?? 0
  );
  const values = available.map(score);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum;
  const weight = (candidate: (typeof candidates)[number]): number => {
    const normalized = span === 0 ? .5 : (score(candidate) - minimum) / span;
    if (preference === 'large') return 1 + normalized * 4;
    if (preference === 'small') return 1 + (1 - normalized) * 4;
    return 1 + (1 - Math.abs(normalized - .5) * 2) * 4;
  };
  const totalWeight = available.reduce((total, candidate) => total + weight(candidate), 0);
  let target = random() * totalWeight;
  for (const candidate of available) {
    target -= weight(candidate);
    if (target < 0) return candidate;
  }
  return available.at(-1);
};
