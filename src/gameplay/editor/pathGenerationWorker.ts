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
import { batchPlaytestConcurrency } from './batchWorkerConcurrency';

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

interface PathGenerationJob {
  id: number;
  request: EditorPathGenerationRequest;
  onProgress: (progress: number) => void;
  resolve: (result: EditorAlgorithmResult | null) => void;
  reject: (error: Error) => void;
  state: 'queued' | 'running' | 'settled';
  slot?: PathGenerationWorkerSlot;
}

interface PathGenerationWorkerSlot {
  worker: Worker;
  job?: PathGenerationJob;
}

class PathGenerationWorkerPool {
  private readonly slots: PathGenerationWorkerSlot[] = [];
  private readonly queue: PathGenerationJob[] = [];
  private nextJobId = 1;

  public constructor() {
    this.slots.push(this.createSlot());
  }

  public start(
    request: EditorPathGenerationRequest,
    onProgress: (progress: number) => void,
  ): EditorPathGenerationTask {
    let resolveJob: (result: EditorAlgorithmResult | null) => void = () => undefined;
    let rejectJob: (error: Error) => void = () => undefined;
    const promise = new Promise<EditorAlgorithmResult | null>((resolve, reject) => {
      resolveJob = resolve;
      rejectJob = reject;
    });
    const job: PathGenerationJob = {
      id: this.nextJobId,
      request,
      onProgress,
      resolve: resolveJob,
      reject: rejectJob,
      state: 'queued',
    };
    this.nextJobId += 1;
    this.queue.push(job);
    this.dispatch();
    return { promise, cancel: () => this.cancel(job) };
  }

  public dispose(): void {
    this.queue.splice(0).forEach((job) => {
      if (job.state === 'settled') return;
      job.state = 'settled';
      job.reject(canceledError());
    });
    this.slots.splice(0).forEach((slot) => {
      const job = slot.job;
      if (job && job.state !== 'settled') {
        job.state = 'settled';
        job.reject(canceledError());
      }
      slot.worker.terminate();
    });
  }

  private dispatch(): void {
    while (this.queue.length > 0) {
      let slot = this.slots.find((candidate) => candidate.job === undefined);
      if (!slot) {
        if (this.slots.length >= batchPlaytestConcurrency()) return;
        try {
          slot = this.createSlot();
        } catch {
          return;
        }
        this.slots.push(slot);
      }
      const job = this.queue.shift();
      if (!job || job.state !== 'queued') continue;
      slot.job = job;
      job.slot = slot;
      job.state = 'running';
      const workerRequest: EditorPathGenerationWorkerRequest = {
        type: 'generate',
        jobId: job.id,
        selection: job.request.selection,
        context: {
          ...job.request.context,
          activeCells: [...job.request.context.activeCells],
          fallbackPath: job.request.context.fallbackPath?.map((cell) => ({ ...cell })),
          fixedPath: job.request.context.fixedPath?.map((cell) => ({ ...cell })),
        },
      };
      try {
        slot.worker.postMessage(workerRequest);
      } catch (error) {
        this.failSlot(
          slot,
          error instanceof Error ? error : new Error('无法发送路径生成任务。'),
        );
      }
    }
  }

  private createSlot(): PathGenerationWorkerSlot {
    const slot: PathGenerationWorkerSlot = { worker: createPathGenerationWorker() };
    slot.worker.addEventListener('message', (event: MessageEvent<EditorPathGenerationWorkerResponse>) => {
      const job = slot.job;
      const response = event.data;
      if (!job || job.state !== 'running' || response.jobId !== job.id) return;
      if (response.type === 'progress') {
        job.onProgress(normalizedProgress(response.progress));
        return;
      }
      if (response.type === 'completed') {
        const result = response.result;
        this.settleSlot(slot, () => job.resolve(result));
      } else {
        const error = new Error(response.message);
        this.settleSlot(slot, () => job.reject(error));
      }
    });
    slot.worker.addEventListener('error', (event) => {
      event.preventDefault();
      this.failSlot(slot, new Error(event.message || '路径生成线程加载失败。'));
    });
    slot.worker.addEventListener('messageerror', () => {
      this.failSlot(slot, new Error('路径生成线程返回了无法读取的数据。'));
    });
    return slot;
  }

  private settleSlot(slot: PathGenerationWorkerSlot, settle: () => void): void {
    const job = slot.job;
    if (!job || job.state === 'settled') return;
    job.state = 'settled';
    job.slot = undefined;
    slot.job = undefined;
    settle();
    this.dispatch();
  }

  private failSlot(slot: PathGenerationWorkerSlot, error: Error): void {
    const job = slot.job;
    this.removeSlot(slot);
    if (job && job.state !== 'settled') {
      job.state = 'settled';
      job.slot = undefined;
      job.reject(error);
    }
    this.dispatch();
  }

  private cancel(job: PathGenerationJob): void {
    if (job.state === 'settled') return;
    if (job.state === 'queued') {
      const index = this.queue.indexOf(job);
      if (index >= 0) this.queue.splice(index, 1);
      job.state = 'settled';
      job.reject(canceledError());
      return;
    }
    const slot = job.slot;
    job.state = 'settled';
    job.slot = undefined;
    if (slot) this.removeSlot(slot);
    job.reject(canceledError());
    this.dispatch();
  }

  private removeSlot(slot: PathGenerationWorkerSlot): void {
    slot.worker.terminate();
    slot.job = undefined;
    const index = this.slots.indexOf(slot);
    if (index >= 0) this.slots.splice(index, 1);
  }
}

let sharedWorkerPool: PathGenerationWorkerPool | undefined;

export const startEditorPathGeneration = (
  request: EditorPathGenerationRequest,
  onProgress: (progress: number) => void,
): EditorPathGenerationTask => {
  if (typeof Worker === 'undefined') return startOnCurrentThread(request, onProgress);
  try {
    sharedWorkerPool ??= new PathGenerationWorkerPool();
    return sharedWorkerPool.start(request, onProgress);
  } catch {
    return startOnCurrentThread(request, onProgress);
  }
};

export const disposeEditorPathGenerationWorkerPool = (): void => {
  sharedWorkerPool?.dispose();
  sharedWorkerPool = undefined;
};
