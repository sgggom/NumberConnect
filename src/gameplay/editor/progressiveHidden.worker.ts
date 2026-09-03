import type { EditorCell } from './types';
import type { EditorAlgorithmResult } from './algorithms/types';
import {
  BATCH_HIDDEN_CHAIN_MAX_ATTEMPTS,
  createProgressiveBatchHiddenResult,
} from './batchPlaytest';
import type {
  ProgressiveHiddenWorkerRequest,
  ProgressiveHiddenWorkerResponse,
} from './progressiveHiddenWorkerProtocol';

interface ProgressiveHiddenWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<ProgressiveHiddenWorkerRequest>) => void,
  ): void;
  postMessage(message: ProgressiveHiddenWorkerResponse): void;
}

const workerScope = globalThis as unknown as ProgressiveHiddenWorkerScope;

const generateChain = (
  request: ProgressiveHiddenWorkerRequest,
): EditorAlgorithmResult[] => {
  const deadlineAt = Date.now() + request.timeoutMs;
  let generationError = '';
  for (let attempt = 0; attempt < BATCH_HIDDEN_CHAIN_MAX_ATTEMPTS; attempt += 1) {
    const results: EditorAlgorithmResult[] = [];
    let previousHiddenCells: ReadonlyArray<EditorCell> | undefined;
    try {
      for (const task of request.tasks) {
        const generated = createProgressiveBatchHiddenResult(
          task,
          previousHiddenCells,
          attempt,
          deadlineAt,
        );
        results.push(generated);
        previousHiddenCells = generated.hiddenCells;
        workerScope.postMessage({
          type: 'progress',
          jobId: request.jobId,
          completed: results.length,
          total: request.tasks.length,
          difficulty: task.config.targetDifficulty,
        });
      }
      return results;
    } catch (error) {
      generationError = error instanceof Error ? error.message : '累进隐藏生成失败';
      if (error instanceof Error && error.name === 'ProgressiveHiddenTimeoutError') throw error;
    }
  }
  throw new Error(generationError || '累进隐藏生成失败。');
};

workerScope.addEventListener('message', (event) => {
  const request = event.data;
  if (request.type !== 'generate-chain') return;
  try {
    workerScope.postMessage({
      type: 'completed',
      jobId: request.jobId,
      results: generateChain(request),
    });
  } catch (error) {
    workerScope.postMessage({
      type: 'failed',
      jobId: request.jobId,
      message: error instanceof Error ? error.message : '累进隐藏生成失败。',
    });
  }
});
