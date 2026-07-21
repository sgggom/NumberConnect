const DAILY_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

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

export const dailyChallengeSeed = (dateKey: string): number => {
  let hash = 2166136261;
  for (const character of dateKey) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 1;
};

export const dailyChallengeStage = (dateKey: string): number => 2 + dailyChallengeSeed(dateKey) % 9;

export const mondayFirstOffset = (year: number, month: number): number => (
  new Date(year, month, 1, 12).getDay() + 6
) % 7;

export const daysInMonth = (year: number, month: number): number => (
  new Date(year, month + 1, 0, 12).getDate()
);
