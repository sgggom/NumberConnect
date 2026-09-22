import type { LevelData } from '../../game/types';
import type { OcclusionGeometry } from './handOcclusion';
import type { HandMode, PlayerConfig, WeightConfig } from './occlusionSimulation';
import type { ConfigurationMetrics } from './configurationBatchMetrics';
export interface ConfigurationSimulationInput {
  level: LevelData; geometry: OcclusionGeometry; mode: HandMode; player: PlayerConfig; weights: WeightConfig;
  seed?: number;
  repetitions?: number;
  assetBaseUrl?: string;
}
export interface ConfigurationSimulationOutput { metrics: ConfigurationMetrics; status: string; repetitions?: number; completedRuns?: number }
export type ConfigurationSimulationRequest = ConfigurationSimulationInput & { jobId: number };
export type ConfigurationSimulationResponse = { jobId: number; result: ConfigurationSimulationOutput } | { jobId: number; error: string } | { jobId: number; progress: number };
