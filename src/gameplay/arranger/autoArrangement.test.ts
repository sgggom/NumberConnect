import { describe, expect, it } from 'vitest';
import type { ArrangementBoardFamily, ArrangementLibraryLevel } from './levelArrangement';
import {
  DEFAULT_AUTO_ARRANGEMENT_FORM,
  generateAutoArrangement,
  parseDifficultyIdRange,
  parseFormationIdRange,
} from './autoArrangement';

const entry = (formationId: number | string, pathId: number, difficultyId: number): ArrangementLibraryLevel => ({
  id: `level_${formationId}_${pathId}_${difficultyId}`,
  boardKey: `board-${formationId}`,
  pathKey: `path-${formationId}-${pathId}`,
  shapeName: '正方形',
  sourceRow: (typeof formationId === 'number' ? formationId : 0) * 100 + pathId * 10 + difficultyId,
  sourceName: `level_${formationId}_${pathId}_${difficultyId}`,
  formationId,
  pathId,
  difficultyId,
  configId: 'path_2_2',
  difficulty: difficultyId,
  pathMetrics: { directionRatios: {} },
  difficultyMetrics: {},
  parameterValues: [],
  rows: 1,
  columns: 1,
  levelData: { data: [[1]] },
});

const family = (formationId: number | string, pathIds: number[]): ArrangementBoardFamily => {
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
  it('keeps each named range as one option while accepting mixed numeric ranges', () => {
    expect(parseFormationIdRange('44,[n1 ~ n20]，55,[n30~n40],1-2,n50')).toEqual([
      '[n1~n20]', '[n30~n40]', 1, 2, 44, 55, 'n50',
    ].sort((left, right) => String(left).localeCompare(String(right), 'en', { numeric: true })));
    expect(() => parseFormationIdRange('[n20~n1]')).toThrow('起始值');
    expect(() => parseFormationIdRange('[n1~m20]')).toThrow('前缀');
    expect(() => parseFormationIdRange('[n1~n20')).toThrow('无法识别');
  });

  it('treats multiple shape ranges and numeric IDs as equal candidate options', () => {
    const families = [family(44, [1]), family('n1', [1]), family('n20', [1]), family('n30', [1]), family('n99', [1])];
    const pick = (groupRandom: number): string => {
      const randomValues = [groupRandom, 0];
      return generateAutoArrangement(families, {
        levelCount: 1, boardsPerLevel: 1, pathRepeatInterval: 0, occlusionPreference: 'random',
        stages: [{ formationIds: [44, '[n1~n20]', '[n30~n40]'], difficultyIds: [2] }],
        randomSource: () => randomValues.shift() ?? 0,
      })[0].levelIds[0];
    };
    expect(pick(0)).toBe('level_44_1_2');
    expect(pick(.4)).toBe('level_n1_1_2');
    expect(pick(.8)).toBe('level_n30_1_2');
  });

  it('handles overlapping shape ranges without reusing levels or bypassing path cooldown', () => {
    const config = {
      levelCount: 4, boardsPerLevel: 1, pathRepeatInterval: 2, occlusionPreference: 'random' as const,
      stages: [{ formationIds: ['[n1~n2]', '[n2~n3]'], difficultyIds: [1, 2] }],
      randomSource: () => 0,
    };
    const groups = generateAutoArrangement([family('n1', [1]), family('n2', [1])], config);
    expect(groups.map((group) => group.levelIds[0])).toEqual([
      'level_n1_1_1', 'level_n2_1_1', 'level_n1_1_2', 'level_n2_1_2',
    ]);
    expect(() => generateAutoArrangement([family('n1', [1])], {
      ...config, levelCount: 1, stages: [{ formationIds: ['[n30~n40]'], difficultyIds: [1] }],
    })).toThrow('找不到阵型：[n30~n40]');
  });

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

  it.each(['rightEmptyPreference', 'lowerRightEmptyPreference'] as const)('supports large, medium, small and random for %s', (preferenceKey) => {
    const scoredFamily = family(1, [1, 2, 3]);
    const metricKey = preferenceKey === 'rightEmptyPreference' ? 'rightEmptyCount' : 'lowerRightEmptyCount';
    [1, 5, 9].forEach((score, index) => {
      scoredFamily.paths[index].difficulties.forEach(({ variants }) => {
        variants.forEach((level) => { level.difficultyMetrics[metricKey] = score; });
      });
    });
    const pick = (preference: 'large' | 'medium' | 'small' | 'random', random = 0) => generateAutoArrangement([scoredFamily], {
      levelCount: 1, boardsPerLevel: 1, pathRepeatInterval: 0,
      occlusionPreference: 'random', [preferenceKey]: preference,
      stages: [{ formationIds: [1], difficultyIds: [1] }], randomSource: () => random,
    })[0].levelIds[0];
    expect(pick('large')).toBe('level_1_3_1');
    expect(pick('medium')).toBe('level_1_2_1');
    expect(pick('small', .999)).toBe('level_1_1_1');
    expect(pick('random')).toBe('level_1_1_1');
    expect(pick('random', .999)).toBe('level_1_3_1');
  });

  it('applies lower-right, right, then occlusion priority and respects cooldown', () => {
    const scoredFamily = family(1, [1, 2, 3, 4]);
    [[9, 1, 0], [9, 5, 0], [8, 100, 100], [9, 5, 10]].forEach(([lowerRight, right, occlusion], index) => {
      scoredFamily.paths[index].difficulties.forEach(({ variants }) => {
        variants.forEach((level) => {
          level.difficultyMetrics = { lowerRightEmptyCount: lowerRight, rightEmptyCount: right };
          level.pathMetrics.consecutiveOcclusionCount = occlusion;
        });
      });
    });
    const groups = generateAutoArrangement([scoredFamily], {
      levelCount: 4, boardsPerLevel: 1, pathRepeatInterval: 10,
      lowerRightEmptyPreference: 'large', rightEmptyPreference: 'large', occlusionPreference: 'large',
      stages: [{ formationIds: [1], difficultyIds: [1, 2] }], randomSource: () => 0,
    });
    expect(groups.map(({ levelIds }) => levelIds[0])).toEqual([
      'level_1_4_1', 'level_1_2_1', 'level_1_1_1', 'level_1_3_1',
    ]);
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

  it('keeps the fixed defaults used by the current 500-level layout', () => {
    expect(DEFAULT_AUTO_ARRANGEMENT_FORM).toMatchObject({
      levelCount: 500,
      boardsPerLevel: 3,
      pathRepeatInterval: 500,
      occlusionPreference: 'small',
      rightEmptyPreference: 'small',
      lowerRightEmptyPreference: 'small',
      stages: [
        { formationRange: '[n1~n50]', difficultyRange: '3,4,5' },
        { formationRange: '56,57,58,59,66,67,68,77', difficultyRange: '4,5,6' },
        { formationRange: '69,610,78,79,710,711', difficultyRange: '4,5,6' },      ],
    });
  });
});
