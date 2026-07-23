import { describe, expect, it } from 'vitest';
import {
  dragJudgmentMode,
  shouldHandleDragAction,
  shouldShowDragQuestion,
} from './dragJudgment';

describe('drag judgment candidates', () => {
  const current = { x: 4, y: 7 };

  it('fully judges hidden cells inside the current number 3 by 3 window', () => {
    expect(dragJudgmentMode(current, { x: 3, y: 6 }, true)).toBe('full');
    expect(dragJudgmentMode(current, { x: 5, y: 8 }, true)).toBe('full');
  });

  it('excludes hidden cells outside the current number 3 by 3 window', () => {
    expect(dragJudgmentMode(current, { x: 6, y: 7 }, true)).toBe('ignore');
    expect(dragJudgmentMode(current, { x: 4, y: 9 }, true)).toBe('ignore');
  });

  it('only accepts correct displayed number cells inside the 3 by 3 window', () => {
    expect(dragJudgmentMode(current, { x: 3, y: 6 }, false)).toBe('correct-only');
    expect(dragJudgmentMode(current, { x: 5, y: 8 }, false)).toBe('correct-only');
  });

  it('excludes displayed number cells outside the 3 by 3 window', () => {
    expect(dragJudgmentMode(current, { x: 10, y: 12 }, false)).toBe('ignore');
  });

  it('accepts correct displayed cells but suppresses their wrong result', () => {
    expect(shouldHandleDragAction('correct-only', false)).toBe(true);
    expect(shouldHandleDragAction('correct-only', true)).toBe(false);
    expect(shouldHandleDragAction('full', false)).toBe(true);
    expect(shouldHandleDragAction('full', true)).toBe(true);
  });

  it('shows questions only on concealed cells inside the current 3 by 3 window', () => {
    expect(shouldShowDragQuestion(current, { x: 3, y: 6 }, true)).toBe(true);
    expect(shouldShowDragQuestion(current, { x: 3, y: 6 }, false)).toBe(false);
    expect(shouldShowDragQuestion(current, { x: 6, y: 7 }, true)).toBe(false);
    expect(shouldShowDragQuestion(undefined, { x: 3, y: 6 }, true)).toBe(false);
  });
});
