import { describe, expect, it, vi } from 'vitest';
import { loadCoinBalance, saveCoinBalance } from './coinBalance';

describe('coin balance', () => {
  it('loads a normalized stored balance', () => {
    expect(loadCoinBalance({ getItem: () => '12.8', setItem: vi.fn() })).toBe(12);
    expect(loadCoinBalance({ getItem: () => '-4', setItem: vi.fn() })).toBe(0);
  });

  it('saves a normalized balance', () => {
    const setItem = vi.fn();
    expect(saveCoinBalance(17.9, { getItem: vi.fn(), setItem })).toBe(17);
    expect(setItem).toHaveBeenCalledWith('number-connect.coin-balance.v1', '17');
  });

  it('falls back to zero when storage fails', () => {
    expect(loadCoinBalance({
      getItem: () => { throw new Error('blocked'); },
      setItem: vi.fn(),
    })).toBe(0);
  });
});
