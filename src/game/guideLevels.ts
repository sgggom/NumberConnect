export const DEFAULT_GUIDE_LEVEL_COUNT = 3;
export const MAX_GUIDE_LEVEL_COUNT = 10;

export const normalizeGuideLevelCount = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value)
    ? Math.max(1, Math.min(MAX_GUIDE_LEVEL_COUNT, value)) : DEFAULT_GUIDE_LEVEL_COUNT;

/** Keep authored level IDs (and existing difficulty saves) stable; skip unused guides. */
export const skipUnusedGuideLevels = (levelId: number, guideCount: number): number =>
  levelId > normalizeGuideLevelCount(guideCount) && levelId <= MAX_GUIDE_LEVEL_COUNT
    ? MAX_GUIDE_LEVEL_COUNT + 1 : levelId;
