import {
  runEditorAlgorithm,
  type EditorAlgorithmContext,
  type EditorAlgorithmResult,
  type EditorAlgorithmSelection,
} from './algorithms';
import type {
  EditorPathGenerationWorkerRequest,
  EditorPathGenerationWorkerResponse,
} from './pathGenerationWorkerProtocol';

export interface EditorPathGenerationRequest {
  selection: EditorAlgorithmSelection;
  context: Omit<EditorAlgorithmContext, 'onProgress'>;
}

export interface EditorPathGenerationTask {
  promise: Promise<EditorAlgorithmResult | null>;
  cancel: () => void;
}

const canceledError = (): Error => {
  const error = new Error('路径生成已取消。');
  error.name = 'AbortError';
  return error;
};

const normalizedProgress = (progress: number): number => (
  Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0))
);

const startOnCurrentThread = (
  request: EditorPathGenerationRequest,
  onProgress: (progress: number) => void,
): EditorPathGenerationTask => {
  let settled = false;
  let resolveTask: (result: EditorAlgorithmResult | null) => void = () => undefined;
  let rejectTask: (reason: Error) => void = () => undefined;
  const promise = new Promise<EditorAlgorithmResult | null>((resolve, reject) => {
    resolveTask = resolve;
    rejectTask = reject;
  });
  const timer = globalThis.setTimeout(() => {
    if (settled) return;
    try {
      const result = runEditorAlgorithm(request.selection, {
        ...request.context,
        onProgress: (progress) => onProgress(normalizedProgress(progress)),
      });
      settled = true;
      resolveTask(result);
    } catch (error) {
      settled = true;
      rejectTask(error instanceof Error ? error : new Error('路径生成失败。'));
    }
  }, 0);

  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      rejectTask(canceledError());
    },
  };
};

const createPathGenerationWorker = (): Worker => new Worker(
  new URL('./pathGeneration.worker.ts', import.meta.url),
  {
    type: 'module',
    name: 'editor-path-generator',
  },
);

export const startEditorPathGeneration = (
  request: EditorPathGenerationRequest,
  onProgress: (progress: number) => void,
): EditorPathGenerationTask => {
  if (typeof Worker === 'undefined') return startOnCurrentThread(request, onProgress);

  let worker: Worker;
  try {
    worker = createPathGenerationWorker();
  } catch {
    return startOnCurrentThread(request, onProgress);
  }

  let settled = false;
  let rejectTask: (reason: Error) => void = () => undefined;
  const finish = (): void => {
    worker.terminate();
  };
  const promise = new Promise<EditorAlgorithmResult | null>((resolve, reject) => {
    rejectTask = reject;
    worker.addEventListener('message', (event: MessageEvent<EditorPathGenerationWorkerResponse>) => {
      if (settled) return;
      const response = event.data;
      if (response.type === 'progress') {
        onProgress(normalizedProgress(response.progress));
        return;
      }
      settled = true;
      finish();
      if (response.type === 'completed') {
        resolve(response.result);
      } else {
        reject(new Error(response.message));
      }
    });
    worker.addEventListener('error', (event) => {
      if (settled) return;
      event.preventDefault();
      settled = true;
      finish();
      reject(new Error(event.message || '路径生成线程加载失败。'));
    });
    worker.addEventListener('messageerror', () => {
      if (settled) return;
      settled = true;
      finish();
      reject(new Error('路径生成线程返回了无法读取的数据。'));
    });
  });
  const workerRequest: EditorPathGenerationWorkerRequest = {
    type: 'generate',
    selection: request.selection,
    context: {
      ...request.context,
      activeCells: [...request.context.activeCells],
      fallbackPath: request.context.fallbackPath?.map((cell) => ({ ...cell })),
      fixedPath: request.context.fixedPath?.map((cell) => ({ ...cell })),
    },
  };
  try {
    worker.postMessage(workerRequest);
  } catch (error) {
    settled = true;
    finish();
    rejectTask(error instanceof Error ? error : new Error('无法发送路径生成任务。'));
  }

  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      finish();
      rejectTask(canceledError());
    },
  };
};
