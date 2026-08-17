import { simulateBatchPlaytestLevel } from './batchPlaytest';
import type {
  BatchSimulationWorkerRequest,
  BatchSimulationWorkerResponse,
} from './batchSimulationWorkerProtocol';

interface BatchSimulationWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<BatchSimulationWorkerRequest>) => void,
  ): void;
  postMessage(message: BatchSimulationWorkerResponse): void;
}

const workerScope = globalThis as unknown as BatchSimulationWorkerScope;

workerScope.addEventListener('message', (event) => {
  if (event.data.type !== 'simulate') return;
  const { jobId, task, level } = event.data;
  try {
    const simulation = simulateBatchPlaytestLevel(task, level, (completed, total) => {
      workerScope.postMessage({ type: 'progress', jobId, completed, total });
    });
    workerScope.postMessage({ type: 'completed', jobId, simulation });
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      jobId,
      message: error instanceof Error ? error.message : '跑关模拟线程执行失败。',
    });
  }
});
