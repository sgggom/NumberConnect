import { PathCompletionSolver } from '../../game/pathCompletionSolver';
import { expect, it } from 'vitest';
import { BoardShape, type LevelData } from '../../game/types';
import { clearOcclusion, simulateOccludedPlay } from './occlusionSimulation';
import { summarizeConfigurationRun } from './configurationBatchMetrics';
import { ManualPlaytestStatistics } from './manualPlaytestStatistics';

const path = Array.from({ length: 8 }, (_, x) => ({ x, y: 0 }));
const level: LevelData = { levelId: 1, rows: 1, columns: 8, boardShape: BoardShape.Square,
  activeCells: path, solutionPath: path, hiddenCells: [path[2], path[4]] };
const run = () => {
  const solver = new PathCompletionSolver(path, level.boardShape);
  return simulateOccludedPlay({ level, memorySteps: 0, seed: 1,
    findCompletion: async (request) => solver.findCompletion(request),
    observe: async () => clearOcclusion(path.length) });
};
it('uses exactly the same metrics as auto simulation for the same actual moves', async () => {
  const result = await run();
  const manual = new ManualPlaytestStatistics(level);
  result.frames.forEach((frame) => manual.add(frame));
  expect(manual.finish(result.errors)).toEqual(summarizeConfigurationRun(level, result));
  expect(manual.finish(0)).toMatchObject({ longConnections: 1, mediumConnections: 0, singleCertain: 2 });
});
it('removes abandoned moves on undo, does not double count replayed moves, and keeps the session error total', async () => {
  const result = await run();
  const manual = new ManualPlaytestStatistics(level);
  result.frames.forEach((frame) => manual.add(frame));
  manual.undo(result.frames[4].progress);
  expect(manual.finish(3)).toMatchObject({ longConnections: 0, mediumConnections: 1, errors: 3 });
  result.frames.slice(4).forEach((frame) => manual.add(frame));
  expect(manual.finish(3)).toEqual({ ...summarizeConfigurationRun(level, result), errors: 3 });
});
it('clears prior results for a fresh manual session', async () => {
  const result = await run();
  const manual = new ManualPlaytestStatistics(level);
  result.frames.forEach((frame) => manual.add(frame));
  manual.reset();
  expect(manual.finish(0)).toMatchObject({ longConnections: 0, mediumConnections: 0, singleCertain: 0, errors: 0, total: 8, hidden: 2 });
});
