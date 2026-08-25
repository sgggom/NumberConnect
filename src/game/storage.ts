import {
  BoardShape,
  DEFAULT_SETTINGS,
  isComboSoundPattern,
  isComboSoundArrangement,
  isComboSoundSet,
  isInputMode,
  isLobbyTheme,
  isMainGameplay,
  isMainGameplayDifficulty,
  isTouchPreviewSize,
  type GameSettings,
  type LevelData,
} from './types';
import { decodeCompactLevelCollection } from './levelDataFormat';

const SETTINGS_KEY = 'number-connect.settings.v1';

const hasStorage = (): boolean => typeof window !== 'undefined' && 'localStorage' in window;

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
    const {
      touchPreviewEnabled,
      touchPreviewDefaultOffMigrated,
      uiTheme: _legacyUiTheme,
      ...currentSettings
    } = stored as typeof stored & { uiTheme?: unknown };
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
    const inputMode = isInputMode(stored.inputMode) ? stored.inputMode : DEFAULT_SETTINGS.inputMode;
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
    const storedComboPatterns = Array.isArray(stored.comboSoundPatterns)
      ? stored.comboSoundPatterns.filter(isComboSoundPattern).slice(0, 32)
      : [];
    const legacyComboPattern = isComboSoundPattern(stored.comboSoundPattern)
      ? stored.comboSoundPattern
      : DEFAULT_SETTINGS.comboSoundPattern;
    const comboSoundPatterns = storedComboPatterns.length > 0
      ? storedComboPatterns
      : [legacyComboPattern];
    const comboSoundPatternIndex = Number.isInteger(stored.comboSoundPatternIndex)
      ? Math.max(0, Math.min(comboSoundPatterns.length - 1, Number(stored.comboSoundPatternIndex)))
      : Math.max(0, comboSoundPatterns.indexOf(legacyComboPattern));
    const comboSoundArrangement = isComboSoundArrangement(stored.comboSoundArrangement, comboSoundPatterns.length)
      ? stored.comboSoundArrangement
      : DEFAULT_SETTINGS.comboSoundArrangement;
    return {
      ...DEFAULT_SETTINGS,
      ...currentSettings,
      inputMode,
      comboSoundSet: isComboSoundSet(stored.comboSoundSet)
        ? stored.comboSoundSet
        : DEFAULT_SETTINGS.comboSoundSet,
      comboSoundPattern: comboSoundPatterns[comboSoundPatternIndex],
      comboSoundPatterns,
      comboSoundPatternIndex,
      comboSoundArrangement,
      mainGameplay,
      mainGameplayDifficulty,
      lobbyTheme: isLobbyTheme(stored.lobbyTheme) ? stored.lobbyTheme : DEFAULT_SETTINGS.lobbyTheme,
      beadMainLevelId,
      puzzleMainLevelId,
      mode3MainLevelId,
      mode4MainLevelId,
      mode5MainLevelId,
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

export const loadLevelCollection = (bundledLevels: LevelData[]): LevelData[] => (
  bundledLevels.map((level) => ({ ...level }))
);

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
