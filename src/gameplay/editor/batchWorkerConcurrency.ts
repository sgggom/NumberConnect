export const MAX_BATCH_PLAYTEST_CONCURRENCY = 32;

export const batchPlaytestConcurrency = (): number => {
  const hardwareConcurrency = globalThis.navigator?.hardwareConcurrency ?? 4;
  return Math.max(1, Math.min(MAX_BATCH_PLAYTEST_CONCURRENCY, hardwareConcurrency - 1));
};
