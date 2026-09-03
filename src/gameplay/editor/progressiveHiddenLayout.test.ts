import { describe, expect, it } from 'vitest';
import {
  createProgressiveHiddenLayout,
  createProgressiveHiddenSegments,
  progressiveHiddenExtraCount,
  progressiveHiddenRunCounts,
  progressiveHiddenRunLimits,
} from './progressiveHiddenLayout';

const path = Array.from({ length: 25 }, (_, index) => {
  const y = Math.floor(index / 5);
  const offset = index % 5;
  return { x: y % 2 === 0 ? offset : 4 - offset, y };
});

const keyOf = (cell: { x: number; y: number }): string => `${cell.x},${cell.y}`;

describe('progressive hidden difficulty layout', () => {
  it('starts with one hidden number per segment and adds the rounded-up difficulty percentage', () => {
    let previous: ReturnType<typeof createProgressiveHiddenLayout> | undefined;
    const layouts: Array<ReturnType<typeof createProgressiveHiddenLayout>> = [];

    for (let difficulty = 1; difficulty <= 10; difficulty += 1) {
      const hidden = createProgressiveHiddenLayout({
        path,
        segmentLengthMin: 5,
        segmentLengthMax: 9,
        difficulty,
        seed: 12345,
        maxVisibleRun: 5,
        previousHiddenCells: previous,
      });
      const segments = createProgressiveHiddenSegments(path.length, 5, 9, 12345);
      expect(hidden).toHaveLength(
        segments.length + progressiveHiddenExtraCount(path.length, difficulty),
      );
      if (previous) {
        const keys = new Set(hidden.map(keyOf));
        expect(previous.every((cell) => keys.has(keyOf(cell)))).toBe(true);
      }
      layouts.push(hidden);
      previous = hidden;
    }

    const segments = createProgressiveHiddenSegments(path.length, 5, 9, 12345);
    const pathIndexes = new Map(path.map((cell, index) => [keyOf(cell), index]));
    expect(segments.every((segment) => layouts[0].filter((cell) => {
      const index = pathIndexes.get(keyOf(cell)) ?? -1;
      return index >= segment.start && index < segment.end;
    }).length === 1)).toBe(true);
    expect(layouts[9]).toHaveLength(segments.length + 7);
  });

  it('scales extra hidden counts with board size and rounds fractions up', () => {
    expect(progressiveHiddenExtraCount(25, 1)).toBe(0);
    expect(progressiveHiddenExtraCount(25, 2)).toBe(1);
    expect(progressiveHiddenExtraCount(25, 3)).toBe(2);
    expect(progressiveHiddenExtraCount(25, 10)).toBe(7);
    expect(progressiveHiddenExtraCount(49, 10)).toBe(14);
    expect(progressiveHiddenExtraCount(70, 10)).toBe(19);
    expect(progressiveHiddenExtraCount(88, 10)).toBe(24);
  });

  it.each([49, 70, 88])(
    'builds an inherited ten-difficulty chain with percentage targets for a %i-number path',
    (pathLength) => {
      const sizedPath = Array.from({ length: pathLength }, (_, x) => ({ x, y: 0 }));
      const segments = createProgressiveHiddenSegments(pathLength, 5, 9, 24680);
      let previous: ReturnType<typeof createProgressiveHiddenLayout> | undefined;
      for (let difficulty = 1; difficulty <= 10; difficulty += 1) {
        const hidden = createProgressiveHiddenLayout({
          path: sizedPath,
          segmentLengthMin: 5,
          segmentLengthMax: 9,
          difficulty,
          seed: 24680,
          maxVisibleRun: 9,
          previousHiddenCells: previous,
        });
        expect(hidden).toHaveLength(
          segments.length + progressiveHiddenExtraCount(pathLength, difficulty),
        );
        previous = hidden;
      }
    },
  );

  it('partitions the whole path with no short trailing segment', () => {
    const segments = createProgressiveHiddenSegments(25, 5, 9, 24680);
    expect(segments.reduce((sum, segment) => sum + segment.length, 0)).toBe(25);
    expect(segments.every((segment) => segment.length >= 5 && segment.length <= 9)).toBe(true);
    expect(segments.at(-1)?.end).toBe(25);
  });

  it('uses continuous runs only while the current difficulty limits allow them', () => {
    let previous: ReturnType<typeof createProgressiveHiddenLayout> | undefined;
    for (let difficulty = 1; difficulty <= 10; difficulty += 1) {
      const hidden = createProgressiveHiddenLayout({
        path,
        segmentLengthMin: 5,
        segmentLengthMax: 9,
        difficulty,
        seed: 98765,
        maxVisibleRun: 5,
        previousHiddenCells: previous,
      });
      const counts = progressiveHiddenRunCounts(path, hidden);
      const limits = progressiveHiddenRunLimits(difficulty);
      expect(counts.doubleRuns).toBeLessThanOrEqual(limits.doubleRuns);
      expect(counts.tripleRuns).toBeLessThanOrEqual(limits.tripleRuns);
      previous = hidden;
    }
  });

  it('is deterministic for the same seed and inherited layout', () => {
    const difficulty1 = createProgressiveHiddenLayout({
      path,
      segmentLengthMin: 5,
      segmentLengthMax: 9,
      difficulty: 1,
      seed: 111,
      maxVisibleRun: 5,
    });
    const options = {
      path,
      segmentLengthMin: 5,
      segmentLengthMax: 9,
      difficulty: 2,
      seed: 111,
      maxVisibleRun: 5,
      previousHiddenCells: difficulty1,
    };
    expect(createProgressiveHiddenLayout(options)).toEqual(createProgressiveHiddenLayout(options));
  });

  it('stops recursive generation when the chain deadline is reached', () => {
    expect(() => createProgressiveHiddenLayout({
      path,
      segmentLengthMin: 5,
      segmentLengthMax: 9,
      difficulty: 1,
      seed: 111,
      maxVisibleRun: 5,
      deadlineAt: 0,
    })).toThrowError(expect.objectContaining({
      name: 'ProgressiveHiddenTimeoutError',
      message: '隐藏难度链生成超时。',
    }));
  });
});
