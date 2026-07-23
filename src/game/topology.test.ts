import { describe, expect, it } from 'vitest';
import { isWithinCellWindow } from './topology';

describe('cell window', () => {
  it('includes every cell in the 3 by 3 window around the center', () => {
    const center = { x: 4, y: 7 };

    for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
      for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
        expect(isWithinCellWindow(center, {
          x: center.x + deltaX,
          y: center.y + deltaY,
        })).toBe(true);
      }
    }
  });

  it('excludes cells outside the current number 3 by 3 window', () => {
    const center = { x: 4, y: 7 };

    expect(isWithinCellWindow(center, { x: 6, y: 7 })).toBe(false);
    expect(isWithinCellWindow(center, { x: 4, y: 5 })).toBe(false);
    expect(isWithinCellWindow(center, { x: 6, y: 9 })).toBe(false);
  });
});
