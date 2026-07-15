import { describe, expect, it } from 'vitest';
import { findPureLuckAlternative } from '../../game/pureLuck';
import { BoardShape, cellKey } from '../../game/types';
import {
  countEditorPathCrossings,
  findEditorPath,
  randomizeEditorPath,
  scoreEditorPathVariety,
} from './findEditorPath';
import { LevelEditorModel } from './LevelEditorModel';

describe('level editor path generation', () => {
  it('uses algorithm 2 and the requested generation defaults for a new editor level', () => {
    const model = new LevelEditorModel();

    expect(model.algorithmSelection.id).toBe('algorithm-2');
    expect(model.algorithmSelection.parameters).toMatchObject({
      targetCrossings: 20,
      turnProbability: 40,
      hiddenPercent: 50,
    });
  });

  it('finds a one-stroke path for a connected painted shape', () => {
    const active = new Set(['0,0', '1,0', '2,0', '2,1', '1,1', '0,1']);
    const path = findEditorPath(2, 3, active);
    expect(path).not.toBeNull();
    expect(path).toHaveLength(active.size);
    expect(new Set((path ?? []).map((cell) => `${cell.x},${cell.y}`))).toEqual(active);
    expect((path ?? []).every((cell, index, cells) => {
      if (index === 0) return true;
      const previous = cells[index - 1];
      return Math.abs(cell.x - previous.x) <= 1 && Math.abs(cell.y - previous.y) <= 1;
    })).toBe(true);
  });

  it('finds a path using honeycomb six-neighbor rules', () => {
    const active = new Set(['0,0', '1,0', '0,1', '1,1', '0,2', '1,2']);
    const path = findEditorPath(3, 2, active, 'hex');
    expect(path).toHaveLength(active.size);
  });

  it('algorithm 2 saves a fixed hidden layout with no equivalent complete path', () => {
    const model = new LevelEditorModel();
    for (let index = 0; index < 5; index += 1) model.changeSize(-1);
    model.fill();
    model.setAlgorithm('algorithm-2');

    expect(model.generatePath()).toBe(true);
    const level = model.createLevel(101);
    expect(level?.algorithm?.id).toBe('algorithm-2');
    expect(level?.algorithm?.parameters.turnProbability).toBe(40);
    expect(level?.hiddenCells).toBeDefined();
    const hidden = new Set(level?.hiddenCells?.map(cellKey));
    expect(findPureLuckAlternative(level?.solutionPath ?? [], hidden, BoardShape.Square)).toBeNull();
  });

  it('varied generation honors the crossing ceiling while preferring turns', () => {
    const active = new Set<string>();
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) active.add(`${x},${y}`);
    }
    const path = findEditorPath(5, 5, active, 'square', 3, 17, {
      style: 'varied',
      crossingMode: 'maximum',
      turnProbability: 100,
      maxNodes: 60000,
    });

    expect(path).toHaveLength(25);
    expect(new Set((path ?? []).map((cell) => `${cell.x},${cell.y}`))).toEqual(active);
    expect(countEditorPathCrossings(path ?? [], 'square')).toBeLessThanOrEqual(3);

    const directions = (path ?? []).slice(1).map((cell, index) => {
      const previous = path![index];
      return `${Math.sign(cell.x - previous.x)},${Math.sign(cell.y - previous.y)}`;
    });
    let longestStraightRun = 1;
    let currentRun = 1;
    directions.slice(1).forEach((direction, index) => {
      if (direction === directions[index]) currentRun += 1;
      else currentRun = 1;
      longestStraightRun = Math.max(longestStraightRun, currentRun);
    });
    expect(longestStraightRun).toBeLessThanOrEqual(3);
  });

  it('treats the crossing setting as a maximum instead of a required target', () => {
    const straightPath = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ];

    expect(scoreEditorPathVariety(straightPath, 'square', 5, 'maximum'))
      .toBeLessThan(scoreEditorPathVariety(straightPath, 'square', 5, 'target'));
  });

  it('does not penalize crossings below the maximum', () => {
    const noCrossingPath = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ];
    const oneCrossingPath = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    ];

    expect(countEditorPathCrossings(noCrossingPath, 'square')).toBe(0);
    expect(countEditorPathCrossings(oneCrossingPath, 'square')).toBe(1);
    expect(scoreEditorPathVariety(oneCrossingPath, 'square', 3, 'maximum'))
      .toBe(scoreEditorPathVariety(noCrossingPath, 'square', 3, 'maximum'));
  });

  it('varies the starting cell instead of always preferring board corners', () => {
    const active = new Set<string>();
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) active.add(`${x},${y}`);
    }
    const starts = Array.from({ length: 6 }, (_, generationIndex) =>
      findEditorPath(5, 5, active, 'square', 4, generationIndex, {
        style: 'varied',
        crossingMode: 'maximum',
        turnProbability: 65,
        maxNodes: 60000,
      })?.[0]);

    expect(new Set(starts.map((cell) => cell && `${cell.x},${cell.y}`)).size).toBeGreaterThan(1);
    expect(starts.every((cell) => cell && cell.x > 0 && cell.x < 4 && cell.y > 0 && cell.y < 4))
      .toBe(true);
  });

  it('produces substantially different complete paths across generation seeds', () => {
    const active = new Set<string>();
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) active.add(`${x},${y}`);
    }
    const signatures = Array.from({ length: 6 }, (_, generationIndex) =>
      findEditorPath(5, 5, active, 'square', 4, generationIndex, {
        style: 'varied',
        crossingMode: 'maximum',
        turnProbability: 65,
        maxNodes: 60000,
      })?.map((cell) => `${cell.x},${cell.y}`).join('|'));

    expect(new Set(signatures).size).toBeGreaterThanOrEqual(5);
  });

  it('randomizes a complete path without breaking coverage, adjacency, or the crossing cap', () => {
    const active = new Set<string>();
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) active.add(`${x},${y}`);
    }
    const source = findEditorPath(5, 5, active, 'square', 2, 23, {
      crossingMode: 'maximum',
    });
    const randomized = randomizeEditorPath(source ?? [], 'square', 2, 941, 65);

    expect(randomized).toHaveLength(25);
    expect(new Set(randomized.map((cell) => `${cell.x},${cell.y}`))).toEqual(active);
    expect(randomized.every((cell, index) => index === 0
      || Math.abs(cell.x - randomized[index - 1].x) <= 1
        && Math.abs(cell.y - randomized[index - 1].y) <= 1)).toBe(true);
    expect(countEditorPathCrossings(randomized, 'square')).toBeLessThanOrEqual(2);
    expect(randomized.map((cell) => `${cell.x},${cell.y}`).join('|'))
      .not.toBe(source?.map((cell) => `${cell.x},${cell.y}`).join('|'));
  });

});
