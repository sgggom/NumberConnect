import { validateHollowFormationRequest, type HollowFormationRequest } from './generateHollowFormation';
import type { EditorPathGenerationTask } from './pathGenerationWorker';
import type { EditorCell } from './types';

export const startHollowFormationGeneration = (
  request: HollowFormationRequest, onProgress: (progress: number) => void,
): EditorPathGenerationTask => {
  validateHollowFormationRequest(request);
  const worker = new Worker(new URL('./hollowFormation.worker.ts', import.meta.url), { type: 'module' });
  let rejectTask: (reason: Error) => void = () => undefined;
  let settled = false;
  let timeout: ReturnType<typeof setTimeout>;
  const finish = (): void => { settled = true; clearTimeout(timeout); worker.terminate(); };
  const promise = new Promise<{ path: EditorCell[] }>((resolve, reject) => {
    rejectTask = reject;
    timeout = setTimeout(() => { finish(); reject(new Error('造型生成超时，请重试。')); }, 10000);
    worker.onmessage = (event: MessageEvent<{ progress?: number; path?: EditorCell[]; error?: string }>) => {
      if (settled) return;
      if (event.data.path) { finish(); resolve({ path: event.data.path }); }
      else if (event.data.error) { finish(); reject(new Error(event.data.error)); }
      else if (event.data.progress !== undefined) onProgress(event.data.progress);
    };
    worker.onerror = () => { finish(); reject(new Error('造型生成失败，请重试。')); };
    try { worker.postMessage(request); } catch (error) { finish(); reject(error); }
  });
  return {
    promise,
    cancel: () => {
      if (settled) return;
      finish();
      const error = new Error('造型生成已取消。');
      error.name = 'AbortError';
      rejectTask(error);
    },
  };
};
