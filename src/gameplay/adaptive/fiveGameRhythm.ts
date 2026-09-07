import type { StageDifficultyState } from './stageDifficulty';

export interface RhythmPosition { day: string; position: number }
export interface RhythmLedger { day: string; next: number; levels: Record<string, RhythmPosition> }
export const isRhythmPosition = (value: unknown): value is RhythmPosition => {
  const item = value as RhythmPosition | undefined;
  return !!item && typeof item.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.day)
    && Number.isInteger(item.position) && item.position >= 1 && item.position <= 5;
};
export const RHYTHM_OFFSETS = [
  [-1, -1, -1, -1], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 1, 1, 0],
] as const;
export const rhythmOffset = (position: number, stage: number): number =>
  RHYTHM_OFFSETS[position - 1][Math.max(0, Math.min(3, stage - 1))];
const localDay = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Allocate once per new whole level. Existing levels retain their assignment across midnight. */
export const assignLevelRhythm = (state: StageDifficultyState, levelId: number, date = new Date()): RhythmPosition | undefined => {
  if (levelId <= 11) return;
  const existing = Object.values(state.stages).filter(entry => entry.levelId === levelId);
  if (existing.length) return existing.find(entry => entry.rhythm)?.rhythm;
  const day = localDay(date);
  state.rhythm ??= { day, next: 0, levels: {} };
  const ledger = state.rhythm;
  if (ledger.levels[levelId]) return ledger.levels[levelId];
  if (ledger.day !== day) { ledger.day = day; ledger.next = 0; }
  const assigned = { day, position: ledger.next % 5 + 1 };
  ledger.next += 1;
  ledger.levels[levelId] = assigned;
  return assigned;
};
