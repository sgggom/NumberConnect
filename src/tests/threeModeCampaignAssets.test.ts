import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parseThreeModeLevelConfigurationText,
  parseThreeModeLevelLibrary,
  resolveThreeModeStage,
  validateCompleteDifficultyFamilies,
  validateThreeModeConfigurationLibrary,
} from '../gameplay/adaptive/threeModeLevelData';

describe('三模式正式关卡资产', () => {
  it('完整覆盖1000关配置、全部阶段引用和1–10档难度', () => {
    const library = parseThreeModeLevelLibrary(JSON.parse(readFileSync(
      'public/levels/three-mode-level-library.json',
      'utf8',
    )) as unknown);
    const campaign = parseThreeModeLevelConfigurationText(readFileSync(
      'public/levels/three-mode-level-config.txt',
      'utf8',
    ));

    validateCompleteDifficultyFamilies(library);
    validateThreeModeConfigurationLibrary(library, campaign);
    expect(campaign).toHaveLength(1000);
    expect(campaign[0].stages).toHaveLength(2);
    expect(campaign[1].stages).toHaveLength(3);
    expect(campaign[999].stages).toHaveLength(4);
    expect(resolveThreeModeStage(library, campaign[0], { stage: 1 }).formationId)
      .toBe('guide_41_1');
    expect(resolveThreeModeStage(library, campaign[999], {
      stage: 4,
      targetDifficulty: 10,
    }).formationId).toBe('level_710_408_10');
  });
});
