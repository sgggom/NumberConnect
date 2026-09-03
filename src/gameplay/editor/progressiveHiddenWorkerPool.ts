import type { EditorAlgorithmResult } from './algorithms/types';
import {
  BATCH_HIDDEN_CHAIN_TIMEOUT_MS,
  BATCH_HIDDEN_CHAIN_MAX_ATTEMPTS,
  batchPlaytestConcurrency,
  createProgressiveBatchHiddenResult,
  type BatchPlaytestTask,
} from './batchPlaytest';
import type {
  ProgressiveHiddenWorkerRequest,
  ProgressiveHiddenWorkerResponse,
} from './progressiveHiddenWorkerProtocol';
import type { EditorCell } from './types';

export interface ProgressiveHiddenGenerationTask {
  promise: Promise<EditorAlgorithmResult[]>;
  cancel: () => void;
}

interface QueuedGenerationJob {
  id: number;
  tasks: BatchPlaytestTask[];
  timeoutMs: number;
  onProgress: (completed: number, total: number, difficulty: number) => void;
  resolve: (results: EditorAlgorithmResult[]) => void;
  reject: (error: Error) => void;
  state: 'queued' | 'running' | 'settled';
  slot?: GenerationWorkerSlot;
  timeoutId?: number;
}

interface GenerationWorkerSlot {
  worker: Worker;
  job?: QueuedGenerationJob;
}

const namedError = (name: string, message: string): Error => {
  const error = new Error(message);
  error.name = name;
  return error;
};

const canceledError = (): Error => namedError('AbortError', '隐藏难度链生成已取消。');
const timeoutError = (timeoutMs: number): Error => namedError(
  'ProgressiveHiddenTimeoutError',
  `隐藏难度链生成超过 ${timeoutMs / 1000} 秒。`,
);

const createGenerationWorker = (): Worker => new Worker(
  new URL('./progressiveHidden.worker.ts', import.meta.url),
  { type: 'module', name: 'progressive-hidden-generator' },
);

class ProgressiveHiddenWorkerPool {
  private readonly slots: GenerationWorkerSlot[] = [];
  private readonly queue: QueuedGenerationJob[] = [];
  private nextJobId = 1;

  public constructor() {
    this.slots.push(this.createSlot());
  }

  public start(
    tasks: ReadonlyArray<BatchPlaytestTask>,
    timeoutMs: number,
    onProgress: (completed: number, total: number, difficulty: number) => void,
  ): ProgressiveHiddenGenerationTask {
    let resolveJob: (results: EditorAlgorithmResult[]) => void = () => undefined;
    let rejectJob: (error: Error) => void = () => undefined;
    const promise = new Promise<EditorAlgorithmResult[]>((resolve, reject) => {
      resolveJob = resolve;
      rejectJob = reject;
    });
    const job: QueuedGenerationJob = {
      id: this.nextJobId,
      tasks: tasks.map((task) => ({ ...task, config: { ...task.config } })),
      timeoutMs,
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
    this.queue.splice(0).forEach((job) => this.rejectJob(job, canceledError()));
    this.slots.splice(0).forEach((slot) => {
      if (slot.job) this.rejectJob(slot.job, canceledError());
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
      job.timeoutId = globalThis.setTimeout(() => this.timeoutSlot(slot as GenerationWorkerSlot), job.timeoutMs);
      const request: ProgressiveHiddenWorkerRequest = {
        type: 'generate-chain',
        jobId: job.id,
        tasks: job.tasks,
        timeoutMs: job.timeoutMs,
      };
      try {
        slot.worker.postMessage(request);
      } catch (error) {
        this.failSlot(slot, error instanceof Error ? error : new Error('无法发送隐藏生成任务。'));
      }
    }
  }

  private createSlot(): GenerationWorkerSlot {
    const slot: GenerationWorkerSlot = { worker: createGenerationWorker() };
    slot.worker.addEventListener('message', (event: MessageEvent<ProgressiveHiddenWorkerResponse>) => {
      const job = slot.job;
      const response = event.data;
      if (!job || job.state !== 'running' || response.jobId !== job.id) return;
      if (response.type === 'progress') {
        job.onProgress(response.completed, response.total, response.difficulty);
      } else if (response.type === 'completed') {
        this.settleSlot(slot, () => job.resolve(response.results));
      } else {
        const error = new Error(response.message);
        if (response.message.includes('超时')) error.name = 'ProgressiveHiddenTimeoutError';
        this.settleSlot(slot, () => job.reject(error));
      }
    });
    slot.worker.addEventListener('error', (event) => {
      event.preventDefault();
      this.failSlot(slot, new Error(event.message || '隐藏生成线程加载失败。'));
    });
    slot.worker.addEventListener('messageerror', () => {
      this.failSlot(slot, new Error('隐藏生成线程返回了无法读取的数据。'));
    });
    return slot;
  }

  private settleSlot(slot: GenerationWorkerSlot, settle: () => void): void {
    const job = slot.job;
    if (!job || job.state === 'settled') return;
    this.clearJobTimeout(job);
    job.state = 'settled';
    job.slot = undefined;
    slot.job = undefined;
    settle();
    this.dispatch();
  }

  private failSlot(slot: GenerationWorkerSlot, error: Error): void {
    const job = slot.job;
    this.removeSlot(slot);
    if (job) this.rejectJob(job, error);
    this.dispatch();
  }

  private timeoutSlot(slot: GenerationWorkerSlot): void {
    const job = slot.job;
    if (!job || job.state !== 'running') return;
    this.removeSlot(slot);
    this.rejectJob(job, timeoutError(job.timeoutMs));
    this.dispatch();
  }

  private cancel(job: QueuedGenerationJob): void {
    if (job.state === 'settled') return;
    if (job.state === 'queued') {
      const index = this.queue.indexOf(job);
      if (index >= 0) this.queue.splice(index, 1);
      this.rejectJob(job, canceledError());
      return;
    }
    const slot = job.slot;
    if (slot) this.removeSlot(slot);
    this.rejectJob(job, canceledError());
    this.dispatch();
  }

  private rejectJob(job: QueuedGenerationJob, error: Error): void {
    if (job.state === 'settled') return;
    this.clearJobTimeout(job);
    job.state = 'settled';
    job.slot = undefined;
    job.reject(error);
  }

  private clearJobTimeout(job: QueuedGenerationJob): void {
    if (job.timeoutId === undefined) return;
    globalThis.clearTimeout(job.timeoutId);
    job.timeoutId = undefined;
  }

  private removeSlot(slot: GenerationWorkerSlot): void {
    slot.worker.terminate();
    slot.job = undefined;
    const index = this.slots.indexOf(slot);
    if (index >= 0) this.slots.splice(index, 1);
  }
}

let sharedPool: ProgressiveHiddenWorkerPool | undefined;

const startOnCurrentThread = (
  tasks: ReadonlyArray<BatchPlaytestTask>,
  timeoutMs: number,
  onProgress: (completed: number, total: number, difficulty: number) => void,
): ProgressiveHiddenGenerationTask => {
  let canceled = false;
  const promise = new Promise<EditorAlgorithmResult[]>((resolve, reject) => {
    globalThis.setTimeout(() => {
      const deadlineAt = Date.now() + timeoutMs;
      const results: EditorAlgorithmResult[] = [];
      let previousHiddenCells: ReadonlyArray<EditorCell> | undefined;
      try {
        let generationError = '';
        let succeeded = false;
        for (let attempt = 0; attempt < BATCH_HIDDEN_CHAIN_MAX_ATTEMPTS && !succeeded; attempt += 1) {
          results.length = 0;
          previousHiddenCells = undefined;
          try {
            for (const task of tasks) {
              if (canceled) throw canceledError();
              const generated = createProgressiveBatchHiddenResult(
                task,
                previousHiddenCells,
                attempt,
                deadlineAt,
              );
              results.push(generated);
              previousHiddenCells = generated.hiddenCells;
              onProgress(results.length, tasks.length, task.config.targetDifficulty);
            }
            succeeded = true;
          } catch (error) {
            generationError = error instanceof Error ? error.message : '累进隐藏生成失败';
            if (error instanceof Error && (
              error.name === 'ProgressiveHiddenTimeoutError' || error.name === 'AbortError'
            )) throw error;
          }
        }
        if (!succeeded) throw new Error(generationError || '累进隐藏生成失败。');
        resolve(results);
      } catch (error) {
        reject(error instanceof Error ? error : new Error('累进隐藏生成失败。'));
      }
    }, 0);
  });
  return { promise, cancel: () => { canceled = true; } };
};

export const startProgressiveHiddenChainGeneration = (
  tasks: ReadonlyArray<BatchPlaytestTask>,
  onProgress: (completed: number, total: number, difficulty: number) => void,
  timeoutMs = BATCH_HIDDEN_CHAIN_TIMEOUT_MS,
): ProgressiveHiddenGenerationTask => {
  if (typeof Worker === 'undefined') return startOnCurrentThread(tasks, timeoutMs, onProgress);
  try {
    sharedPool ??= new ProgressiveHiddenWorkerPool();
    return sharedPool.start(tasks, timeoutMs, onProgress);
  } catch {
    return startOnCurrentThread(tasks, timeoutMs, onProgress);
  }
};

export const disposeProgressiveHiddenWorkerPool = (): void => {
  sharedPool?.dispose();
  sharedPool = undefined;
};
