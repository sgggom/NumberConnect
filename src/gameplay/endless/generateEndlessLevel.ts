import { BoardShape, cellKey, type EndlessStageSettings, type LevelData } from '../../game/types';
import {
  createEditorAlgorithm,
  runEditorAlgorithm,
  serializeEditorAlgorithm,
} from '../editor/algorithms';

const GENERATION_ATTEMPTS = 3;
// Algorithm 2's default cap keeps its uniqueness check fast enough for live stage transitions.
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
  const defaults = createEditorAlgorithm('algorithm-2');
  if (defaults.id !== 'algorithm-2') throw new Error('无法加载算法二。');

  const algorithm = {
    ...defaults,
    parameters: {
      ...defaults.parameters,
      targetCrossings: profile.targetCrossings,
      hiddenPercent: profile.hiddenPercent,
      maxHiddenRun: Math.min(profile.maxHiddenRun, REALTIME_MAX_HIDDEN_RUN),
      maxVisibleRun: profile.maxVisibleRun,
    },
  };

  for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
    const result = runEditorAlgorithm(algorithm, {
      rows,
      columns,
      activeCells: activeCellKeys,
      shape: 'square',
      generationIndex: seed + attempt * 1000003,
      fallbackPath,
      searchMode: 'realtime',
    });
    if (!result) continue;

    return {
      levelId: seed,
      boardShape: BoardShape.Square,
      rows,
      columns,
      activeCells,
      solutionPath: result.path,
      pathSource: 'generated',
      hiddenCells: result.hiddenCells,
      algorithm: serializeEditorAlgorithm(algorithm),
    };
  }

  throw new Error(`算法二无法生成 ${columns} × ${rows} 的无尽关卡。`);
};
