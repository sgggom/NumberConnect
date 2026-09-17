import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BatchPlaytestTask } from './batchPlaytest';
import {
  disposeProgressiveHiddenWorkerPool,
  startProgressiveHiddenChainGeneration,
} from './progressiveHiddenWorkerPool';
import type {
  ProgressiveHiddenWorkerRequest,
  ProgressiveHiddenWorkerResponse,
} from './progressiveHiddenWorkerProtocol';

type WorkerMessageListener = (event: MessageEvent<ProgressiveHiddenWorkerResponse>) => void;

class FakeProgressiveHiddenWorker {
  static instances: FakeProgressiveHiddenWorker[] = [];
  static shouldRespond = true;
  static failuresRemaining = 0;

  private readonly listeners: WorkerMessageListener[] = [];
  public terminated = false;
  public requests: ProgressiveHiddenWorkerRequest[] = [];

  constructor() {
    FakeProgressiveHiddenWorker.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message') this.listeners.push(listener as unknown as WorkerMessageListener);
  }

  postMessage(request: ProgressiveHiddenWorkerRequest): void {
    this.requests.push(request);
    if (!FakeProgressiveHiddenWorker.shouldRespond) return;
    globalThis.setTimeout(() => {
      if (this.terminated) return;
      if (FakeProgressiveHiddenWorker.failuresRemaining > 0) {
        FakeProgressiveHiddenWorker.failuresRemaining--;
        this.emit({ type: 'failed', jobId: request.jobId, message: '评分目标未匹配' });
        return;
      }
      this.emit({
        type: 'completed',
        jobId: request.jobId,
        results: request.tasks.map(() => ({ path: [], hiddenCells: [], targetHiddenCount: 0 })),
      });
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }

  private emit(response: ProgressiveHiddenWorkerResponse): void {
    const event = { data: response } as MessageEvent<ProgressiveHiddenWorkerResponse>;
    this.listeners.forEach((listener) => listener(event));
  }
}

const task: BatchPlaytestTask = {
  taskIndex: 0,
  generationNumber: 1,
  config: {
    mode: 'hidden',
    sourceRow: 2,
    id: 'CFG-001',
    enabled: true,
    shape: 'square',
    rows: 5,
    columns: 5,
    targetCrossings: 0,
    turnProbability: 0,
    hiddenPercent: 0,
    segmentLengthMin: 5,
    segmentLengthMax: 9,
    targetDifficulty: 1,
    maxVisibleRun: 8,
    maxHiddenRun: 3,
    generationCount: 1,
    simulationRunCount: 1,
    reasoningLevel: 'medium',
    seed: 1,
    outputLabel: '',
    presetPath: Array.from({ length: 25 }, (_, index) => ({ x: index % 5, y: Math.floor(index / 5) })),
  },
};

describe('progressive hidden worker pool', () => {
  afterEach(() => {
    disposeProgressiveHiddenWorkerPool();
    vi.unstubAllGlobals();
    FakeProgressiveHiddenWorker.instances = [];
    FakeProgressiveHiddenWorker.shouldRespond = true;
    FakeProgressiveHiddenWorker.failuresRemaining = 0;
    vi.useRealTimers();
  });

  it('runs separate path chains in all available worker slots', async () => {
    vi.stubGlobal('Worker', FakeProgressiveHiddenWorker);
    vi.stubGlobal('navigator', { hardwareConcurrency: 6 });

    const jobs = Array.from({ length: 10 }, () => (
      startProgressiveHiddenChainGeneration([task], () => undefined).promise
    ));

    expect(FakeProgressiveHiddenWorker.instances).toHaveLength(5);
    await expect(Promise.all(jobs)).resolves.toHaveLength(10);
    expect(FakeProgressiveHiddenWorker.instances).toHaveLength(5);
  });

  it('terminates and replaces a worker when one path chain times out', async () => {
    vi.stubGlobal('Worker', FakeProgressiveHiddenWorker);
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 });
    FakeProgressiveHiddenWorker.shouldRespond = false;

    const timedOut = startProgressiveHiddenChainGeneration([task], () => undefined, 5);
    await expect(timedOut.promise).rejects.toMatchObject({ name: 'ProgressiveHiddenTimeoutError' });
    expect(FakeProgressiveHiddenWorker.instances[0].terminated).toBe(true);

    FakeProgressiveHiddenWorker.shouldRespond = true;
    await expect(startProgressiveHiddenChainGeneration([task], () => undefined).promise)
      .resolves.toHaveLength(1);
    expect(FakeProgressiveHiddenWorker.instances).toHaveLength(2);
  });

  const scoredTask = (): BatchPlaytestTask => ({ ...task, config: { ...task.config, hiddenScoreTargets: { one: Array(10).fill(0), two: Array(10).fill(0) } } });

  it('keeps retrying scored chains with new seeds until a complete result arrives', async () => {
    vi.useFakeTimers(); vi.stubGlobal('Worker', FakeProgressiveHiddenWorker);
    FakeProgressiveHiddenWorker.failuresRemaining = 2;
    const onRetry = vi.fn();
    const job = startProgressiveHiddenChainGeneration([scoredTask()], () => undefined, 1000, onRetry);
    await vi.advanceTimersByTimeAsync(510);
    await expect(job.promise).resolves.toHaveLength(1);
    expect(onRetry.mock.calls.map(call => call[0])).toEqual([2,3]);
    const seeds = FakeProgressiveHiddenWorker.instances.flatMap(w => w.requests.map(r => r.tasks[0].config.seed));
    expect(new Set(seeds).size).toBe(3);
    expect(task.config.seed).toBe(1);
  });

  it('recycles a timed-out scored worker and retries rather than skipping the path', async () => {
    vi.useFakeTimers(); vi.stubGlobal('Worker', FakeProgressiveHiddenWorker);
    FakeProgressiveHiddenWorker.shouldRespond = false;
    const job = startProgressiveHiddenChainGeneration([scoredTask()], () => undefined, 5);
    await vi.advanceTimersByTimeAsync(5);
    expect(FakeProgressiveHiddenWorker.instances[0].terminated).toBe(true);
    FakeProgressiveHiddenWorker.shouldRespond = true;
    await vi.advanceTimersByTimeAsync(255);
    await expect(job.promise).resolves.toHaveLength(1);
    expect(FakeProgressiveHiddenWorker.instances).toHaveLength(2);
  });

  it('can cancel between retries without starting another round', async () => {
    vi.useFakeTimers(); vi.stubGlobal('Worker', FakeProgressiveHiddenWorker);
    FakeProgressiveHiddenWorker.failuresRemaining = 100;
    const job = startProgressiveHiddenChainGeneration([scoredTask()], () => undefined, 1000);
    const canceled = expect(job.promise).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1);
    job.cancel();
    await canceled;
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeProgressiveHiddenWorker.instances.flatMap(w => w.requests)).toHaveLength(1);
  });
});
