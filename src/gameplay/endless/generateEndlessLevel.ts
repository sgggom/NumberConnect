import { BoardShape, cellKey, type EndlessStageSettings, type LevelData } from '../../game/types';
import { selectHiddenCells } from '../../game/hidden';
import { generateVariedPath } from '../../game/generateVariedPath';

const GENERATION_ATTEMPTS = 3;
// Keep hidden runs short enough for readable live stage transitions.
const REALTIME_MAX_HIDDEN_RUN = 3;

const createFallbackPath = (rows: number, columns: number, seed: number) => {
  const path = Array.from({ length: rows }).flatMap((_, row) => {
    const columnsInRow = Array.from({ length: columns }, (__, column) => column);
    if (row % 2 === 1) columnsInRow.reverse();
    return columnsInRow.map((column) => ({ x: column, y: row }));
  });
  const variation = seed >>> 0;
  if ((variation & 1) !== 0) path.reverse();
  if ((variation & 2) !== 0) path.forEach((cell) => { cell.x = columns - 1 - cell.x; });
  return path;
};

export const generateEndlessLevel = (
  profile: EndlessStageSettings,
  seed: number,
): LevelData => {
  const rows = Math.max(1, Math.floor(profile.rows));
  const columns = Math.max(1, Math.floor(profile.columns));
  const activeCells = Array.from({ length: rows * columns }, (_, index) => ({
    x: index % columns,
    y: Math.floor(index / columns),
  }));
  const activeCellKeys = new Set(activeCells.map(cellKey));
  const fallbackPath = createFallbackPath(rows, columns, seed);
  for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
    const generationIndex = seed + attempt * 1000003;
    const path = generateVariedPath({
      rows,
      columns,
      activeCells: activeCellKeys,
      shape: 'square',
      generationIndex,
      fallbackPath,
      searchMode: 'realtime',
    }, {
      targetCrossings: profile.targetCrossings,
      turnProbability: 40,
    });
    if (!path) continue;
    const hiddenCells = selectHiddenCells(
      path,
      profile.hiddenPercent,
      Math.min(profile.maxHiddenRun, REALTIME_MAX_HIDDEN_RUN),
      profile.maxVisibleRun,
      Math.imul(generationIndex + 1, 104729) ^ path.length ^ 0x4f1bbcdc,
    );

    return {
      levelId: seed,
      boardShape: BoardShape.Square,
      rows,
      columns,
      activeCells,
      solutionPath: path,
      pathSource: 'generated',
      hiddenCells: [...hiddenCells].map((key) => {
        const [x, y] = key.split(',').map(Number);
        return { x, y };
      }),
      algorithm: {
        id: 'endless-varied-path',
        parameters: {
          targetCrossings: profile.targetCrossings,
          turnProbability: 40,
          hiddenPercent: profile.hiddenPercent,
          maxHiddenRun: Math.min(profile.maxHiddenRun, REALTIME_MAX_HIDDEN_RUN),
          maxVisibleRun: profile.maxVisibleRun,
        },
      },
    };
  }

  throw new Error(`无法生成 ${columns} × ${rows} 的无尽关卡。`);
};
