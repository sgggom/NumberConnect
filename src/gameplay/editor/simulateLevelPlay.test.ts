import { describe, expect, it } from 'vitest';
import { formatLevelBaseDataTsv } from './levelBaseDataTsv';
import { averageSimulatedPlayResults, simulateLevelPlay } from './simulateLevelPlay';

const keyOf = (cell: { x: number; y: number }): string => `${cell.x},${cell.y}`;

describe('editor level play simulation', () => {
  it('records every connection as one step with the requested cell data', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ];

    expect(simulateLevelPlay({
      path,
      hiddenCellKeys: new Set(),
      shape: 'square',
      random: () => 0.99,
    })).toEqual({
      totalSteps: 3,
      errorCount: 0,
      steps: [
        {
          stepNumber: 1,
          outcome: 'connected',
          startNumber: 1,
          endNumber: 2,
          attemptedCells: [path[0], path[1]],
          turnType: 'straight',
          connectableCount: 2,
          directConnect: true,
          distanceToNextVisibleNumber: 1,
        },
        {
          stepNumber: 2,
          outcome: 'connected',
          startNumber: 2,
          endNumber: 3,
          attemptedCells: [path[1], path[2]],
          turnType: 'right-angle',
          connectableCount: 2,
          directConnect: true,
          distanceToNextVisibleNumber: 1,
        },
        {
          stepNumber: 3,
          outcome: 'connected',
          startNumber: 3,
          endNumber: 4,
          attemptedCells: [path[2], path[3]],
          turnType: 'right-angle',
          connectableCount: 1,
          directConnect: true,
          distanceToNextVisibleNumber: 1,
        },
      ],
    });
  });

  it('records a wrong connection as its own step, then retries from the same cell', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ];
    const hidden = new Set([keyOf(path[1]), keyOf(path[3])]);

    const result = simulateLevelPlay({
      path,
      hiddenCellKeys: hidden,
      shape: 'square',
      random: () => 0.99,
    });

    expect(result.totalSteps).toBe(5);
    expect(result.errorCount).toBe(1);
    expect(result.steps.map((step) => step.outcome)).toEqual([
      'error',
      'connected',
      'connected',
      'connected',
      'connected',
    ]);
    expect(result.steps.map((step) => step.attemptedCells[1])).toEqual([
      path[3],
      path[1],
      path[2],
      path[3],
      path[4],
    ]);
    expect(result.steps.map((step) => step.connectableCount)).toEqual([2, 2, 3, 2, 1]);
    expect(result.steps.map((step) => step.directConnect)).toEqual([
      false,
      false,
      true,
      false,
      true,
    ]);
    expect(result.steps.map((step) => step.distanceToNextVisibleNumber)).toEqual([
      2,
      2,
      1,
      2,
      1,
    ]);
    expect(result.steps.map((step) => step.turnType)).toEqual([
      'straight',
      'straight',
      'straight',
      'acute',
      'acute',
    ]);
  });

  it('averages matching step indexes across multiple simulations', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ];
    const hidden = new Set([keyOf(path[1]), keyOf(path[3])]);
    const directRun = simulateLevelPlay({
      path,
      hiddenCellKeys: hidden,
      shape: 'square',
      random: () => 0,
    });
    const errorRun = simulateLevelPlay({
      path,
      hiddenCellKeys: hidden,
      shape: 'square',
      random: () => 0.99,
    });

    const averaged = averageSimulatedPlayResults([directRun, errorRun]);

    expect(averaged.totalSteps).toBe(4.5);
    expect(averaged.errorCount).toBe(0.5);
    expect(averaged.steps).toHaveLength(5);
    expect(averaged.steps[0].errorRate).toBe(0.5);
    expect(averaged.steps[1].directConnectRate).toBe(0.5);
    expect(averaged.steps[4].errorRate).toBe(0);
  });

  it('formats one row of level base data for spreadsheet paste', () => {
    const row = formatLevelBaseDataTsv({
      levelId: 4,
      shape: '正方形',
      rows: 6,
      columns: 6,
      cellCount: 36,
      levelJson: '{"levelId":4,"levelData":[[1,-2],[0,3]]}',
      algorithm: '算法2',
      metrics: {
        rightAngleTurns: 8,
        acuteAngleTurns: 3,
        obtuseAngleTurns: 4,
        straightContinuations: 19,
        pathCrossings: 2,
        hiddenCount: 14,
        hiddenRatio: 14 / 36,
        longestHiddenRun: 3,
        longestVisibleRun: 4,
      },
      averageConnectableCount: 2.345,
      directConnectRatio: 2 / 3,
      averageDistanceToNextVisibleNumber: 1.875,
    });

    expect(row).not.toContain('\n');
    expect(row.split('\t')).toEqual([
      '4',
      '正方形',
      '6',
      '6',
      '36',
      '{"levelId":4,"levelData":[[1,-2],[0,3]]}',
      '算法2',
      '14',
      '38.9%',
      '19',
      '8',
      '3',
      '4',
      '2',
      '3',
      '4',
      '2.35',
      '66.7%',
      '1.88',
    ]);
  });

  it('classifies acute and obtuse turns from the connection direction', () => {
    const acute = simulateLevelPlay({
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }],
      hiddenCellKeys: new Set(),
      shape: 'square',
    });
    const obtuse = simulateLevelPlay({
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 1 }],
      hiddenCellKeys: new Set(),
      shape: 'square',
    });

    expect(acute.steps.map((step) => step.turnType)).toEqual(['straight', 'acute']);
    expect(obtuse.steps.map((step) => step.turnType)).toEqual(['straight', 'obtuse']);
  });

  it('returns no connection steps for an empty or one-cell path', () => {
    expect(simulateLevelPlay({
      path: [],
      hiddenCellKeys: new Set(),
      shape: 'square',
    })).toEqual({ totalSteps: 0, errorCount: 0, steps: [] });
    expect(simulateLevelPlay({
      path: [{ x: 0, y: 0 }],
      hiddenCellKeys: new Set(),
      shape: 'square',
    })).toEqual({ totalSteps: 0, errorCount: 0, steps: [] });
  });

  it('filters a candidate that cannot reach the next visible number in the required steps', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const hidden = new Set([keyOf(path[1]), keyOf(path[4])]);

    const result = simulateLevelPlay({
      path,
      hiddenCellKeys: hidden,
      shape: 'square',
      random: () => 0.99,
    });

    expect(result.errorCount).toBe(0);
    expect(result.totalSteps).toBe(path.length - 1);
    expect(result.steps.map((step) => step.attemptedCells[1])).toEqual(path.slice(1));

  });

  it('looks through a three-hidden-cell interval before choosing a connection', () => {
    const path = [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 1 },
      { x: 4, y: 1 },
      { x: 3, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
      { x: 0, y: 0 },
    ];
    const hidden = new Set([
      keyOf(path[1]),
      keyOf(path[2]),
      keyOf(path[3]),
      keyOf(path[10]),
    ]);

    const result = simulateLevelPlay({
      path,
      hiddenCellKeys: hidden,
      shape: 'square',
      random: () => 0.99,
    });
    expect(result.errorCount).toBe(0);
    expect(result.steps.map((step) => step.attemptedCells[1])).toEqual(path.slice(1));
  });

  it('uses high reasoning to reject a branch beyond medium lookahead', () => {
    const path = [
      { x: 6, y: 5 },
      { x: 7, y: 4 },
      { x: 8, y: 4 },
      { x: 9, y: 5 },
      { x: 9, y: 6 },
      { x: 9, y: 7 },
      { x: 8, y: 8 },
      { x: 7, y: 8 },
      { x: 6, y: 9 },
      { x: 5, y: 10 },
      { x: 4, y: 10 },
      { x: 3, y: 10 },
      { x: 2, y: 10 },
      { x: 1, y: 9 },
      { x: 1, y: 8 },
      { x: 1, y: 7 },
      { x: 1, y: 6 },
      { x: 2, y: 5 },
      { x: 2, y: 4 },
      { x: 3, y: 3 },
      { x: 4, y: 3 },
      { x: 5, y: 4 },
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 6 },
      { x: 3, y: 7 },
    ];
    const hidden = new Set([
      ...path.slice(1, 7).map(keyOf),
      ...path.slice(22).map(keyOf),
    ]);

    const result = simulateLevelPlay({
      path,
      hiddenCellKeys: hidden,
      shape: 'square',
      reasoningLevel: 'high',
      random: () => 0.99,
    });
    const mediumResult = simulateLevelPlay({
      path,
      hiddenCellKeys: hidden,
      shape: 'square',
      reasoningLevel: 'medium',
      random: () => 0.99,
    });

    expect(result.errorCount).toBe(0);
    expect(mediumResult.errorCount).toBeGreaterThan(0);
    expect(result.steps.map((step) => step.attemptedCells[1])).toEqual(path.slice(1));
  });

  it('always follows a visible next number instead of guessing a hidden neighbor', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ];
    const hidden = new Set([keyOf(path[3])]);

    const result = simulateLevelPlay({
      path,
      hiddenCellKeys: hidden,
      shape: 'square',
      random: () => 0.99,
    });

    expect(result.errorCount).toBe(0);
    expect(result.steps[0].directConnect).toBe(true);
    expect(result.steps[0].attemptedCells[1]).toEqual(path[1]);
  });

  it('treats either valid order of two swappable hidden cells as connected', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ];
    const hidden = new Set([keyOf(path[1]), keyOf(path[2])]);

    const result = simulateLevelPlay({
      path,
      hiddenCellKeys: hidden,
      shape: 'square',
      random: () => 0.99,
    });

    expect(result.totalSteps).toBe(3);
    expect(result.errorCount).toBe(0);
    expect(result.steps.every((step) => step.outcome === 'connected')).toBe(true);
    expect(result.steps.map((step) => step.attemptedCells[1])).toEqual([
      path[2],
      path[1],
      path[3],
    ]);
  });
});
