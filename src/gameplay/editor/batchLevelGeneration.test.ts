import { describe, expect, it } from 'vitest';
import { BoardShape } from '../../game/types';
import {
  ALGORITHM4_BATCH_HEADERS,
  generateAlgorithm4BatchLevels,
  parseAlgorithm4BatchConfigRows,
} from './batchLevelGeneration';

describe('algorithm 4 batch level generation', () => {
  it('reads algorithm parameters and the trailing generation count from workbook rows', () => {
    const configs = parseAlgorithm4BatchConfigRows([
      [...ALGORITHM4_BATCH_HEADERS],
      ['正方形', 5, 5, 2, 0.65, 0.45, 2, 5, 3],
      ['长方形', 4, 6, '', '35%', '', '', '', 2],
    ]);

    expect(configs).toEqual([
      {
        sourceRow: 2,
        shape: 'square',
        rows: 5,
        columns: 5,
        targetCrossings: 2,
        turnProbability: 65,
        hiddenPercent: 45,
        maxHiddenRun: 2,
        maxVisibleRun: 5,
        generationCount: 3,
      },
      {
        sourceRow: 3,
        shape: 'rectangle',
        rows: 4,
        columns: 6,
        targetCrossings: 20,
        turnProbability: 35,
        hiddenPercent: 50,
        maxHiddenRun: 3,
        maxVisibleRun: 4,
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

  it('creates the requested number of full algorithm 4 levels', async () => {
    const configs = parseAlgorithm4BatchConfigRows([
      [...ALGORITHM4_BATCH_HEADERS],
      ['正方形', 3, 3, 0, 40, 50, 3, 4, 2],
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
      (level) => level.algorithm?.parameters.hiddenPercent === 50,
    )).toBe(true);
    expect(progress).toEqual([1, 2]);
  });
});
