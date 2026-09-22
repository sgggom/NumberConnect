import { describe, expect, it } from 'vitest';
import { BoardShape, type LevelData } from '../../game/types';
import { PathCompletionSolver } from '../../game/pathCompletionSolver';
import { clearOcclusion, simulateOccludedPlay } from './occlusionSimulation';
import { METRIC_COLUMNS, summarizeConfigurationRun } from './configurationBatchMetrics';
import { simulateRepeatedConfiguration } from './repeatedConfigurationSimulation';

const cells = [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
const level: LevelData = { levelId: 1, rows: 2, columns: 4, boardShape: BoardShape.Square, activeCells: cells, solutionPath: cells, hiddenCells: [cells[5]] };
function input() {
  const solver = new PathCompletionSolver(cells, level.boardShape);
  const occlusion = clearOcclusion(7); occlusion[1] = { coverage: 1, numberBlocked: true };
  return { level, seed: 0, memorySteps: 0, player: { reasoning: 'low' as const, normal: .5, afterError: 1 },
    observe: async () => occlusion, findCompletion: async (request: Parameters<typeof solver.findCompletion>[0]) => solver.findCompletion(request) };
}
describe('repeated batch results', () => {
  it('averages independently reset runs and preserves static counts and progress', async () => {
    const progress: number[] = [];
    const result = await simulateRepeatedConfiguration(input(), 6, (count) => progress.push(count));
    const individual = await Promise.all(Array.from({ length: 6 }, async (_, seed) =>
      summarizeConfigurationRun(level, await simulateOccludedPlay({ ...input(), seed }))));
    for (const [key] of METRIC_COLUMNS) {
      expect(result.metrics[key]).toBeCloseTo(individual.reduce((sum, metrics) => sum + metrics[key], 0) / 6);
    }
    expect(result.metrics.total).toBe(7); expect(result.metrics.hidden).toBe(1);
    expect(result.metrics.errors).toBeGreaterThan(0); expect(result.metrics.errors).toBeLessThan(1);
    expect(result.completedRuns).toBe(6); expect(result.repetitions).toBe(6);
    expect(progress).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('does not publish a partial average after cancellation', async () => {
    const abort = new AbortController();
    await expect(simulateRepeatedConfiguration({ ...input(), signal: abort.signal }, 3, () => abort.abort()))
      .rejects.toMatchObject({ name: 'AbortError' });
  });
  it.each([0, -1, 1.5, NaN, 1001])('rejects invalid repetition count %s', async (count) => {
    await expect(simulateRepeatedConfiguration(input(), count)).rejects.toThrow('模拟次数');
  });
});
