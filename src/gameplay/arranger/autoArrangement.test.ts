import { describe, expect, it } from 'vitest';
import { BoardShape } from '../../game/types';
import type { ArrangementBoardFamily, ArrangementLibraryLevel } from './levelArrangement';
import {
  DEFAULT_AUTO_ARRANGEMENT_FORM,
  generateAutoArrangement,
  parseDifficultyIdRange,
  parseFormationIdRange,
} from './autoArrangement';

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
    expect(parseDifficultyIdRange('1-3,8')).toEqual([1, 2, 3, 8]);
  });

  it('creates the configured boards per level and respects path cooldown', () => {
    const groups = generateAutoArrangement([family(1, [1, 2]), family(2, [3, 4])], {
      levelCount: 4,
      boardsPerLevel: 2,
      pathRepeatInterval: 2,
      occlusionPreference: 'small',
      stages: [{ formationIds: [1], difficultyIds: [1, 2] }, { formationIds: [2], difficultyIds: [1, 2] }],
      randomSource: () => 0,
    });
    expect(groups).toHaveLength(4);
    expect(groups.every((group) => group.levelIds.length === 2)).toBe(true);
    expect(groups[0].levelIds).toEqual(['level_1_1_1', 'level_2_3_1']);
    expect(groups[1].levelIds).toEqual(['level_1_2_1', 'level_2_4_1']);
    expect(groups[2].levelIds).toEqual(['level_1_1_2', 'level_2_3_2']);
  });

  it('rejects an impossible path interval without returning partial groups', () => {
    expect(() => generateAutoArrangement([family(1, [1])], {
      levelCount: 2,
      boardsPerLevel: 1,
      pathRepeatInterval: 100,
      occlusionPreference: 'random',
      stages: [{ formationIds: [1], difficultyIds: [1, 2] }],
    })).toThrow('无法满足路径间隔');
  });

  it('requires exactly one formation range for every board stage', () => {
    expect(() => generateAutoArrangement([family(1, [1]), family(2, [2])], {
      levelCount: 1,
      boardsPerLevel: 2,
      pathRepeatInterval: 0,
      occlusionPreference: 'random',
      stages: [{ formationIds: [1, 2], difficultyIds: [1, 2] }],
    })).toThrow('必须配置 2 个棋盘阶段');
  });

  it('prefers large, medium, or small consecutive occlusion counts', () => {
    const scoredFamily = family(1, [1, 2, 3]);
    [1, 5, 9].forEach((score, pathIndex) => {
      scoredFamily.paths[pathIndex].difficulties.forEach((difficulty) => {
        difficulty.variants.forEach((level) => {
          level.pathMetrics.consecutiveOcclusionCount = score;
        });
      });
    });
    const firstFor = (occlusionPreference: 'large' | 'medium' | 'small'): string => (
      generateAutoArrangement([scoredFamily], {
        levelCount: 1,
        boardsPerLevel: 1,
        pathRepeatInterval: 0,
        occlusionPreference,
        stages: [{ formationIds: [1], difficultyIds: [1, 2] }],
        randomSource: () => occlusionPreference === 'large' ? .999 : occlusionPreference === 'medium' ? .5 : 0,
      })[0].levelIds[0]
    );
    expect(firstFor('large')).toMatch(/^level_1_3_/);
    expect(firstFor('medium')).toMatch(/^level_1_2_/);
    expect(firstFor('small')).toMatch(/^level_1_1_/);
  });

  it('rejects a requested level count larger than the stage pools can provide', () => {
    expect(() => generateAutoArrangement([family(1, [1])], {
      levelCount: 3,
      boardsPerLevel: 1,
      pathRepeatInterval: 0,
      occlusionPreference: 'random',
      stages: [{ formationIds: [1], difficultyIds: [1, 2] }],
    })).toThrow('最多可生成 2 关');
  });

  it('limits each board stage to its configured difficulty range', () => {
    const groups = generateAutoArrangement([family(1, [1]), family(2, [2])], {
      levelCount: 1,
      boardsPerLevel: 2,
      pathRepeatInterval: 0,
      occlusionPreference: 'small',
      stages: [
        { formationIds: [1], difficultyIds: [1] },
        { formationIds: [2], difficultyIds: [2] },
      ],
      randomSource: () => 0,
    });
    expect(groups[0].levelIds).toEqual(['level_1_1_1', 'level_2_2_2']);
  });

  it('randomly chooses within an allowed range instead of following source order', () => {
    const config = {
      levelCount: 1,
      boardsPerLevel: 1,
      pathRepeatInterval: 0,
      occlusionPreference: 'random' as const,
      stages: [{ formationIds: [1], difficultyIds: [1, 2] }],
    };
    const first = generateAutoArrangement([family(1, [1, 2])], { ...config, randomSource: () => 0 });
    const last = generateAutoArrangement([family(1, [1, 2])], { ...config, randomSource: () => .999 });
    expect(first[0].levelIds[0]).not.toBe(last[0].levelIds[0]);
  });

  it('keeps the fixed defaults used by the current 400-level layout', () => {
    expect(DEFAULT_AUTO_ARRANGEMENT_FORM).toMatchObject({
      levelCount: 400,
      boardsPerLevel: 4,
      pathRepeatInterval: 100,
      stages: [
        { formationRange: '44,45,54', difficultyRange: '3,4,5' },
        { formationRange: '44,45,54,55,56', difficultyRange: '3,4,5' },
        { formationRange: '44,45,54,55,56,57,66', difficultyRange: '4,5,6' },
        { formationRange: '67,68,77,78,79,88,89', difficultyRange: '5,6,7' },
      ],
    });
  });
});
