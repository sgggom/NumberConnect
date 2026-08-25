export type LifeRulePlayContext = 'normal' | 'collection' | 'daily' | 'bead';

export const hasUnlimitedLives = (playContext: LifeRulePlayContext): boolean => (
  playContext === 'daily'
);
