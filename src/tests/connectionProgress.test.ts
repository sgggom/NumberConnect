import { describe, expect, it } from 'vitest';
import { ConnectionProgress } from '../game/connectionProgress';

describe('connection progress', () => {
  it('starts from any visible number and connects forward', () => {
    const progress = new ConnectionProgress(6, [0, 3, 5]);

    expect(progress.begin(3)).toEqual({ type: 'started', index: 3 });
    expect(progress.extend(4)).toMatchObject({ type: 'advanced', added: true, progress: 2 });
    expect(progress.isVisible(4)).toBe(true);
    expect(progress.isEdgeConnected(3)).toBe(true);
  });

  it('starts from the final visible number and connects backward', () => {
    const progress = new ConnectionProgress(5, [0, 2, 4]);

    progress.begin(4);
    expect(progress.extend(3)).toMatchObject({ type: 'advanced', added: true });
    expect(progress.extend(2)).toMatchObject({ type: 'advanced', added: true });
    expect(progress.isEdgeConnected(3)).toBe(true);
    expect(progress.isEdgeConnected(2)).toBe(true);
  });

  it('rejects hidden starting points and skipped numbers', () => {
    const progress = new ConnectionProgress(5, [0, 2, 4]);

    expect(progress.begin(1)).toMatchObject({ type: 'wrong', reason: 'hidden-start' });
    progress.begin(2);
    expect(progress.extend(4)).toMatchObject({ type: 'wrong', reason: 'non-consecutive' });
  });

  it('only suggests the next visible number when connecting forward', () => {
    const progress = new ConnectionProgress(7, [0, 2, 4, 6]);

    progress.begin(2);
    expect(progress.suggestedNextIndex()).toBe(4);
    progress.extend(3);
    expect(progress.suggestedNextIndex()).toBe(4);
    progress.extend(4);
    expect(progress.suggestedNextIndex()).toBe(6);
  });

  it('only suggests the next visible number when connecting backward', () => {
    const progress = new ConnectionProgress(7, [0, 2, 4, 6]);

    progress.begin(6);
    expect(progress.suggestedNextIndex()).toBe(4);
    progress.extend(5);
    expect(progress.suggestedNextIndex()).toBe(4);
  });

  it('completes independently drawn consecutive sections', () => {
    const progress = new ConnectionProgress(5, [0, 2, 4]);

    progress.begin(2);
    progress.extend(3);
    progress.endStroke();
    progress.begin(0);
    progress.extend(1);
    progress.extend(2);
    progress.endStroke();
    progress.begin(4);
    const completion = progress.extend(3);

    expect(completion).toMatchObject({ type: 'advanced', complete: true, progress: 5 });
    expect(progress.complete).toBe(true);
  });
});
