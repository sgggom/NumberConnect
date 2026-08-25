import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardShape, type LevelData } from '../../game/types';
import type { BatchPlaytestSimulation, BatchPlaytestTask } from './batchPlaytest';
import {
  disposeBatchSimulationWorkerPool,
  startBatchPlaytestSimulation,
} from './batchSimulationWorkerPool';
import type {
  BatchSimulationWorkerRequest,
  BatchSimulationWorkerResponse,
} from './batchSimulationWorkerProtocol';

type WorkerMessageListener = (event: MessageEvent<BatchSimulationWorkerResponse>) => void;

const simulation: BatchPlaytestSimulation = {
  totalSteps: 3,
  errorCount: 1,
  steps: [],
  averageErrorCountByReasoning: { low: 2, medium: 1, high: 0 },
};

class FakeBatchSimulationWorker {
  static instances: FakeBatchSimulationWorker[] = [];

  private readonly listeners: WorkerMessageListener[] = [];
  public terminated = false;
  public requests: BatchSimulationWorkerRequest[] = [];

  constructor() {
    FakeBatchSimulationWorker.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message') this.listeners.push(listener as unknown as WorkerMessageListener);
  }

  postMessage(request: BatchSimulationWorkerRequest): void {
    this.requests.push(request);
    globalThis.setTimeout(() => {
      if (this.terminated) return;
      this.emit({ type: 'progress', jobId: request.jobId, completed: 1, total: 3 });
      this.emit({ type: 'completed', jobId: request.jobId, simulation });
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }

  private emit(response: BatchSimulationWorkerResponse): void {
    const event = { data: response } as MessageEvent<BatchSimulationWorkerResponse>;
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
    rows: 2,
    columns: 2,
    targetCrossings: 0,
    turnProbability: 40,
    hiddenPercent: 30,
    targetDifficulty: 5,
    maxVisibleRun: 4,
    maxHiddenRun: 2,
    generationCount: 1,
    simulationRunCount: 1,
    reasoningLevel: 'medium',
    seed: 1,
    outputLabel: '',
  },
};

const level: LevelData = {
  levelId: 1,
  boardShape: BoardShape.Square,
  rows: 2,
  columns: 2,
  activeCells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
  solutionPath: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
};

describe('batch simulation worker pool', () => {
  afterEach(() => {
    disposeBatchSimulationWorkerPool();
    vi.unstubAllGlobals();
    FakeBatchSimulationWorker.instances = [];
  });

  it('reuses an idle worker across sequential simulations', async () => {
    vi.stubGlobal('Worker', FakeBatchSimulationWorker);
    vi.stubGlobal('navigator', { hardwareConcurrency: 12 });
    const progress: number[] = [];

    const first = await startBatchPlaytestSimulation(
      task,
      level,
      (completed) => progress.push(completed),
    ).promise;
    const second = await startBatchPlaytestSimulation(task, level, () => undefined).promise;

    expect(first).toEqual(simulation);
    expect(second).toEqual(simulation);
    expect(progress).toEqual([1]);
    expect(FakeBatchSimulationWorker.instances).toHaveLength(1);
    expect(FakeBatchSimulationWorker.instances[0].requests).toHaveLength(2);
    expect(FakeBatchSimulationWorker.instances[0].terminated).toBe(false);
  });

  it('runs separate jobs in parallel slots and replaces a canceled slot', async () => {
    vi.stubGlobal('Worker', FakeBatchSimulationWorker);
    vi.stubGlobal('navigator', { hardwareConcurrency: 12 });
    const first = startBatchPlaytestSimulation(task, level, () => undefined);
    const second = startBatchPlaytestSimulation(task, level, () => undefined);

    expect(FakeBatchSimulationWorker.instances).toHaveLength(2);
    first.cancel();
    await expect(first.promise).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second.promise).resolves.toEqual(simulation);
    expect(FakeBatchSimulationWorker.instances[0].terminated).toBe(true);
  });
});
