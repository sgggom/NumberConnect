import { describe, expect, it, vi } from 'vitest';
import { normalizeGuideLevelCount, skipUnusedGuideLevels } from '../game/guideLevels';
import { loadSettings, saveSettings } from '../game/storage';

describe('configurable guide sequence', () => {
  it('defaults to three and skips unused guides while keeping authored IDs', () => {
    expect(normalizeGuideLevelCount(undefined)).toBe(3);
    for (let count = 1; count <= 10; count++) {
      expect(skipUnusedGuideLevels(count, count)).toBe(count);
      expect(skipUnusedGuideLevels(count + 1, count)).toBe(11);
      expect(skipUnusedGuideLevels(11, count)).toBe(11);
      expect(skipUnusedGuideLevels(500, count)).toBe(500);
      expect(skipUnusedGuideLevels(1, count)).toBe(1);
    }
  });
  it('migrates old settings, clamps bounds and persists the selection', () => {
    let value = '{}';
    vi.stubGlobal('window', { localStorage: { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } } });
    try {
      expect(loadSettings().guideLevelCount).toBe(3);
      for (const [input, expected] of [[20,10], [0,1], [2.5,3], ['invalid',3], [null,3]]) {
        value = JSON.stringify({ guideLevelCount: input });
        expect(loadSettings().guideLevelCount).toBe(expected);
      }
      const settings = loadSettings(); settings.guideLevelCount = 7; saveSettings(settings);
      expect(loadSettings().guideLevelCount).toBe(7);
    } finally { vi.unstubAllGlobals(); }
  });
});
