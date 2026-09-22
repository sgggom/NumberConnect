import { simulateOccludedPlay } from './occlusionSimulation';
import { METRIC_COLUMNS, summarizeConfigurationRun, type ConfigurationMetrics } from './configurationBatchMetrics';
import type { ConfigurationSimulationOutput } from './configurationSimulationProtocol';

export async function simulateRepeatedConfiguration(input: Parameters<typeof simulateOccludedPlay>[0], repetitions = 1,
  onProgress?: (completed: number) => void): Promise<ConfigurationSimulationOutput> {
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 1000) throw new Error('模拟次数须为1～1000的整数');
  let sum: ConfigurationMetrics | undefined, completedRuns = 0;
  const stops = new Set<string>();
  for (let index = 0; index < repetitions; index++) {
    const run = await simulateOccludedPlay({ ...input, seed: input.seed === undefined ? undefined : input.seed + index });
    const metrics = summarizeConfigurationRun(input.level, run);
    if (!sum) sum = { ...metrics };
    else for (const [key] of METRIC_COLUMNS) sum[key] += metrics[key];
    if (run.complete) completedRuns++; else stops.add(run.stoppedReason ?? '未完成');
    onProgress?.(index + 1);
  }
  for (const [key] of METRIC_COLUMNS) sum![key] /= repetitions;
  return { metrics: sum!, repetitions, completedRuns,
    status: completedRuns === repetitions ? `已通关（${completedRuns}/${repetitions}次）`
      : `通关${completedRuns}/${repetitions}次；${[...stops].join('；')}` };
}
