import type {
  ArrangementBoardFamily,
  ArrangementLevelGroup,
  ArrangementPathFamily,
} from './levelArrangement';

export interface AutoArrangementStage {
  formationIds: (number | string)[];
  difficultyIds: number[];
}

export interface AutoArrangementConfig {
  levelCount: number;
  boardsPerLevel: number;
  pathRepeatInterval: number;
  occlusionPreference: AutoArrangementOcclusionPreference;
  rightEmptyPreference?: AutoArrangementOcclusionPreference;
  lowerRightEmptyPreference?: AutoArrangementOcclusionPreference;
  stages: AutoArrangementStage[];
  randomSource?: () => number;
}

export type AutoArrangementOcclusionPreference = 'large' | 'medium' | 'small' | 'random';

export const DEFAULT_AUTO_ARRANGEMENT_FORM = {
  levelCount: 500,
  boardsPerLevel: 3,
  pathRepeatInterval: 500,
  occlusionPreference: 'small' as const,
  rightEmptyPreference: 'small' as const,
  lowerRightEmptyPreference: 'small' as const,
  stages: [
    { formationRange: '[n1~n50]', difficultyRange: '3,4,5' },
    { formationRange: '56,57,58,59,66,67,68,77', difficultyRange: '4,5,6' },
    { formationRange: '69,610,78,79,710,711', difficultyRange: '4,5,6' },  ],
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

const shapeRange = /^\[([^\d\s\[\]~,，]+)(\d+)~([^\d\s\[\]~,，]+)(\d+)\]$/;

export const parseFormationIdRange = (value: string): (number | string)[] => {
  const normalized = value.replace(/\[[^\]]*\]/g, (part) => part.replace(/\s/g, '').replace(/～/g, '~'));
  const parts = normalized.split(/[,，\s]+/).filter(Boolean);
  if (parts.length === 0) throw new Error('每个阶段至少需要选择一个阵型。');
  const ids = parts.flatMap((part): (number | string)[] => {
    const range = shapeRange.exec(part);
    if (range) {
      if (range[1] !== range[3]) throw new Error(`阵型范围“${part}”的造型名前缀必须相同。`);
      if (!Number.isSafeInteger(Number(range[2])) || !Number.isSafeInteger(Number(range[4]))) {
        throw new Error(`阵型范围“${part}”的编号过大。`);
      }
      if (Number(range[2]) > Number(range[4])) throw new Error(`阵型范围“${part}”起始值不能大于结束值。`);
      return [part];
    }
    if (/^[^\d\s\[\]~,，_\-][^\s\[\]~,，_]*$/.test(part)) return [part];
    return parseNumericIdRange(part, '阵型');
  });
  return [...new Set(ids)].sort((left, right) => String(left).localeCompare(String(right), 'en', { numeric: true }));
};
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

  const familiesFor = (selector: number | string): ArrangementBoardFamily[] => {
    const range = typeof selector === 'string' ? shapeRange.exec(selector) : null;
    return families.filter(({ representative }) => {
      const id = representative.formationId;
      if (!range) return id === selector;
      if (typeof id !== 'string' || !id.startsWith(range[1])) return false;
      const suffix = id.slice(range[1].length);
      return /^\d+$/.test(suffix) && Number(suffix) >= Number(range[2]) && Number(suffix) <= Number(range[4]);
    });
  };
  const lastUsedLevel = new Map<string, number>();
  const groups: ArrangementLevelGroup[] = [];
  const stagePools = stages.map((stage, stageIndex) => {
    const selections = stage.formationIds.map((id) => ({ id, families: familiesFor(id) }));
    const missingIds = selections.filter((selection) => selection.families.length === 0).map(({ id }) => id);
    if (missingIds.length > 0) throw new Error(`阶段 ${stageIndex + 1} 找不到阵型：${missingIds.join('、')}。`);
    const availableDifficultyIds = new Set(selections.flatMap((selection) => selection.families.flatMap((family) => family.paths.flatMap((path) => (
      path.difficulties.flatMap((difficulty) => {
        const difficultyId = difficulty.representative.difficultyId ?? difficulty.difficulty;
        return difficultyId === undefined ? [] : [difficultyId];
      })
    )))));
    const missingDifficultyIds = stage.difficultyIds.filter((id) => !availableDifficultyIds.has(id));
    if (missingDifficultyIds.length > 0) {
      throw new Error(`阶段 ${stageIndex + 1} 找不到难度：${missingDifficultyIds.join('、')}。`);
    }
    const grouped = stage.formationIds.some((id) => typeof id === 'string' && shapeRange.test(id));
    const candidates = selections.flatMap((selection) => selection.families.flatMap((family) => family.paths.flatMap((path) => (
      path.difficulties.flatMap((difficulty) => {
        const difficultyId = difficulty.representative.difficultyId ?? difficulty.difficulty;
        if (difficultyId === undefined || !stage.difficultyIds.includes(difficultyId)) return [];
        return difficulty.variants.map((level) => ({
          level,
          pathKey: `${level.formationId ?? family.representative.formationId}:${path.key}`,
          selectionGroup: grouped ? String(selection.id) : undefined,
        }));
      })
    ))));
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
        config,
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
  candidates: ReadonlyArray<{ level: ArrangementPathFamily['difficulties'][number]['variants'][number]; pathKey: string; selectionGroup?: string }>,
  levelNumber: number,
  interval: number,
  lastUsedLevel: ReadonlyMap<string, number>,
  usedLevelIds: ReadonlySet<string>,
  preferences: Pick<AutoArrangementConfig, 'lowerRightEmptyPreference' | 'rightEmptyPreference' | 'occlusionPreference'>,
  random: () => number,
): (typeof candidates)[number] | undefined => {
  let available = candidates.filter((candidate) => {
    if (usedLevelIds.has(candidate.level.id)) return false;
    const lastUsed = lastUsedLevel.get(candidate.pathKey);
    return lastUsed === undefined || levelNumber - lastUsed >= interval;
  });
  if (available.length === 0) return undefined;
  if (available[0].selectionGroup !== undefined) {
    const groups = [...new Set(available.map((candidate) => candidate.selectionGroup))];
    const group = groups[Math.floor(random() * groups.length) % groups.length];
    available = available.filter((candidate) => candidate.selectionGroup === group);
  }
  const criteria: Array<{
    preference: AutoArrangementOcclusionPreference | undefined;
    score: (candidate: (typeof candidates)[number]) => number;
  }> = [
    { preference: preferences.lowerRightEmptyPreference, score: ({ level }) => level.difficultyMetrics.lowerRightEmptyCount ?? 0 },
    { preference: preferences.rightEmptyPreference, score: ({ level }) => level.difficultyMetrics.rightEmptyCount ?? 0 },
    { preference: preferences.occlusionPreference, score: ({ level }) => level.pathMetrics.consecutiveOcclusionCount ?? 0 },
  ];
  // Lower-priority preferences only break ties left by higher-priority preferences.
  for (const { preference, score } of criteria) {
    if (!preference || preference === 'random' || available.length === 1) continue;
    let minimum = Infinity;
    let maximum = -Infinity;
    for (const candidate of available) {
      const value = score(candidate);
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    const target = preference === 'large' ? maximum : preference === 'small' ? minimum : (minimum + maximum) / 2;
    let bestDistance = Infinity;
    for (const candidate of available) bestDistance = Math.min(bestDistance, Math.abs(score(candidate) - target));
    available = available.filter((candidate) => Math.abs(score(candidate) - target) === bestDistance);
  }
  return available[Math.floor(random() * available.length) % available.length];
};
