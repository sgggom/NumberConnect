import { calculateCompletionAwareScore, type CompletionAwareScoreRequest } from './completionAwareScore';
import type { BoardHoldScore } from './types';
import type {
  CompletionAwareScoreWorkerRequest,
  CompletionAwareScoreWorkerResponse,
} from './completionAwareScoreWorkerProtocol';

const runOnCurrentThread = (request: CompletionAwareScoreRequest): Promise<BoardHoldScore> => (
  new Promise((resolve) => {
    globalThis.setTimeout(() => resolve(calculateCompletionAwareScore(request)), 0);
  })
);

export const calculateCompletionAwareScoreInWorker = (
  request: CompletionAwareScoreRequest,
): Promise<BoardHoldScore> => {
  if (typeof Worker === 'undefined') return runOnCurrentThread(request);

  let worker: Worker;
  try {
    worker = new Worker(new URL('./completionAwareScore.worker.ts', import.meta.url), {
      type: 'module',
      name: 'completion-aware-score',
    });
  } catch {
    return runOnCurrentThread(request);
  }

  return new Promise((resolve, reject) => {
    const finish = (): void => worker.terminate();
    worker.addEventListener('message', (event: MessageEvent<CompletionAwareScoreWorkerResponse>) => {
      finish();
      if (event.data.type === 'completed') resolve(event.data.score);
      else reject(new Error(event.data.message));
    }, { once: true });
    worker.addEventListener('error', (event) => {
      event.preventDefault();
      finish();
      reject(new Error(event.message || '难度评分线程加载失败。'));
    }, { once: true });
    worker.addEventListener('messageerror', () => {
      finish();
      reject(new Error('难度评分线程返回了无法读取的数据。'));
    }, { once: true });
    const workerRequest: CompletionAwareScoreWorkerRequest = { type: 'score', request };
    worker.postMessage(workerRequest);
  });
};
