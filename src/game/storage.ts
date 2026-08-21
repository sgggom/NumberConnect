import {
  BoardShape,
  DEFAULT_SETTINGS,
  isInputMode,
  isChargeProgressMode,
  isMainGameplay,
  isMainGameplayDifficulty,
  isTouchPreviewSize,
  isUiTheme,
  type GameSettings,
  type LevelData,
} from './types';
import { decodeCompactLevelCollection } from './levelDataFormat';

const SETTINGS_KEY = 'number-connect.settings.v1';
const LEVEL_COLLECTION_KEY = 'number-connect.level-collection.v5';

const hasStorage = (): boolean => typeof window !== 'undefined' && 'localStorage' in window;

const withDefaultAlgorithm = (level: LevelData): LevelData => {
  if (level.algorithm?.id === 'algorithm-1' || level.algorithm?.id === 'algorithm-8') {
    const parameters = level.algorithm.parameters ?? {};
    return {
      ...level,
      algorithm: {
        id: 'algorithm-1',
        parameters: {
          topology: 'board-shape',
          pathMode: 'spatial-distribution-multiple-solutions',
          targetCrossings: level.boardShape === BoardShape.Hex
            ? 0
            : Number.isFinite(Number(parameters.targetCrossings))
            ? Math.max(0, Math.min(99, Math.floor(Number(parameters.targetCrossings))))
            : 20,
          turnProbability: Number.isFinite(Number(parameters.turnProbability))
            ? Math.max(0, Math.min(100, Math.floor(Number(parameters.turnProbability))))
            : 40,
          hiddenPercent: Number.isFinite(Number(parameters.hiddenPercent))
            ? Math.max(0, Math.min(100, Math.floor(Number(parameters.hiddenPercent))))
            : 35,
          targetDifficulty: Number.isFinite(Number(parameters.targetDifficulty))
            ? Math.max(1, Math.min(10, Math.floor(Number(parameters.targetDifficulty))))
            : 6,
          maxVisibleRun: Number.isFinite(Number(parameters.maxVisibleRun))
            ? Math.max(1, Math.min(99, Math.floor(Number(parameters.maxVisibleRun))))
            : 8,
          maxHiddenRun: Number.isFinite(Number(parameters.maxHiddenRun))
            ? Math.max(1, Math.min(99, Math.floor(Number(parameters.maxHiddenRun))))
            : 4,
        },
      },
    };
  }
  if (level.algorithm) return level;
  return {
      ...level,
      algorithm: {
        id: 'algorithm-1',
        parameters: {
          topology: 'board-shape',
          pathMode: 'spatial-distribution-multiple-solutions',
          targetCrossings: level.boardShape === BoardShape.Hex ? 0 : 20,
          turnProbability: 40,
          hiddenPercent: 35,
          targetDifficulty: 6,
          maxVisibleRun: 8,
          maxHiddenRun: 4,
        },
      },
    };
};

export const loadSettings = (): GameSettings => {
  if (!hasStorage()) return { ...DEFAULT_SETTINGS };
  try {
    const stored = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? '{}') as (
      Partial<GameSettings> & {
        touchPreviewEnabled?: boolean;
        touchPreviewDefaultOffMigrated?: boolean;
        selectedLevelId?: number;
      }
    );
    const { touchPreviewEnabled, touchPreviewDefaultOffMigrated, ...currentSettings } = stored;
    let touchPreviewSize = isTouchPreviewSize(stored.touchPreviewSize)
      ? stored.touchPreviewSize
      : touchPreviewEnabled === false
        ? 'off'
        : DEFAULT_SETTINGS.touchPreviewSize;
    if (touchPreviewDefaultOffMigrated !== true) {
      if (touchPreviewSize === 'small') touchPreviewSize = 'off';
      if (typeof window.localStorage.setItem === 'function') {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
          ...stored,
          touchPreviewSize,
          touchPreviewDefaultOffMigrated: true,
        }));
      }
    }
    const uiTheme = isUiTheme(stored.uiTheme) ? stored.uiTheme : DEFAULT_SETTINGS.uiTheme;
    const inputMode = isInputMode(stored.inputMode) ? stored.inputMode : DEFAULT_SETTINGS.inputMode;
    const chargeProgressMode = isChargeProgressMode(stored.chargeProgressMode)
      ? stored.chargeProgressMode
      : DEFAULT_SETTINGS.chargeProgressMode;
    const mainGameplay = isMainGameplay(stored.mainGameplay)
      ? stored.mainGameplay
      : DEFAULT_SETTINGS.mainGameplay;
    const mainGameplayDifficulty = isMainGameplayDifficulty(stored.mainGameplayDifficulty)
      ? stored.mainGameplayDifficulty
      : DEFAULT_SETTINGS.mainGameplayDifficulty;
    const legacyLevelId = Number.isInteger(stored.selectedLevelId) && Number(stored.selectedLevelId) > 0
      ? Number(stored.selectedLevelId)
      : 1;
    const beadMainLevelId = Number.isInteger(stored.beadMainLevelId) && Number(stored.beadMainLevelId) > 0
      ? Number(stored.beadMainLevelId)
      : legacyLevelId;
    const puzzleMainLevelId = Number.isInteger(stored.puzzleMainLevelId) && Number(stored.puzzleMainLevelId) > 0
      ? Number(stored.puzzleMainLevelId)
      : legacyLevelId;
    const mode3MainLevelId = Number.isInteger(stored.mode3MainLevelId) && Number(stored.mode3MainLevelId) > 0
      ? Number(stored.mode3MainLevelId)
      : legacyLevelId;
    const mode4MainLevelId = Number.isInteger(stored.mode4MainLevelId) && Number(stored.mode4MainLevelId) > 0
      ? Number(stored.mode4MainLevelId)
      : legacyLevelId;
    const mode5MainLevelId = Number.isInteger(stored.mode5MainLevelId) && Number(stored.mode5MainLevelId) > 0
      ? Number(stored.mode5MainLevelId)
      : legacyLevelId;
    return {
      ...DEFAULT_SETTINGS,
      ...currentSettings,
      inputMode,
      chargeProgressMode,
      mainGameplay,
      mainGameplayDifficulty,
      beadMainLevelId,
      puzzleMainLevelId,
      mode3MainLevelId,
      mode4MainLevelId,
      mode5MainLevelId,
      uiTheme,
      touchPreviewSize,
      showDifficultyScore: stored.showDifficultyScore === true,
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

export const loadEditorLevelCollection = (): LevelData[] => {
  if (!hasStorage()) return [];
  const storedValue = window.localStorage.getItem(LEVEL_COLLECTION_KEY);
  return storedValue === null
    ? []
    : parseLevelArray(storedValue)
      .filter((level) => level.custom === true)
      .sort((left, right) => left.levelId - right.levelId);
};

export const loadLevelCollection = (bundledLevels: LevelData[]): LevelData[] => {
  const customLevels = loadEditorLevelCollection();
  if (customLevels.length > 0) {
    const customByLevelId = new Map(customLevels.map((level) => [level.levelId, level]));
    const bundledLevelIds = new Set(bundledLevels.map((level) => level.levelId));
    return [
      ...bundledLevels.map((level) => ({
        ...(customByLevelId.get(level.levelId) ?? level),
      })),
      ...customLevels.filter((level) => !bundledLevelIds.has(level.levelId)),
    ].sort((left, right) => left.levelId - right.levelId);
  }
  return bundledLevels.map((level) => ({ ...level }));
};

export const saveLevelCollection = (levels: LevelData[]): void => {
  const normalized = [...levels]
    .filter((level) => level.custom === true)
    .sort((left, right) => left.levelId - right.levelId)
    .map((level) => ({ ...level }));
  if (hasStorage()) window.localStorage.setItem(LEVEL_COLLECTION_KEY, JSON.stringify(normalized));
};

const loadBundledLevels = async (
  resourcePath: string,
  algorithmId: string,
): Promise<LevelData[]> => {
  const response = await fetch(resourcePath);
  if (!response.ok) throw new Error('Unable to load level collection');
  const payload = await response.json() as unknown;
  return decodeCompactLevelCollection(payload, false)
    .map((level): LevelData => ({
      ...level,
      pathSource: 'generated',
      algorithm: {
        id: algorithmId,
        parameters: {},
      },
      custom: false,
    }))
    .sort((left, right) => left.levelId - right.levelId);
};

export const loadBuiltInLevels = (): Promise<LevelData[]> => (
  loadBundledLevels('./levels/mode5-levels.json', 'algorithm-1')
);

export const loadBeadLevels = (): Promise<LevelData[]> => (
  loadBundledLevels('./levels/bead-levels.json', 'algorithm-1')
);

export const loadMode3Levels = (): Promise<LevelData[]> => (
  loadBundledLevels('./levels/mode3-levels.json', 'algorithm-1')
);

/** 玩法5读取独立资源文件，后续调整阵型不会影响玩法3/4。 */
export const loadMode5Levels = (): Promise<LevelData[]> => (
  loadBundledLevels('./levels/mode5-levels.json', 'algorithm-1')
);

export const getNextLevelId = (levels: LevelData[]): number => {
  const used = new Set(levels.map((level) => level.levelId));
  let id = 1;
  while (used.has(id)) id += 1;
  return id;
};
