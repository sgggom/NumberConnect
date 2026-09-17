import type { ArrangementLibraryIndex } from './levelArrangement';

export const arrangementBoardSize = (level: ArrangementLibraryIndex): number => (
  level.pathMetrics.connectionCount === undefined
    ? level.rows * level.columns
    : level.pathMetrics.connectionCount + 1
);

/** Distinct sizes, not row counts: a shape with many paths must not dominate the size bands. */
export function earlyBoardSizes(sizes: readonly number[], levelNumber: number): readonly number[] {
  if (levelNumber > 20 || sizes.length < 2) return sizes;
  if (levelNumber <= 5) return sizes.slice(0, 1);
  const last = sizes.length - 1;
  const start = levelNumber <= 10 ? 1 : Math.min(last, Math.max(1, Math.floor(sizes.length * 0.25)));
  const end = levelNumber <= 10
    ? Math.min(last, Math.max(1, Math.ceil(sizes.length * 0.5) - 1))
    : Math.min(last, Math.max(2, Math.ceil(sizes.length * 0.75) - 1));
  return sizes.slice(start, end + 1);
}

export function preferEarlyBoardSize<T extends { level: ArrangementLibraryIndex }>(
  available: T[], poolSizes: readonly number[], levelNumber: number, random: () => number,
): T[] {
  if (levelNumber > 20 || available.length < 2 || poolSizes.length < 2) return available;
  const preferred = earlyBoardSizes(poolSizes, levelNumber);
  const minimum = preferred[0];
  const maximum = preferred[preferred.length - 1];
  const availableSizes = [...new Set(available.map(({ level }) => arrangementBoardSize(level)))].sort((a, b) => a - b);
  let choices = availableSizes.filter((size) => size >= minimum && size <= maximum);
  if (!choices.length) {
    // Cooldowns and unique-level rules have already run. Widen size preference only.
    const distance = (size: number): number => size < minimum ? minimum - size : size - maximum;
    let nearest = Infinity;
    for (const size of availableSizes) nearest = Math.min(nearest, distance(size));
    choices = availableSizes.filter((size) => distance(size) === nearest);
  }
  const chosenSize = choices.length === 1 ? choices[0] : choices[Math.floor(random() * choices.length) % choices.length];
  return available.filter(({ level }) => arrangementBoardSize(level) === chosenSize);
}
