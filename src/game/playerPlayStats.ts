export interface PlayerPlayStats { levels: number[]; errors: number; ads: number; revives: number }
const KEY = 'number-connect.player-play-stats.v1';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export const loadPlayerPlayStats = (storage: Store): PlayerPlayStats => {
  try {
    const value = JSON.parse(storage.getItem(KEY) ?? 'null') as PlayerPlayStats;
    if (value && Array.isArray(value.levels) && value.levels.every(n => Number.isInteger(n) && n > 0)
      && [value.errors, value.ads, value.revives].every(n => Number.isSafeInteger(n) && n >= 0)) {
      return { ...value, levels: [...new Set(value.levels)] };
    }
  } catch { /* Missing or invalid historical counters start a fresh measurement. */ }
  return { levels: [], errors: 0, ads: 0, revives: 0 };
};
export const recordPlayerPlayStat = (stats: PlayerPlayStats, storage: Store, levelId: number,
  metric?: 'errors' | 'ads' | 'revives'): void => {
  if (!stats.levels.includes(levelId)) stats.levels.push(levelId);
  if (metric) stats[metric] += 1;
  try { storage.setItem(KEY, JSON.stringify(stats)); } catch { /* Continue in memory. */ }
};
