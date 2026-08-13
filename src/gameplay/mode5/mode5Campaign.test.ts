import { describe, expect, it } from 'vitest';
import type { Mode5CampaignLevel } from './mode5Workbook';
import {
  mode5LevelCount,
  mode5LevelProgressForId,
  mode5LevelStartIndex,
} from './mode5Campaign';

const campaign: Mode5CampaignLevel[] = [
  { id: 1, formationIds: [1, 2], stageLevelIds: [1, 2] },
  { id: 2, formationIds: [3, 4, 5, 6], stageLevelIds: [3, 4, 5, 6] },
  { id: 3, formationIds: [9, 7, 8], stageLevelIds: [7, 8, 9] },
];

describe('玩法5配表大关与小阶段', () => {
  it('完全按照配表定义阶段数量和顺序', () => {
    expect(mode5LevelProgressForId(campaign, 1)).toMatchObject({ level: 1, stage: 1, totalStages: 2 });
    expect(mode5LevelProgressForId(campaign, 2)).toMatchObject({ level: 1, stage: 2, totalStages: 2, isFinalStage: true });
    expect(mode5LevelProgressForId(campaign, 3)).toMatchObject({ level: 2, stage: 1, totalStages: 4 });
    expect(mode5LevelProgressForId(campaign, 6)).toMatchObject({ level: 2, stage: 4, totalStages: 4, isFinalStage: true });
    expect(mode5LevelProgressForId(campaign, 9)).toMatchObject({ level: 3, stage: 3, totalStages: 3, isFinalStage: true });
  });

  it('计算配表大关数和起始阶段位置', () => {
    expect(mode5LevelCount(campaign)).toBe(3);
    expect([1, 2, 3].map((level) => mode5LevelStartIndex(campaign, level))).toEqual([0, 2, 6]);
  });
});
