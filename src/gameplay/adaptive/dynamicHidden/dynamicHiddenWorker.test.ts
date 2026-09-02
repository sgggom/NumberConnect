import { afterEach, describe, expect, it } from 'vitest';
import { BoardShape, type Cell } from '../../../game/types';
import {
  disposeDynamicHiddenWorker,
  startDynamicHiddenGeneration,
} from './dynamicHiddenWorker';

const path: Cell[] = Array.from({ length: 16 }, (_value, index) => {
  const y = Math.floor(index / 4);
  const offset = index % 4;
  return { x: y % 2 === 0 ? offset : 3 - offset, y };
});

describe('dynamic hidden worker client', () => {
  afterEach(() => disposeDynamicHiddenWorker());

  it('falls back to an asynchronous current-thread task when Worker is unavailable', async () => {
    const task = startDynamicHiddenGeneration({
      path,
      boardShape: BoardShape.Square,
      targetDifficulty: 5,
      seed: 505,
    });

    await expect(task.promise).resolves.toMatchObject({
      report: { algorithmVersion: 'dynamic-hidden-v1' },
    });
  });

  it('can cancel a queued current-thread generation', async () => {
    const task = startDynamicHiddenGeneration({
      path,
      boardShape: BoardShape.Square,
      targetDifficulty: 5,
      seed: 606,
    });
    task.cancel();

    await expect(task.promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});
