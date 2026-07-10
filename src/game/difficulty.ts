import type { EndlessStageSettings } from './types';

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const getEndlessStageSettings = (stageValue: number): EndlessStageSettings => {
  const stage = Math.max(1, Math.floor(stageValue));
  const zeroBased = stage - 1;
  const boardSize = clamp(4 + Math.floor(zeroBased / 3), 4, 8);

  return {
    rows: boardSize,
    columns: boardSize,
    hiddenPercent: clamp(20 + zeroBased * 4, 20, 75),
    maxVisibleRun: clamp(6 - Math.floor(zeroBased / 3), 2, 6),
    maxHiddenRun: clamp(2 + Math.floor(zeroBased / 2), 2, 8),
    targetCrossings: clamp(1 + Math.floor(zeroBased / 2), 1, 12),
  };
};
