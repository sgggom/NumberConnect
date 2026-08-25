export type LifeRulePlayContext = 'normal' | 'collection' | 'daily' | 'editor-playtest' | 'bead';

export const hasUnlimitedLives = (playContext: LifeRulePlayContext): boolean => (
  playContext === 'daily'
);
