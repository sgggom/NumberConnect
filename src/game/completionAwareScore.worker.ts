import { calculateCompletionAwareScore } from './completionAwareScore';
import type {
  CompletionAwareScoreWorkerRequest,
  CompletionAwareScoreWorkerResponse,
} from './completionAwareScoreWorkerProtocol';

interface ScoreWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<CompletionAwareScoreWorkerRequest>) => void,
  ): void;
  postMessage(message: CompletionAwareScoreWorkerResponse): void;
}

const workerScope = globalThis as unknown as ScoreWorkerScope;

workerScope.addEventListener('message', (event) => {
  if (event.data.type !== 'score') return;
  try {
    workerScope.postMessage({
      type: 'completed',
      score: calculateCompletionAwareScore(event.data.request),
    });
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : '难度评分计算失败。',
    });
  }
});
