import { decodeCompactLevelData, type CompactLevelData } from '../../game/levelDataFormat';
import type { LevelData } from '../../game/types';

export interface FormationIdParts {
  id: string;
  familyId: string;
  boardId: number;
  pathId: number;
  difficulty: number;
}

export interface ThreeModeConfiguredStage {
  index: number;
  formationId: string;
}

export interface ThreeModeConfiguredLevel {
  id: number;
  stages: ThreeModeConfiguredStage[];
}

export interface ThreeModeLevelLibrary {
  levels: ReadonlyMap<string, CompactLevelData>;
  guides: ReadonlyMap<string, CompactLevelData>;
}

export interface ResolvedThreeModeStage {
  levelId: number;
  stage: number;
  totalStages: number;
  configuredFormationId: string;
  formationId: string;
  defaultDifficulty?: number;
  difficulty?: number;
  level: LevelData;
}

const FORMATION_ID_PATTERN = /^(level_([1-9]\d*)_([1-9]\d*))_(10|[1-9])$/;
const GUIDE_ID_PATTERN = /^guide_[1-9]\d*_[1-9]\d*$/;
const CONFIG_LEVEL_ID_PATTERN = /^level_([1-9]\d*)$/;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const assertCompactLevel = (value: unknown, label: string): CompactLevelData => {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.data)) {
    throw new Error(`${label} 必须是只包含 data 二维数组的对象。`);
  }
  return value as unknown as CompactLevelData;
};

export const parseFormationId = (value: unknown): FormationIdParts => {
  if (typeof value !== 'string') throw new Error('阵型 ID 必须是字符串。');
  const match = FORMATION_ID_PATTERN.exec(value);
  if (!match) {
    throw new Error(`阵型 ID ${value} 必须符合 level_阵型_路径_难度，难度为 1–10。`);
  }
  return {
    id: value,
    familyId: match[1],
    boardId: Number(match[2]),
    pathId: Number(match[3]),
    difficulty: Number(match[4]),
  };
};

const isGuideId = (value: unknown): value is string => (
  typeof value === 'string' && GUIDE_ID_PATTERN.test(value)
);

const parseConfiguredFormationId = (value: unknown): string => (
  isGuideId(value) ? value : parseFormationId(value).id
);

export const formationIdAtDifficulty = (formationId: string, difficulty: number): string => {
  const parsed = parseFormationId(formationId);
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 10) {
    throw new Error(`目标难度必须是 1–10 的整数，收到 ${difficulty}。`);
  }
  return `${parsed.familyId}_${difficulty}`;
};

export const parseThreeModeLevelLibrary = (value: unknown): ThreeModeLevelLibrary => {
  if (!isRecord(value)) throw new Error('关卡库必须是以阵型 ID 为键的 JSON 对象。');
  const levels = new Map<string, CompactLevelData>();
  const guides = new Map<string, CompactLevelData>();
  Object.entries(value).forEach(([id, rawLevel]) => {
    if (FORMATION_ID_PATTERN.test(id)) {
      levels.set(id, assertCompactLevel(rawLevel, `关卡库 ${id}`));
      return;
    }
    if (GUIDE_ID_PATTERN.test(id)) {
      guides.set(id, assertCompactLevel(rawLevel, `关卡库 ${id}`));
      return;
    }
    throw new Error(`关卡库包含无法识别的 ID：${id}。`);
  });
  if (levels.size === 0) throw new Error('关卡库中没有 level_阵型_路径_难度 数据。');
  return { levels, guides };
};

export const validateCompleteDifficultyFamilies = (library: ThreeModeLevelLibrary): void => {
  const difficultiesByFamily = new Map<string, Set<number>>();
  library.levels.forEach((_level, id) => {
    const parsed = parseFormationId(id);
    const difficulties = difficultiesByFamily.get(parsed.familyId) ?? new Set<number>();
    difficulties.add(parsed.difficulty);
    difficultiesByFamily.set(parsed.familyId, difficulties);
  });
  difficultiesByFamily.forEach((difficulties, familyId) => {
    const missing = Array.from({ length: 10 }, (_, index) => index + 1)
      .filter((difficulty) => !difficulties.has(difficulty));
    if (missing.length > 0) {
      throw new Error(`关卡库 ${familyId} 缺少难度 ${missing.join('、')}。`);
    }
  });
};

const configuredLevelEntries = (value: unknown): Array<{ id: number; data: unknown }> => {
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (!isRecord(entry)) throw new Error(`关卡配置第 ${index + 1} 项必须是对象。`);
      return { id: Number(entry.id ?? entry.levelId), data: entry.data };
    });
  }
  if (!isRecord(value)) throw new Error('关卡配置必须是 JSON 对象或数组。');
  return Object.entries(value).map(([key, entry]) => {
    const keyMatch = CONFIG_LEVEL_ID_PATTERN.exec(key);
    if (!isRecord(entry)) throw new Error(`关卡配置 ${key} 必须是对象。`);
    const id = keyMatch ? Number(keyMatch[1]) : Number(entry.id ?? entry.levelId);
    return { id, data: entry.data };
  });
};

/**
 * 配置 data 中的每个阵型 ID 代表一个阶段。
 * 普通阵型 ID 的尾段是该阶段的默认难度；guide_* 使用固定引导数据。
 */
export const parseThreeModeLevelConfiguration = (value: unknown): ThreeModeConfiguredLevel[] => {
  const seenIds = new Set<number>();
  const levels = configuredLevelEntries(value).map(({ id, data }) => {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('关卡 id 必须是正整数。');
    if (seenIds.has(id)) throw new Error(`关卡 id ${id} 重复。`);
    seenIds.add(id);
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error(`关卡 ${id} data 必须是非空二维数组。`);
    }
    const stages = data.map((entry, stageIndex): ThreeModeConfiguredStage => {
      const formationId = Array.isArray(entry)
        ? entry.length === 1
          ? entry[0]
          : undefined
        : entry;
      if (formationId === undefined) {
        throw new Error(`关卡 ${id} 第 ${stageIndex + 1} 阶段必须只包含一个阵型 ID。`);
      }
      return {
        index: stageIndex,
        formationId: parseConfiguredFormationId(formationId),
      };
    });
    return { id, stages };
  });
  if (levels.length === 0) throw new Error('关卡配置不能为空。');
  return levels.sort((left, right) => left.id - right.id);
};

export const parseThreeModeLevelConfigurationText = (value: string): ThreeModeConfiguredLevel[] => {
  const rows = value.replace(/^\uFEFF/, '').split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);
  if (rows.length < 2 || rows[0] !== 'id\t"levelName"') {
    throw new Error('关卡配置首行必须是 id 和 "levelName"。');
  }
  const payload = rows.slice(1).map((row, index) => {
    const match = /^([1-9]\d*)\t\[(.*)\]$/.exec(row);
    if (!match) throw new Error(`关卡配置第 ${index + 2} 行格式错误。`);
    return {
      id: Number(match[1]),
      data: match[2].split(',').map((id) => id.trim()).filter(Boolean),
    };
  });
  return parseThreeModeLevelConfiguration(payload);
};

export const validateThreeModeConfigurationLibrary = (
  library: ThreeModeLevelLibrary,
  configuration: ReadonlyArray<ThreeModeConfiguredLevel>,
): void => {
  configuration.forEach((configuredLevel) => configuredLevel.stages.forEach((stage) => {
    const configuredId = stage.formationId;
    if (!library.levels.has(configuredId) && !library.guides.has(configuredId)) {
      throw new Error(`关卡 ${configuredLevel.id} 第 ${stage.index + 1} 阶段的 ${configuredId} 不在关卡库中。`);
    }
  }));
};

export const resolveThreeModeStage = (
  library: ThreeModeLevelLibrary,
  configuredLevel: ThreeModeConfiguredLevel,
  options: {
    stage: number;
    targetDifficulty?: number;
    runtimeLevelId?: number;
  },
): ResolvedThreeModeStage => {
  const { stage, targetDifficulty } = options;
  if (!Number.isInteger(stage) || stage < 1 || stage > configuredLevel.stages.length) {
    throw new Error(`关卡 ${configuredLevel.id} 不存在第 ${stage} 阶段。`);
  }
  const configuredStage = configuredLevel.stages[stage - 1];
  const configuredFormationId = configuredStage.formationId;
  const guide = isGuideId(configuredFormationId);
  const defaultDifficulty = guide ? undefined : parseFormationId(configuredFormationId).difficulty;
  const difficulty = guide ? undefined : targetDifficulty ?? defaultDifficulty;
  const formationId = guide
    ? configuredFormationId
    : formationIdAtDifficulty(configuredFormationId, difficulty!);
  const compactLevel = guide ? library.guides.get(formationId) : library.levels.get(formationId);
  if (!compactLevel) {
    throw new Error(`关卡库缺少 ${formationId}（关卡 ${configuredLevel.id} 第 ${stage} 阶段难度 ${difficulty}）。`);
  }
  return {
    levelId: configuredLevel.id,
    stage,
    totalStages: configuredLevel.stages.length,
    configuredFormationId,
    formationId,
    defaultDifficulty,
    difficulty,
    level: {
      ...decodeCompactLevelData(compactLevel, options.runtimeLevelId ?? configuredLevel.id, false),
      formationId,
    },
  };
};

export const loadThreeModeLevelLibrary = async (
  resourcePath = './levels/three-mode-level-library.json',
): Promise<ThreeModeLevelLibrary> => {
  const response = await fetch(resourcePath);
  if (!response.ok) throw new Error('无法加载三模式关卡库。');
  const library = parseThreeModeLevelLibrary(await response.json());
  validateCompleteDifficultyFamilies(library);
  return library;
};

export const loadThreeModeLevelConfiguration = async (
  resourcePath = './levels/three-mode-level-config.txt',
): Promise<ThreeModeConfiguredLevel[]> => {
  const response = await fetch(resourcePath);
  if (!response.ok) throw new Error('无法加载三模式关卡配置。');
  const contentType = response.headers.get('content-type') ?? '';
  return contentType.includes('json')
    ? parseThreeModeLevelConfiguration(await response.json())
    : parseThreeModeLevelConfigurationText(await response.text());
};
