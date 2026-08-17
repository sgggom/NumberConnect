import { PathCompletionSolver, type PathCompletionRequest } from './pathCompletionSolver';
import type { BoardShape, Cell } from './types';
import type { PathCompletionWorkerRequest, PathCompletionWorkerResponse } from './pathCompletionWorkerProtocol';

const runOnCurrentThread = (
  cells: ReadonlyArray<Cell>,
  boardShape: BoardShape,
  request: PathCompletionRequest,
): Promise<number[] | null> => new Promise((resolve) => {
  globalThis.setTimeout(() => {
    resolve(new PathCompletionSolver(cells, boardShape).findCompletion(request));
  }, 0);
});

export const findPathCompletionInWorker = (
  cells: ReadonlyArray<Cell>,
  boardShape: BoardShape,
  request: PathCompletionRequest,
): Promise<number[] | null> => {
  if (typeof Worker === 'undefined') return runOnCurrentThread(cells, boardShape, request);
  let worker: Worker;
  try {
    worker = new Worker(new URL('./pathCompletion.worker.ts', import.meta.url), {
      type: 'module',
      name: 'path-completion',
    });
  } catch {
    return runOnCurrentThread(cells, boardShape, request);
  }

  return new Promise((resolve, reject) => {
    const finish = (): void => worker.terminate();
    worker.addEventListener('message', (event: MessageEvent<PathCompletionWorkerResponse>) => {
      finish();
      if (event.data.type === 'completed') resolve(event.data.completion);
      else reject(new Error(event.data.message));
    }, { once: true });
    worker.addEventListener('error', (event) => {
      event.preventDefault();
      finish();
      reject(new Error(event.message || '路径验证线程加载失败。'));
    }, { once: true });
    const workerRequest: PathCompletionWorkerRequest = {
      type: 'complete',
      request: {
        cells: cells.map((cell) => ({ ...cell })),
        boardShape,
        fixedPositions: [...request.fixedPositions.entries()],
        requiredEdges: [...request.requiredEdges],
        directedStep: request.directedStep,
      },
    };
    worker.postMessage(workerRequest);
  });
};
