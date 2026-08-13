export const MODE5_DYNAMIC_DIFFICULTY_STORAGE_KEY = 'number-connect.mode5-dynamic-difficulty.v1';
export const MODE5_DYNAMIC_DIFFICULTY_DEFAULT = 1;
export const MODE5_DYNAMIC_DIFFICULTY_MIN = 1;
export const MODE5_DYNAMIC_DIFFICULTY_MAX = 10;
export const MODE5_DYNAMIC_DIFFICULTY_WINDOW_SIZE = 5;
export const MODE5_DYNAMIC_DIFFICULTY_COOLDOWN_GAMES = 2;

export type Mode5DynamicDifficultyGameResult = 'completed' | 'life-depleted';

export interface Mode5DynamicDifficultyGameRecord {
  errors: number;
  result: Mode5DynamicDifficultyGameResult;
  levelId: number;
  finishedAtUtc: string;
}

export interface Mode5DynamicDifficultyState {
  version: 1;
  currentDifficulty: number;
  recentGames: Mode5DynamicDifficultyGameRecord[];
  cooldownGames: number;
  totalEligibleGames: number;
}

export type Mode5DynamicDifficultyReason =
  | 'warm-up'
  | 'cooldown'
  | 'raised'
  | 'lowered-errors'
  | 'lowered-failures'
  | 'steady'
  | 'difficulty-limit';

export interface Mode5DynamicDifficultyDecision {
  state: Mode5DynamicDifficultyState;
  previousDifficulty: number;
  currentDifficulty: number;
  delta: number;
  windowErrors: number;
  failedGames: number;
  reason: Mode5DynamicDifficultyReason;
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

export const createMode5DynamicDifficultyState = (
  currentDifficulty = MODE5_DYNAMIC_DIFFICULTY_DEFAULT,
): Mode5DynamicDifficultyState => ({
  version: 1,
  currentDifficulty: clampInteger(
    currentDifficulty,
    MODE5_DYNAMIC_DIFFICULTY_MIN,
    MODE5_DYNAMIC_DIFFICULTY_MAX,
  ),
  recentGames: [],
  cooldownGames: 0,
  totalEligibleGames: 0,
});

const normalizeMode5Record = (
  value: unknown,
): Mode5DynamicDifficultyGameRecord | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Partial<Mode5DynamicDifficultyGameRecord>;
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

export const normalizeMode5DynamicDifficultyState = (
  value: unknown,
): Mode5DynamicDifficultyState => {
  if (!value || typeof value !== 'object') return createMode5DynamicDifficultyState();
  const state = value as Partial<Mode5DynamicDifficultyState>;
  const recentGames = Array.isArray(state.recentGames)
    ? state.recentGames.flatMap((record) => {
        const normalized = normalizeMode5Record(record);
        return normalized ? [normalized] : [];
      }).slice(-MODE5_DYNAMIC_DIFFICULTY_WINDOW_SIZE)
    : [];
  return {
    version: 1,
    currentDifficulty: clampInteger(
      state.currentDifficulty ?? MODE5_DYNAMIC_DIFFICULTY_DEFAULT,
      MODE5_DYNAMIC_DIFFICULTY_MIN,
      MODE5_DYNAMIC_DIFFICULTY_MAX,
    ),
    recentGames,
    cooldownGames: clampInteger(
      state.cooldownGames ?? 0,
      0,
      MODE5_DYNAMIC_DIFFICULTY_COOLDOWN_GAMES,
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

export const loadMode5DynamicDifficultyState = (
  storage: StorageLike | undefined = browserStorage(),
): Mode5DynamicDifficultyState => {
  if (!storage) return createMode5DynamicDifficultyState();
  try {
    return normalizeMode5DynamicDifficultyState(JSON.parse(
      storage.getItem(MODE5_DYNAMIC_DIFFICULTY_STORAGE_KEY) ?? '{}',
    ));
  } catch {
    return createMode5DynamicDifficultyState();
  }
};

export const saveMode5DynamicDifficultyState = (
  state: Mode5DynamicDifficultyState,
  storage: StorageLike | undefined = browserStorage(),
): void => {
  storage?.setItem(
    MODE5_DYNAMIC_DIFFICULTY_STORAGE_KEY,
    JSON.stringify(normalizeMode5DynamicDifficultyState(state)),
  );
};

/** 玩法5独立升降公式；当前阈值以玩法4为初始模板。 */
export const recordMode5DynamicDifficultyGame = (
  state: Mode5DynamicDifficultyState,
  record: Mode5DynamicDifficultyGameRecord,
): Mode5DynamicDifficultyDecision => {
  const previousState = normalizeMode5DynamicDifficultyState(state);
  const normalizedRecord = normalizeMode5Record(record);
  if (!normalizedRecord) throw new Error('Invalid mode5 dynamic difficulty game record');

  const recentGames = [...previousState.recentGames, normalizedRecord]
    .slice(-MODE5_DYNAMIC_DIFFICULTY_WINDOW_SIZE);
  const windowErrors = recentGames.reduce(
    (sum, game) => sum + Math.min(game.errors, 3),
    0,
  );
  const failedGames = recentGames.filter(
    (game) => game.result === 'life-depleted',
  ).length;
  const nextState: Mode5DynamicDifficultyState = {
    ...previousState,
    recentGames,
    totalEligibleGames: previousState.totalEligibleGames + 1,
  };
  const previousDifficulty = previousState.currentDifficulty;

  if (recentGames.length < MODE5_DYNAMIC_DIFFICULTY_WINDOW_SIZE) {
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
  let reason: Mode5DynamicDifficultyReason = 'steady';
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
    MODE5_DYNAMIC_DIFFICULTY_MIN,
    MODE5_DYNAMIC_DIFFICULTY_MAX,
  );
  const delta = currentDifficulty - previousDifficulty;
  nextState.currentDifficulty = currentDifficulty;
  if (delta !== 0) {
    nextState.cooldownGames = MODE5_DYNAMIC_DIFFICULTY_COOLDOWN_GAMES;
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
