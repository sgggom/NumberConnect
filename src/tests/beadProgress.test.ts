import { describe, expect, it, vi } from 'vitest';
import {
  advanceBeadProgress,
  loadBeadProgress,
  nextBeads,
  orderedBeads,
  parseBeadPattern,
  saveBeadProgress,
  type BeadPatternData,
} from '../gameplay/beads';

const pattern: BeadPatternData = {
  id: 'test-pattern',
  name: 'Test',
  width: 3,
  height: 2,
  pixels: {
    '0,0': '#FF0000', '1,0': null, '2,0': '#00FF00',
    '0,1': '#0000FF', '1,1': '#FFFFFF', '2,1': null,
  },
};

describe('bead progression', () => {
  it('orders non-empty beads from left to right and top to bottom', () => {
    expect(orderedBeads(pattern)).toEqual([
      { x: 0, y: 0, color: '#FF0000' },
      { x: 2, y: 0, color: '#00FF00' },
      { x: 0, y: 1, color: '#0000FF' },
      { x: 1, y: 1, color: '#FFFFFF' },
    ]);
  });

  it('assigns the next uncollected beads to a normal level', () => {
    expect(nextBeads(pattern, { patternId: pattern.id, collected: 1 }, 2)).toEqual([
      { x: 2, y: 0, color: '#00FF00' },
      { x: 0, y: 1, color: '#0000FF' },
    ]);
  });

  it('persists progress and clamps it to the pattern size', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    };
    const completed = advanceBeadProgress(pattern, { patternId: pattern.id, collected: 3 }, 10);

    expect(completed.collected).toBe(4);
    saveBeadProgress(completed, storage);
    expect(loadBeadProgress(pattern, storage)).toEqual(completed);
  });

  it('rejects incomplete pattern coordinates', () => {
    expect(() => parseBeadPattern({
      id: 'broken', name: 'Broken', width: 2, height: 1, pixels: { '0,0': '#FFFFFF' },
    })).toThrow('Missing bead coordinate 1,0');
  });
});
