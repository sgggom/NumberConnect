import { describe, expect, it } from 'vitest';
import {
  boardVisualExtent,
  cellVisualRadiusForStep,
  maximumStepForExtent,
  numberFontSizeForBoard,
} from './boardSizing';

describe('board sizing', () => {
  it.each([
    { range: 7, available: 420, isHex: false },
    { range: 11, available: 420, isHex: false },
    { range: 7.5, available: 500, isHex: true },
  ])('keeps the complete cell visuals inside the available extent', ({
    range,
    available,
    isHex,
  }) => {
    const step = maximumStepForExtent(range, available, isHex);

    expect(boardVisualExtent(range, step, isHex)).toBeLessThanOrEqual(available);
    expect(boardVisualExtent(range, step + 0.01, isHex)).toBeGreaterThan(available);
  });

  it('reserves room beyond the cell body for glow and pulse effects', () => {
    const step = 52;
    const bodyRadius = Math.max(13, Math.min(32, step * 0.34)) * 0.9;

    expect(cellVisualRadiusForStep(step, false)).toBeGreaterThan(bodyRadius + 8);
  });

  it('shrinks three-digit labels to fit dense large-board cells', () => {
    const baseRadius = 13;
    const twoDigitSize = numberFontSizeForBoard(baseRadius, 64);
    const threeDigitSize = numberFontSizeForBoard(baseRadius, 144);

    expect(threeDigitSize).toBeLessThan(twoDigitSize);
    expect(threeDigitSize * 3 * 0.6).toBeLessThanOrEqual(
      baseRadius * 2 * 0.9 * 0.88,
    );
  });
});
