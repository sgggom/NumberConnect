import { runEditorAlgorithm } from './algorithms';
import type {
  EditorPathGenerationWorkerRequest,
  EditorPathGenerationWorkerResponse,
} from './pathGenerationWorkerProtocol';

interface PathGenerationWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<EditorPathGenerationWorkerRequest>) => void,
  ): void;
  postMessage(message: EditorPathGenerationWorkerResponse): void;
}

const workerScope = globalThis as unknown as PathGenerationWorkerScope;

workerScope.addEventListener('message', (event) => {
  if (event.data.type !== 'generate') return;
  const { jobId } = event.data;

  try {
    const result = runEditorAlgorithm(event.data.selection, {
      ...event.data.context,
      activeCells: new Set(event.data.context.activeCells),
      onProgress: (progress) => workerScope.postMessage({
        type: 'progress',
        jobId,
        progress,
      }),
    });
    workerScope.postMessage({ type: 'completed', jobId, result });
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      jobId,
      message: error instanceof Error ? error.message : '路径生成线程执行失败。',
    });
  }
});
