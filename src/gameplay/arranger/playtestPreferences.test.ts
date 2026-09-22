import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('arranger preference persistence', () => {
  it('restores settings after module reload and saves weight resets', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    const first = await import('./playtestPreferences');
    first.savePlaytestPreference('player.normal', '75');
    first.savePlaytestPreference('hand.visible', 'false');
    first.savePlaytestPreference('weight.hiddenNumber', '1.3');
    vi.resetModules();
    const restored = await import('./playtestPreferences');
    expect(restored.readPlaytestPreference('player.normal')).toBe('75');
    expect(restored.readPlaytestPreference('hand.visible')).toBe('false');
    expect(restored.readPlaytestPreference('weight.hiddenNumber')).toBe('1.3');
    restored.savePlaytestPreference('weight.hiddenNumber', '0.5');
    vi.resetModules();
    expect((await import('./playtestPreferences')).readPlaytestPreference('weight.hiddenNumber')).toBe('0.5');
  });
  it('retains settings between boards when browser storage is blocked', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    const preferences = await import('./playtestPreferences');
    expect(preferences.readPlaytestPreference('hand.size')).toBeUndefined();
    preferences.savePlaytestPreference('hand.size', '0.65');
    expect(preferences.readPlaytestPreference('hand.size')).toBe('0.65');
  });
});
