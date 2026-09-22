import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConfigurationBatchPanel } from './ConfigurationBatchPanel';
import { listBatchHistory, loadBatchHistoryResults, loadBatchResumePlan } from './configurationBatchHistory';
import { readConfigurationBatchSettings } from './configurationBatchSettings';
import { simulateRepeatedConfiguration } from './repeatedConfigurationSimulation';
import type { LevelData } from '../../game/types';

vi.mock('./handOcclusion', () => ({ HandOcclusionSampler: class { observe() {} dispose() {} } }));
vi.mock('./repeatedConfigurationSimulation', () => ({ simulateRepeatedConfiguration: vi.fn() }));
class Element {
  append() {} setAttribute() {} addEventListener() {} replaceChildren() {} showModal() {} close() {}
}
class Rect {
  constructor(public x: number, public y: number, public width: number, public height: number) {}
  get left() { return this.x; } get top() { return this.y; }
  get right() { return this.x + this.width; } get bottom() { return this.y + this.height; }
}
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('document', { createElement: () => new Element() });
  vi.stubGlobal('DOMRect', Rect);
  vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 900, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('Worker', undefined);
  vi.mocked(simulateRepeatedConfiguration).mockReset().mockImplementation(async (_, repetitions) => ({
    repetitions, completedRuns: repetitions, status: '已通关', metrics: { total: 2, hidden: 1, longConnections: 0, mediumConnections: 0, singleCertain: 0, singleMisleading: 0, twoGapOne: 0, twoGapTwo: 0, multiple: 0, bottlenecks: 0, errors: 0 },
  }));
});
afterEach(() => vi.unstubAllGlobals());
it('continues a cancelled batch in a new panel, preserving its parameters, saved results and original task order', async () => {
  const tasks = ['a', 'b', 'c'].map((id, order) => ({ id, configuredId: id, groupId: 1, stage: order + 1 }));
  const level = { rows: 1, columns: 2, solutionPath: [{ x: 0, y: 0 }, { x: 1, y: 0 }] } as LevelData;
  const load = vi.fn(async () => level);
  const first = new ConfigurationBatchPanel(new Element() as unknown as HTMLElement);
  const settings = readConfigurationBatchSettings(); settings.handSize = .65;
  await first.run('原配置', tasks, new DOMRect(200, 80, 360, 640), load, () => first.cancel(), 7, settings, { libraryId: 'original', scope: '原范围' });
  const [entry] = await listBatchHistory();
  expect(entry.saved).toBe(1);
  expect(await loadBatchResumePlan(entry.id)).toMatchObject({ board: { x: 200, y: 80, width: 360, height: 640 } });
  const originalResult = (await loadBatchHistoryResults(entry.id))[0];
  load.mockClear();
  const second = new ConfigurationBatchPanel(new Element() as unknown as HTMLElement);
  await second.run('已更改配置', [], new DOMRect(0, 0, 1, 1), load, undefined, 1, undefined, undefined, entry);
  expect(load.mock.calls).toHaveLength(2);
  expect(vi.mocked(simulateRepeatedConfiguration).mock.calls.map((call) => call[1])).toEqual([7, 7, 7]);
  expect((await listBatchHistory())).toHaveLength(1);
  expect((await listBatchHistory())[0]).toMatchObject({ id: entry.id, name: '原配置', saved: 3, total: 3, status: '计算完成', settings });
  const results = await loadBatchHistoryResults(entry.id);
  expect(results.map((row) => row.id)).toEqual(['a', 'b', 'c']);
  expect(results[0]).toEqual(originalResult);
});
