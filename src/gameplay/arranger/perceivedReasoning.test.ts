import { describe, expect, it } from 'vitest';
import { BoardShape } from '../../game/types';
import { reasoningCandidates } from './perceivedReasoning';
import { decideHandObservation } from './occlusionSimulation';

describe('perceived player reasoning', () => {
  const input = {
    cells: [{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 0 }],
    shape: BoardShape.Square, visited: new Set([0]), known: new Map<number, number>(),
    nextNumber: 2, candidates: [1, 2],
  };
  it('low keeps all choices while medium and high exclude a move isolating the remainder', () => {
    expect([...reasoningCandidates({ ...input, strength: 'low' })]).toEqual([1, 2]);
    expect([...reasoningCandidates({ ...input, strength: 'medium' })]).toEqual([2]);
    expect([...reasoningCandidates({ ...input, strength: 'high' })]).toEqual([2]);
  });
  it('falls back when every candidate fails perceived constraints', () => {
    expect([...reasoningCandidates({ ...input, known: new Map([[1, 9], [2, 8]]), strength: 'high' })]).toEqual([1, 2]);
  });
  it('strict reasoning reports no move instead of falling back, including a single candidate', () => {
    expect(reasoningCandidates({ ...input, strength: 'medium', candidates: [1], fallback: false }).size).toBe(0);
    expect(reasoningCandidates({ ...input, known: new Map([[1, 9], [2, 8]]), strength: 'medium', fallback: false }).size).toBe(0);
  });
  it('does not depend on the authored cell ordering', () => {
    const reordered = { ...input, cells: [...input.cells].reverse(), visited: new Set([3]), candidates: [2, 1] };
    expect([...reasoningCandidates({ ...reordered, strength: 'high' })].map((i) => reordered.cells[i]))
      .toEqual([input.cells[2]]);
  });
  it('uses separately configured observation rates regardless of reasoning', () => {
    for (const reasoning of ['low', 'medium', 'high'] as const) {
      const player = { reasoning, normal: .37, afterError: .82 };
      expect(decideHandObservation(player, false, true, () => .4).observed).toBe(false);
      expect(decideHandObservation(player, true, true, () => .4).observed).toBe(true);
      expect(decideHandObservation({ ...player, afterError: 0 }, true, false, () => .99))
        .toMatchObject({ observed: true, forced: true });
    }
  });
});
