import { describe, expect, it, vi } from 'vitest';
import {
  MODE5_DYNAMIC_DIFFICULTY_STORAGE_KEY,
  createMode5DynamicDifficultyState,
  loadMode5DynamicDifficultyState,
  recordMode5DynamicDifficultyGame,
  saveMode5DynamicDifficultyState,
} from './dynamicDifficulty';

describe('玩法5独立动态难度状态', () => {
  it('默认从难度1开始', () => {
    expect(createMode5DynamicDifficultyState().currentDifficulty).toBe(1);
    expect(loadMode5DynamicDifficultyState({
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    }).currentDifficulty).toBe(1);
  });

  it('只从玩法5存档键读取和保存', () => {
    const values = new Map<string, string>([[
      MODE5_DYNAMIC_DIFFICULTY_STORAGE_KEY,
      JSON.stringify(createMode5DynamicDifficultyState(8)),
    ]]);
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    };

    const state = loadMode5DynamicDifficultyState(storage);
    expect(state.currentDifficulty).toBe(8);
    saveMode5DynamicDifficultyState(state, storage);
    expect(storage.getItem).toHaveBeenCalledWith(MODE5_DYNAMIC_DIFFICULTY_STORAGE_KEY);
    expect(storage.setItem).toHaveBeenCalledWith(
      MODE5_DYNAMIC_DIFFICULTY_STORAGE_KEY,
      expect.any(String),
    );
  });

  it('通过独立入口记录玩法5对局', () => {
    const decision = recordMode5DynamicDifficultyGame(createMode5DynamicDifficultyState(6), {
      errors: 1,
      result: 'completed',
      levelId: 3,
      finishedAtUtc: '2026-08-11T00:00:00.000Z',
    });
    expect(decision.state.recentGames).toHaveLength(1);
    expect(decision.state.recentGames[0].levelId).toBe(3);
  });

  it('按玩法5自己的最近5局公式提升难度', () => {
    let state = createMode5DynamicDifficultyState(6);
    [0, 0, 1, 0, 1].forEach((errors, index) => {
      state = recordMode5DynamicDifficultyGame(state, {
        errors,
        result: 'completed',
        levelId: index + 1,
        finishedAtUtc: `2026-08-11T00:00:0${index}.000Z`,
      }).state;
    });

    expect(state.currentDifficulty).toBe(7);
    expect(state.cooldownGames).toBe(2);
  });
});
