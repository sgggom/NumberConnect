import { generateAlgorithm4BatchTask } from './batchLevelGeneration';
import type {
  Algorithm4BatchWorkerRequest,
  Algorithm4BatchWorkerResponse,
} from './batchLevelGenerationWorkerProtocol';

interface BatchWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<Algorithm4BatchWorkerRequest>) => void,
  ): void;
  postMessage(message: Algorithm4BatchWorkerResponse): void;
}

const workerScope = globalThis as unknown as BatchWorkerScope;

workerScope.addEventListener('message', (event) => {
  if (event.data.type !== 'generate') return;

  try {
    workerScope.postMessage({
      type: 'completed',
      result: generateAlgorithm4BatchTask(event.data.task),
    });
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      taskIndex: event.data.task.taskIndex,
      message: error instanceof Error ? error.message : '生成线程执行失败。',
    });
  }
});
