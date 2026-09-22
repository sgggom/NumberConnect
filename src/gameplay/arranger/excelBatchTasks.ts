import type { ArrangementLibraryIndex } from './levelArrangement';
import type { ConfigurationBatchTask } from './configurationBatchTasks';

/** One task per imported Excel row; no arrangement, selection, path or difficulty filtering. */
export function createExcelBatchTasks(levels: readonly ArrangementLibraryIndex[], fileName: string): ConfigurationBatchTask[] {
  return levels.map((level) => ({ configuration: fileName, groupId: level.sourceRow, stage: 1,
    id: level.id, configuredId: level.id, difficulty: level.difficultyId ?? level.difficulty }));
}
