import { describe, expect, it } from 'vitest';
import { BoardShape, cellKey, type Cell, type LevelData } from '../../game/types';
import { mode4RandomHiddenSeed } from '../mode3/mode3HiddenLayout';
import {
  MODE5_DIFFICULTY_CONFIGS,
  createMode5HiddenCells,
  createMode5StageHiddenCells,
  mode5Algorithm8Seed,
  mode5EffectiveHiddenPercent,
  resolveMode5DifficultyConfig,
} from './mode5HiddenLayout';

const snakePath = (rows: number, columns: number): Cell[] => Array.from(
  { length: rows * columns },
  (_, index) => {
    const y = Math.floor(index / columns);
    const offset = index % columns;
    return { x: y % 2 === 0 ? offset : columns - 1 - offset, y };
  },
);

const makeLevel = (): LevelData => ({
  levelId: 5,
  boardShape: BoardShape.Rectangle,
  rows: 8,
  columns: 6,
  activeCells: snakePath(8, 6),
  solutionPath: snakePath(8, 6),
});

describe('玩法5独立隐藏布局', () => {
  it('拥有自己的10档初始配置', () => {
    expect(MODE5_DIFFICULTY_CONFIGS).toHaveLength(10);
    expect(resolveMode5DifficultyConfig(1)).toEqual({
      hiddenPercentRange: [20, 26],
      maxVisibleRun: 4,
      maxHiddenRun: 2,
    });
    expect(resolveMode5DifficultyConfig(10)).toEqual({
      hiddenPercentRange: [58, 60],
      maxVisibleRun: 2,
      maxHiddenRun: 3,
    });
  });

  it('同关同难度稳定生成，并固定显示首尾', () => {
    const level = makeLevel();
    const first = createMode5HiddenCells(level, 8);
    const second = createMode5HiddenCells(level, 8);

    expect(second).toEqual(first);
    expect(first.has(cellKey(level.solutionPath[0]))).toBe(false);
    expect(first.has(cellKey(level.solutionPath.at(-1)!))).toBe(false);
  });

  it('难度会进入玩法5自己的算法8种子', () => {
    const level = makeLevel();
    expect(mode5Algorithm8Seed(level, 1)).not.toBe(mode5Algorithm8Seed(level, 10));
  });

  it('数字1到4最多隐藏1个', () => {
    const level = makeLevel();
    for (let difficulty = 1; difficulty <= 10; difficulty += 1) {
      const hidden = createMode5HiddenCells(level, difficulty);
      const firstFourHidden = level.solutionPath.slice(0, 4).filter(
        (cell) => hidden.has(cellKey(cell)),
      );
      expect(firstFourHidden.length).toBeLessThanOrEqual(1);
    }
  });

  it('首关直接读取棋盘隐藏数据且不受难度影响', () => {
    const level = makeLevel();
    level.hiddenCells = [level.solutionPath[1], level.solutionPath[6]];
    const expected = new Set(level.hiddenCells.map(cellKey));

    expect(createMode5StageHiddenCells(level, 1, true)).toEqual(expected);
    expect(createMode5StageHiddenCells(level, 10, true)).toEqual(expected);
  });

  it('拥有独立于玩法4的种子与占比入口', () => {
    const level = makeLevel();
    expect(mode5Algorithm8Seed(level, 6)).not.toBe(mode4RandomHiddenSeed(level));
    expect(mode5EffectiveHiddenPercent(level, 6)).toBeGreaterThanOrEqual(46);
    expect(mode5EffectiveHiddenPercent(level, 6)).toBeLessThanOrEqual(50);
  });
});
