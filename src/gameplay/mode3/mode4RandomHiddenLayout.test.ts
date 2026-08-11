import { describe, expect, it } from 'vitest';
import type { Cell } from '../../game/types';
import {
  calculateMode4RandomRunMetrics,
  selectMode4RandomDispersedHiddenLayout,
} from './mode4RandomHiddenLayout';

const snakePath = (rows: number, columns: number): Cell[] => Array.from(
  { length: rows * columns },
  (_, index) => {
    const y = Math.floor(index / columns);
    const offset = index % columns;
    return { x: y % 2 === 0 ? offset : columns - 1 - offset, y };
  },
);

describe('玩法4随机分散隐藏布局', () => {
  it('按配置占比精确选取并固定显示首尾', () => {
    const path = snakePath(8, 6);
    const hidden = selectMode4RandomDispersedHiddenLayout(path, 57, 20260811, {
      maxVisibleRun: 2,
      maxHiddenRun: 5,
    });

    expect(hidden.size).toBe(Math.round(path.length * 0.57));
    expect(hidden.has(0)).toBe(false);
    expect(hidden.has(path.length - 1)).toBe(false);
  });

  it('数字1到4中最多隐藏1个', () => {
    const path = snakePath(8, 6);
    for (let percent = 10; percent <= 60; percent += 5) {
      const hidden = selectMode4RandomDispersedHiddenLayout(path, percent, 917263, {
        maxVisibleRun: 2,
        maxHiddenRun: 5,
      });
      expect([...hidden].filter((index) => index < 4)).toHaveLength(1);
    }
  });

  it('同一关卡种子稳定，不接收目标难度参数', () => {
    const path = snakePath(7, 6);
    const options = { maxVisibleRun: 3, maxHiddenRun: 3 };
    const first = selectMode4RandomDispersedHiddenLayout(path, 37, 481516, options);
    const second = selectMode4RandomDispersedHiddenLayout(path, 37, 481516, options);

    expect(second).toEqual(first);
  });

  it('数量可行时满足连续显示和连续隐藏上限', () => {
    const path = snakePath(8, 6);
    const hidden = selectMode4RandomDispersedHiddenLayout(path, 42, 314159, {
      maxVisibleRun: 2,
      maxHiddenRun: 4,
    });
    const metrics = calculateMode4RandomRunMetrics(path.length, hidden);

    expect(metrics.longestVisibleRun).toBeLessThanOrEqual(2);
    expect(metrics.longestHiddenRun).toBeLessThanOrEqual(4);
  });
});
