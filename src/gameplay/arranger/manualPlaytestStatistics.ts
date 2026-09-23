import type { LevelData } from '../../game/types';
import { createConfigurationMetricsAccumulator, type ConfigurationMetrics } from './configurationBatchMetrics';
import type { SimulationFrame } from './occlusionSimulation';

/** Keep only this manual session's attempts; undo removes the abandoned path. */
export class ManualPlaytestStatistics {
  private frames: SimulationFrame[] = [];
  constructor(private readonly level: LevelData) {}
  add(frame: SimulationFrame): void { this.frames.push(frame); }
  undo(progress: number): void { this.frames = this.frames.filter((frame) => frame.progress < progress); }
  reset(): void { this.frames = []; }
  finish(errors: number): ConfigurationMetrics {
    const accumulator = createConfigurationMetricsAccumulator(this.level);
    this.frames.forEach(accumulator.add);
    return accumulator.finish(errors);
  }
}
