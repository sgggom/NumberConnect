import { DEFAULT_SETTINGS, type GameSettings, type LevelData } from './types';

const SETTINGS_KEY = 'number-connect.settings.v1';
const CUSTOM_LEVELS_KEY = 'number-connect.custom-levels.v1';

const hasStorage = (): boolean => typeof window !== 'undefined' && 'localStorage' in window;

export const loadSettings = (): GameSettings => {
  if (!hasStorage()) return { ...DEFAULT_SETTINGS };
  try {
    const stored = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<GameSettings>;
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

export const saveSettings = (settings: GameSettings): void => {
  if (hasStorage()) window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
};

export const loadCustomLevels = (): LevelData[] => {
  if (!hasStorage()) return [];
  try {
    const levels = JSON.parse(window.localStorage.getItem(CUSTOM_LEVELS_KEY) ?? '[]') as LevelData[];
    return Array.isArray(levels) ? levels.map((level) => ({ ...level, custom: true })) : [];
  } catch {
    return [];
  }
};

export const saveCustomLevel = (level: LevelData): void => {
  const levels = loadCustomLevels().filter((existing) => existing.levelId !== level.levelId);
  levels.push({ ...level, custom: true });
  levels.sort((left, right) => left.levelId - right.levelId);
  if (hasStorage()) window.localStorage.setItem(CUSTOM_LEVELS_KEY, JSON.stringify(levels));
};

export const loadBuiltInLevels = async (): Promise<LevelData[]> => {
  const levels = await Promise.all(
    Array.from({ length: 5 }, async (_, index) => {
      const response = await fetch(`./levels/level${index + 1}.json`);
      if (!response.ok) throw new Error(`Unable to load level ${index + 1}`);
      return response.json() as Promise<LevelData>;
    }),
  );
  return levels.sort((left, right) => left.levelId - right.levelId);
};

export const getNextCustomLevelId = (builtIn: LevelData[], custom: LevelData[]): number => {
  const used = new Set([...builtIn, ...custom].map((level) => level.levelId));
  let id = 1;
  while (used.has(id)) id += 1;
  return id;
};
