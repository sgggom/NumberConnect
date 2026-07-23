export const CELL_RADIUS_SCALE = 0.9;
export const CELL_GLOW_RADIUS_MARGIN = 6;
export const CELL_GLOW_STROKE_WIDTH = 4;
export const CELL_HINT_MAX_SCALE = 1.13;
export const MAX_CELL_STEP = 86;

export const baseCellRadiusForStep = (step: number, isHex: boolean): number => (isHex
  ? Math.max(16, Math.min(44, step * 0.56))
  : Math.max(13, Math.min(32, step * 0.34)));

export const cellVisualRadiusForStep = (step: number, isHex: boolean): number => (
  baseCellRadiusForStep(step, isHex) * CELL_RADIUS_SCALE
  + CELL_GLOW_RADIUS_MARGIN
  + CELL_GLOW_STROKE_WIDTH * 0.5
) * CELL_HINT_MAX_SCALE;

export const boardVisualExtent = (
  projectedRange: number,
  step: number,
  isHex: boolean,
): number => projectedRange * step + cellVisualRadiusForStep(step, isHex) * 2;

export const numberFontSizeForBoard = (
  baseRadius: number,
  totalNodes: number,
): number => {
  const standardSize = Math.round(
    Math.max(12, Math.round(baseRadius * 0.72)) * 1.5,
  );
  const digitCount = String(Math.max(1, totalNodes)).length;
  if (digitCount <= 2) return standardSize;

  const availableWidth = baseRadius * 2 * CELL_RADIUS_SCALE * 0.88;
  const fittedSize = Math.floor(availableWidth / (digitCount * 0.6));
  return Math.max(10, Math.min(standardSize, fittedSize));
};

export const maximumStepForExtent = (
  projectedRange: number,
  availableExtent: number,
  isHex: boolean,
): number => {
  let lower = 0;
  let upper = MAX_CELL_STEP;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const candidate = (lower + upper) * 0.5;
    if (boardVisualExtent(projectedRange, candidate, isHex) <= availableExtent) {
      lower = candidate;
    } else {
      upper = candidate;
    }
  }
  return lower;
};
