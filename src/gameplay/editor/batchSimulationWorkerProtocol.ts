import type { LevelData } from '../../game/types';
import type {
  BatchPlaytestSimulation,
  BatchPlaytestTask,
} from './batchPlaytest';

export interface BatchSimulationWorkerRequest {
  type: 'simulate';
  jobId: number;
  task: BatchPlaytestTask;
  level: LevelData;
}

export type BatchSimulationWorkerResponse =
  | { type: 'progress'; jobId: number; completed: number; total: number }
  | { type: 'completed'; jobId: number; simulation: BatchPlaytestSimulation }
  | { type: 'error'; jobId: number; message: string };
