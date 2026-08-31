import { describe, expect, it } from 'vitest';
import {
  formationIdAtDifficulty,
  parseFormationId,
  parseThreeModeLevelConfiguration,
  parseThreeModeLevelConfigurationText,
  parseThreeModeLevelLibrary,
  resolveThreeModeStage,
  validateCompleteDifficultyFamilies,
  validateThreeModeConfigurationLibrary,
} from './threeModeLevelData';

const board = (hidden: number) => ({ data: [[1, hidden, 3]] });

const libraryPayload = {
  level_33_7_1: board(-2),
  level_33_7_5: board(-2),
  level_33_7_10: board(-2),
  level_33_8_4: board(-2),
  level_33_9_6: board(-2),
  guide_41_1: { data: [[1, 2, 3, 4]] },
};

describe('three-mode level data', () => {
  it('reads the default difficulty from the final formation ID segment', () => {
    expect(parseFormationId('level_812_600_10')).toEqual({
      id: 'level_812_600_10',
      familyId: 'level_812_600',
      boardId: 812,
      pathId: 600,
      difficulty: 10,
    });
    expect(formationIdAtDifficulty('level_812_600_10', 1)).toBe('level_812_600_1');
  });

  it('treats every configured formation as one stage', () => {
    const [configured] = parseThreeModeLevelConfiguration({
      level_12: {
        data: [
          'level_33_7_5',
          'level_33_8_4',
          'level_33_9_6',
        ],
      },
    });

    expect(configured.id).toBe(12);
    expect(configured.stages).toHaveLength(3);
    expect(configured.stages.map(({ formationId }) => formationId)).toEqual([
      'level_33_7_5', 'level_33_8_4', 'level_33_9_6',
    ]);
  });

  it('parses the tab-separated production configuration format', () => {
    const levels = parseThreeModeLevelConfigurationText([
      'id\t"levelName"',
      '1\t[guide_41_1,level_33_7_5]',
      '2\t[level_33_8_4]',
    ].join('\n'));
    expect(levels[0].stages.map(({ formationId }) => formationId)).toEqual([
      'guide_41_1', 'level_33_7_5',
    ]);
  });

  it('uses the configured suffix by default and swaps only difficulty for dynamic play', () => {
    const library = parseThreeModeLevelLibrary(libraryPayload);
    const [configured] = parseThreeModeLevelConfiguration({
      level_1: { data: ['level_33_7_5'] },
    });

    validateThreeModeConfigurationLibrary(library, [configured]);
    expect(resolveThreeModeStage(library, configured, { stage: 1 })).toMatchObject({
      formationId: 'level_33_7_5',
      defaultDifficulty: 5,
      difficulty: 5,
    });
    expect(resolveThreeModeStage(library, configured, { stage: 1, targetDifficulty: 10 })).toMatchObject({
      formationId: 'level_33_7_10',
      defaultDifficulty: 5,
      difficulty: 10,
    });
  });

  it('fails clearly when a requested difficulty variant is absent', () => {
    const library = parseThreeModeLevelLibrary(libraryPayload);
    const [configured] = parseThreeModeLevelConfiguration({
      level_1: { data: ['level_33_7_5'] },
    });
    expect(() => resolveThreeModeStage(library, configured, { stage: 1, targetDifficulty: 9 }))
      .toThrow('关卡库缺少 level_33_7_9');
  });

  it('rejects stages containing multiple IDs', () => {
    expect(() => parseThreeModeLevelConfiguration({
      level_1: { data: [['level_33_7_5', 'level_33_8_4']] },
    })).toThrow('必须只包含一个阵型 ID');
  });

  it('can require all ten difficulty variants for every family', () => {
    const library = parseThreeModeLevelLibrary(libraryPayload);
    expect(() => validateCompleteDifficultyFamilies(library)).toThrow('缺少难度');
  });
});
