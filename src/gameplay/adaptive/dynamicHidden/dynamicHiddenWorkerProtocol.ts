import type {
  DynamicHiddenGenerationInput,
  DynamicHiddenGenerationResult,
} from './dynamicHiddenGenerator';

export interface DynamicHiddenWorkerRequest {
  type: 'generate';
  jobId: number;
  input: DynamicHiddenGenerationInput;
}

export type DynamicHiddenWorkerResponse =
  | { type: 'completed'; jobId: number; result: DynamicHiddenGenerationResult }
  | { type: 'error'; jobId: number; message: string };
