import { describe, expect, it, vi } from 'vitest';
import {
  loadBeadLevels,
  loadBuiltInLevels,
  loadLevelCollection,
  loadMode3Levels,
  loadMode5Levels,
  loadSettings,
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
    id: 'algorithm-1',
    parameters: {
      topology: 'board-shape',
      pathMode: 'spatial-distribution-multiple-solutions',
      targetCrossings: 20,
      turnProbability: 40,
      hiddenPercent: 35,
      targetDifficulty: 6,
      maxVisibleRun: 8,
      maxHiddenRun: 4,
    },
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
        chargeProgressMode: 'coins',
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

  it('loads a valid lobby theme and falls back to the cool theme', () => {
    const getItem = vi.fn()
      .mockReturnValueOnce(JSON.stringify({ lobbyTheme: 'warm' }))
      .mockReturnValueOnce(JSON.stringify({ lobbyTheme: 'night' }));
    vi.stubGlobal('window', { localStorage: { getItem } });

    try {
      expect(loadSettings().lobbyTheme).toBe('warm');
      expect(loadSettings().lobbyTheme).toBe('cool');
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

  it('loads a valid combo sound set and falls back from an invalid one', () => {
    const getItem = vi.fn()
      .mockReturnValueOnce(JSON.stringify({ comboSoundSet: 'combo2' }))
      .mockReturnValueOnce(JSON.stringify({ comboSoundSet: 'missing' }));
    vi.stubGlobal('window', { localStorage: { getItem } });

    try {
      expect(loadSettings().comboSoundSet).toBe('combo2');
      expect(loadSettings().comboSoundSet).toBe(DEFAULT_SETTINGS.comboSoundSet);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('loads a valid charge progress mode and keeps coin mode as the fallback', () => {
    const getItem = vi.fn()
      .mockReturnValueOnce(JSON.stringify({ chargeProgressMode: 'off' }))
      .mockReturnValueOnce(JSON.stringify({ chargeProgressMode: 'progress' }))
      .mockReturnValueOnce(JSON.stringify({ chargeProgressMode: 'unknown' }));
    vi.stubGlobal('window', { localStorage: { getItem } });

    try {
      expect(loadSettings().chargeProgressMode).toBe('off');
      expect(loadSettings().chargeProgressMode).toBe('progress');
      expect(loadSettings().chargeProgressMode).toBe('coins');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('loads a valid connection sound pattern and rejects invalid notes', () => {
    const getItem = vi.fn()
      .mockReturnValueOnce(JSON.stringify({ comboSoundPattern: '13587642' }))
      .mockReturnValueOnce(JSON.stringify({ comboSoundPattern: '1290' }));
    vi.stubGlobal('window', { localStorage: { getItem } });

    try {
      expect(loadSettings().comboSoundPattern).toBe('13587642');
      expect(loadSettings().comboSoundPattern).toBe(DEFAULT_SETTINGS.comboSoundPattern);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('loads a connection sound pattern list and its active entry', () => {
    const getItem = vi.fn(() => JSON.stringify({
      comboSoundPatterns: ['12', '876', '90'],
      comboSoundPatternIndex: 1,
      comboSoundArrangement: '1,[1,2],2',
    }));
    vi.stubGlobal('window', { localStorage: { getItem } });

    try {
      const settings = loadSettings();
      expect(settings.comboSoundPatterns).toEqual(['12', '876']);
      expect(settings.comboSoundPatternIndex).toBe(1);
      expect(settings.comboSoundPattern).toBe('876');
      expect(settings.comboSoundArrangement).toBe('1,[1,2],2');
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

describe('level collection', () => {
  it('uses only bundled levels and returns independent objects', () => {
    const bundled = [makeLevel(1)];
    const loaded = loadLevelCollection(bundled);
    expect(loaded).toEqual(bundled);
    expect(loaded[0]).not.toBe(bundled[0]);
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
        algorithm: { id: 'algorithm-1' },
        custom: false,
      }]);
      await expect(loadBeadLevels()).resolves.toMatchObject([{
        levelId: 1,
        pathSource: 'generated',
        algorithm: { id: 'algorithm-1' },
        custom: false,
      }]);
      await expect(loadMode3Levels()).resolves.toMatchObject([{
        levelId: 1,
        pathSource: 'generated',
        algorithm: { id: 'algorithm-1' },
        custom: false,
      }]);
      await expect(loadMode5Levels()).resolves.toMatchObject([{
        levelId: 1,
        pathSource: 'generated',
        algorithm: { id: 'algorithm-1' },
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
