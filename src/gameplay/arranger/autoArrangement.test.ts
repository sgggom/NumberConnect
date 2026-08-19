import { describe, expect, it } from 'vitest';
import { BoardShape } from '../../game/types';
import type { ArrangementBoardFamily, ArrangementLibraryLevel } from './levelArrangement';
import { generateAutoArrangement, parseFormationIdRange } from './autoArrangement';

const entry = (formationId: number, pathId: number, difficultyId: number): ArrangementLibraryLevel => ({
  id: `level_${formationId}_${pathId}_${difficultyId}`,
  boardKey: `board-${formationId}`,
  pathKey: `path-${formationId}-${pathId}`,
  shapeName: '正方形',
  sourceRow: formationId * 100 + pathId * 10 + difficultyId,
  sourceName: `level_${formationId}_${pathId}_${difficultyId}`,
  formationId,
  pathId,
  difficultyId,
  configId: 'path_2_2',
  difficulty: difficultyId,
  pathMetrics: { directionRatios: {} },
  difficultyMetrics: {},
  parameters: [],
  level: {
    levelId: 1,
    boardShape: BoardShape.Square,
    rows: 2,
    columns: 2,
    activeCells: [{ x: 0, y: 0 }],
    solutionPath: [{ x: 0, y: 0 }],
  },
});

const family = (formationId: number, pathIds: number[]): ArrangementBoardFamily => {
  const paths = pathIds.map((pathId) => {
    const difficulties = [1, 2].map((difficultyId) => {
      const representative = entry(formationId, pathId, difficultyId);
      return { difficulty: difficultyId, representative, variants: [representative] };
    });
    return { key: `path-${formationId}-${pathId}`, representative: difficulties[0].representative, difficulties };
  });
  return { key: `board-${formationId}`, representative: paths[0].representative, paths };
};

describe('automatic level arrangement', () => {
  it('parses individual ids and numeric ranges', () => {
    expect(parseFormationIdRange('1-3, 8，10-11')).toEqual([1, 2, 3, 8, 10, 11]);
  });

  it('creates the configured boards per level and respects path cooldown', () => {
    const groups = generateAutoArrangement([family(1, [1, 2]), family(2, [3, 4])], {
      boardsPerLevel: 2,
      pathRepeatInterval: 2,
      stages: [{ startLevel: 1, endLevel: 4, formationIds: [1, 2] }],
    });
    expect(groups).toHaveLength(4);
    expect(groups.every((group) => group.levelIds.length === 2)).toBe(true);
    expect(groups[0].levelIds).toEqual(['level_1_1_1', 'level_1_2_1']);
    expect(groups[1].levelIds).toEqual(['level_2_3_1', 'level_2_4_1']);
    expect(groups[2].levelIds).toEqual(['level_1_1_2', 'level_1_2_2']);
  });

  it('rejects an impossible path interval without returning partial groups', () => {
    expect(() => generateAutoArrangement([family(1, [1])], {
      boardsPerLevel: 1,
      pathRepeatInterval: 100,
      stages: [{ startLevel: 1, endLevel: 2, formationIds: [1] }],
    })).toThrow('无法满足路径间隔');
  });
});
