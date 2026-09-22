import { describe, expect, it } from 'vitest';
import { BoardShape, type LevelData } from '../../game/types';
import { clearOcclusion, type SimulationFrame, type OcclusionRun } from './occlusionSimulation';
import { classifyConfigurationFrame, createConfigurationMetricsAccumulator, isUnambiguousConnection, summarizeConfigurationRun, csvCell } from './configurationBatchMetrics';

const cells = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 }];
const level: LevelData = { levelId: 1, rows: 3, columns: 3, boardShape: BoardShape.Square,
  activeCells: cells, solutionPath: cells, hiddenCells: [cells[1], cells[2]] };
function frame(labels: Array<number | null>, extra: Partial<SimulationFrame> = {}): SimulationFrame {
  return { step: 1, current: 0, correctNext: 1, attempted: 1, outcome: 'connected', reason: '', candidates: [],
    neighborhood: [], knownNumbers: [], labels, edges: [], occlusion: clearOcclusion(5),
    observation: { observed: false, forced: false, probability: 0 }, errors: 0, progress: 1,
    after: { labels, edges: [[0, 1]], errors: 0, progress: 2, complete: false }, ...extra };
}
describe('configuration batch metric definitions', () => {
  it('distinguishes one certain hidden neighbor from one misleading unblocked neighbor', () => {
    expect(classifyConfigurationFrame(level, frame([1, null, 3, 4, 5])).singleCertain).toBe(1);
    const occlusion = clearOcclusion(5); occlusion[1].numberBlocked = true;
    const input = frame([1, 2, null, 4, 5], { occlusion });
    expect(classifyConfigurationFrame(level, input).singleMisleading).toBe(1);
    occlusion[2].numberBlocked = true;
    expect(classifyConfigurationFrame(level, input).singleMisleading).toBe(0);
  });
  it('counts two visible empty slots with one or two intervening numbers', () => {
    expect(classifyConfigurationFrame(level, frame([1, null, 3, null, 5])).twoGapOne).toBe(1);
    expect(classifyConfigurationFrame(level, frame([1, null, null, 4, 5])).twoGapTwo).toBe(1);
    const occlusion = clearOcclusion(5); occlusion[1].numberBlocked = true;
    expect(classifyConfigurationFrame(level, frame([1, null, null, 4, 5], { occlusion })).twoGapTwo).toBe(0);
  });
  it('uses numeric gap 5→8 = 2, even when the displayed anchor is covered', () => {
    const occlusion = clearOcclusion(5); occlusion[3].numberBlocked = true;
    expect(classifyConfigurationFrame(level, frame([5, null, null, 8, 9], { occlusion })).twoGapTwo).toBe(1);
  });
  it('counts multiple empty slots and excludes already connected hidden slots', () => {
    expect(classifyConfigurationFrame(level, frame([1, null, null, null, 5])).multiple).toBe(1);
    expect(classifyConfigurationFrame(level, frame([1, null, null, null, 5], { edges: [[0, 1]] })).multiple).toBe(0);
  });
  it('deduplicates situations and forced observations but preserves every error', () => {
    const first = frame([1, null, 3, 4, 5]);
    const retry = { ...first, observation: { observed: true, forced: true, probability: 1 } };
    const run: OcclusionRun = { complete: true, attempts: 3, errors: 2, directChoices: 0, coveredNextSteps: 0,
      meanCoverage: 0, ambiguity: 0, frames: [first, retry, retry], finalLabels: [], finalEdges: [] };
    expect(summarizeConfigurationRun(level, run)).toMatchObject({ total: 5, hidden: 2, singleCertain: 1, bottlenecks: 1, errors: 2 });
  });
  it('quotes CSV IDs and prevents spreadsheet formula interpretation', () => {
    expect(csvCell('level,"1"')).toBe('"level,""1"""');
    expect(csvCell('=1+1')).toBe('"\'=1+1"');
  });
});

function straightRun(length: number, hiddenIndices: number[] = []) {
  const path = Array.from({ length: length + 1 }, (_, x) => ({ x, y: 0 }));
  const level: LevelData = { levelId: 1, rows: 2, columns: length + 1, boardShape: BoardShape.Square,
    activeCells: path, solutionPath: path, hiddenCells: hiddenIndices.map((i) => path[i]) };
  const frames = Array.from({ length }, (_, current) => {
    const labels = path.map((_, i) => hiddenIndices.includes(i) && i > current ? null : i + 1);
    const edges = Array.from({ length: current }, (_, i) => [i, i + 1] as const);
    return frame(labels, { current, correctNext: current + 1, attempted: current + 1,
      progress: current + 1, edges, occlusion: clearOcclusion(path.length),
      after: { labels, edges: [...edges, [current, current + 1]], errors: 0, progress: current + 2, complete: current === length - 1 } });
  });
  return { level, frames };
}
function countConnections(input: ReturnType<typeof straightRun>) {
  const accumulator = createConfigurationMetricsAccumulator(input.level);
  input.frames.forEach(accumulator.add);
  return accumulator.finish();
}
describe('maximal non-overlapping connection segments', () => {
  it.each([[3, 0, 0], [4, 0, 1], [6, 0, 1], [7, 1, 0], [8, 1, 0], [14, 1, 0]])(
    'counts %i consecutive edges as %i long and %i medium segments', (length, longConnections, mediumConnections) => {
      expect(countConnections(straightRun(length))).toMatchObject({ longConnections, mediumConnections });
    });
  it('allows a segment mixing certain hidden steps and direct displayed steps', () => {
    expect(countConnections(straightRun(7, [1, 3, 4, 6]))).toMatchObject({ longConnections: 1, mediumConnections: 0 });
  });
  it('splits on hidden distractions, including covered ones, and counts both end segments', () => {
    const input = straightRun(14);
    input.level.solutionPath.push({ x: 5, y: 1 });
    input.frames.forEach((frame) => {
      frame.labels.push(null);
      frame.occlusion.push({ coverage: 1, numberBlocked: true });
    });
    expect(countConnections(input)).toMatchObject({ longConnections: 1, mediumConnections: 1 });
  });
  it('excludes connected empty slots from interference and rejects multiple hidden choices', () => {
    const input = frame([1, null, 3, null, 5]);
    expect(isUnambiguousConnection(level, input)).toBe(false);
    expect(isUnambiguousConnection(level, { ...input, edges: [[0, 3]] })).toBe(true);
    expect(isUnambiguousConnection(level, frame([1, 2, 3, null, 5]))).toBe(false);
    expect(isUnambiguousConnection(level, frame([1, 2, 3, 4, 5]))).toBe(true);
  });
  it('does not count retries as extra edges or mutate counts when finish is read repeatedly', () => {
    const input = straightRun(6, [1, 2, 3, 4, 5]);
    const error = { ...input.frames[2], outcome: 'error' as const };
    input.frames.splice(2, 0, error, error);
    const accumulator = createConfigurationMetricsAccumulator(input.level);
    input.frames.forEach(accumulator.add);
    expect(accumulator.finish()).toMatchObject({ longConnections: 0, mediumConnections: 1 });
    expect(accumulator.finish()).toEqual(accumulator.finish());
  });
  it('counts only successfully connected edges when the run stops before its next move', () => {
    const input = straightRun(7);
    input.frames[6].outcome = 'error';
    expect(countConnections(input)).toMatchObject({ longConnections: 0, mediumConnections: 1 });
  });
});
