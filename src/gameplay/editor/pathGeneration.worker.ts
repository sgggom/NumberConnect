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

  try {
    const result = runEditorAlgorithm(event.data.selection, {
      ...event.data.context,
      activeCells: new Set(event.data.context.activeCells),
      onProgress: (progress) => workerScope.postMessage({
        type: 'progress',
        progress,
      }),
    });
    workerScope.postMessage({ type: 'completed', result });
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : '路径生成线程执行失败。',
    });
  }
});
