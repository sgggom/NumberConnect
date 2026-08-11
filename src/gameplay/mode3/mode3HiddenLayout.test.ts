import { describe, expect, it } from 'vitest';
import mode3LevelsJson from '../../../public/levels/mode3-levels.json';
import { decodeCompactLevelCollection } from '../../game/levelDataFormat';
import { BoardShape, cellKey, type Cell, type LevelData } from '../../game/types';
import {
  MODE3_DIFFICULTY_CONFIG,
  MODE4_DIFFICULTY_CONFIGS,
  createMode3HiddenCells,
  createMode4HiddenCells,
  mode3EffectiveHiddenPercent,
  mode3EditorShape,
  mode4EffectiveHiddenPercent,
  mode4RandomHiddenSeed,
  resolveMode4DifficultyConfig,
} from './mode3HiddenLayout';

const snakePath = (rows: number, columns: number): Cell[] => Array.from(
  { length: rows * columns },
  (_, index) => {
    const y = Math.floor(index / columns);
    const offset = index % columns;
    return { x: y % 2 === 0 ? offset : columns - 1 - offset, y };
  },
);

const makeLevel = (): LevelData => {
  const solutionPath = snakePath(6, 6);
  return {
    levelId: 3,
    boardShape: BoardShape.Square,
    rows: 6,
    columns: 6,
    activeCells: solutionPath.map((cell) => ({ ...cell })),
    solutionPath,
    hiddenCells: [{ ...solutionPath[1] }],
  };
};

describe('玩法3 Algorithm 8 隐藏布局', () => {
  it('忽略关卡原隐藏格，并按固定[20,40]配置重新计算', () => {
    const level = makeLevel();
    const hidden = createMode3HiddenCells(level, 6);
    const hiddenPercent = mode3EffectiveHiddenPercent(level);

    expect(MODE3_DIFFICULTY_CONFIG).toEqual({
      hiddenPercentRange: [20, 40],
      maxVisibleRun: 3,
      maxHiddenRun: 3,
    });
    expect(hiddenPercent).toBeGreaterThanOrEqual(20);
    expect(hiddenPercent).toBeLessThanOrEqual(40);
    expect(hidden.size).toBe(Math.round(level.solutionPath.length * hiddenPercent / 100));
    expect(hidden.size).not.toBe(level.hiddenCells?.length);
  });

  it('起点终点保持显示，相同关卡和难度生成稳定', () => {
    const level = makeLevel();
    const first = createMode3HiddenCells(level, 6);
    const second = createMode3HiddenCells(level, 6);

    expect(first).toEqual(second);
    expect(first.has(cellKey(level.solutionPath[0]))).toBe(false);
    expect(first.has(cellKey(level.solutionPath.at(-1)!))).toBe(false);
  });

  it('动态难度只改变算法8难度参数，不改变玩法3隐藏占比', () => {
    const level = makeLevel();
    const easy = createMode3HiddenCells(level, 1);
    const hard = createMode3HiddenCells(level, 10);

    expect(hard.size).toBe(easy.size);
  });

  it('把棋盘类型映射到算法8空间拓扑', () => {
    expect(mode3EditorShape(BoardShape.Square)).toBe('square');
    expect(mode3EditorShape(BoardShape.Level)).toBe('square');
    expect(mode3EditorShape(BoardShape.Diamond)).toBe('diamond');
    expect(mode3EditorShape(BoardShape.Rectangle)).toBe('rectangle');
    expect(mode3EditorShape(BoardShape.Hex)).toBe('hex');
  });

  it('全部玩法3关卡均可生成，并始终显示起点和终点', () => {
    const levels = decodeCompactLevelCollection(mode3LevelsJson, false);
    expect(levels).toHaveLength(24);

    levels.forEach((level) => {
      const hidden = createMode3HiddenCells(level, 6);
      expect(hidden.size).toBeLessThanOrEqual(Math.max(0, level.solutionPath.length - 2));
      expect(hidden.has(cellKey(level.solutionPath[0]))).toBe(false);
      expect(hidden.has(cellKey(level.solutionPath.at(-1)!))).toBe(false);
    });
  });
});

describe('玩法4动态配置', () => {
  it('逐级匹配产品给定的10档参数', () => {
    expect(MODE4_DIFFICULTY_CONFIGS).toEqual([
      { hiddenPercentRange: [10, 15], maxVisibleRun: 5, maxHiddenRun: 2 },
      { hiddenPercentRange: [15, 20], maxVisibleRun: 5, maxHiddenRun: 2 },
      { hiddenPercentRange: [20, 25], maxVisibleRun: 4, maxHiddenRun: 2 },
      { hiddenPercentRange: [25, 30], maxVisibleRun: 4, maxHiddenRun: 2 },
      { hiddenPercentRange: [30, 35], maxVisibleRun: 3, maxHiddenRun: 3 },
      { hiddenPercentRange: [35, 40], maxVisibleRun: 3, maxHiddenRun: 3 },
      { hiddenPercentRange: [40, 45], maxVisibleRun: 2, maxHiddenRun: 4 },
      { hiddenPercentRange: [45, 50], maxVisibleRun: 2, maxHiddenRun: 4 },
      { hiddenPercentRange: [50, 55], maxVisibleRun: 2, maxHiddenRun: 5 },
      { hiddenPercentRange: [55, 60], maxVisibleRun: 2, maxHiddenRun: 5 },
    ]);
    expect(resolveMode4DifficultyConfig(0)).toBe(MODE4_DIFFICULTY_CONFIGS[0]);
    expect(resolveMode4DifficultyConfig(99)).toBe(MODE4_DIFFICULTY_CONFIGS[9]);
  });

  it('按当前档位选择稳定占比，难度10比难度1隐藏更多', () => {
    const level = makeLevel();
    const easyPercent = mode4EffectiveHiddenPercent(level, 1);
    const hardPercent = mode4EffectiveHiddenPercent(level, 10);
    const easy = createMode4HiddenCells(level, 1);
    const hard = createMode4HiddenCells(level, 10);

    expect(easyPercent).toBeGreaterThanOrEqual(10);
    expect(easyPercent).toBeLessThanOrEqual(15);
    expect(hardPercent).toBeGreaterThanOrEqual(55);
    expect(hardPercent).toBeLessThanOrEqual(60);
    expect(easy.size).toBe(Math.round(level.solutionPath.length * easyPercent / 100));
    expect(hard.size).toBe(Math.round(level.solutionPath.length * hardPercent / 100));
    expect(hard.size).toBeGreaterThan(easy.size);
    expect(createMode4HiddenCells(level, 10)).toEqual(hard);
  });

  it('全部关卡和档位都只按配置取数量，且前4个数字最多隐藏1个', () => {
    const levels = decodeCompactLevelCollection(mode3LevelsJson, false);

    levels.forEach((level) => {
      expect(mode4RandomHiddenSeed(level)).toBe(mode4RandomHiddenSeed(level));
      for (let difficulty = 1; difficulty <= 10; difficulty += 1) {
        const hidden = createMode4HiddenCells(level, difficulty);
        const percent = mode4EffectiveHiddenPercent(level, difficulty);
        const firstFourHiddenCount = level.solutionPath
          .slice(0, 4)
          .filter((cell) => hidden.has(cellKey(cell)))
          .length;

        expect(hidden.size).toBe(Math.round(level.solutionPath.length * percent / 100));
        expect(firstFourHiddenCount).toBeLessThanOrEqual(1);
        expect(hidden.has(cellKey(level.solutionPath[0]))).toBe(false);
        expect(hidden.has(cellKey(level.solutionPath.at(-1)!))).toBe(false);
      }
    });
  });
});
