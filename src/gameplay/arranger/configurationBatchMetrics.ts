import { areNeighborCells } from '../../game/topology';
import { cellKey, type LevelData } from '../../game/types';
import { nextDisplayedIndex, type OcclusionRun, type SimulationFrame } from './occlusionSimulation';

export interface ConfigurationMetrics {
  total: number; hidden: number; singleCertain: number; singleMisleading: number;
  twoGapOne: number; twoGapTwo: number; multiple: number; bottlenecks: number; errors: number;
}
export const METRIC_COLUMNS: ReadonlyArray<readonly [keyof ConfigurationMetrics, string]> = [
  ['total', '总数字数量'], ['hidden', '隐藏数字数量'], ['singleCertain', '空1必中数量'],
  ['singleMisleading', '空1误导数量'], ['twoGapOne', '2选1'], ['twoGapTwo', '2空位间隔2'],
  ['multiple', '多空位'], ['bottlenecks', '卡点'], ['errors', '错误次数'],
];

export function classifyConfigurationFrame(level: LevelData, frame: SimulationFrame) {
  const visited = new Set(frame.edges.flatMap(([a, b]) => [a, b])); visited.add(frame.current);
  const hidden = level.solutionPath.flatMap((cell, i) => !visited.has(i) && frame.labels[i] === null
    && areNeighborCells(level.solutionPath[frame.current], cell, level.boardShape) ? [i] : []);
  const unblocked = hidden.filter((i) => !frame.occlusion[i].numberBlocked);
  const currentNumber = frame.labels[frame.current] ?? frame.progress;
  const anchor = nextDisplayedIndex(frame.labels, currentNumber + 1);
  const gap = anchor === undefined ? undefined : frame.labels[anchor]! - currentNumber - 1;
  return {
    singleCertain: Number(hidden.length === 1 && hidden[0] === frame.correctNext),
    singleMisleading: Number(hidden.length === 1 && hidden[0] !== frame.correctNext
      && frame.correctNext !== undefined && frame.occlusion[frame.correctNext].numberBlocked && unblocked.length === 1),
    twoGapOne: Number(unblocked.length === 2 && gap === 1),
    twoGapTwo: Number(unblocked.length === 2 && gap === 2),
    multiple: Number(unblocked.length >= 3),
  };
}

export function createConfigurationMetricsAccumulator(level: LevelData) {
  const hiddenKeys = new Set((level.hiddenCells ?? []).map(cellKey));
  const result: ConfigurationMetrics = {
    total: level.solutionPath.length,
    hidden: level.solutionPath.filter((cell, i) => i > 0 && i < level.solutionPath.length - 1 && hiddenKeys.has(cellKey(cell))).length,
    singleCertain: 0, singleMisleading: 0, twoGapOne: 0, twoGapTwo: 0, multiple: 0, bottlenecks: 0, errors: 0,
  };
  const positions = new Set<number>(), bottlenecks = new Set<number>();
  const add = (frame: SimulationFrame) => {
    result.errors = frame.after.errors;
    if (frame.observation.forced) bottlenecks.add(frame.current);
    if (positions.has(frame.current)) return;
    positions.add(frame.current);
    const counts = classifyConfigurationFrame(level, frame);
    for (const key of Object.keys(counts) as Array<keyof typeof counts>) result[key] += counts[key];
  }
  return { add, finish: (errors = result.errors): ConfigurationMetrics => ({ ...result, errors, bottlenecks: bottlenecks.size }) };
}

export function summarizeConfigurationRun(level: LevelData, run: OcclusionRun): ConfigurationMetrics {
  const accumulator = createConfigurationMetricsAccumulator(level);
  run.frames.forEach(accumulator.add);
  return accumulator.finish(run.errors);
}

export function csvCell(value: string | number): string {
  const text = String(value);
  const safe = typeof value === 'string' && /^[=+@\-\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
