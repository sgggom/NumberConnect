import { describe, expect, it, vi } from 'vitest';
import { BoardShape, type LevelData } from '../../game/types';
import { loadBuiltInLevels } from '../../game/storage';
import { formatLevelCollectionTxt, formatLevelListTxt } from './levelCollectionTxt';

const serpentinePath = (rows: number, columns: number) => Array.from(
  { length: rows * columns },
  (_, index) => {
    const y = Math.floor(index / columns);
    const offset = index % columns;
    return { x: y % 2 === 0 ? offset : columns - offset - 1, y };
  },
);

const createLevel = (
  levelId: number,
  rows: number,
  columns: number,
  boardShape: BoardShape,
): LevelData => {
  const path = serpentinePath(rows, columns);
  return {
    levelId,
    boardShape,
    rows,
    columns,
    activeCells: path.map((cell) => ({ ...cell })),
    solutionPath: path,
    hiddenCells: [path[2], path[4]],
    pathSource: 'generated',
    algorithm: {
      id: 'algorithm-1',
      parameters: {
        topology: 'board-shape',
        pathMode: 'single-stroke-multiple-solutions',
        targetCrossings: 20,
        turnProbability: 40,
        earlyHiddenProbability: 40,
        middleHiddenProbability: 50,
        lateHiddenProbability: 60,
        earlyAdjacentHiddenSkipProbability: 25,
        middleAdjacentHiddenSkipProbability: 50,
        lateAdjacentHiddenSkipProbability: 75,
        maxHiddenRun: 3,
        maxVisibleRun: 4,
      },
    },
  };
};

describe('level collection TXT export', () => {
  it('exports only level ids and compact data in the reference JSON shape', () => {
    const text = formatLevelListTxt([
      createLevel(8, 3, 4, BoardShape.Rectangle),
      createLevel(3, 3, 3, BoardShape.Square),
    ]);

    expect(JSON.parse(text)).toEqual({
      level_3: { data: [[1, 2, -3], [6, -5, 4], [7, 8, 9]] },
      level_8: { data: [[1, 2, -3, 4], [8, 7, 6, -5], [9, 10, 11, 12]] },
    });
    expect(text).toBe('{"level_3":{"data":[[1,2,-3],[6,-5,4],[7,8,9]]},"level_8":{"data":[[1,2,-3,4],[8,7,6,-5],[9,10,11,12]]}}');
  });

  it('writes one tab-separated line per level with id, formation, and shape first', async () => {
    const progress = vi.fn();
    const text = await formatLevelCollectionTxt([
      createLevel(7, 3, 3, BoardShape.Square),
      createLevel(8, 3, 4, BoardShape.Rectangle),
    ], {
      simulationRunCount: 1,
      reasoningLevel: 'medium',
      onProgress: progress,
    });
    const lines = text.split('\r\n');
    const first = lines[0].split('\t');
    const second = lines[1].split('\t');

    expect(lines).toHaveLength(2);
    expect(first).toHaveLength(23);
    expect(first.slice(0, 7)).toEqual([
      '1',
      '{"data":[[1,2,-3],[6,-5,4],[7,8,9]]}',
      '正方形',
      '3',
      '3',
      '9',
      '算法1',
    ]);
    expect(second.slice(0, 3)).toEqual([
      '2',
      '{"data":[[1,2,-3,4],[8,7,6,-5],[9,10,11,12]]}',
      '长方形',
    ]);
    expect(first.slice(-4).every((value) => Number.isFinite(Number(value)))).toBe(true);
    expect(progress).toHaveBeenNthCalledWith(1, 1, 2, 1);
    expect(progress).toHaveBeenNthCalledWith(2, 2, 2, 2);
  });

  it('exports legacy algorithm 8 levels under the current algorithm 1 label', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => [{ data: [[1, 2], [4, -3]] }],
    })));

    try {
      const levels = await loadBuiltInLevels();
      const text = await formatLevelCollectionTxt(levels, {
        simulationRunCount: 1,
        reasoningLevel: 'medium',
      });
      const values = text.split('\t');

      expect(values[1]).toBe('{"data":[[1,2],[4,-3]]}');
      expect(values[6]).toBe('算法1');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
