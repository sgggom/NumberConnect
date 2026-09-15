import { describe, expect, it } from 'vitest';
import { generateHollowFormation, type FormationSymmetry } from './generateHollowFormation';
import { areEditorCellsNeighbors, countEditorPathCrossings } from './findEditorPath';
import { LevelEditorModel } from './LevelEditorModel';
import { createRandom } from '../../game/random';
import type { EditorCell } from './types';

const key = ({ x, y }: EditorCell): string => `${x},${y}`;
const symmetries: FormationSymmetry[] = ['central', 'vertical', 'horizontal', 'diagonal', 'rotate-2', 'rotate-4'];

describe('hollow formation generation', () => {
  it('randomizes the actual count within the requested interval', () => {
    const counts = new Set<number>();
    for (let seed = 0; seed < 12; seed += 1) {
      const path = generateHollowFormation({ rows: 8, columns: 8, shape: 'square', symmetry: 'rotate-4', seed,
        hollowPercentMin: 20, hollowPercentMax: 50 });
      const count = 64 - path.length;
      expect(count / 64 * 100).toBeGreaterThanOrEqual(20);
      expect(count / 64 * 100).toBeLessThanOrEqual(50);
      counts.add(count);
    }
    expect(counts.size).toBeGreaterThan(1);
  });

  it('supports equal bounds when feasible and rejects reversed or infeasible ranges', () => {
    const base = { rows: 8, columns: 8, shape: 'square' as const, symmetry: 'rotate-4' as const, seed: 9 };
    expect(generateHollowFormation({ ...base, hollowPercentMin: 25, hollowPercentMax: 25 })).toHaveLength(48);
    expect(() => generateHollowFormation({ ...base, hollowPercentMin: 40, hollowPercentMax: 20 })).toThrow('下限不能大于上限');
    expect(() => generateHollowFormation({ ...base, hollowPercentMin: 30, hollowPercentMax: 30 })).toThrow('范围内没有可用格数');
  });

  it.each([0, 10, 30, 60, 90])('uses the whole board as the denominator for %s percent hollowing', (hollowPercent) => {
    const path = generateHollowFormation({ rows: 8, columns: 8, shape: 'square', symmetry: 'vertical', seed: 41, hollowPercentMin: Math.max(0, hollowPercent - 3), hollowPercentMax: Math.min(90, hollowPercent + 3) });
    expect(Math.abs(64 - path.length - Math.round(64 * hollowPercent / 100))).toBeLessThanOrEqual(2);
    expect(new Set(path.map(key)).size).toBe(path.length);
    expect(path.slice(1).every((cell, i) => areEditorCellsNeighbors(path[i], cell, 'square'))).toBe(true);
    expect(countEditorPathCrossings(path, 'square')).toBe(0);
  });

  it('random type selects an existing symmetry and excludes square-only types on rectangles', () => {
    for (const columns of [6, 8]) for (let seed = 0; seed < 6; seed += 1) {
      const request = { rows: 6, columns, shape: 'rectangle' as const, symmetry: 'random' as const, seed, hollowPercentMin: 25, hollowPercentMax: 35 };
      const options: FormationSymmetry[] = columns === 6 ? symmetries : ['central', 'vertical', 'horizontal', 'rotate-2'];
      const selected = options[Math.floor(createRandom(seed)() * options.length)];
      expect(generateHollowFormation(request)).toEqual(generateHollowFormation({ ...request, symmetry: selected }));
    }
  });

  it.each(symmetries)('can remove edge cells while retaining %s symmetry', (symmetry) => {
    const path = generateHollowFormation({ rows: 8, columns: 8, shape: 'square', symmetry, seed: 14, hollowPercentMin: 37, hollowPercentMax: 43 });
    const active = new Set(path.map(key));
    expect(Math.abs(64 - path.length - 64 * .4)).toBeLessThanOrEqual(2);
    expect(Array.from({ length: 8 }, (_, i) => [
      { x: i, y: 0 }, { x: i, y: 7 }, { x: 0, y: i }, { x: 7, y: i },
    ]).flat().some((cell) => !active.has(key(cell)))).toBe(true);
  });

  it.each(symmetries)('generates connected hollow %s boards with a non-crossing Hamiltonian path', (symmetry) => {
    for (const size of [3, 6, 7, 10]) {
      const path = generateHollowFormation({ rows: size, columns: size, shape: 'square', symmetry, seed: size * 13, hollowPercentMin: 10, hollowPercentMax: 50 });
      const active = new Set(path.map(key));
      expect(active.size).toBe(path.length);
      expect(active.size).toBeLessThan(size * size);
      expect(countEditorPathCrossings(path, 'square')).toBe(0);
      for (let index = 0; index < path.length; index += 1) {
        const { x, y } = path[index];
        expect(x >= 0 && y >= 0 && x < size && y < size).toBe(true);
        if (index > 0) expect(areEditorCellsNeighbors(path[index - 1], path[index], 'square')).toBe(true);
        const counterpart = symmetry === 'vertical' ? { x, y: size - 1 - y }
          : symmetry === 'horizontal' ? { x: size - 1 - x, y }
          : symmetry === 'diagonal' ? { x: y, y: x }
            : symmetry === 'rotate-4' ? { x: size - 1 - y, y: x }
              : { x: size - 1 - x, y: size - 1 - y };
        expect(active.has(key(counterpart))).toBe(true);
      }
      const reached = new Set([key(path[0])]);
      const queue = [path[0]];
      for (let i = 0; i < queue.length; i += 1) {
        const { x, y } = queue[i];
        for (const next of [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }]) {
          if (active.has(key(next)) && !reached.has(key(next))) { reached.add(key(next)); queue.push(next); }
        }
      }
      expect(reached.size).toBe(active.size);
    }
  });

  it('supports rectangular and maximum-size boards without returning an unsolved shape', () => {
    for (const [rows, columns] of [[3, 12], [8, 5], [20, 20]]) {
      const path = generateHollowFormation({ rows, columns, shape: 'rectangle', symmetry: 'central', seed: 72 });
      expect(path.length).toBeLessThan(rows * columns);
      expect(new Set(path.map(key)).size).toBe(path.length);
      expect(countEditorPathCrossings(path, 'rectangle')).toBe(0);
      expect(path.slice(1).every((cell, i) => areEditorCellsNeighbors(path[i], cell, 'rectangle'))).toBe(true);
    }
  });

  it('uses display directions for diamond reflection', () => {
    for (const symmetry of ['vertical', 'horizontal', 'diagonal'] as const) {
      const path = generateHollowFormation({ rows: 6, columns: 6, shape: 'diamond', symmetry, seed: 3 });
      const active = new Set(path.map(key));
      for (const { x, y } of path) expect(active.has(key(symmetry === 'vertical'
        ? { x: 5 - y, y: 5 - x } : symmetry === 'horizontal' ? { x: y, y: x } : { x, y: 5 - y }))).toBe(true);
      expect(countEditorPathCrossings(path, 'diamond')).toBe(0);
    }
  });

  it('varies hollow silhouettes with different seeds', () => {
    const patterns = new Set(Array.from({ length: 8 }, (_, seed) => generateHollowFormation({
      rows: 8, columns: 8, shape: 'square', symmetry: 'rotate-4', seed,
    }).map(key).sort().join(';')));
    expect(patterns.size).toBeGreaterThan(2);
  });

  it('rejects unsupported dimensions and topology', () => {
    const base = { rows: 5, columns: 8, shape: 'rectangle' as const, symmetry: 'central' as const, seed: 1 };
    expect(() => generateHollowFormation({ ...base, rows: 2 })).toThrow('至少 3×3');
    expect(() => generateHollowFormation({ ...base, symmetry: 'diagonal' })).toThrow('等宽高');
    expect(() => generateHollowFormation({ ...base, symmetry: 'rotate-4' })).toThrow('等宽高');
    expect(() => generateHollowFormation({ ...base, shape: 'hex' })).toThrow('六边形');
    for (const hollowPercent of [-1, 91, NaN, Infinity]) {
      expect(() => generateHollowFormation({ ...base, hollowPercentMin: hollowPercent })).toThrow('0–90');
    }
  });

  it('applies only the shape, clears stale paths and hidden state, and preserves state on invalid input', () => {
    const model = new LevelEditorModel();
    const path = generateHollowFormation({ ...model.size(), shape: model.shape, symmetry: 'central', seed: 4 });
    model.setManualEditMode('path');
    expect(model.applyGeneratedFormation(path)).toBe(true);
    expect(model.manualEditMode).toBe('off');
    expect(model.hasGeneratedPath).toBe(false);
    expect(model.solutionPath).toEqual([]);
    expect(model.activeCells.size).toBe(path.length);
    model.applyGeneratedPathResult({ path });
    model.toggleManualHiddenCell(key(path[1]));
    expect(model.hiddenCellKeys.size).toBe(1);
    expect(model.applyGeneratedFormation([path[0], path[0]])).toBe(false);
    expect(model.hiddenCellKeys.size).toBe(1);
    expect(model.applyGeneratedFormation(path)).toBe(true);
    expect(model.hiddenCellKeys.size).toBe(0);
    expect(model.solutionPath).toEqual([]);
    expect(model.activeCells.size).toBe(path.length);
    expect(model.createLevel(1)).toBeNull();
  });
});
