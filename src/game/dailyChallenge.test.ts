import { describe, expect, it } from 'vitest';
import {
  createDailyChallengeLevel,
  DAILY_CHALLENGE_LEVEL_COUNT,
  dailyChallengeLevelIndex,
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

  it('cycles through all imported levels in calendar-day order', () => {
    expect(DAILY_CHALLENGE_LEVEL_COUNT).toBe(30);
    expect(dailyChallengeLevelIndex('2026-07-21')).toBe(dailyChallengeLevelIndex('2026-07-21'));
    expect(dailyChallengeLevelIndex('2026-07-22')).toBe(
      (dailyChallengeLevelIndex('2026-07-21') + 1) % DAILY_CHALLENGE_LEVEL_COUNT,
    );
    expect(dailyChallengeLevelIndex('2026-08-20')).toBe(dailyChallengeLevelIndex('2026-07-21'));
    expect(dailyChallengeLevelIndex('1969-12-31')).toBeGreaterThanOrEqual(0);
  });

  it('builds every batch-playtested board with its authored hidden cells', () => {
    const dates = Array.from({ length: DAILY_CHALLENGE_LEVEL_COUNT }, (_, offset) => (
      formatDailyDateKey(new Date(2026, 6, 21 + offset, 12))
    ));
    expect(new Set(dates.map(dailyChallengeLevelIndex)).size).toBe(DAILY_CHALLENGE_LEVEL_COUNT);

    dates.forEach((dateKey) => {
      const level = createDailyChallengeLevel(dateKey);
      expect(level.levelId).toBe(Number(dateKey.replaceAll('-', '')));
      expect(level.rows).toBe(10);
      expect(level.columns).toBe(8);
      expect(level.solutionPath).toHaveLength(80);
      expect(level.hiddenCells).toHaveLength(42);
      expect(level.hiddenCells?.filter((cell) => (
        level.solutionPath.slice(0, 4).some((pathCell) => pathCell.x === cell.x && pathCell.y === cell.y)
      )).length).toBeLessThanOrEqual(1);
    });
  });

  it('uses a Monday-first calendar grid', () => {
    expect(mondayFirstOffset(2026, 6)).toBe(2);
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(daysInMonth(2028, 1)).toBe(29);
  });
});
