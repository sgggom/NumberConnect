import { describe, expect, it, vi } from 'vitest';
import {
  loadBuiltInLevels,
  loadLevelCollection,
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
        selectedLevelId: 4,
        showNextNumber: false,
        touchPreviewSize: DEFAULT_SETTINGS.touchPreviewSize,
        touchPreviewFollowsPointer: DEFAULT_SETTINGS.touchPreviewFollowsPointer,
      });
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
});

describe('level collection migration', () => {
  it('ignores the obsolete v1 collection and starts from the new bundled levels', () => {
    const bundled = [makeLevel(1)];
    const getItem = vi.fn((key: string) => (
      key === 'number-connect.level-collection.v1'
        ? JSON.stringify([makeLevel(9, true)])
        : null
    ));
    vi.stubGlobal('window', { localStorage: { getItem } });

    try {
      expect(loadLevelCollection(bundled)).toEqual(bundled);
      expect(getItem).toHaveBeenCalledWith('number-connect.level-collection.v2');
      expect(getItem).not.toHaveBeenCalledWith('number-connect.level-collection.v1');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('loads and saves editor changes with the v2 collection key', () => {
    const stored = [makeLevel(7, true)];
    const getItem = vi.fn((key: string) => (
      key === 'number-connect.level-collection.v2' ? JSON.stringify(stored) : null
    ));
    const setItem = vi.fn();
    vi.stubGlobal('window', { localStorage: { getItem, setItem } });

    try {
      expect(loadLevelCollection([makeLevel(1)])).toEqual(stored);
      saveLevelCollection(stored);
      expect(setItem).toHaveBeenCalledWith(
        'number-connect.level-collection.v2',
        JSON.stringify(stored),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('treats exported bundled levels as official campaign levels', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => [makeLevel(1, true)],
    })));

    try {
      await expect(loadBuiltInLevels()).resolves.toMatchObject([{ levelId: 1, custom: false }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
