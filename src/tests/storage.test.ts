import { describe, expect, it, vi } from 'vitest';
import { loadSettings } from '../game/storage';
import { BoardShape, DEFAULT_SETTINGS } from '../game/types';

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
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
