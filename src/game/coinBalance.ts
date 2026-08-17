const COIN_BALANCE_KEY = 'number-connect.coin-balance.v1';

export interface CoinBalanceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const browserStorage = (): CoinBalanceStorage | undefined => (
  typeof window !== 'undefined' && 'localStorage' in window
    ? window.localStorage
    : undefined
);

export const loadCoinBalance = (
  storage: CoinBalanceStorage | undefined = browserStorage(),
): number => {
  if (!storage) return 0;
  try {
    const value = Number(storage.getItem(COIN_BALANCE_KEY));
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  } catch {
    return 0;
  }
};

export const saveCoinBalance = (
  balance: number,
  storage: CoinBalanceStorage | undefined = browserStorage(),
): number => {
  const normalized = Number.isFinite(balance) ? Math.max(0, Math.floor(balance)) : 0;
  try {
    storage?.setItem(COIN_BALANCE_KEY, String(normalized));
  } catch {
    // Keep the in-memory balance usable when browser storage is unavailable.
  }
  return normalized;
};
