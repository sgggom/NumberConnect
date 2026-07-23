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

  it('accepts either order for a configured pair of swappable hidden numbers', () => {
    const authored = new ConnectionProgress(4, [0, 3], [[1, 2]]);
    authored.begin(0);
    expect(authored.extend(1)).toMatchObject({ type: 'advanced' });
    expect(authored.extend(2)).toMatchObject({ type: 'advanced' });
    expect(authored.extend(3)).toMatchObject({ type: 'advanced', complete: true });

    const swapped = new ConnectionProgress(4, [0, 3], [[1, 2]]);
    swapped.begin(0);
    expect(swapped.extend(2)).toMatchObject({ type: 'advanced' });
    expect(swapped.displayNumber(2)).toBe(2);
    expect(swapped.displayNumber(1)).toBe(3);
    expect(swapped.extend(1)).toMatchObject({ type: 'advanced' });
    expect(swapped.extend(3)).toMatchObject({ type: 'advanced', complete: true });
    expect(swapped.connectedNodePairs()).toEqual([[0, 2], [1, 2], [1, 3]]);
  });

  it('accepts the swapped hidden pair when connecting backward', () => {
    const progress = new ConnectionProgress(4, [0, 3], [[1, 2]]);

    progress.begin(3);
    expect(progress.extend(1)).toMatchObject({ type: 'advanced' });
    expect(progress.extend(2)).toMatchObject({ type: 'advanced' });
    expect(progress.extend(0)).toMatchObject({ type: 'advanced', complete: true });
  });

  it('does not allow a two-position jump unless the hidden pair is swappable', () => {
    const progress = new ConnectionProgress(4, [0, 3]);

    progress.begin(0);
    expect(progress.extend(2)).toMatchObject({ type: 'wrong', reason: 'non-consecutive' });
  });

  it('rejects hidden starting points and skipped numbers', () => {
    const progress = new ConnectionProgress(5, [0, 2, 4]);

    expect(progress.begin(1)).toMatchObject({ type: 'wrong', reason: 'hidden-start' });
    progress.begin(2);
    expect(progress.extend(4)).toMatchObject({ type: 'wrong', reason: 'non-consecutive' });
  });

  it('allows a power-up to reveal a hidden starting point', () => {
    const progress = new ConnectionProgress(5, [0, 4]);

    expect(progress.begin(2)).toMatchObject({ type: 'wrong', reason: 'hidden-start' });
    expect(progress.revealIndices([2, 2, 9])).toBe(1);
    expect(progress.begin(2)).toEqual({ type: 'started', index: 2 });
  });

  it('clicks every position in ascending order, including concealed cells', () => {
    const progress = new ConnectionProgress(6, [0, 3, 5]);

    progress.enableClickMode();
    expect(progress.currentClickIndex).toBe(0);
    expect(progress.isVisible(1)).toBe(false);
    expect(progress.clickForward(1).at(-1)).toMatchObject({
      type: 'advanced',
      index: 1,
      progress: 2,
    });
    expect(progress.isVisible(1)).toBe(true);
    expect(progress.currentClickIndex).toBe(1);
    expect(progress.clickForward(3).at(-1)).toEqual({
      type: 'wrong',
      index: 3,
      reason: 'click-order',
    });
    expect(progress.clickForward(2).at(-1)).toMatchObject({
      type: 'advanced',
      index: 2,
      progress: 3,
    });
    expect(progress.clickForward(3).at(-1)).toMatchObject({
      type: 'advanced',
      index: 3,
      progress: 4,
    });
    expect(progress.progress).toBe(4);
    expect(progress.isEdgeConnected(0)).toBe(true);
    expect(progress.isEdgeConnected(1)).toBe(true);
    expect(progress.isEdgeConnected(2)).toBe(true);

    progress.clickForward(4);
    const completion = progress.clickForward(5);
    expect(completion.at(-1)).toMatchObject({ type: 'advanced', complete: true, progress: 6 });
  });

  it('starts from number two and rejects out-of-order clicks', () => {
    const progress = new ConnectionProgress(5, [0, 3, 4]);

    progress.enableClickMode();
    expect(progress.clickForward(3).at(-1)).toEqual({
      type: 'wrong',
      index: 3,
      reason: 'click-order',
    });
    expect(progress.clickForward(0)).toEqual([{ type: 'ignored' }]);
    expect(progress.clickForward(1).at(-1)).toMatchObject({
      type: 'advanced',
      index: 1,
      progress: 2,
    });
  });

  it('adds a power-up-revealed number to the click sequence', () => {
    const progress = new ConnectionProgress(5, [0, 3, 4]);

    progress.enableClickMode();
    progress.clickForward(1);
    progress.revealIndices([2]);
    expect(progress.clickForward(3)).toEqual([{
      type: 'wrong',
      index: 3,
      reason: 'click-order',
    }]);
    expect(progress.clickForward(2).at(-1)).toMatchObject({
      type: 'advanced',
      index: 2,
      progress: 3,
    });
  });

  it('continues from the connected prefix after switching from drag to click', () => {
    const progress = new ConnectionProgress(6, [0, 3, 5]);

    progress.begin(0);
    progress.extend(1);
    progress.endStroke();
    progress.enableClickMode();

    expect(progress.clickForward(3).at(-1)).toMatchObject({
      type: 'wrong',
      reason: 'click-order',
    });
    expect(progress.clickForward(2).at(-1)).toMatchObject({
      type: 'advanced',
      index: 2,
      progress: 3,
    });
    const actions = progress.clickForward(3);
    expect(actions.filter((action) => action.type === 'advanced')).toHaveLength(1);
    expect(progress.progress).toBe(4);
    expect(progress.activeIndex).toBe(3);
  });

  it('accepts either concealed position for an undecided swappable pair in click mode', () => {
    const progress = new ConnectionProgress(4, [0, 3], [[1, 2]]);

    progress.enableClickMode();
    expect(progress.clickForward(2).at(-1)).toMatchObject({
      type: 'advanced',
      index: 2,
      progress: 2,
    });
    expect(progress.clickForward(1).at(-1)).toMatchObject({
      type: 'advanced',
      index: 1,
      progress: 3,
    });
    expect(progress.clickForward(3).at(-1)).toMatchObject({
      type: 'advanced',
      complete: true,
      progress: 4,
    });
  });

  it('locks an undecided swappable pair back to authored order when one number is revealed', () => {
    const progress = new ConnectionProgress(4, [0, 3], [[1, 2]]);

    progress.revealIndices([1]);
    progress.begin(0);
    expect(progress.extend(2)).toMatchObject({ type: 'wrong', reason: 'non-consecutive' });
    expect(progress.extend(1)).toMatchObject({ type: 'advanced' });
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
