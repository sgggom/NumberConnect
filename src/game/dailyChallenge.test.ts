import { describe, expect, it } from 'vitest';
import {
  dailyChallengeSeed,
  dailyChallengeStage,
  daysInMonth,
  formatDailyDateKey,
  mondayFirstOffset,
  parseDailyDateKey,
} from './dailyChallenge';

describe('daily challenge dates', () => {
  it('formats and parses local calendar dates without a timezone shift', () => {
    const date = new Date(2026, 6, 21, 12);
    expect(formatDailyDateKey(date)).toBe('2026-07-21');
    expect(parseDailyDateKey('2026-07-21')?.getDate()).toBe(21);
  });

  it('rejects impossible dates', () => {
    expect(parseDailyDateKey('2026-02-30')).toBeNull();
    expect(parseDailyDateKey('not-a-date')).toBeNull();
  });

  it('creates a stable seed and bounded difficulty stage for each day', () => {
    expect(dailyChallengeSeed('2026-07-21')).toBe(dailyChallengeSeed('2026-07-21'));
    expect(dailyChallengeSeed('2026-07-21')).not.toBe(dailyChallengeSeed('2026-07-22'));
    expect(dailyChallengeStage('2026-07-21')).toBeGreaterThanOrEqual(2);
    expect(dailyChallengeStage('2026-07-21')).toBeLessThanOrEqual(10);
  });

  it('uses a Monday-first calendar grid', () => {
    expect(mondayFirstOffset(2026, 6)).toBe(2);
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(daysInMonth(2028, 1)).toBe(29);
  });
});
