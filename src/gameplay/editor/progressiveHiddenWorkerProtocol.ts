import type { EditorAlgorithmResult } from './algorithms/types';
import type { BatchPlaytestTask } from './batchPlaytest';
import type { EditorCell } from './types';
import type { HiddenTargetSearch } from './targetHiddenLayout';

export interface ProgressiveHiddenWorkerRequest {
  type: 'generate-chain';
  jobId: number;
  tasks: BatchPlaytestTask[];
  timeoutMs: number;
  search?: HiddenTargetSearch & { previousHiddenCells?: EditorCell[] };
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
    errorName?: string;
  };
