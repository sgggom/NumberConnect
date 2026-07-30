import { describe, expect, it } from 'vitest';
import { BoardShape } from '../../game/types';
import {
  ALGORITHM4_BATCH_HEADERS,
  createAlgorithm4BatchTasks,
  finalizeAlgorithm4BatchTaskResults,
  generateAlgorithm4BatchLevels,
  generateAlgorithm4BatchTask,
  parseAlgorithm4BatchConfigRows,
} from './batchLevelGeneration';

describe('algorithm 4 batch level generation', () => {
  it('reads algorithm parameters and the trailing generation count from workbook rows', () => {
    const configs = parseAlgorithm4BatchConfigRows([
      ['id', ...ALGORITHM4_BATCH_HEADERS],
      [1, '正方形', 5, 5, 2, 65, 35, 55, 75, 2, 5, 25, 60, 90, 3],
      [2, '长方形', 4, 6, '', 35, '', '', '', '', '', '', '', '', 2],
    ]);

    expect(configs).toEqual([
      {
        sourceRow: 2,
        shape: 'square',
        rows: 5,
        columns: 5,
        targetCrossings: 2,
        turnProbability: 65,
        earlyHiddenProbability: 35,
        middleHiddenProbability: 55,
        lateHiddenProbability: 75,
        maxHiddenRun: 2,
        maxVisibleRun: 5,
        earlyAdjacentHiddenSkipProbability: 25,
        middleAdjacentHiddenSkipProbability: 60,
        lateAdjacentHiddenSkipProbability: 90,
        generationCount: 3,
      },
      {
        sourceRow: 3,
        shape: 'rectangle',
        rows: 4,
        columns: 6,
        targetCrossings: 20,
        turnProbability: 35,
        earlyHiddenProbability: 50,
        middleHiddenProbability: 50,
        lateHiddenProbability: 50,
        maxHiddenRun: 3,
        maxVisibleRun: 4,
        earlyAdjacentHiddenSkipProbability: 0,
        middleAdjacentHiddenSkipProbability: 0,
        lateAdjacentHiddenSkipProbability: 0,
        generationCount: 2,
      },
    ]);
  });

  it('reports the spreadsheet row for invalid shape dimensions', () => {
    expect(() => parseAlgorithm4BatchConfigRows([
      [...ALGORITHM4_BATCH_HEADERS],
      ['六边形蜂窝', 6, 7, 0, 40, 50, 3, 4, 1],
    ])).toThrow('第 2 行：六边形蜂窝棋盘的行数和列数必须相同');
  });

  it('requires every probability to use a 0–100 integer value', () => {
    expect(() => parseAlgorithm4BatchConfigRows([
      [...ALGORITHM4_BATCH_HEADERS],
      ['正方形', 5, 5, 2, 0.65, 35, 55, 75, 2, 5, 25, 60, 90, 3],
    ])).toThrow('第 2 行“拐弯概率 %”必须是 0–100 的整数（15 表示 15%）');
  });

  it('creates the requested number of full algorithm 4 levels', async () => {
    const configs = parseAlgorithm4BatchConfigRows([
      [...ALGORITHM4_BATCH_HEADERS],
      ['正方形', 3, 3, 0, 40, 50, 50, 50, 3, 4, 0, 0, 0, 2],
    ]);
    const progress: number[] = [];
    const result = await generateAlgorithm4BatchLevels(
      configs,
      11,
      24680,
      (completed) => progress.push(completed),
    );

    expect(result.failures).toEqual([]);
    expect(result.levels).toHaveLength(2);
    expect(result.levels.map((level) => level.levelId)).toEqual([11, 12]);
    expect(result.levels.every((level) => level.boardShape === BoardShape.Square)).toBe(true);
    expect(result.levels.every((level) => level.activeCells.length === 9)).toBe(true);
    expect(result.levels.every((level) => level.solutionPath.length === 9)).toBe(true);
    expect(result.levels.every((level) => level.algorithm?.id === 'algorithm-4')).toBe(true);
    expect(result.levels.every(
      (level) => level.algorithm?.parameters.middleHiddenProbability === 50,
    )).toBe(true);
    expect(result.levels.every(
      (level) => !Object.hasOwn(level.algorithm?.parameters ?? {}, 'hiddenPercent'),
    )).toBe(true);
    expect(progress).toEqual([1, 2]);
  });

  it('restores spreadsheet order and consecutive ids after tasks finish out of order', () => {
    const configs = parseAlgorithm4BatchConfigRows([
      [...ALGORITHM4_BATCH_HEADERS],
      ['正方形', 3, 3, 0, 40, 50, 50, 50, 3, 4, 0, 0, 0, 3],
    ]);
    const tasks = createAlgorithm4BatchTasks(configs, 13579);
    const results = tasks.map(generateAlgorithm4BatchTask).reverse();
    const finalized = finalizeAlgorithm4BatchTaskResults(results, 21);

    expect(finalized.failures).toEqual([]);
    expect(finalized.levels.map((level) => level.levelId)).toEqual([21, 22, 23]);
    expect(finalized.levels.map((level) => level.solutionPath)).toEqual(
      tasks.map((task) => generateAlgorithm4BatchTask(task).level?.solutionPath),
    );
  });
});
