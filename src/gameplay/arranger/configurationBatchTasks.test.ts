import { describe, expect, it } from 'vitest';
import { createConfigurationBatchTasks, filterConfigurationBatchTasks } from './configurationBatchTasks';
import type { ArrangementLibraryIndex } from './levelArrangement';

const entry = (id: string, difficultyId: number, extra: Partial<ArrangementLibraryIndex> = {}): ArrangementLibraryIndex => ({
  id, difficultyId, formationId: 'n1', pathId: 2, boardKey: 'board', pathKey: 'path', shapeName: '正方形',
  sourceRow: difficultyId, sourceName: id, configId: id, rows: 2, columns: 2, pathMetrics: { directionRatios: {} }, difficultyMetrics: {}, ...extra,
});
describe('configuration batch includes every difficulty', () => {
  it('filters configuration, inclusive group range and difficulty together', () => {
    const tasks = ['main', 'daily', 'bead'].flatMap((configuration) => [1, 2, 3].flatMap((groupId) =>
      [undefined, 1, 2, 3].map((difficulty) => ({ configuration, groupId, stage: 1, id: `${configuration}-${groupId}-${difficulty}`, configuredId: 'source', difficulty }))));
    const selected = filterConfigurationBatchTasks(tasks, { configurations: ['main', 'daily'], difficulties: [0, 2], range: { from: 2, to: 3 } });
    expect(selected).toHaveLength(8);
    expect(selected.every((task) => task.configuration !== 'bead' && task.groupId >= 2 && (task.difficulty === undefined || task.difficulty === 2))).toBe(true);
    expect(filterConfigurationBatchTasks(tasks, { configurations: [], difficulties: [0, 1] })).toEqual([]);
    expect(filterConfigurationBatchTasks(tasks, { configurations: ['main'], difficulties: [] })).toEqual([]);
    expect(filterConfigurationBatchTasks(tasks, { configurations: ['main'], difficulties: [1], range: { from: 3, to: 2 } })).toEqual([]);
    expect(filterConfigurationBatchTasks(tasks, { configurations: ['main'], difficulties: [1], range: { from: NaN, to: 2 } })).toEqual([]);
  });
  it('expands each configured slot in difficulty order without mixing other paths or formations', () => {
    const library = [entry('hard', 10), entry('easy', 1), entry('medium', 5),
      entry('other-path', 2, { pathId: 3 }), entry('other-board', 3, { formationId: 'n2' }), entry('extra', 11)];
    const tasks = createConfigurationBatchTasks([{ id: 7, levelIds: ['hard'] }], library);
    expect(tasks.map((task) => task.id)).toEqual(['easy', 'medium', 'hard', 'extra']);
    expect(tasks.every((task) => task.groupId === 7 && task.stage === 1 && task.configuredId === 'hard')).toBe(true);
  });
  it('keeps all variants and repeated configuration slots, but does not double-count the selected difficulty', () => {
    const tasks = createConfigurationBatchTasks([{ id: 1, levelIds: ['a', 'a'] }], [entry('a', 1), entry('b', 1), entry('c', 2)]);
    expect(tasks.map((task) => task.id)).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
    expect(tasks.map((task) => task.stage)).toEqual([1, 1, 1, 2, 2, 2]);
  });
  it('matches actual board/path keys when IDs are absent and retains missing entries for error reporting', () => {
    const library = [entry('a', 1, { formationId: undefined, pathId: undefined }),
      entry('b', 2, { formationId: undefined, pathId: undefined }),
      entry('c', 3, { formationId: undefined, pathId: undefined, pathKey: 'other' })];
    expect(createConfigurationBatchTasks([{ id: 1, levelIds: ['a', 'missing'] }], library).map((task) => task.id))
      .toEqual(['a', 'b', 'missing']);
  });
});
