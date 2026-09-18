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
});
