import {
  generateDynamicHiddenLayout,
  type DynamicHiddenGenerationInput,
  type DynamicHiddenGenerationResult,
} from './dynamicHiddenGenerator';
import type {
  DynamicHiddenWorkerRequest,
  DynamicHiddenWorkerResponse,
} from './dynamicHiddenWorkerProtocol';

export interface DynamicHiddenGenerationTask {
  promise: Promise<DynamicHiddenGenerationResult>;
  cancel: () => void;
}

interface DynamicHiddenJob {
  id: number;
  input: DynamicHiddenGenerationInput;
  timeoutMs: number;
  resolve: (result: DynamicHiddenGenerationResult) => void;
  reject: (error: Error) => void;
  state: 'queued' | 'running' | 'settled';
  timeoutId?: ReturnType<typeof globalThis.setTimeout>;
}

const canceledError = (): Error => {
  const error = new Error('动态隐藏布局生成已取消。');
  error.name = 'AbortError';
  return error;
};

const timeoutError = (): Error => {
  const error = new Error('动态隐藏布局生成超时。');
  error.name = 'TimeoutError';
  return error;
};

const startOnCurrentThread = (
  input: DynamicHiddenGenerationInput,
): DynamicHiddenGenerationTask => {
  let settled = false;
  let resolveTask: (result: DynamicHiddenGenerationResult) => void = () => undefined;
  let rejectTask: (error: Error) => void = () => undefined;
  const promise = new Promise<DynamicHiddenGenerationResult>((resolve, reject) => {
    resolveTask = resolve;
    rejectTask = reject;
  });
  const timer = globalThis.setTimeout(() => {
    if (settled) return;
    try {
      const result = generateDynamicHiddenLayout(input);
      settled = true;
      resolveTask(result);
    } catch (error) {
      settled = true;
      rejectTask(error instanceof Error ? error : new Error('动态隐藏布局生成失败。'));
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

const createDynamicHiddenWorker = (): Worker => new Worker(
  new URL('./dynamicHidden.worker.ts', import.meta.url),
  { type: 'module', name: 'dynamic-hidden-generator' },
);

class DynamicHiddenWorkerQueue {
  private worker?: Worker;
  private activeJob?: DynamicHiddenJob;
  private readonly queue: DynamicHiddenJob[] = [];
  private nextJobId = 1;

  public start(input: DynamicHiddenGenerationInput, timeoutMs: number): DynamicHiddenGenerationTask {
    let resolveJob: (result: DynamicHiddenGenerationResult) => void = () => undefined;
    let rejectJob: (error: Error) => void = () => undefined;
    const promise = new Promise<DynamicHiddenGenerationResult>((resolve, reject) => {
      resolveJob = resolve;
      rejectJob = reject;
    });
    const job: DynamicHiddenJob = {
      id: this.nextJobId,
      input,
      timeoutMs: Math.max(50, Math.floor(timeoutMs)),
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
    this.queue.splice(0).forEach((job) => this.rejectJob(job, canceledError()));
    if (this.activeJob) this.rejectJob(this.activeJob, canceledError());
    this.activeJob = undefined;
    this.resetWorker();
  }

  private dispatch(): void {
    if (this.activeJob) return;
    const job = this.queue.shift();
    if (!job || job.state !== 'queued') return;
    try {
      this.worker ??= this.createWorker();
      this.activeJob = job;
      job.state = 'running';
      job.timeoutId = globalThis.setTimeout(() => {
        if (this.activeJob !== job || job.state !== 'running') return;
        this.activeJob = undefined;
        this.rejectJob(job, timeoutError());
        this.resetWorker();
        this.dispatch();
      }, job.timeoutMs);
      const request: DynamicHiddenWorkerRequest = {
        type: 'generate',
        jobId: job.id,
        input: {
          ...job.input,
          path: job.input.path.map((cell) => ({ ...cell })),
        },
      };
      this.worker.postMessage(request);
    } catch (error) {
      this.activeJob = undefined;
      this.rejectJob(
        job,
        error instanceof Error ? error : new Error('无法启动动态隐藏布局线程。'),
      );
      this.resetWorker();
      this.dispatch();
    }
  }

  private createWorker(): Worker {
    const worker = createDynamicHiddenWorker();
    worker.addEventListener('message', (event: MessageEvent<DynamicHiddenWorkerResponse>) => {
      const job = this.activeJob;
      const response = event.data;
      if (!job || job.state !== 'running' || response.jobId !== job.id) return;
      this.activeJob = undefined;
      if (response.type === 'completed') this.resolveJob(job, response.result);
      else this.rejectJob(job, new Error(response.message));
      this.dispatch();
    });
    worker.addEventListener('error', (event) => {
      event.preventDefault();
      this.failActive(new Error(event.message || '动态隐藏布局线程加载失败。'));
    });
    worker.addEventListener('messageerror', () => {
      this.failActive(new Error('动态隐藏布局线程返回了无法读取的数据。'));
    });
    return worker;
  }

  private failActive(error: Error): void {
    const job = this.activeJob;
    this.activeJob = undefined;
    if (job) this.rejectJob(job, error);
    this.resetWorker();
    this.dispatch();
  }

  private cancel(job: DynamicHiddenJob): void {
    if (job.state === 'settled') return;
    if (job.state === 'queued') {
      const index = this.queue.indexOf(job);
      if (index >= 0) this.queue.splice(index, 1);
      this.rejectJob(job, canceledError());
      return;
    }
    if (this.activeJob === job) {
      this.activeJob = undefined;
      this.rejectJob(job, canceledError());
      this.resetWorker();
      this.dispatch();
    }
  }

  private resolveJob(job: DynamicHiddenJob, result: DynamicHiddenGenerationResult): void {
    if (job.state === 'settled') return;
    if (job.timeoutId !== undefined) globalThis.clearTimeout(job.timeoutId);
    job.state = 'settled';
    job.resolve(result);
  }

  private rejectJob(job: DynamicHiddenJob, error: Error): void {
    if (job.state === 'settled') return;
    if (job.timeoutId !== undefined) globalThis.clearTimeout(job.timeoutId);
    job.state = 'settled';
    job.reject(error);
  }

  private resetWorker(): void {
    this.worker?.terminate();
    this.worker = undefined;
  }
}

let sharedQueue: DynamicHiddenWorkerQueue | undefined;

export const startDynamicHiddenGeneration = (
  input: DynamicHiddenGenerationInput,
  timeoutMs = 1500,
): DynamicHiddenGenerationTask => {
  if (typeof Worker === 'undefined') return startOnCurrentThread(input);
  sharedQueue ??= new DynamicHiddenWorkerQueue();
  return sharedQueue.start(input, timeoutMs);
};

export const disposeDynamicHiddenWorker = (): void => {
  sharedQueue?.dispose();
  sharedQueue = undefined;
};
