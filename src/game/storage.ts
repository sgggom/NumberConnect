import {
  BoardShape,
  DEFAULT_SETTINGS,
  isInputMode,
  isTouchPreviewSize,
  isUiTheme,
  type GameSettings,
  type LevelData,
} from './types';
import { decodeCompactLevelCollection } from './levelDataFormat';

const SETTINGS_KEY = 'number-connect.settings.v1';
const LEVEL_COLLECTION_KEY = 'number-connect.level-collection.v2';

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
    const stored = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? '{}') as (
      Partial<GameSettings> & { touchPreviewEnabled?: boolean }
    );
    const { touchPreviewEnabled, ...currentSettings } = stored;
    const touchPreviewSize = isTouchPreviewSize(stored.touchPreviewSize)
      ? stored.touchPreviewSize
      : touchPreviewEnabled === false
        ? 'off'
        : DEFAULT_SETTINGS.touchPreviewSize;
    const uiTheme = isUiTheme(stored.uiTheme) ? stored.uiTheme : DEFAULT_SETTINGS.uiTheme;
    const inputMode = isInputMode(stored.inputMode) ? stored.inputMode : DEFAULT_SETTINGS.inputMode;
    return {
      ...DEFAULT_SETTINGS,
      ...currentSettings,
      inputMode,
      uiTheme,
      touchPreviewSize,
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
  return bundledLevels.map((level) => ({ ...level }));
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
  const payload = await response.json() as unknown;
  return decodeCompactLevelCollection(payload, false)
    .map((level) => ({ ...withDefaultAlgorithm(level), custom: false }))
    .sort((left, right) => left.levelId - right.levelId);
};

export const getNextLevelId = (levels: LevelData[]): number => {
  const used = new Set(levels.map((level) => level.levelId));
  let id = 1;
  while (used.has(id)) id += 1;
  return id;
};
