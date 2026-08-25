import type { LevelData } from '../../game/types';

export const reorderLevelCollection = (
  levels: ReadonlyArray<LevelData>,
  levelId: number,
  targetPosition: number,
): LevelData[] => {
  const sourceIndex = levels.findIndex((level) => level.levelId === levelId);
  const targetIndex = Math.floor(targetPosition) - 1;
  if (
    sourceIndex < 0
    || !Number.isInteger(targetPosition)
    || targetIndex < 0
    || targetIndex >= levels.length
  ) return levels.map((level) => ({ ...level }));

  const reordered = [...levels];
  const [moved] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, moved);
  return reordered.map((level, index) => ({ ...level, levelId: index + 1 }));
};
