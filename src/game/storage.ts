import { BoardShape, DEFAULT_SETTINGS, type GameSettings, type LevelData } from './types';

const SETTINGS_KEY = 'number-connect.settings.v1';
const CUSTOM_LEVELS_KEY = 'number-connect.custom-levels.v1';
const LEVEL_COLLECTION_KEY = 'number-connect.level-collection.v1';

const hasStorage = (): boolean => typeof window !== 'undefined' && 'localStorage' in window;

const withDefaultAlgorithm = (level: LevelData): LevelData => {
  if (level.algorithm?.id === 'algorithm-1') {
    return {
      ...level,
      algorithm: {
        id: 'algorithm-1',
        parameters: {
          topology: 'board-shape',
          pathMode: 'single-stroke',
          targetCrossings: level.boardShape === BoardShape.Hex
            ? 0
            : Number.isFinite(Number(level.algorithm.parameters?.targetCrossings))
            ? Math.max(0, Math.min(99, Math.floor(Number(level.algorithm.parameters.targetCrossings))))
            : 0,
        },
      },
    };
  }
  if (level.algorithm) return level;
  return {
      ...level,
      algorithm: {
        id: 'algorithm-1',
        parameters: { topology: 'board-shape', pathMode: 'single-stroke', targetCrossings: 0 },
      },
    };
};

export const loadSettings = (): GameSettings => {
  if (!hasStorage()) return { ...DEFAULT_SETTINGS };
  try {
    const stored = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<GameSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      shape: BoardShape.Level,
      squareSize: DEFAULT_SETTINGS.squareSize,
      diamondSize: DEFAULT_SETTINGS.diamondSize,
      hexSize: DEFAULT_SETTINGS.hexSize,
      rectangleSizeIndex: DEFAULT_SETTINGS.rectangleSizeIndex,
      hiddenPercent: DEFAULT_SETTINGS.hiddenPercent,
      maxHiddenRun: DEFAULT_SETTINGS.maxHiddenRun,
      maxVisibleRun: DEFAULT_SETTINGS.maxVisibleRun,
      targetCrossings: DEFAULT_SETTINGS.targetCrossings,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

export const saveSettings = (settings: GameSettings): void => {
  if (hasStorage()) window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
};

const parseLevelArray = (value: string | null): LevelData[] => {
  try {
    const parsed = JSON.parse(value ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((level): level is LevelData => (
      Boolean(level)
      && typeof level === 'object'
      && Number.isFinite(Number((level as LevelData).levelId))
      && Array.isArray((level as LevelData).activeCells)
      && Array.isArray((level as LevelData).solutionPath)
    )).map(withDefaultAlgorithm) : [];
  } catch {
    return [];
  }
};

export const loadLevelCollection = (bundledLevels: LevelData[]): LevelData[] => {
  if (!hasStorage()) return bundledLevels.map((level) => ({ ...level }));
  const storedValue = window.localStorage.getItem(LEVEL_COLLECTION_KEY);
  if (storedValue !== null) {
    return parseLevelArray(storedValue).sort((left, right) => left.levelId - right.levelId);
  }

  const legacyCustomLevels = parseLevelArray(window.localStorage.getItem(CUSTOM_LEVELS_KEY));
  const merged = new Map<number, LevelData>();
  bundledLevels.forEach((level) => merged.set(level.levelId, { ...level }));
  legacyCustomLevels.forEach((level) => merged.set(level.levelId, { ...level, custom: true }));
  return [...merged.values()].sort((left, right) => left.levelId - right.levelId);
};

export const saveLevelCollection = (levels: LevelData[]): void => {
  const normalized = [...levels]
    .sort((left, right) => left.levelId - right.levelId)
    .map((level) => ({ ...level }));
  if (hasStorage()) window.localStorage.setItem(LEVEL_COLLECTION_KEY, JSON.stringify(normalized));
};

export const loadBuiltInLevels = async (): Promise<LevelData[]> => {
  const response = await fetch('./levels/levels.json');
  if (!response.ok) throw new Error('Unable to load level collection');
  const payload = await response.json() as LevelData[] | { levels?: LevelData[] };
  const levels = Array.isArray(payload) ? payload : payload.levels;
  if (!Array.isArray(levels)) throw new Error('Invalid level collection');
  return levels.map(withDefaultAlgorithm).sort((left, right) => left.levelId - right.levelId);
};

export const getNextLevelId = (levels: LevelData[]): number => {
  const used = new Set(levels.map((level) => level.levelId));
  let id = 1;
  while (used.has(id)) id += 1;
  return id;
};
