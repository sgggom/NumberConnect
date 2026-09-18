import type { EditorAlgorithmResult } from './algorithms/types';
import type { BatchPlaytestTask } from './batchPlaytest';

export interface ProgressiveHiddenWorkerRequest {
  type: 'generate-chain';
  jobId: number;
  tasks: BatchPlaytestTask[];
  timeoutMs: number;
}

export type ProgressiveHiddenWorkerResponse =
  | {
    type: 'progress';
    jobId: number;
    completed: number;
    total: number;
    difficulty: number;
  }
  | {
    type: 'completed';
    jobId: number;
    results: EditorAlgorithmResult[];
  }
  | {
    type: 'failed';
    jobId: number;
    message: string;
  };
