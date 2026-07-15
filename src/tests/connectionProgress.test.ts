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
    expect(progress.suggestedNextHint()).toEqual({ index: 4, consecutive: false });
    progress.extend(3);
    expect(progress.suggestedNextHint()).toEqual({ index: 4, consecutive: true });
    progress.extend(4);
    expect(progress.suggestedNextHint()).toEqual({ index: 6, consecutive: false });
  });

  it('only suggests the next visible number when connecting backward', () => {
    const progress = new ConnectionProgress(7, [0, 2, 4, 6]);

    progress.begin(6);
    expect(progress.suggestedNextHint()).toEqual({ index: 4, consecutive: false });
    progress.extend(5);
    expect(progress.suggestedNextHint()).toEqual({ index: 4, consecutive: true });
  });

  it('completes independently drawn consecutive sections', () => {
    const progress = new ConnectionProgress(5, [0, 2, 4]);

    progress.begin(2);
    progress.extend(3);
    progress.endStroke();
    progress.begin(2);
    progress.extend(1);
    progress.extend(0);
    progress.endStroke();
    progress.begin(3);
    const completion = progress.extend(4);

    expect(completion).toMatchObject({ type: 'advanced', complete: true, progress: 5 });
    expect(progress.complete).toBe(true);
  });

  it('ignores a completed cell when it cannot add a missing consecutive edge', () => {
    const progress = new ConnectionProgress(5, [0, 1, 2, 3, 4]);

    progress.begin(1);
    progress.extend(2);
    progress.endStroke();

    progress.begin(4);
    expect(progress.extend(1)).toEqual({ type: 'ignored' });
    expect(progress.activeIndex).toBe(4);
    expect(progress.isEdgeConnected(0)).toBe(false);
  });

  it('adds the missing edge when joining two previously completed sections', () => {
    const progress = new ConnectionProgress(4, [0, 1, 2, 3]);

    progress.begin(0);
    progress.extend(1);
    progress.endStroke();
    progress.begin(3);
    progress.extend(2);
    progress.endStroke();

    progress.begin(1);
    const joined = progress.extend(2);

    expect(joined).toMatchObject({ type: 'advanced', added: true, complete: true });
    expect(progress.isEdgeConnected(1)).toBe(true);
  });

  it('ignores already connected cells revisited during the current stroke', () => {
    const progress = new ConnectionProgress(5, [0, 4]);

    progress.begin(0);
    progress.extend(1);
    progress.extend(2);

    expect(progress.extend(0)).toEqual({ type: 'ignored' });
    expect(progress.activeIndex).toBe(2);
    expect(progress.extend(3)).toMatchObject({ type: 'advanced', added: true });
  });
});
