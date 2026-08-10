export const DYNAMIC_DIFFICULTY_STORAGE_KEY = 'number-connect.dynamic-difficulty.v1';
export const MODE4_DYNAMIC_DIFFICULTY_STORAGE_KEY = 'number-connect.mode4-dynamic-difficulty.v1';
export const DYNAMIC_DIFFICULTY_DEFAULT = 6;
export const DYNAMIC_DIFFICULTY_MIN = 1;
export const DYNAMIC_DIFFICULTY_MAX = 10;
export const DYNAMIC_DIFFICULTY_WINDOW_SIZE = 5;
export const DYNAMIC_DIFFICULTY_COOLDOWN_GAMES = 2;

export type DynamicDifficultyGameResult = 'completed' | 'life-depleted';

export interface DynamicDifficultyGameRecord {
  errors: number;
  result: DynamicDifficultyGameResult;
  levelId: number;
  finishedAtUtc: string;
}

export interface DynamicDifficultyState {
  version: 1;
  currentDifficulty: number;
  recentGames: DynamicDifficultyGameRecord[];
  cooldownGames: number;
  totalEligibleGames: number;
}

export type DynamicDifficultyReason =
  | 'warm-up'
  | 'cooldown'
  | 'raised'
  | 'lowered-errors'
  | 'lowered-failures'
  | 'steady'
  | 'difficulty-limit';

export interface DynamicDifficultyDecision {
  state: DynamicDifficultyState;
  previousDifficulty: number;
  currentDifficulty: number;
  delta: number;
  windowErrors: number;
  failedGames: number;
  reason: DynamicDifficultyReason;
}

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const clampInteger = (value: unknown, minimum: number, maximum: number): number => {
  const numeric = Number(value);
  const integer = Number.isFinite(numeric) ? Math.floor(numeric) : minimum;
  return Math.max(minimum, Math.min(maximum, integer));
};

const browserStorage = (): StorageLike | undefined => {
  try {
    return typeof window !== 'undefined' && 'localStorage' in window
      ? window.localStorage
      : undefined;
  } catch {
    return undefined;
  }
};

export const createDynamicDifficultyState = (
  currentDifficulty = DYNAMIC_DIFFICULTY_DEFAULT,
): DynamicDifficultyState => ({
  version: 1,
  currentDifficulty: clampInteger(
    currentDifficulty,
    DYNAMIC_DIFFICULTY_MIN,
    DYNAMIC_DIFFICULTY_MAX,
  ),
  recentGames: [],
  cooldownGames: 0,
  totalEligibleGames: 0,
});

const normalizeRecord = (value: unknown): DynamicDifficultyGameRecord | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Partial<DynamicDifficultyGameRecord>;
  if (record.result !== 'completed' && record.result !== 'life-depleted') return undefined;
  const levelId = Number(record.levelId);
  if (!Number.isFinite(levelId)) return undefined;
  return {
    errors: clampInteger(record.errors, 0, Number.MAX_SAFE_INTEGER),
    result: record.result,
    levelId: Math.floor(levelId),
    finishedAtUtc: typeof record.finishedAtUtc === 'string'
      ? record.finishedAtUtc
      : new Date(0).toISOString(),
  };
};

export const normalizeDynamicDifficultyState = (value: unknown): DynamicDifficultyState => {
  if (!value || typeof value !== 'object') return createDynamicDifficultyState();
  const state = value as Partial<DynamicDifficultyState>;
  const recentGames = Array.isArray(state.recentGames)
    ? state.recentGames.flatMap((record) => {
        const normalized = normalizeRecord(record);
        return normalized ? [normalized] : [];
      }).slice(-DYNAMIC_DIFFICULTY_WINDOW_SIZE)
    : [];
  return {
    version: 1,
    currentDifficulty: clampInteger(
      state.currentDifficulty ?? DYNAMIC_DIFFICULTY_DEFAULT,
      DYNAMIC_DIFFICULTY_MIN,
      DYNAMIC_DIFFICULTY_MAX,
    ),
    recentGames,
    cooldownGames: clampInteger(
      state.cooldownGames ?? 0,
      0,
      DYNAMIC_DIFFICULTY_COOLDOWN_GAMES,
    ),
    totalEligibleGames: Math.max(
      recentGames.length,
      clampInteger(
        state.totalEligibleGames ?? recentGames.length,
        0,
        Number.MAX_SAFE_INTEGER,
      ),
    ),
  };
};

const loadDynamicDifficultyStateFromKey = (
  storageKey: string,
  storage: StorageLike | undefined = browserStorage(),
): DynamicDifficultyState => {
  if (!storage) return createDynamicDifficultyState();
  try {
    return normalizeDynamicDifficultyState(JSON.parse(
      storage.getItem(storageKey) ?? '{}',
    ));
  } catch {
    return createDynamicDifficultyState();
  }
};

const saveDynamicDifficultyStateToKey = (
  storageKey: string,
  state: DynamicDifficultyState,
  storage: StorageLike | undefined = browserStorage(),
): void => {
  storage?.setItem(
    storageKey,
    JSON.stringify(normalizeDynamicDifficultyState(state)),
  );
};

/** 玩法3沿用原有存储键，确保已经积累的最近5局记录不会丢失。 */
export const loadDynamicDifficultyState = (
  storage: StorageLike | undefined = browserStorage(),
): DynamicDifficultyState => loadDynamicDifficultyStateFromKey(
  DYNAMIC_DIFFICULTY_STORAGE_KEY,
  storage,
);

export const saveDynamicDifficultyState = (
  state: DynamicDifficultyState,
  storage: StorageLike | undefined = browserStorage(),
): void => saveDynamicDifficultyStateToKey(
  DYNAMIC_DIFFICULTY_STORAGE_KEY,
  state,
  storage,
);

/** 玩法4使用独立存储键，不与玩法3共享最近5局样本或当前难度。 */
export const loadMode4DynamicDifficultyState = (
  storage: StorageLike | undefined = browserStorage(),
): DynamicDifficultyState => loadDynamicDifficultyStateFromKey(
  MODE4_DYNAMIC_DIFFICULTY_STORAGE_KEY,
  storage,
);

export const saveMode4DynamicDifficultyState = (
  state: DynamicDifficultyState,
  storage: StorageLike | undefined = browserStorage(),
): void => saveDynamicDifficultyStateToKey(
  MODE4_DYNAMIC_DIFFICULTY_STORAGE_KEY,
  state,
  storage,
);

export const recordDynamicDifficultyGame = (
  state: DynamicDifficultyState,
  record: DynamicDifficultyGameRecord,
): DynamicDifficultyDecision => {
  const previousState = normalizeDynamicDifficultyState(state);
  const normalizedRecord = normalizeRecord(record);
  if (!normalizedRecord) throw new Error('Invalid dynamic difficulty game record');

  const recentGames = [...previousState.recentGames, normalizedRecord]
    .slice(-DYNAMIC_DIFFICULTY_WINDOW_SIZE);
  const windowErrors = recentGames.reduce(
    (sum, game) => sum + Math.min(game.errors, 3),
    0,
  );
  const failedGames = recentGames.filter(
    (game) => game.result === 'life-depleted',
  ).length;
  const nextState: DynamicDifficultyState = {
    ...previousState,
    recentGames,
    totalEligibleGames: previousState.totalEligibleGames + 1,
  };
  const previousDifficulty = previousState.currentDifficulty;

  if (recentGames.length < DYNAMIC_DIFFICULTY_WINDOW_SIZE) {
    return {
      state: nextState,
      previousDifficulty,
      currentDifficulty: previousDifficulty,
      delta: 0,
      windowErrors,
      failedGames,
      reason: 'warm-up',
    };
  }

  if (nextState.cooldownGames > 0) {
    nextState.cooldownGames -= 1;
    return {
      state: nextState,
      previousDifficulty,
      currentDifficulty: previousDifficulty,
      delta: 0,
      windowErrors,
      failedGames,
      reason: 'cooldown',
    };
  }

  let requestedDelta = 0;
  let reason: DynamicDifficultyReason = 'steady';
  if (failedGames >= 2) {
    requestedDelta = -1;
    reason = 'lowered-failures';
  } else if (windowErrors >= 8) {
    requestedDelta = -1;
    reason = 'lowered-errors';
  } else if (failedGames === 0 && windowErrors <= 2) {
    requestedDelta = 1;
    reason = 'raised';
  }

  const currentDifficulty = clampInteger(
    previousDifficulty + requestedDelta,
    DYNAMIC_DIFFICULTY_MIN,
    DYNAMIC_DIFFICULTY_MAX,
  );
  const delta = currentDifficulty - previousDifficulty;
  nextState.currentDifficulty = currentDifficulty;
  if (delta !== 0) {
    nextState.cooldownGames = DYNAMIC_DIFFICULTY_COOLDOWN_GAMES;
  } else if (requestedDelta !== 0) {
    reason = 'difficulty-limit';
  }

  return {
    state: nextState,
    previousDifficulty,
    currentDifficulty,
    delta,
    windowErrors,
    failedGames,
    reason,
  };
};
