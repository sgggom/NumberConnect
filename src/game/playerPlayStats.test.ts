import { describe, expect, it } from 'vitest';
import { loadPlayerPlayStats, recordPlayerPlayStat } from './playerPlayStats';

describe('persistent player counters', () => {
  it('counts each level once across stages and retries, and restores all event totals', () => {
    let value: string | null = null;
    const store = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
    const stats = loadPlayerPlayStats(store);
    recordPlayerPlayStat(stats, store, 1);
    recordPlayerPlayStat(stats, store, 1, 'errors');
    recordPlayerPlayStat(stats, store, 1, 'errors');
    recordPlayerPlayStat(stats, store, 1, 'revives');
    recordPlayerPlayStat(stats, store, 1, 'ads');
    recordPlayerPlayStat(stats, store, 11);
    expect(loadPlayerPlayStats(store)).toEqual({ levels: [1,11], errors: 2, ads: 1, revives: 1 });
  });
  it('recovers missing and corrupt data and supports unavailable storage', () => {
    for (const value of [null, '{', '{"levels":[],"errors":-1,"ads":0,"revives":0}']) {
      expect(loadPlayerPlayStats({ getItem: () => value, setItem: () => {} })).toEqual({ levels: [], errors: 0, ads: 0, revives: 0 });
    }
    const store = { getItem: () => { throw Error(); }, setItem: () => { throw Error(); } };
    const stats = loadPlayerPlayStats(store);
    expect(() => recordPlayerPlayStat(stats, store, 1, 'errors')).not.toThrow();
    expect(stats.errors).toBe(1);
  });
});
