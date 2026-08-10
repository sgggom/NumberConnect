import { describe, expect, it, vi } from 'vitest';
import {
  loadBeadLevels,
  loadBuiltInLevels,
  loadLevelCollection,
  loadMode3Levels,
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
        beadMainLevelId: 4,
        puzzleMainLevelId: 4,
        mode3MainLevelId: 4,
        mode4MainLevelId: 4,
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

  it('keeps the four main gameplay selections and level progress independent', () => {
    const getItem = vi.fn(() => JSON.stringify({
      mainGameplay: 'mode4',
      beadMainLevelId: 3,
      puzzleMainLevelId: 8,
      mode3MainLevelId: 5,
      mode4MainLevelId: 7,
    }));
    vi.stubGlobal('window', { localStorage: { getItem } });

    try {
      expect(loadSettings()).toMatchObject({
        mainGameplay: 'mode4',
        beadMainLevelId: 3,
        puzzleMainLevelId: 8,
        mode3MainLevelId: 5,
        mode4MainLevelId: 7,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('level collection migration', () => {
  it('ignores the obsolete v3 collection and starts from the new bundled levels', () => {
    const bundled = [makeLevel(1)];
    const getItem = vi.fn((key: string) => (
      key === 'number-connect.level-collection.v3'
        ? JSON.stringify([makeLevel(9, true)])
        : null
    ));
    vi.stubGlobal('window', { localStorage: { getItem } });

    try {
      expect(loadLevelCollection(bundled)).toEqual(bundled);
      expect(getItem).toHaveBeenCalledWith('number-connect.level-collection.v4');
      expect(getItem).not.toHaveBeenCalledWith('number-connect.level-collection.v3');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('loads and saves editor changes with the v4 collection key', () => {
    const stored = [makeLevel(7, true)];
    const getItem = vi.fn((key: string) => (
      key === 'number-connect.level-collection.v4' ? JSON.stringify(stored) : null
    ));
    const setItem = vi.fn();
    vi.stubGlobal('window', { localStorage: { getItem, setItem } });

    try {
      expect(loadLevelCollection([makeLevel(1)])).toEqual(stored);
      saveLevelCollection(stored);
      expect(setItem).toHaveBeenCalledWith(
        'number-connect.level-collection.v4',
        JSON.stringify(stored),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('loads separate official level pools for the campaign, bead gameplay, and gameplay 3', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [{ data: [[1]] }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(loadBuiltInLevels()).resolves.toMatchObject([{
        levelId: 1,
        pathSource: 'generated',
        algorithm: { id: 'algorithm-5' },
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
      expect(fetchMock).toHaveBeenNthCalledWith(1, './levels/levels.json');
      expect(fetchMock).toHaveBeenNthCalledWith(2, './levels/bead-levels.json');
      expect(fetchMock).toHaveBeenNthCalledWith(3, './levels/mode3-levels.json');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
