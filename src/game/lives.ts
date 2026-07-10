export const formatLives = (livesValue: number): string => {
  const lives = Math.max(0, Math.floor(livesValue));
  if (lives === 0) return '♥X0';
  return lives <= 3 ? '♥'.repeat(lives) : `♥X${lives}`;
};
