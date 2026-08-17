import dailyChallengeLevels from './dailyChallengeLevels.json';
import { decodeCompactLevelData } from './levelDataFormat';
import type { LevelData } from './types';

const DAILY_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export const DAILY_CHALLENGE_LEVEL_COUNT = dailyChallengeLevels.length;

export const formatDailyDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const parseDailyDateKey = (value: string): Date | null => {
  const match = DAILY_DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
};

export const isDailyDateKey = (value: unknown): value is string => (
  typeof value === 'string' && parseDailyDateKey(value) !== null
);

export const dailyChallengeLevelIndex = (dateKey: string): number => {
  const date = parseDailyDateKey(dateKey);
  if (!date) throw new Error(`无效的每日挑战日期：${dateKey}`);
  const dayNumber = Math.floor(Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ) / MILLISECONDS_PER_DAY);
  return (
    dayNumber % DAILY_CHALLENGE_LEVEL_COUNT + DAILY_CHALLENGE_LEVEL_COUNT
  ) % DAILY_CHALLENGE_LEVEL_COUNT;
};

export const createDailyChallengeLevel = (dateKey: string): LevelData => (
  decodeCompactLevelData(
    dailyChallengeLevels[dailyChallengeLevelIndex(dateKey)],
    Number(dateKey.replaceAll('-', '')),
    false,
  )
);

export const mondayFirstOffset = (year: number, month: number): number => (
  new Date(year, month, 1, 12).getDay() + 6
) % 7;

export const daysInMonth = (year: number, month: number): number => (
  new Date(year, month + 1, 0, 12).getDate()
);
