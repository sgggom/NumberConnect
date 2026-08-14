import { describe, expect, it, vi } from 'vitest';
import {
  loadBeadLevels,
  loadBuiltInLevels,
  loadEditorLevelCollection,
  loadLevelCollection,
  loadMode3Levels,
  loadMode5Levels,
  loadSettings,
  saveLevelCollection,
} from '../game/storage';
import { BoardShape, DEFAULT_SETTINGS, type LevelData } from '../game/types';

const makeLevel = (levelId: number, custom = false): LevelData => ({
  levelId,
  boardShape: BoardShape.Square,
  rows: 1,
  columns: 1,
  activeCells: [{ x: 0, y: 0 }],
  solutionPath: [{ x: 0, y: 0 }],
  algorithm: {
    id: 'algorithm-2',
    parameters: {},
  },
  custom,
});

describe('game settings migration', () => {
  it('keeps level mode and ignores removed procedural settings', () => {
    const getItem = vi.fn(() => JSON.stringify({
      shape: BoardShape.Hex,
      hiddenPercent: 90,
      maxHiddenRun: 12,
      targetCrossings: 20,
      selectedLevelId: 4,
      showNextNumber: false,
    }));
    vi.stubGlobal('window', { localStorage: { getItem } });

    try {
      const settings = loadSettings();
      expect(settings).toMatchObject({
        shape: BoardShape.Level,
        hiddenPercent: DEFAULT_SETTINGS.hiddenPercent,
        maxHiddenRun: DEFAULT_SETTINGS.maxHiddenRun,
        targetCrossings: DEFAULT_SETTINGS.targetCrossings,
        mainGameplay: 'beads',
        mainGameplayDifficulty: 'dynamic',
        beadMainLevelId: 4,
        puzzleMainLevelId: 4,
        mode3MainLevelId: 4,
        mode4MainLevelId: 4,
        mode5MainLevelId: 4,
        showNextNumber: false,
        showDifficultyScore: false,
        inputMode: DEFAULT_SETTINGS.inputMode,
        touchPreviewSize: DEFAULT_SETTINGS.touchPreviewSize,
        touchPreviewFollowsPointer: DEFAULT_SETTINGS.touchPreviewFollowsPointer,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('loads difficulty score visibility only when it was explicitly enabled', () => {
    const getItem = vi.fn()
      .mockReturnValueOnce(JSON.stringify({}))
      .mockReturnValueOnce(JSON.stringify({ showDifficultyScore: true }));
    vi.stubGlobal('window', { localStorage: { getItem } });

    try {
      expect(loadSettings().showDifficultyScore).toBe(false);
      expect(loadSettings().showDifficultyScore).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('migrates saved small-window preferences', () => {
    const getItem = vi.fn(() => JSON.stringify({
      touchPreviewEnabled: false,
      touchPreviewFollowsPointer: true,
    }));
    vi.stubGlobal('window', { localStorage: { getItem } });

    try {
      expect(loadSettings()).toMatchObject({
        touchPreviewSize: 'off',
        touchPreviewFollowsPointer: true,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('turns the legacy small default off once and preserves later explicit choices', () => {
    const values = new Map<string, string>([
      ['number-connect.settings.v1', JSON.stringify({ touchPreviewSize: 'small' })],
    ]);
    const localStorage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    };
    vi.stubGlobal('window', { localStorage });

    try {
      expect(loadSettings().touchPreviewSize).toBe('off');
      expect(localStorage.setItem).toHaveBeenCalledOnce();
      expect(JSON.parse(localStorage.setItem.mock.calls[0][1])).toMatchObject({
        touchPreviewSize: 'off',
        touchPreviewDefaultOffMigrated: true,
      });
      values.set('number-connect.settings.v1', JSON.stringify({
        touchPreviewSize: 'small',
        touchPreviewDefaultOffMigrated: true,
      }));
      expect(loadSettings().touchPreviewSize).toBe('small');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('loads the persistent zoomed board preview mode', () => {
    const getItem = vi.fn(() => JSON.stringify({ touchPreviewSize: 'zoom' }));
    vi.stubGlobal('window', { localStorage: { getItem } });

    try {
      expect(loadSettings().touchPreviewSize).toBe('zoom');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('loads a valid input mode and falls back from an invalid one', () => {
    const getItem = vi.fn()
      .mockReturnValueOnce(JSON.stringify({ inputMode: 'auto-click' }))
      .mockReturnValueOnce(JSON.stringify({ inputMode: 'click' }))
      .mockReturnValueOnce(JSON.stringify({ inputMode: 'keyboard' }));
    vi.stubGlobal('window', { localStorage: { getItem } });

    try {
      expect(loadSettings().inputMode).toBe('auto-click');
      expect(loadSettings().inputMode).toBe('click');
      expect(loadSettings().inputMode).toBe('drag');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the five main gameplay selections and level progress independent', () => {
    const getItem = vi.fn(() => JSON.stringify({
      mainGameplay: 'mode5',
      mainGameplayDifficulty: 8,
      beadMainLevelId: 3,
      puzzleMainLevelId: 8,
      mode3MainLevelId: 5,
      mode4MainLevelId: 7,
      mode5MainLevelId: 9,
    }));
    vi.stubGlobal('window', { localStorage: { getItem } });

    try {
      expect(loadSettings()).toMatchObject({
        mainGameplay: 'mode5',
        mainGameplayDifficulty: 8,
        beadMainLevelId: 3,
        puzzleMainLevelId: 8,
        mode3MainLevelId: 5,
        mode4MainLevelId: 7,
        mode5MainLevelId: 9,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('loads dynamic or fixed main gameplay difficulty and rejects invalid values', () => {
    const getItem = vi.fn()
      .mockReturnValueOnce(JSON.stringify({ mainGameplayDifficulty: 'dynamic' }))
      .mockReturnValueOnce(JSON.stringify({ mainGameplayDifficulty: 1 }))
      .mockReturnValueOnce(JSON.stringify({ mainGameplayDifficulty: 10 }))
      .mockReturnValueOnce(JSON.stringify({ mainGameplayDifficulty: '6' }))
      .mockReturnValueOnce(JSON.stringify({ mainGameplayDifficulty: 11 }));
    vi.stubGlobal('window', { localStorage: { getItem } });

    try {
      expect(loadSettings().mainGameplayDifficulty).toBe('dynamic');
      expect(loadSettings().mainGameplayDifficulty).toBe(1);
      expect(loadSettings().mainGameplayDifficulty).toBe(10);
      expect(loadSettings().mainGameplayDifficulty).toBe('dynamic');
      expect(loadSettings().mainGameplayDifficulty).toBe('dynamic');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('level collection migration', () => {
  it('ignores the obsolete v4 collection and starts from the gameplay 5 bundled levels', () => {
    const bundled = [makeLevel(1)];
    const getItem = vi.fn((key: string) => (
      key === 'number-connect.level-collection.v4'
        ? JSON.stringify([makeLevel(9, true)])
        : null
    ));
    vi.stubGlobal('window', { localStorage: { getItem } });

    try {
      expect(loadLevelCollection(bundled)).toEqual(bundled);
      expect(getItem).toHaveBeenCalledWith('number-connect.level-collection.v5');
      expect(getItem).not.toHaveBeenCalledWith('number-connect.level-collection.v4');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses custom levels to replace matching bundled formations without reviving stale copies', () => {
    const bundled = [
      { ...makeLevel(1), hiddenCells: [{ x: 0, y: 0 }] },
      makeLevel(2),
    ];
    const staleBundledCopy = makeLevel(1);
    const replacementLevel = { ...makeLevel(2, true), hiddenCells: [{ x: 1, y: 0 }] };
    const appendedLevel = makeLevel(7, true);
    const stored = [staleBundledCopy, replacementLevel, appendedLevel];
    const getItem = vi.fn((key: string) => (
      key === 'number-connect.level-collection.v5' ? JSON.stringify(stored) : null
    ));
    const setItem = vi.fn();
    vi.stubGlobal('window', { localStorage: { getItem, setItem } });

    try {
      expect(loadLevelCollection(bundled)).toEqual([bundled[0], replacementLevel, appendedLevel]);
      expect(loadEditorLevelCollection()).toEqual([replacementLevel, appendedLevel]);
      saveLevelCollection(stored);
      expect(setItem).toHaveBeenCalledWith(
        'number-connect.level-collection.v5',
        JSON.stringify([replacementLevel, appendedLevel]),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('loads separate official level pools for the campaign, bead gameplay, gameplay 3, and gameplay 5', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [{ data: [[1]] }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(loadBuiltInLevels()).resolves.toMatchObject([{
        levelId: 1,
        pathSource: 'generated',
        algorithm: { id: 'algorithm-8' },
        custom: false,
      }]);
      await expect(loadBeadLevels()).resolves.toMatchObject([{
        levelId: 1,
        pathSource: 'generated',
        algorithm: { id: 'algorithm-4' },
        custom: false,
      }]);
      await expect(loadMode3Levels()).resolves.toMatchObject([{
        levelId: 1,
        pathSource: 'generated',
        algorithm: { id: 'algorithm-8' },
        custom: false,
      }]);
      await expect(loadMode5Levels()).resolves.toMatchObject([{
        levelId: 1,
        pathSource: 'generated',
        algorithm: { id: 'algorithm-8' },
        custom: false,
      }]);
      expect(fetchMock).toHaveBeenNthCalledWith(1, './levels/mode5-levels.json');
      expect(fetchMock).toHaveBeenNthCalledWith(2, './levels/bead-levels.json');
      expect(fetchMock).toHaveBeenNthCalledWith(3, './levels/mode3-levels.json');
      expect(fetchMock).toHaveBeenNthCalledWith(4, './levels/mode5-levels.json');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
