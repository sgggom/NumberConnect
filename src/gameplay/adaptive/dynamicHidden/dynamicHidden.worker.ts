import { generateDynamicHiddenLayout } from './dynamicHiddenGenerator';
import type {
  DynamicHiddenWorkerRequest,
  DynamicHiddenWorkerResponse,
} from './dynamicHiddenWorkerProtocol';

interface DynamicHiddenWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<DynamicHiddenWorkerRequest>) => void,
  ): void;
  postMessage(message: DynamicHiddenWorkerResponse): void;
}

const workerScope = globalThis as unknown as DynamicHiddenWorkerScope;

workerScope.addEventListener('message', (event) => {
  if (event.data.type !== 'generate') return;
  const { jobId, input } = event.data;
  try {
    workerScope.postMessage({
      type: 'completed',
      jobId,
      result: generateDynamicHiddenLayout(input),
    });
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      jobId,
      message: error instanceof Error ? error.message : '动态隐藏布局生成失败。',
    });
  }
});
