import { describe, expect, it } from 'vitest';
import { hiddenIntroductionDifficulties } from './hiddenDifficulty';

const tier = (difficultyId: number, data: number[][]) => ({ difficultyId, levelData: { data } });

describe('hidden introduction difficulty', () => {
  it('keeps inherited labels and identifies each newly hidden position independent of input order', () => {
    const result = hiddenIntroductionDifficulties([
      tier(3, [[1, -2, -3, -4, 5]]),
      tier(1, [[1, -2, 3, 4, 5]]),
      tier(2, [[1, -2, -3, 4, 5]]),
    ]);
    expect([...result]).toEqual([['1,0', 1], ['2,0', 2], ['3,0', 3]]);
  });

  it('does not guess across missing earlier tiers or conflicting variants', () => {
    expect(hiddenIntroductionDifficulties([tier(3, [[1, -2]])]).size).toBe(0);
    expect(hiddenIntroductionDifficulties([
      tier(1, [[1, 2]]), tier(1, [[1, -2]]), tier(2, [[1, -2]]),
    ]).size).toBe(0);
  });
});
