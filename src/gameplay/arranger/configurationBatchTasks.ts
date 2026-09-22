import type { ArrangementLevelGroup, ArrangementLibraryIndex } from './levelArrangement';

export interface ConfigurationBatchTask {
  groupId: number; stage: number; id: string; configuredId: string; difficulty?: number;
  configuration?: string;
}

export interface ConfigurationBatchScope {
  configurations: string[]; difficulties: number[]; range?: { from: number; to: number };
}
export function filterConfigurationBatchTasks(tasks: readonly ConfigurationBatchTask[], scope: ConfigurationBatchScope): ConfigurationBatchTask[] {
  const modes = new Set(scope.configurations), difficulties = new Set(scope.difficulties);
  const range = scope.range;
  if (range && (!Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 1 || range.from > range.to)) return [];
  return tasks.filter((task) => modes.has(task.configuration ?? '') && difficulties.has(task.difficulty ?? 0)
    && (!range || (task.groupId >= range.from && task.groupId <= range.to)));
}

export function createConfigurationBatchTasks(groups: readonly ArrangementLevelGroup[], library: readonly ArrangementLibraryIndex[]): ConfigurationBatchTask[] {
  const byId = new Map(library.map((level) => [level.id, level]));
  const pathKey = (level: ArrangementLibraryIndex) => level.formationId !== undefined && level.pathId !== undefined
    ? JSON.stringify(['id', level.formationId, level.pathId]) : JSON.stringify(['path', level.boardKey, level.pathKey]);
  const byPath = new Map<string, ArrangementLibraryIndex[]>();
  for (const level of library) {
    const key = pathKey(level), levels = byPath.get(key) ?? [];
    levels.push(level); byPath.set(key, levels);
  }
  return groups.flatMap((group) => group.levelIds.flatMap((configuredId, index) => {
    const configured = byId.get(configuredId);
    const base = { groupId: group.id, stage: index + 1, configuredId };
    // Missing entries remain visible as failed tasks rather than silently disappearing.
    if (!configured) return [{ ...base, id: configuredId }];
    const levels = (byPath.get(pathKey(configured)) ?? [configured])
      .filter((level) => level.id === configuredId || (level.difficultyId ?? level.difficulty) !== undefined)
      .slice().sort((a, b) => (a.difficultyId ?? a.difficulty ?? Infinity) - (b.difficultyId ?? b.difficulty ?? Infinity)
        || a.sourceRow - b.sourceRow);
    return [...new Map(levels.map((level) => [level.id, level])).values()].map((level) => ({ ...base,
      id: level.id, difficulty: level.difficultyId ?? level.difficulty }));
  }));
}
