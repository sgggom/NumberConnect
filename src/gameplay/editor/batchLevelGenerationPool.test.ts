import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALGORITHM4_BATCH_HEADERS,
  generateAlgorithm4BatchTask,
  parseAlgorithm4BatchConfigRows,
} from './batchLevelGeneration';
import {
  generateAlgorithm4BatchLevelsInWorkers,
  resolveAlgorithm4BatchWorkerCount,
} from './batchLevelGenerationPool';
import type {
  Algorithm4BatchWorkerRequest,
  Algorithm4BatchWorkerResponse,
} from './batchLevelGenerationWorkerProtocol';

type WorkerMessageListener = (event: MessageEvent<Algorithm4BatchWorkerResponse>) => void;

class FakeBatchWorker {
  static instances: FakeBatchWorker[] = [];
  static completionOrder: number[] = [];

  private readonly messageListeners: WorkerMessageListener[] = [];
  private terminated = false;

  constructor() {
    FakeBatchWorker.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message') {
      this.messageListeners.push(listener as unknown as WorkerMessageListener);
    }
  }

  postMessage(request: Algorithm4BatchWorkerRequest): void {
    const delay = Math.max(0, 4 - request.task.taskIndex);
    globalThis.setTimeout(() => {
      if (this.terminated) return;
      FakeBatchWorker.completionOrder.push(request.task.taskIndex);
      const response: Algorithm4BatchWorkerResponse = {
        type: 'completed',
        result: generateAlgorithm4BatchTask(request.task),
      };
      const event = { data: response } as MessageEvent<Algorithm4BatchWorkerResponse>;
      this.messageListeners.forEach((listener) => listener(event));
    }, delay);
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe('algorithm 4 batch worker pool', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeBatchWorker.instances = [];
    FakeBatchWorker.completionOrder = [];
  });

  it('uses the available logical processors while leaving one for the interface', () => {
    expect(resolveAlgorithm4BatchWorkerCount(20, 16)).toBe(8);
    expect(resolveAlgorithm4BatchWorkerCount(20, 8)).toBe(7);
    expect(resolveAlgorithm4BatchWorkerCount(3, 8)).toBe(3);
    expect(resolveAlgorithm4BatchWorkerCount(20, 2)).toBe(2);
    expect(resolveAlgorithm4BatchWorkerCount(20, 1)).toBe(1);
    expect(resolveAlgorithm4BatchWorkerCount(1, 16)).toBe(1);
    expect(resolveAlgorithm4BatchWorkerCount(0, 16)).toBe(0);
  });

  it('honors a lower worker cap', () => {
    expect(resolveAlgorithm4BatchWorkerCount(20, 16, 4)).toBe(4);
  });

  it('uses the serial implementation when the worker limit is one', async () => {
    const configs = parseAlgorithm4BatchConfigRows([
      [...ALGORITHM4_BATCH_HEADERS],
      ['正方形', 3, 3, 0, 40, 50, 50, 50, 3, 4, 0, 0, 0, 2],
    ]);
    const onWorkerCount = vi.fn();
    const onProgress = vi.fn();

    const result = await generateAlgorithm4BatchLevelsInWorkers(configs, 31, 97531, {
      maxWorkers: 1,
      onWorkerCount,
      onProgress,
    });

    expect(result.failures).toEqual([]);
    expect(result.levels.map((level) => level.levelId)).toEqual([31, 32]);
    expect(onWorkerCount).toHaveBeenCalledWith(1);
    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  it('runs tasks through a dynamically sized worker pool and restores result order', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 });
    vi.stubGlobal('Worker', FakeBatchWorker);
    const configs = parseAlgorithm4BatchConfigRows([
      [...ALGORITHM4_BATCH_HEADERS],
      ['正方形', 3, 3, 0, 40, 50, 50, 50, 3, 4, 0, 0, 0, 4],
    ]);
    const onWorkerCount = vi.fn();
    const onProgress = vi.fn();

    const result = await generateAlgorithm4BatchLevelsInWorkers(configs, 41, 86420, {
      onWorkerCount,
      onProgress,
    });

    expect(FakeBatchWorker.instances).toHaveLength(3);
    expect(FakeBatchWorker.completionOrder[0]).not.toBe(0);
    expect(onWorkerCount).toHaveBeenCalledWith(3);
    expect(onProgress).toHaveBeenCalledTimes(4);
    expect(result.failures).toEqual([]);
    expect(result.levels.map((level) => level.levelId)).toEqual([41, 42, 43, 44]);
  });
});
