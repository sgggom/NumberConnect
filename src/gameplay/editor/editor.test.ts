import { describe, expect, it } from 'vitest';
import { findPureLuckAlternative } from '../../game/pureLuck';
import { BoardShape, cellKey } from '../../game/types';
import {
  countEditorPathCrossings,
  findEditorPath,
  randomizeEditorPath,
  scoreEditorPathVariety,
} from './findEditorPath';
import { calculateSquareGridLayout } from './editorGridLayout';
import {
  createThreeEightVisualEvidence,
  solveInitialFormationPath,
  solveRecognizedGridPath,
} from './ImageLevelRecognizer';
import { calculateEditorLevelMetrics } from './levelMetrics';
import { LevelEditorModel } from './LevelEditorModel';

const serpentinePath = (rows: number, columns: number) => Array.from(
  { length: rows * columns },
  (_, index) => {
    const y = Math.floor(index / columns);
    const offset = index % columns;
    return { x: y % 2 === 0 ? offset : columns - offset - 1, y };
  },
);

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

  it('allows random starting cells across both the board edge and interior', () => {
    const active = new Set<string>();
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) active.add(`${x},${y}`);
    }
    const starts = Array.from({ length: 12 }, (_, generationIndex) =>
      findEditorPath(5, 5, active, 'square', 4, generationIndex, {
        style: 'varied',
        crossingMode: 'maximum',
        startMode: 'any',
        turnProbability: 65,
        maxNodes: 60000,
      })?.[0]);

    expect(new Set(starts.map((cell) => cell && `${cell.x},${cell.y}`)).size).toBeGreaterThan(1);
    expect(starts.some((cell) => cell && (cell.x === 0 || cell.x === 4 || cell.y === 0 || cell.y === 4)))
      .toBe(true);
    expect(starts.some((cell) => cell && cell.x > 0 && cell.x < 4 && cell.y > 0 && cell.y < 4))
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

  it('reconstructs an image path from OCR evidence and neighbor constraints', () => {
    const values = [
      34, 35, 37, 40, 39, 44, 43,
      10, 33, 36, 38, 41, 42, 45,
      9, 11, 32, 31, 30, 47, 46,
      7, 8, 12, 18, 29, 28, 48,
      6, 13, 17, 19, 27, 26, 49,
      3, 5, 14, 16, 20, 21, 25,
      4, 2, 1, 15, 22, 23, 24,
    ];
    const evidence = values.map((value) => {
      if (value === 6) return [{ value: 8, confidence: 81 }];
      if (value === 11) return [{ value: 1, confidence: 80 }];
      if (value === 41) return [{ value: 4, confidence: 8 }];
      return [{ value, confidence: 92 }];
    });
    const solved = solveRecognizedGridPath(7, 7, evidence, 3000);

    expect(solved).not.toBeNull();
    expect(solved?.path.map((cellIndex) => values[cellIndex])).toEqual(
      Array.from({ length: 49 }, (_, index) => index + 1),
    );
    expect(solved?.scoreGap).toBeGreaterThan(5);
  });

  it('uses glyph topology to disambiguate swapped 3 and 8 OCR evidence', () => {
    const values = [
      6, 5, 44, 43, 54, 41,
      4, 7, 45, 53, 42, 40,
      3, 8, 46, 48, 52, 39,
      2, 9, 47, 49, 51, 38,
      10, 1, 22, 50, 35, 37,
      11, 12, 21, 23, 34, 36,
      13, 19, 20, 24, 33, 32,
      14, 18, 25, 26, 31, 30,
      15, 16, 17, 27, 28, 29,
    ];
    const threeEvidence = createThreeEightVisualEvidence(3, 64, 1, 0.67, new Map([[8, 78]]));
    const eightEvidence = createThreeEightVisualEvidence(8, 0, 2, 1.05, new Map());
    expect(threeEvidence).toEqual({ value: 3, confidence: 90 });
    expect(eightEvidence).toEqual({ value: 8, confidence: 90 });

    const evidence = values.map((value) => [{ value, confidence: 95 }]);
    evidence[values.indexOf(3)] = [{ value: 8, confidence: 78 }, threeEvidence!];
    evidence[values.indexOf(8)] = [eightEvidence!];
    const solved = solveRecognizedGridPath(9, 6, evidence, 3000);

    expect(solved?.path.map((cellIndex) => values[cellIndex])).toEqual(
      Array.from({ length: 54 }, (_, index) => index + 1),
    );
  });

  it('does not apply 3/8 topology evidence to multi-digit or mismatched glyphs', () => {
    expect(createThreeEightVisualEvidence(3, 64, 0, 1.15, new Map([[31, 66]]))).toBeNull();
    expect(createThreeEightVisualEvidence(3, 64, 1, 0.8, new Map([[31, 66]]))).toBeNull();
    expect(createThreeEightVisualEvidence(3, 64, 2, 0.7, new Map([[8, 78]]))).toBeNull();
    expect(createThreeEightVisualEvidence(3, 20, 1, 0.7, new Map([[8, 78]]))).toBeNull();
    expect(createThreeEightVisualEvidence(8, 80, 1, 0.9, new Map([[3, 70]]))).toBeNull();
  });

  it('reconstructs a 12x12 image path after sizing the board', () => {
    const path = serpentinePath(12, 12);
    const valuesByCell = new Array<number>(144);
    path.forEach((cell, index) => {
      valuesByCell[cell.y * 12 + cell.x] = index + 1;
    });
    const solved = solveRecognizedGridPath(
      12,
      12,
      valuesByCell.map((value) => [{ value, confidence: 96 }]),
      512,
    );

    expect(solved?.path).toEqual(path.map((cell) => cell.y * 12 + cell.x));
  });

  it('reconstructs a complete path from the visible clues of an initial formation', () => {
    const clues: Array<number | null> = [
      null, 36, null, 34, null, 4, null, 7,
      38, null, 41, null, null, 9, null, null,
      null, null, 64, null, null, 1, null, null,
      null, 63, 56, null, 31, null, 13, 11,
      59, 62, 55, null, null, null, null, null,
      60, 61, 52, null, null, null, 28, 17,
      49, null, 53, null, null, null, 20, null,
      50, 48, 47, 25, null, 22, null, null,
    ];
    const clueCellByValue = new Map<number, number>();
    clues.forEach((value, cellIndex) => {
      if (value !== null) clueCellByValue.set(value, cellIndex);
    });
    const solved = solveInitialFormationPath(8, 8, clueCellByValue);

    expect(solved).not.toBeNull();
    clues.forEach((value, cellIndex) => {
      if (value !== null) expect(solved?.path[value - 1]).toBe(cellIndex);
    });
    expect(solved?.ambiguous).toBe(true);
  });

  it('applies a recognized path as a complete manual editor level', () => {
    const model = new LevelEditorModel();
    const path = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 },
      { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
    ];

    expect(model.applyRecognizedPath(3, 3, path)).toBeNull();
    expect(model.hasGeneratedPath).toBe(true);
    expect(model.createLevel(88)).toMatchObject({
      rows: 3,
      columns: 3,
      pathSource: 'manual',
      solutionPath: path,
    });
  });

  it('supports independently sized rectangles and 12x12 recognized boards', () => {
    const model = new LevelEditorModel();
    model.setShape('rectangle');
    model.changeSize(1, 'columns');
    model.changeSize(1, 'rows');
    expect(model.size()).toEqual({ columns: 6, rows: 9 });

    const rectanglePath = serpentinePath(9, 6);
    expect(model.applyRecognizedPath(9, 6, rectanglePath)).toBeNull();
    expect(model.shape).toBe('rectangle');
    expect(model.size()).toEqual({ columns: 6, rows: 9 });

    const squarePath = serpentinePath(12, 12);
    expect(model.applyRecognizedPath(12, 12, squarePath)).toBeNull();
    expect(model.shape).toBe('square');
    expect(model.size()).toEqual({ columns: 12, rows: 12 });
    expect(model.solutionPath).toEqual(squarePath);
  });

  it('fits rectangular editor grids with square cells in either orientation', () => {
    const tall = calculateSquareGridLayout({
      rows: 9,
      columns: 6,
      availableWidth: 568,
      availableHeight: 806,
      columnGap: 8,
      rowGap: 8,
      maxWidth: 760,
      maxHeight: 760,
    });
    expect(tall.cellSize).toBeCloseTo(77.333, 3);
    expect(tall.width).toBeCloseTo(504, 3);
    expect(tall.height).toBeCloseTo(760, 3);

    const wide = calculateSquareGridLayout({
      rows: 6,
      columns: 9,
      availableWidth: 568,
      availableHeight: 806,
      columnGap: 8,
      rowGap: 8,
      maxWidth: 760,
      maxHeight: 760,
    });
    expect(wide.cellSize).toBe(56);
    expect(wide.width).toBe(568);
    expect(wide.height).toBe(376);
  });

  it('preserves blank cells when applying a recognized initial formation', () => {
    const model = new LevelEditorModel();
    const path = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 },
      { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
    ];
    const hiddenCells = [path[2], path[4], path[6]];

    expect(model.applyRecognizedPath(3, 3, path, hiddenCells)).toBeNull();
    expect(model.createLevel(89)?.hiddenCells).toEqual(hiddenCells);
  });

  it('applies a recognized hidden layout without replacing the complete path', () => {
    const model = new LevelEditorModel();
    const path = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 },
      { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
    ];
    const hiddenCells = [path[2], path[4], path[6]];

    expect(model.applyRecognizedPath(3, 3, path)).toBeNull();
    expect(model.applyRecognizedHiddenCells(3, 3, hiddenCells)).toBeNull();
    expect(model.solutionPath).toEqual(path);
    expect(model.createLevel(90)?.hiddenCells).toEqual(hiddenCells);
    expect(model.applyRecognizedHiddenCells(4, 4, hiddenCells)).toBe('隐藏图片尺寸为 4×4，当前关卡为 3×3。');
    expect(model.applyRecognizedHiddenCells(3, 3, [path[0]])).toBe('路径起点和终点必须在隐藏图片中显示。');
  });

  it('classifies straight, right, acute, and obtuse path angles', () => {
    const metricsFor = (path: Array<{ x: number; y: number }>) => calculateEditorLevelMetrics({
      path,
      hiddenCellKeys: new Set(),
      shape: 'square',
    });

    expect(metricsFor([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]).straightContinuations).toBe(1);
    expect(metricsFor([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]).rightAngleTurns).toBe(1);
    expect(metricsFor([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }]).acuteAngleTurns).toBe(1);
    expect(metricsFor([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 1 }]).obtuseAngleTurns).toBe(1);
  });

  it('calculates crossings, hidden ratio, and longest visibility runs', () => {
    const crossing = calculateEditorLevelMetrics({
      path: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 }],
      hiddenCellKeys: new Set(),
      shape: 'square',
    });
    const visibility = calculateEditorLevelMetrics({
      path: Array.from({ length: 7 }, (_, x) => ({ x, y: 0 })),
      hiddenCellKeys: new Set(['2,0', '3,0', '5,0']),
      shape: 'square',
    });

    expect(crossing.pathCrossings).toBe(1);
    expect(visibility.hiddenCount).toBe(3);
    expect(visibility.hiddenRatio).toBeCloseTo(3 / 7);
    expect(visibility.longestHiddenRun).toBe(2);
    expect(visibility.longestVisibleRun).toBe(2);
  });

});
