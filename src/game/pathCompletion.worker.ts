import { PathCompletionSolver } from './pathCompletionSolver';
import type { PathCompletionWorkerRequest, PathCompletionWorkerResponse } from './pathCompletionWorkerProtocol';

interface CompletionWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<PathCompletionWorkerRequest>) => void,
  ): void;
  postMessage(message: PathCompletionWorkerResponse): void;
}

const workerScope = globalThis as unknown as CompletionWorkerScope;

workerScope.addEventListener('message', (event) => {
  if (event.data.type !== 'complete') return;
  try {
    const { request } = event.data;
    const solver = new PathCompletionSolver(request.cells, request.boardShape);
    workerScope.postMessage({
      type: 'completed',
      completion: solver.findCompletion({
        fixedPositions: new Map(request.fixedPositions),
        requiredEdges: request.requiredEdges,
        directedStep: request.directedStep,
      }),
    });
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : '路径验证失败。',
    });
  }
});
