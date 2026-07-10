import { describe, expect, it } from 'vitest';
import { findEditorPath } from './findEditorPath';

describe('level editor path generation', () => {
  it('finds a one-stroke path for a connected painted shape', () => {
    const active = new Set(['0,0', '1,0', '2,0', '2,1', '1,1', '0,1']);
    const path = findEditorPath(2, 3, active);
    expect(path).not.toBeNull();
    expect(path).toHaveLength(active.size);
    expect(new Set((path ?? []).map((cell) => `${cell.x},${cell.y}`))).toEqual(active);
    expect((path ?? []).every((cell, index, cells) => {
      if (index === 0) return true;
      const previous = cells[index - 1];
      return Math.abs(cell.x - previous.x) <= 1 && Math.abs(cell.y - previous.y) <= 1;
    })).toBe(true);
  });

  it('finds a path using honeycomb six-neighbor rules', () => {
    const active = new Set(['0,0', '1,0', '0,1', '1,1', '0,2', '1,2']);
    const path = findEditorPath(3, 2, active, 'hex');
    expect(path).toHaveLength(active.size);
  });

});
