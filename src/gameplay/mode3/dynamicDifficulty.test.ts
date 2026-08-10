import { describe, expect, it } from 'vitest';
import {
  DYNAMIC_DIFFICULTY_STORAGE_KEY,
  MODE4_DYNAMIC_DIFFICULTY_STORAGE_KEY,
  createDynamicDifficultyState,
  loadDynamicDifficultyState,
  loadMode4DynamicDifficultyState,
  normalizeDynamicDifficultyState,
  recordDynamicDifficultyGame,
  saveDynamicDifficultyState,
  saveMode4DynamicDifficultyState,
  type DynamicDifficultyGameResult,
  type DynamicDifficultyState,
} from './dynamicDifficulty';

const recordGame = (
  state: DynamicDifficultyState,
  errors: number,
  result: DynamicDifficultyGameResult = 'completed',
  levelId = 1,
) => recordDynamicDifficultyGame(state, {
  errors,
  result,
  levelId,
  finishedAtUtc: '2026-08-10T00:00:00.000Z',
});

describe('玩法3最近5局动态难度', () => {
  it('前4局只收集样本，第5局低错误时提升1级', () => {
    let state = createDynamicDifficultyState(6);
    for (let index = 0; index < 4; index += 1) {
      const decision = recordGame(state, index % 2);
      state = decision.state;
      expect(decision.reason).toBe('warm-up');
      expect(decision.currentDifficulty).toBe(6);
    }

    const decision = recordGame(state, 0);
    expect(decision.windowErrors).toBe(2);
    expect(decision.delta).toBe(1);
    expect(decision.currentDifficulty).toBe(7);
    expect(decision.state.cooldownGames).toBe(2);
  });

  it('错误总数达到8时降低1级，并将单局评分封顶为3', () => {
    let state = createDynamicDifficultyState(6);
    [99, 3, 2, 0].forEach((errors) => {
      state = recordGame(state, errors).state;
    });

    const decision = recordGame(state, 0);
    expect(decision.windowErrors).toBe(8);
    expect(decision.reason).toBe('lowered-errors');
    expect(decision.delta).toBe(-1);
    expect(decision.currentDifficulty).toBe(5);
    expect(decision.state.recentGames[0].errors).toBe(99);
  });

  it('最近5局有2次生命耗尽时优先降低难度', () => {
    let state = createDynamicDifficultyState(6);
    const games: Array<[number, DynamicDifficultyGameResult]> = [
      [3, 'life-depleted'],
      [0, 'completed'],
      [3, 'life-depleted'],
      [0, 'completed'],
      [0, 'completed'],
    ];
    let last = recordGame(state, games[0][0], games[0][1]);
    state = last.state;
    games.slice(1).forEach(([errors, result]) => {
      last = recordGame(state, errors, result);
      state = last.state;
    });

    expect(last.windowErrors).toBe(6);
    expect(last.failedGames).toBe(2);
    expect(last.reason).toBe('lowered-failures');
    expect(last.delta).toBe(-1);
  });

  it('调整后的2局只采样，到第3局才重新判断', () => {
    let state = createDynamicDifficultyState(6);
    for (let index = 0; index < 5; index += 1) state = recordGame(state, 0).state;
    expect(state.currentDifficulty).toBe(7);

    const firstCooldown = recordGame(state, 3);
    expect(firstCooldown.reason).toBe('cooldown');
    expect(firstCooldown.state.cooldownGames).toBe(1);

    const secondCooldown = recordGame(firstCooldown.state, 3);
    expect(secondCooldown.reason).toBe('cooldown');
    expect(secondCooldown.state.cooldownGames).toBe(0);

    const nextEvaluation = recordGame(secondCooldown.state, 3);
    expect(nextEvaluation.windowErrors).toBe(9);
    expect(nextEvaluation.reason).toBe('lowered-errors');
    expect(nextEvaluation.currentDifficulty).toBe(6);
  });

  it('难度始终限制在1到10', () => {
    let maximum = createDynamicDifficultyState(10);
    for (let index = 0; index < 5; index += 1) maximum = recordGame(maximum, 0).state;
    expect(maximum.currentDifficulty).toBe(10);
    expect(maximum.cooldownGames).toBe(0);

    let minimum = createDynamicDifficultyState(1);
    for (let index = 0; index < 5; index += 1) minimum = recordGame(minimum, 3).state;
    expect(minimum.currentDifficulty).toBe(1);
    expect(minimum.cooldownGames).toBe(0);
  });

  it('加载时清洗非法状态，并只保留最后5局', () => {
    const normalized = normalizeDynamicDifficultyState({
      currentDifficulty: 99,
      cooldownGames: 99,
      totalEligibleGames: -5,
      recentGames: [
        { errors: 1, result: 'invalid', levelId: 1 },
        ...Array.from({ length: 7 }, (_, index) => ({
          errors: index,
          result: 'completed',
          levelId: index + 1,
          finishedAtUtc: '2026-08-10T00:00:00.000Z',
        })),
      ],
    });

    expect(normalized.currentDifficulty).toBe(10);
    expect(normalized.cooldownGames).toBe(2);
    expect(normalized.recentGames).toHaveLength(5);
    expect(normalized.recentGames.map((game) => game.levelId)).toEqual([3, 4, 5, 6, 7]);
    expect(normalized.totalEligibleGames).toBe(5);
  });

  it('使用独立localStorage键保存与读取', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const state = createDynamicDifficultyState(8);

    saveDynamicDifficultyState(state, storage);
    expect(values.has(DYNAMIC_DIFFICULTY_STORAGE_KEY)).toBe(true);
    expect(loadDynamicDifficultyState(storage)).toEqual(state);
  });

  it('玩法3与玩法4的难度档案互不覆盖', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const mode3State = createDynamicDifficultyState(3);
    const mode4State = createDynamicDifficultyState(9);

    saveDynamicDifficultyState(mode3State, storage);
    saveMode4DynamicDifficultyState(mode4State, storage);

    expect(DYNAMIC_DIFFICULTY_STORAGE_KEY).not.toBe(MODE4_DYNAMIC_DIFFICULTY_STORAGE_KEY);
    expect(loadDynamicDifficultyState(storage)).toEqual(mode3State);
    expect(loadMode4DynamicDifficultyState(storage)).toEqual(mode4State);
  });
});
