import type { LevelData } from '../../game/types';
import {
  batchPlaytestConcurrency,
  simulateBatchPlaytestLevelAsync,
  type BatchPlaytestSimulation,
  type BatchPlaytestTask,
} from './batchPlaytest';
import type {
  BatchSimulationWorkerRequest,
  BatchSimulationWorkerResponse,
} from './batchSimulationWorkerProtocol';

export interface BatchSimulationTask {
  promise: Promise<BatchPlaytestSimulation>;
  cancel: () => void;
}

interface QueuedSimulationJob {
  id: number;
  task: BatchPlaytestTask;
  level: LevelData;
  onProgress: (completed: number, total: number) => void;
  resolve: (simulation: BatchPlaytestSimulation) => void;
  reject: (error: Error) => void;
  state: 'queued' | 'running' | 'settled';
  slot?: SimulationWorkerSlot;
}

interface SimulationWorkerSlot {
  worker: Worker;
  job?: QueuedSimulationJob;
}

const canceledError = (): Error => {
  const error = new Error('批量跑关已取消。');
  error.name = 'AbortError';
  return error;
};

const createSimulationWorker = (): Worker => new Worker(
  new URL('./batchSimulation.worker.ts', import.meta.url),
  { type: 'module', name: 'batch-playtest-simulator' },
);

class BatchSimulationWorkerPool {
  private readonly slots: SimulationWorkerSlot[] = [];
  private readonly queue: QueuedSimulationJob[] = [];
  private nextJobId = 1;

  public constructor() {
    this.slots.push(this.createSlot());
  }

  public start(
    task: BatchPlaytestTask,
    level: LevelData,
    onProgress: (completed: number, total: number) => void,
  ): BatchSimulationTask {
    let resolveJob: (simulation: BatchPlaytestSimulation) => void = () => undefined;
    let rejectJob: (error: Error) => void = () => undefined;
    const promise = new Promise<BatchPlaytestSimulation>((resolve, reject) => {
      resolveJob = resolve;
      rejectJob = reject;
    });
    const job: QueuedSimulationJob = {
      id: this.nextJobId,
      task,
      level,
      onProgress,
      resolve: resolveJob,
      reject: rejectJob,
      state: 'queued',
    };
    this.nextJobId += 1;
    this.queue.push(job);
    this.dispatch();
    return {
      promise,
      cancel: () => this.cancel(job),
    };
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
      const request: BatchSimulationWorkerRequest = {
        type: 'simulate',
        jobId: job.id,
        task: job.task,
        level: job.level,
      };
      try {
        slot.worker.postMessage(request);
      } catch (error) {
        this.failSlot(slot, error instanceof Error ? error : new Error('无法发送跑关模拟任务。'));
      }
    }
  }

  private createSlot(): SimulationWorkerSlot {
    const slot: SimulationWorkerSlot = { worker: createSimulationWorker() };
    slot.worker.addEventListener('message', (event: MessageEvent<BatchSimulationWorkerResponse>) => {
      const job = slot.job;
      const response = event.data;
      if (!job || job.state !== 'running' || response.jobId !== job.id) return;
      if (response.type === 'progress') {
        job.onProgress(response.completed, response.total);
        return;
      }
      if (response.type === 'completed') {
        const simulation = response.simulation;
        this.settleSlot(slot, () => job.resolve(simulation));
      } else {
        const error = new Error(response.message);
        this.settleSlot(slot, () => job.reject(error));
      }
    });
    slot.worker.addEventListener('error', (event) => {
      event.preventDefault();
      this.failSlot(slot, new Error(event.message || '跑关模拟线程加载失败。'));
    });
    slot.worker.addEventListener('messageerror', () => {
      this.failSlot(slot, new Error('跑关模拟线程返回了无法读取的数据。'));
    });
    return slot;
  }

  private settleSlot(slot: SimulationWorkerSlot, settle: () => void): void {
    const job = slot.job;
    if (!job || job.state === 'settled') return;
    job.state = 'settled';
    job.slot = undefined;
    slot.job = undefined;
    settle();
    this.dispatch();
  }

  private failSlot(slot: SimulationWorkerSlot, error: Error): void {
    const job = slot.job;
    this.removeSlot(slot);
    if (job && job.state !== 'settled') {
      job.state = 'settled';
      job.slot = undefined;
      job.reject(error);
    }
    this.dispatch();
  }

  private cancel(job: QueuedSimulationJob): void {
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

  private removeSlot(slot: SimulationWorkerSlot): void {
    slot.worker.terminate();
    slot.job = undefined;
    const index = this.slots.indexOf(slot);
    if (index >= 0) this.slots.splice(index, 1);
  }
}

let sharedPool: BatchSimulationWorkerPool | undefined;

const startOnCurrentThread = (
  task: BatchPlaytestTask,
  level: LevelData,
  onProgress: (completed: number, total: number) => void,
): BatchSimulationTask => {
  const abortController = new AbortController();
  return {
    promise: simulateBatchPlaytestLevelAsync(task, level, {
      signal: abortController.signal,
      onProgress,
    }),
    cancel: () => abortController.abort(),
  };
};

export const startBatchPlaytestSimulation = (
  task: BatchPlaytestTask,
  level: LevelData,
  onProgress: (completed: number, total: number) => void,
): BatchSimulationTask => {
  if (typeof Worker === 'undefined') return startOnCurrentThread(task, level, onProgress);
  try {
    sharedPool ??= new BatchSimulationWorkerPool();
    return sharedPool.start(task, level, onProgress);
  } catch {
    return startOnCurrentThread(task, level, onProgress);
  }
};

export const disposeBatchSimulationWorkerPool = (): void => {
  sharedPool?.dispose();
  sharedPool = undefined;
};
