import type { Mode5CampaignLevel } from './mode5Workbook';

export interface Mode5LevelProgress {
  level: number;
  stage: number;
  totalStages: number;
  stageIndex: number;
  levelStartIndex: number;
  isFinalStage: boolean;
}

export const mode5LevelCount = (campaign: ReadonlyArray<Mode5CampaignLevel>): number => (
  campaign.length
);

export const mode5LevelStartIndex = (
  campaign: ReadonlyArray<Mode5CampaignLevel>,
  level: number,
): number => {
  const target = campaign.find((entry) => entry.id === level);
  if (!target) return 0;
  return campaign.slice(0, campaign.indexOf(target)).reduce(
    (total, entry) => total + entry.stageLevelIds.length,
    0,
  );
};

export const mode5StageLevelId = (
  campaign: ReadonlyArray<Mode5CampaignLevel>,
  level: number,
  stage: number,
): number | undefined => {
  if (!Number.isInteger(stage) || stage < 1) return undefined;
  return campaign.find((entry) => entry.id === level)?.stageLevelIds[stage - 1];
};

export const mode5LevelProgressForId = (
  campaign: ReadonlyArray<Mode5CampaignLevel>,
  levelId: number,
): Mode5LevelProgress => {
  let levelStartIndex = 0;
  for (const level of campaign) {
    const stageIndex = level.stageLevelIds.indexOf(levelId);
    if (stageIndex >= 0) {
      return {
        level: level.id,
        stage: stageIndex + 1,
        totalStages: level.stageLevelIds.length,
        stageIndex: levelStartIndex + stageIndex,
        levelStartIndex,
        isFinalStage: stageIndex === level.stageLevelIds.length - 1,
      };
    }
    levelStartIndex += level.stageLevelIds.length;
  }

  const first = campaign[0];
  return {
    level: first?.id ?? 1,
    stage: 1,
    totalStages: first?.stageLevelIds.length ?? 1,
    stageIndex: 0,
    levelStartIndex: 0,
    isFinalStage: (first?.stageLevelIds.length ?? 1) === 1,
  };
};
