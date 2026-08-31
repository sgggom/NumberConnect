import { describe, expect, it, vi } from 'vitest';
import { ConnectionProgress } from '../game/connectionProgress';
import { PathCompletionSolver } from '../game/pathCompletionSolver';
import { BoardShape } from '../game/types';

describe('connection progress', () => {
  it('uses the current complete path without running a new search for normal moves', () => {
    const cells = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ];
    const solver = new PathCompletionSolver(cells, BoardShape.Square);
    const findCompletion = vi.spyOn(solver, 'findCompletion');
    const progress = new ConnectionProgress(cells.length, [0, 3], [], solver);

    progress.begin(0);
    expect(progress.extend(1)).toMatchObject({ type: 'advanced' });
    expect(progress.extend(2)).toMatchObject({ type: 'advanced' });
    expect(findCompletion).not.toHaveBeenCalled();
  });

  it('uses asynchronous completion only after leaving the cached path', async () => {
    const cells = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ];
    const progress = new ConnectionProgress(
      cells.length,
      [0, 3],
      [],
      new PathCompletionSolver(cells, BoardShape.Square),
    );
    const findCompletion = vi.fn(async () => [0, 2, 1, 3]);

    progress.begin(0);
    await expect(progress.extendAsync(2, findCompletion)).resolves.toMatchObject({ type: 'advanced' });
    expect(findCompletion).toHaveBeenCalledTimes(1);
    await expect(progress.extendAsync(1, findCompletion)).resolves.toMatchObject({ type: 'advanced' });
    expect(findCompletion).toHaveBeenCalledTimes(1);
  });

  it('accepts an alternate connection when the remaining board still has a full solution', () => {
    const cells = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ];
    const progress = new ConnectionProgress(
      cells.length,
      [0, 3],
      [],
      new PathCompletionSolver(cells, BoardShape.Square),
    );

    progress.begin(0);
    expect(progress.extend(2)).toMatchObject({ type: 'advanced' });
    expect(progress.displayNumber(2)).toBe(2);
    expect(progress.extend(1)).toMatchObject({ type: 'advanced' });
    expect(progress.displayNumber(1)).toBe(3);
    expect(progress.extend(3)).toMatchObject({ type: 'advanced', complete: true });
    expect(progress.connectedNodePairs()).toEqual([[0, 2], [1, 2], [1, 3]]);
  });

  it('undoes connected edges one step at a time and restores the previous endpoint', () => {
    const progress = new ConnectionProgress(4, [0, 3]);

    progress.begin(0);
    progress.extend(1);
    progress.extend(2);

    expect(progress.canUndoStep).toBe(true);
    expect(progress.undoLastStep()).toBe(2);
    expect(progress.activeIndex).toBe(1);
    expect(progress.isEdgeConnected(0)).toBe(true);
    expect(progress.isEdgeConnected(1)).toBe(false);
    expect(progress.isVisible(2)).toBe(false);

    expect(progress.undoLastStep()).toBe(0);
    expect(progress.activeIndex).toBe(0);
    expect(progress.isEdgeConnected(0)).toBe(false);
    expect(progress.isVisible(1)).toBe(false);
    expect(progress.canUndoStep).toBe(false);
    expect(progress.undoLastStep()).toBeUndefined();
  });

  it('restores the prior solution order after undoing an alternate connection', () => {
    const cells = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ];
    const progress = new ConnectionProgress(
      cells.length,
      [0, 3],
      [],
      new PathCompletionSolver(cells, BoardShape.Square),
    );

    progress.begin(0);
    progress.extend(2);
    expect(progress.displayNumber(2)).toBe(2);

    expect(progress.undoLastStep()).toBe(0);
    expect(progress.displayNumber(1)).toBe(2);
    expect(progress.isVisible(2)).toBe(false);
    expect(progress.extend(1)).toMatchObject({ type: 'advanced', index: 1 });
  });

  it('keeps power-up reveals made after a connection when that connection is undone', () => {
    const progress = new ConnectionProgress(5, [0, 4]);

    progress.begin(0);
    progress.extend(1);
    progress.revealIndices([3]);
    progress.undoLastStep();

    expect(progress.isVisible(1)).toBe(false);
    expect(progress.isVisible(3)).toBe(true);
    expect(progress.begin(3)).toMatchObject({ type: 'wrong', reason: 'start-order' });
    expect(progress.begin(0)).toMatchObject({ type: 'started', index: 0 });
  });

  it('keeps a revealed alternate-path number fixed when undoing the branch that exposed it', () => {
    const cells = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ];
    const progress = new ConnectionProgress(
      cells.length,
      [0, 3],
      [],
      new PathCompletionSolver(cells, BoardShape.Square),
    );

    progress.begin(0);
    progress.extend(2);
    progress.revealIndices([1]);
    expect(progress.displayNumber(1)).toBe(3);

    progress.undoLastStep();
    expect(progress.isVisible(1)).toBe(true);
    expect(progress.isVisible(2)).toBe(false);
    expect(progress.displayNumber(1)).toBe(3);
    expect(progress.extend(2)).toMatchObject({ type: 'advanced', index: 2 });
  });

  it('rejects an adjacent connection when no complete one-stroke solution remains', () => {
    const cells = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 2 },
    ];
    const progress = new ConnectionProgress(
      cells.length,
      [0, 2, 4],
      [],
      new PathCompletionSolver(cells, BoardShape.Square),
    );

    progress.begin(0);
    expect(progress.canCompleteAfterStep(0, 3)).toBe(false);
    expect(progress.canCompleteAfterStep(0, 1)).toBe(true);
    expect(progress.extend(3)).toMatchObject({ type: 'wrong', reason: 'no-completion' });
    expect(progress.extend(1)).toMatchObject({ type: 'advanced' });
  });

  it('starts only from number one even when a later number is visible', () => {
    const progress = new ConnectionProgress(6, [0, 3, 5]);

    expect(progress.begin(3)).toEqual({ type: 'wrong', index: 3, reason: 'start-order' });
    expect(progress.begin(0)).toEqual({ type: 'started', index: 0 });
    expect(progress.extend(1)).toMatchObject({ type: 'advanced', added: true, progress: 2 });
    expect(progress.isVisible(1)).toBe(true);
    expect(progress.isEdgeConnected(0)).toBe(true);
  });

  it('rejects a connection from a larger number to a smaller number', () => {
    const progress = new ConnectionProgress(5, [0, 2, 4]);

    expect(progress.begin(4)).toMatchObject({ type: 'wrong', reason: 'start-order' });
    expect(progress.extend(3)).toEqual({ type: 'ignored' });
    expect(progress.progress).toBe(0);
    expect(progress.isEdgeConnected(3)).toBe(false);
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

  it('unlocks a swappable hidden pair after its chosen edge is undone', () => {
    const progress = new ConnectionProgress(4, [0, 3], [[1, 2]]);

    progress.begin(0);
    progress.extend(2);
    expect(progress.displayNumber(2)).toBe(2);

    progress.undoLastStep();
    expect(progress.displayNumber(1)).toBe(2);
    expect(progress.extend(1)).toMatchObject({ type: 'advanced', index: 1 });
  });

  it('rejects a swappable hidden pair when connecting backward', () => {
    const progress = new ConnectionProgress(4, [0, 3], [[1, 2]]);

    expect(progress.begin(3)).toMatchObject({ type: 'wrong', reason: 'start-order' });
    expect(progress.extend(1)).toEqual({ type: 'ignored' });
    expect(progress.progress).toBe(0);
  });

  it('does not allow a two-position jump unless the hidden pair is swappable', () => {
    const progress = new ConnectionProgress(4, [0, 3]);

    progress.begin(0);
    expect(progress.extend(2)).toMatchObject({ type: 'wrong', reason: 'non-consecutive' });
  });

  it('rejects starting after number one and skipped numbers', () => {
    const progress = new ConnectionProgress(5, [0, 2, 4]);

    expect(progress.begin(1)).toMatchObject({ type: 'wrong', reason: 'start-order' });
    expect(progress.begin(2)).toMatchObject({ type: 'wrong', reason: 'start-order' });
    progress.begin(0);
    expect(progress.extend(4)).toMatchObject({ type: 'wrong', reason: 'non-consecutive' });
  });

  it('does not let a power-up reveal bypass the required starting number', () => {
    const progress = new ConnectionProgress(5, [0, 4]);

    expect(progress.begin(2)).toMatchObject({ type: 'wrong', reason: 'start-order' });
    expect(progress.revealIndices([2, 2, 9])).toBe(1);
    expect(progress.begin(2)).toMatchObject({ type: 'wrong', reason: 'start-order' });
    expect(progress.begin(0)).toEqual({ type: 'started', index: 0 });
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

    progress.begin(0);
    expect(progress.suggestedNextHint()).toEqual({ index: 2, consecutive: false });
    progress.extend(1);
    expect(progress.suggestedNextHint()).toEqual({ index: 2, consecutive: true });
    progress.extend(2);
    expect(progress.suggestedNextHint()).toEqual({ index: 4, consecutive: false });
  });

  it('does not suggest a smaller visible number', () => {
    const progress = new ConnectionProgress(7, [0, 2, 4, 6]);

    expect(progress.begin(6)).toMatchObject({ type: 'wrong', reason: 'start-order' });
    expect(progress.suggestedNextHint()).toBeUndefined();
    expect(progress.extend(5)).toEqual({ type: 'ignored' });
  });

  it('continues the ascending prefix across separate strokes', () => {
    const progress = new ConnectionProgress(5, [0, 2, 4]);

    expect(progress.begin(2)).toMatchObject({ type: 'wrong', reason: 'start-order' });
    progress.begin(0);
    progress.extend(1);
    progress.endStroke();
    expect(progress.begin(2)).toMatchObject({ type: 'wrong', reason: 'start-order' });
    progress.begin(1);
    progress.extend(2);
    progress.endStroke();
    progress.begin(2);
    const completion = progress.extend(3);
    progress.endStroke();
    progress.begin(3);
    const finalCompletion = progress.extend(4);

    expect(completion).toMatchObject({ type: 'advanced', complete: false, progress: 4 });
    expect(finalCompletion).toMatchObject({ type: 'advanced', complete: true, progress: 5 });
    expect(progress.complete).toBe(true);
  });

  it('rejects restarting behind the connected prefix', () => {
    const progress = new ConnectionProgress(5, [0, 1, 2, 3, 4]);

    progress.begin(0);
    progress.extend(1);
    progress.endStroke();

    expect(progress.begin(0)).toMatchObject({ type: 'wrong', reason: 'start-order' });
    expect(progress.activeIndex).toBeUndefined();
    expect(progress.isEdgeConnected(0)).toBe(true);
  });

  it('restores the required frontier after undoing a step', () => {
    const progress = new ConnectionProgress(4, [0, 1, 2, 3]);

    progress.begin(0);
    progress.extend(1);
    progress.extend(2);
    expect(progress.undoLastStep()).toBe(2);
    progress.endStroke();

    expect(progress.begin(2)).toMatchObject({ type: 'wrong', reason: 'start-order' });
    expect(progress.begin(1)).toMatchObject({ type: 'started', index: 1 });
    expect(progress.extend(2)).toMatchObject({ type: 'advanced', progress: 3 });
    const completion = progress.extend(3);

    expect(completion).toMatchObject({ type: 'advanced', added: true, complete: true });
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
