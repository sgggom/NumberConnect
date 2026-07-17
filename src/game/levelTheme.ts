const LEVEL_BALL_COLORS = [
  0x173f73,
  0x553c8c,
  0x126b68,
  0x8b3f5d,
  0x8a5225,
  0x2e6a4e,
  0x743b6e,
  0x285f87,
] as const;

const levelColorIndex = (levelId: number): number => {
  const normalizedLevelId = Number.isFinite(levelId) ? Math.trunc(levelId) : 1;
  return ((normalizedLevelId - 1) % LEVEL_BALL_COLORS.length + LEVEL_BALL_COLORS.length)
    % LEVEL_BALL_COLORS.length;
};

export const levelBallColor = (levelId: number): number => (
  LEVEL_BALL_COLORS[levelColorIndex(levelId)]
);

export const levelBallColorCss = (levelId: number): string => (
  `#${levelBallColor(levelId).toString(16).padStart(6, '0')}`
);
