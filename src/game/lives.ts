export const formatLives = (livesValue: number): string => {
  const lives = Math.max(0, Math.floor(livesValue));
  return lives <= 3
    ? `${'♥'.repeat(lives)}${'♡'.repeat(3 - lives)}`
    : `♥X${lives}`;
};
