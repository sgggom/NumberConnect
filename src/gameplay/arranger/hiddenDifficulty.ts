import type { ArrangementLibraryLevel } from './levelArrangement';

type DifficultyLevel = Pick<ArrangementLibraryLevel, 'difficultyId' | 'difficulty' | 'levelData'>;

/** Missing or ambiguous earlier variants cannot establish an exact introduction tier. */
export function hiddenIntroductionDifficulties(levels: readonly DifficultyLevel[]): Map<string, number> {
  const tiers = new Map<number, DifficultyLevel[]>();
  for (const level of levels) {
    const tier = level.difficultyId ?? level.difficulty;
    if (tier === undefined || !Number.isInteger(tier) || tier < 1) continue;
    tiers.set(tier, [...(tiers.get(tier) ?? []), level]);
  }
  const result = new Map<string, number>();
  for (const tier of [...tiers.keys()].sort((a, b) => a - b)) {
    const variants = tiers.get(tier)!;
    variants[0].levelData.data.forEach((row, y) => row.forEach((value, x) => {
      const key = `${x},${y}`;
      if (value >= 0 || result.has(key)) return;
      if (!variants.every((level) => level.levelData.data[y]?.[x] === value)) return;
      for (let earlier = 1; earlier < tier; earlier++) {
        const previous = tiers.get(earlier);
        if (!previous?.every((level) => level.levelData.data[y]?.[x] === -value)) return;
      }
      result.set(key, tier);
    }));
  }
  return result;
}
