import { describe, expect, it } from 'vitest';
import { arrangementBoardSize, earlyBoardSizes, preferEarlyBoardSize } from './earlyBoardProgression';
import { arrangementBoardFamilies, type ArrangementLibraryIndex } from './levelArrangement';
import { generateAutoArrangement } from './autoArrangement';

const entry = (formation: number, size: number, path = 1): ArrangementLibraryIndex => ({
  id: `level_${formation}_${path}_1`, formationId: formation, pathId: path, difficultyId: 1, difficulty: 1,
  sourceName: '', sourceRow: path, configId: '', shapeName: '', boardKey: `b${formation}`, pathKey: `p${formation}:${path}`,
  rows: 10, columns: 10, pathMetrics: { connectionCount: size - 1, directionRatios: {} }, difficultyMetrics: {},
});

describe('early board size progression', () => {
  it('uses smallest, small, medium bands then releases the size preference at level 21', () => {
    const sizes = [10, 20, 30, 40, 50, 60, 70, 80];
    expect(earlyBoardSizes(sizes, 5)).toEqual([10]);
    expect(earlyBoardSizes(sizes, 6)).toEqual([20, 30, 40]);
    expect(earlyBoardSizes(sizes, 10)).toEqual([20, 30, 40]);
    expect(earlyBoardSizes(sizes, 11)).toEqual([30, 40, 50, 60]);
    expect(earlyBoardSizes(sizes, 20)).toEqual([30, 40, 50, 60]);
    expect(earlyBoardSizes(sizes, 21)).toEqual(sizes);
  });

  it('counts active digits rather than the enclosing rectangle and handles narrow pools', () => {
    expect(arrangementBoardSize(entry(1, 12))).toBe(12);
    expect(earlyBoardSizes([10], 11)).toEqual([10]);
    expect(earlyBoardSizes([10, 20], 6)).toEqual([20]);
    expect(earlyBoardSizes([10, 20], 11)).toEqual([20]);
  });

  it('samples size tiers so later bands do not always select the smallest or most numerous tier', () => {
    const available = Array.from({ length: 100 }, (_, index) => ({ level: entry(1, 20, index + 1) }));
    available.push({ level: entry(2, 30) }, { level: entry(3, 40) });
    expect(preferEarlyBoardSize(available, [10, 20, 30, 40, 50, 60, 70, 80], 6, () => 0.5)[0].level.formationId).toBe(2);
    expect(preferEarlyBoardSize(available, [10, 20, 30, 40, 50, 60, 70, 80], 6, () => 0.999)[0].level.formationId).toBe(3);
  });

  it('widens size only among candidates remaining after hard constraints', () => {
    const available = [{ level: entry(2, 20) }, { level: entry(3, 30) }];
    expect(preferEarlyBoardSize(available, [10, 20, 30], 1, () => 0)[0].level.formationId).toBe(2);
    expect(preferEarlyBoardSize(available, [10, 20, 30], 21, () => 0)).toBe(available);
  });

  it('progresses each configured stage independently without reordering stages', () => {
    const levels = Array.from({ length: 8 }, (_, i) => Array.from({ length: 25 }, (_, j) => entry(i + 1, (i + 1) * 10, j + 1))).flat();
    const byId = new Map(levels.map((level) => [level.id, level]));
    const groups = generateAutoArrangement(arrangementBoardFamilies(levels), {
      levelCount: 21, boardsPerLevel: 2, pathRepeatInterval: 0, occlusionPreference: 'random',
      stages: [{ formationIds: [1, 2, 3, 4], difficultyIds: [1] }, { formationIds: [5, 6, 7, 8], difficultyIds: [1] }],
      randomSource: () => 0.999,
    });
    for (let index = 0; index < groups.length; index += 1) {
      const expected = index < 5 ? [10, 50] : index < 10 ? [20, 60] : index < 20 ? [30, 70] : [40, 80];
      expect(groups[index].levelIds.map((id) => arrangementBoardSize(byId.get(id)!))).toEqual(expected);
    }
    expect(new Set(groups.flatMap((group) => group.levelIds)).size).toBe(42);
  });
});

it('keeps early stage-three size bands ahead of slope ranking and releases them at level 21', () => {
  const levels: ArrangementLibraryIndex[] = [];
  for (const formation of [1, 2, 3, 4]) {
    for (let path = 1; path <= 25; path++) {
      for (const difficulty of [1, 5, 10]) {
        const level = entry(formation, formation === 4 ? 40 : 10, path);
        level.id = `level_${formation}_${path}_${difficulty}`;
        level.difficulty = level.difficultyId = difficulty;
        level.importedSimulation = { metrics: { errors: difficulty * (formation === 4 ? 10 : 1) }, status: '' };
        levels.push(level);
      }
    }
  }
  const byId = new Map(levels.map((level) => [level.id, level]));
  const groups = generateAutoArrangement(arrangementBoardFamilies(levels), {
    levelCount: 21, boardsPerLevel: 3, pathRepeatInterval: 0, occlusionPreference: 'random',
    stages: [
      { formationIds: [1], difficultyIds: [10] },
      { formationIds: [2], difficultyIds: [10] },
      { formationIds: [3, 4], difficultyIds: [10] },
    ], randomSource: () => 0,
  });
  expect(groups.slice(0, 5).map((group) => byId.get(group.levelIds[2])!.formationId)).toEqual([3, 3, 3, 3, 3]);
  expect(byId.get(groups[20].levelIds[2])!.formationId).toBe(4);
});
