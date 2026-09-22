import { areNeighborCells } from '../../game/topology';
import type { BoardShape, Cell } from '../../game/types';

export type ReasoningStrength = 'low' | 'medium' | 'high';

/** Bounded lookahead using perceived labels only, never the solution order. */
export function reasoningCandidates(input: {
  cells: readonly Cell[]; shape: BoardShape; visited: ReadonlySet<number>;
  known: ReadonlyMap<number, number>; nextNumber: number;
  candidates: number[]; strength: ReasoningStrength;
  fallback?: boolean;
}): Set<number> {
  const { cells, shape, visited, known, nextNumber, candidates } = input;
  const depth = input.strength === 'high' ? 5 : input.strength === 'medium' ? 2 : 0;
  if (!depth || (candidates.length < 2 && input.fallback !== false)) return new Set(candidates);
  const neighbors = cells.map((cell, i) => cells.flatMap((other, j) =>
    i !== j && areNeighborCells(cell, other, shape) ? [j] : []));
  const anchor = [...known].filter(([i, value]) => !visited.has(i) && value >= nextNumber)
    .sort((a, b) => a[1] - b[1])[0];
  // Graph distance is a lower bound even when some of its cells cannot be used.
  const distances = new Map<number, number>();
  if (anchor) {
    const queue = [anchor[0]]; distances.set(anchor[0], 0);
    for (let i = 0; i < queue.length; i++) for (const n of neighbors[queue[i]]) {
      if (!visited.has(n) && !distances.has(n)) {
        distances.set(n, distances.get(queue[i])! + 1); queue.push(n);
      }
    }
  }
  const used = new Set(visited);
  const search = (current: number, step: number): boolean => {
    const value = nextNumber + step - 1;
    if (known.has(current) && known.get(current) !== value) return false;
    if (anchor && (distances.get(current) ?? Infinity) > anchor[1] - value) return false;
    const remaining = cells.flatMap((_, i) => used.has(i) ? [] : [i]);
    if (!remaining.length) return true;
    if (!neighbors[current].some((n) => !used.has(n))) return false;
    const reachable = new Set([remaining[0]]), queue = [remaining[0]];
    for (let i = 0; i < queue.length; i++) for (const n of neighbors[queue[i]]) {
      if (!used.has(n) && !reachable.has(n)) { reachable.add(n); queue.push(n); }
    }
    if (reachable.size !== remaining.length) return false;
    if (step >= depth || current === anchor?.[0]) return true;
    for (const n of neighbors[current]) {
      if (used.has(n)) continue;
      used.add(n); const possible = search(n, step + 1); used.delete(n);
      if (possible) return true;
    }
    return false;
  };
  const safe = candidates.filter((candidate) => {
    used.add(candidate); const possible = search(candidate, 1); used.delete(candidate);
    return possible;
  });
  return new Set(safe.length || input.fallback === false ? safe : candidates);
}
