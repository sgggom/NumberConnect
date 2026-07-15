import { describe, expect, it } from 'vitest';
import { getEndlessStageSettings } from '../game/difficulty';
import { selectHiddenCells } from '../game/hidden';
import { formatLives } from '../game/lives';
import { generateProceduralLevel, isValidPath } from '../game/pathfinding';
import { BoardShape, cellKey, type Cell } from '../game/types';
import { createVideoView, groupVideoViews, parseVideoViews, videoPlacementLabel } from '../game/videoStats';
import { generateEndlessLevel } from '../gameplay/endless/generateEndlessLevel';

describe('procedural level generation', () => {
  it.each([[4, 4], [5, 5], [6, 6], [8, 8]])('creates a valid %sx%s path', (rows, columns) => {
    const level = generateProceduralLevel(rows, columns, 12345 + rows, 4, BoardShape.Square);
    expect(isValidPath(rows, columns, level.solutionPath)).toBe(true);
  });

  it('creates a valid six-neighbor honeycomb path', () => {
    const level = generateProceduralLevel(6, 6, 24680, 2, BoardShape.Hex);
    expect(isValidPath(6, 6, level.solutionPath, undefined, BoardShape.Hex)).toBe(true);
  });

});

describe('hidden number selection', () => {
  it('never hides endpoints and respects the hidden-run limit', () => {
    const path: Cell[] = Array.from({ length: 30 }, (_, x) => ({ x, y: 0 }));
    const hidden = selectHiddenCells(path, 60, 3, 4, 99);
    expect(hidden.has(cellKey(path[0]))).toBe(false);
    expect(hidden.has(cellKey(path[path.length - 1]))).toBe(false);

    let longestRun = 0;
    let currentRun = 0;
    path.forEach((cell) => {
      currentRun = hidden.has(cellKey(cell)) ? currentRun + 1 : 0;
      longestRun = Math.max(longestRun, currentRun);
    });
    expect(longestRun).toBeLessThanOrEqual(3);
  });
});

describe('endless difficulty', () => {
  it('scales the requested dimensions and hiding pressure', () => {
    const first = getEndlessStageSettings(1);
    const middle = getEndlessStageSettings(7);
    const late = getEndlessStageSettings(20);
    expect(first.rows).toBeLessThanOrEqual(middle.rows);
    expect(middle.rows).toBeLessThanOrEqual(late.rows);
    expect(first.hiddenPercent).toBeLessThan(middle.hiddenPercent);
    expect(middle.hiddenPercent).toBeLessThan(late.hiddenPercent);
    expect(first.maxVisibleRun).toBeGreaterThanOrEqual(late.maxVisibleRun);
    expect(first.maxHiddenRun).toBeLessThan(late.maxHiddenRun);
  });

  it.each([1, 7, 20])('generates endless stage %i with algorithm 2 and its difficulty parameters', (stage) => {
    const profile = getEndlessStageSettings(stage);
    const level = generateEndlessLevel(profile, 24680 + stage);

    expect(level.algorithm).toMatchObject({
      id: 'algorithm-2',
      parameters: {
        targetCrossings: profile.targetCrossings,
        hiddenPercent: profile.hiddenPercent,
        maxHiddenRun: Math.min(profile.maxHiddenRun, 3),
        maxVisibleRun: profile.maxVisibleRun,
      },
    });
    expect(level.hiddenCells).toBeDefined();
    expect(isValidPath(profile.rows, profile.columns, level.solutionPath)).toBe(true);
  });
});

describe('endless lives', () => {
  it('shows up to three hearts and switches to a multiplier above three', () => {
    expect(formatLives(3)).toBe('♥♥♥');
    expect(formatLives(2)).toBe('♥♥');
    expect(formatLives(4)).toBe('♥X4');
    expect(formatLives(0)).toBe('♥X0');
  });
});

describe('video statistics', () => {
  it('records and validates an endless-stage reward placement', () => {
    const record = createVideoView('endless-stage-complete', 4, new Date('2026-07-10T00:00:00.000Z'));
    expect(videoPlacementLabel(record.placement)).toBe('无尽模式 · 阶段结算奖励');
    expect(parseVideoViews(JSON.stringify([record]))).toEqual([record]);
    expect(parseVideoViews('{broken')).toEqual([]);
  });

  it('labels normal and endless failure continue placements', () => {
    expect(videoPlacementLabel('normal-life-depleted')).toBe('普通模式 · 生命耗尽续关');
    expect(videoPlacementLabel('endless-life-depleted')).toBe('无尽模式 · 生命耗尽续关');
  });

  it('groups views by ad placement instead of individual history entries', () => {
    const records = [
      createVideoView('normal-life-depleted'),
      createVideoView('normal-life-depleted'),
      createVideoView('endless-stage-complete', 1),
    ];
    expect(groupVideoViews(records)).toEqual([
      { placement: 'endless-stage-complete', count: 1 },
      { placement: 'normal-life-depleted', count: 2 },
    ]);
  });
});
