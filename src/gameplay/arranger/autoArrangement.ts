import type {
  ArrangementBoardFamily,
  ArrangementLevelGroup,
  ArrangementPathFamily,
} from './levelArrangement';

export interface AutoArrangementStage {
  startLevel: number;
  endLevel: number;
  formationIds: number[];
}

export interface AutoArrangementConfig {
  boardsPerLevel: number;
  pathRepeatInterval: number;
  stages: AutoArrangementStage[];
}

export const parseFormationIdRange = (value: string): number[] => {
  const ids = new Set<number>();
  value.split(/[,，\s]+/).filter(Boolean).forEach((part) => {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start > end) throw new Error(`阵型范围“${part}”起始值不能大于结束值。`);
      for (let id = start; id <= end; id += 1) ids.add(id);
      return;
    }
    if (!/^\d+$/.test(part)) throw new Error(`无法识别阵型范围“${part}”。`);
    ids.add(Number(part));
  });
  if (ids.size === 0) throw new Error('每个阶段至少需要选择一个阵型。');
  return [...ids].sort((left, right) => left - right);
};

export const generateAutoArrangement = (
  families: ReadonlyArray<ArrangementBoardFamily>,
  config: AutoArrangementConfig,
): ArrangementLevelGroup[] => {
  if (!Number.isInteger(config.boardsPerLevel) || config.boardsPerLevel < 1) {
    throw new Error('每关棋盘数量必须是大于 0 的整数。');
  }
  if (!Number.isInteger(config.pathRepeatInterval) || config.pathRepeatInterval < 0) {
    throw new Error('相同路径重复间隔必须是非负整数。');
  }
  const stages = [...config.stages].sort((left, right) => left.startLevel - right.startLevel);
  if (stages.length === 0) throw new Error('至少需要配置一个阶段。');
  stages.forEach((stage, index) => {
    if (!Number.isInteger(stage.startLevel) || !Number.isInteger(stage.endLevel) || stage.startLevel < 1 || stage.endLevel < stage.startLevel) {
      throw new Error(`阶段 ${index + 1} 的关卡范围无效。`);
    }
    if (index === 0 && stage.startLevel !== 1) throw new Error('第一个阶段必须从第 1 关开始。');
    if (index > 0 && stage.startLevel !== stages[index - 1].endLevel + 1) {
      throw new Error(`阶段 ${index + 1} 必须从第 ${stages[index - 1].endLevel + 1} 关开始。`);
    }
  });

  const familyById = new Map(families.flatMap((family) => (
    family.representative.formationId === undefined ? [] : [[family.representative.formationId, family] as const]
  )));
  const lastUsedLevel = new Map<string, number>();
  const difficultyCursor = new Map<string, number>();
  const groups: ArrangementLevelGroup[] = [];
  let rotationCursor = 0;

  stages.forEach((stage, stageIndex) => {
    const missingIds = stage.formationIds.filter((id) => !familyById.has(id));
    if (missingIds.length > 0) throw new Error(`阶段 ${stageIndex + 1} 找不到阵型：${missingIds.join('、')}。`);
    const paths = stage.formationIds.flatMap((id) => familyById.get(id)!.paths.map((path) => ({
      formationId: id,
      path,
      key: `${id}:${path.key}`,
    })));
    if (paths.length === 0) throw new Error(`阶段 ${stageIndex + 1} 没有可用路径。`);

    for (let levelNumber = stage.startLevel; levelNumber <= stage.endLevel; levelNumber += 1) {
      const levelIds: string[] = [];
      for (let slot = 0; slot < config.boardsPerLevel; slot += 1) {
        const selection = findAvailablePath(paths, rotationCursor, levelNumber, config.pathRepeatInterval, lastUsedLevel);
        if (!selection) {
          throw new Error(`第 ${levelNumber} 关无法满足路径间隔 ${config.pathRepeatInterval}，请扩大阵型范围或减小间隔。`);
        }
        rotationCursor = (selection.index + 1) % paths.length;
        const difficulty = chooseDifficulty(selection.path.path, selection.path.key, difficultyCursor);
        levelIds.push(difficulty.representative.id);
        lastUsedLevel.set(selection.path.key, levelNumber);
      }
      groups.push({ id: levelNumber, levelIds });
    }
  });
  return groups;
};

const findAvailablePath = (
  paths: ReadonlyArray<{ formationId: number; path: ArrangementPathFamily; key: string }>,
  startIndex: number,
  levelNumber: number,
  interval: number,
  lastUsedLevel: ReadonlyMap<string, number>,
): { path: { formationId: number; path: ArrangementPathFamily; key: string }; index: number } | undefined => {
  for (let offset = 0; offset < paths.length; offset += 1) {
    const index = (startIndex + offset) % paths.length;
    const path = paths[index];
    const lastUsed = lastUsedLevel.get(path.key);
    if (lastUsed === undefined || levelNumber - lastUsed >= interval) return { path, index };
  }
  return undefined;
};

const chooseDifficulty = (
  path: ArrangementPathFamily,
  key: string,
  cursors: Map<string, number>,
): ArrangementPathFamily['difficulties'][number] => {
  if (path.difficulties.length === 0) throw new Error('路径缺少难度数据。');
  const cursor = cursors.get(key) ?? 0;
  cursors.set(key, cursor + 1);
  return path.difficulties[cursor % path.difficulties.length];
};
