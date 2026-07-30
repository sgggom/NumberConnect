import type {
  Algorithm4BatchTask,
  Algorithm4BatchTaskResult,
} from './batchLevelGeneration';

export interface Algorithm4BatchWorkerRequest {
  type: 'generate';
  task: Algorithm4BatchTask;
}

export type Algorithm4BatchWorkerResponse =
  | {
      type: 'completed';
      result: Algorithm4BatchTaskResult;
    }
  | {
      type: 'error';
      taskIndex: number;
      message: string;
    };
