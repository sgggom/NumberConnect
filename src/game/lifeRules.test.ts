import { describe, expect, it } from 'vitest';
import { hasUnlimitedLives, type LifeRulePlayContext } from './lifeRules';

describe('gameplay life rules', () => {
  it('gives only daily challenges unlimited lives', () => {
    const contexts: LifeRulePlayContext[] = ['normal', 'collection', 'daily', 'bead'];
    expect(contexts.map((context) => [context, hasUnlimitedLives(context)])).toEqual([
      ['normal', false],
      ['collection', false],
      ['daily', true],
      ['bead', false],
    ]);
  });
});
