import type { BoardHoldScore } from './types';
import type { CompletionAwareScoreRequest } from './completionAwareScore';

export interface CompletionAwareScoreWorkerRequest {
  type: 'score';
  request: CompletionAwareScoreRequest;
}

export type CompletionAwareScoreWorkerResponse =
  | { type: 'completed'; score: BoardHoldScore }
  | { type: 'error'; message: string };
