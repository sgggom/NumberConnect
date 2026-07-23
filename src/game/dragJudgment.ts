import { isWithinCellWindow } from './topology';
import type { Cell } from './types';

export type DragJudgmentMode = 'full' | 'correct-only' | 'ignore';

export const dragJudgmentMode = (
  current: Cell,
  candidate: Cell,
  hidden: boolean,
): DragJudgmentMode => {
  if (!isWithinCellWindow(current, candidate)) return 'ignore';
  return hidden ? 'full' : 'correct-only';
};

export const shouldHandleDragAction = (
  mode: DragJudgmentMode,
  isWrong: boolean,
): boolean => mode === 'full' || (mode === 'correct-only' && !isWrong);

export const shouldShowDragQuestion = (
  current: Cell | undefined,
  candidate: Cell,
  concealed: boolean,
): boolean => current !== undefined
  && concealed
  && dragJudgmentMode(current, candidate, true) === 'full';
