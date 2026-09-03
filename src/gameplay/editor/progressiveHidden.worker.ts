import type { EditorCell } from './types';
import type { EditorAlgorithmResult } from './algorithms/types';
import { BATCH_PLAYTEST_MAX_ATTEMPTS, createProgressiveBatchHiddenResult } from './batchPlaytest';
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
  const results: EditorAlgorithmResult[] = [];
  let previousHiddenCells: ReadonlyArray<EditorCell> | undefined;
  for (const task of request.tasks) {
    let generated: EditorAlgorithmResult | undefined;
    let generationError = '';
    for (let attempt = 0; attempt < BATCH_PLAYTEST_MAX_ATTEMPTS && !generated; attempt += 1) {
      try {
        generated = createProgressiveBatchHiddenResult(
          task,
          previousHiddenCells,
          attempt,
          deadlineAt,
        );
      } catch (error) {
        generationError = error instanceof Error ? error.message : '累进隐藏生成失败';
        if (error instanceof Error && error.name === 'ProgressiveHiddenTimeoutError') throw error;
      }
    }
    if (!generated) {
      throw new Error(generationError || `难度 ${task.config.targetDifficulty} 生成失败。`);
    }
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
