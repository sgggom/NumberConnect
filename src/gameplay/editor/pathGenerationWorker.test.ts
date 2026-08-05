import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditorAlgorithm } from './algorithms';
import {
  startEditorPathGeneration,
  type EditorPathGenerationRequest,
} from './pathGenerationWorker';
import type {
  EditorPathGenerationWorkerRequest,
  EditorPathGenerationWorkerResponse,
} from './pathGenerationWorkerProtocol';

type WorkerMessageListener = (
  event: MessageEvent<EditorPathGenerationWorkerResponse>,
) => void;

class FakePathGenerationWorker {
  static instances: FakePathGenerationWorker[] = [];
  static lastRequest?: EditorPathGenerationWorkerRequest;

  private readonly messageListeners: WorkerMessageListener[] = [];
  public terminated = false;

  constructor() {
    FakePathGenerationWorker.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message') {
      this.messageListeners.push(listener as unknown as WorkerMessageListener);
    }
  }

  postMessage(request: EditorPathGenerationWorkerRequest): void {
    FakePathGenerationWorker.lastRequest = request;
    globalThis.setTimeout(() => {
      if (this.terminated) return;
      this.emit({ type: 'progress', progress: 0.42 });
      this.emit({
        type: 'completed',
        result: {
          path: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
        },
      });
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }

  private emit(response: EditorPathGenerationWorkerResponse): void {
    const event = { data: response } as MessageEvent<EditorPathGenerationWorkerResponse>;
    this.messageListeners.forEach((listener) => listener(event));
  }
}

const generationRequest = (): EditorPathGenerationRequest => ({
  selection: createEditorAlgorithm('algorithm-1'),
  context: {
    rows: 2,
    columns: 2,
    activeCells: new Set(['0,0', '1,0', '0,1', '1,1']),
    shape: 'square',
    generationIndex: 7,
  },
});

describe('single path generation worker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakePathGenerationWorker.instances = [];
    FakePathGenerationWorker.lastRequest = undefined;
  });

  it('keeps the fallback generation asynchronous and reports bounded progress', async () => {
    vi.stubGlobal('Worker', undefined);
    const progress: number[] = [];

    const result = await startEditorPathGeneration(
      {
        ...generationRequest(),
        selection: createEditorAlgorithm('algorithm-2'),
      },
      (value) => progress.push(value),
    ).promise;

    expect(result?.path).toHaveLength(4);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress.some((value) => value > 0 && value < 1)).toBe(true);
    expect(progress.every((value) => value >= 0 && value <= 1)).toBe(true);
  });

  it('serializes active cells and forwards worker progress before completion', async () => {
    vi.stubGlobal('Worker', FakePathGenerationWorker);
    const progress: number[] = [];

    const result = await startEditorPathGeneration(
      generationRequest(),
      (value) => progress.push(value),
    ).promise;

    expect(FakePathGenerationWorker.lastRequest?.context.activeCells).toEqual([
      '0,0',
      '1,0',
      '0,1',
      '1,1',
    ]);
    expect(progress).toEqual([0.42]);
    expect(result?.path).toHaveLength(2);
    expect(FakePathGenerationWorker.instances[0].terminated).toBe(true);
  });

  it('terminates an in-flight worker when generation is canceled', async () => {
    vi.stubGlobal('Worker', FakePathGenerationWorker);
    const task = startEditorPathGeneration(generationRequest(), () => undefined);

    task.cancel();

    await expect(task.promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakePathGenerationWorker.instances[0].terminated).toBe(true);
  });
});
