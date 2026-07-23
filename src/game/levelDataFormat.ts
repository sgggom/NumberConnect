import { areNeighborCells } from './topology';
import { BoardShape, cellKey, type Cell, type LevelData } from './types';

export interface CompactLevelData {
  data: number[][];
}

const BACKGROUND_NAMES = ['apple', 'banana', 'orange', 'grapes', 'basket', 'pineapple'] as const;

const levelError = (levelId: number, message: string): Error => (
  new Error(`关卡 ${levelId}：${message}`)
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const assertCellInside = (
  cell: Cell,
  rows: number,
  columns: number,
  levelId: number,
): void => {
  if (
    !Number.isInteger(cell.x)
    || !Number.isInteger(cell.y)
    || cell.x < 0
    || cell.x >= columns
    || cell.y < 0
    || cell.y >= rows
  ) {
    throw levelError(levelId, `格子 (${cell.x}, ${cell.y}) 超出 ${columns}×${rows} 棋盘范围。`);
  }
};

/**
 * 对外关卡格式：
 * - 正整数：显示该数字；
 * - 负整数：隐藏其绝对值对应的数字；
 * - 0：该位置不属于关卡。
 */
export const encodeCompactLevelData = (level: LevelData): CompactLevelData => {
  const { levelId, rows, columns } = level;
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows <= 0 || columns <= 0) {
    throw levelError(levelId, '棋盘行列数必须是正整数。');
  }

  const activeCellKeys = new Set<string>();
  level.activeCells.forEach((cell) => {
    assertCellInside(cell, rows, columns, levelId);
    activeCellKeys.add(cellKey(cell));
  });
  const pathCellKeys = new Set<string>();
  level.solutionPath.forEach((cell) => {
    assertCellInside(cell, rows, columns, levelId);
    pathCellKeys.add(cellKey(cell));
  });
  if (
    pathCellKeys.size !== level.solutionPath.length
    || activeCellKeys.size !== level.activeCells.length
    || pathCellKeys.size !== activeCellKeys.size
    || [...pathCellKeys].some((key) => !activeCellKeys.has(key))
  ) {
    throw levelError(levelId, '完整路径必须无重复地覆盖全部激活格。');
  }

  const hiddenCellKeys = new Set((level.hiddenCells ?? []).map((cell) => {
    assertCellInside(cell, rows, columns, levelId);
    return cellKey(cell);
  }));
  if ([...hiddenCellKeys].some((key) => !pathCellKeys.has(key))) {
    throw levelError(levelId, '隐藏格必须位于完整路径中。');
  }

  const data = Array.from({ length: rows }, () => Array<number>(columns).fill(0));
  level.solutionPath.forEach((cell, index) => {
    const value = index + 1;
    data[cell.y][cell.x] = hiddenCellKeys.has(cellKey(cell)) ? -value : value;
  });
  return { data };
};

export const decodeCompactLevelData = (
  value: unknown,
  levelId: number,
  custom: boolean,
): LevelData => {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !('data' in value)) {
    throw levelError(levelId, 'JSON 对象只能包含 data 字段。');
  }
  if (!Array.isArray(value.data) || value.data.length === 0) {
    throw levelError(levelId, 'data 必须是非空二维数组。');
  }

  const rows = value.data.length;
  const firstRow = value.data[0];
  if (!Array.isArray(firstRow) || firstRow.length === 0) {
    throw levelError(levelId, 'data 的每一行都必须是非空数组。');
  }
  const columns = firstRow.length;
  const pathByNumber: Array<Cell | undefined> = [];
  const activeCells: Cell[] = [];
  const hiddenCells: Cell[] = [];

  value.data.forEach((row, y) => {
    if (!Array.isArray(row) || row.length !== columns) {
      throw levelError(levelId, `data 第 ${y + 1} 行长度不一致。`);
    }
    row.forEach((rawCell, x) => {
      if (!Number.isSafeInteger(rawCell)) {
        throw levelError(levelId, `data[${y}][${x}] 必须是整数。`);
      }
      const cellValue = rawCell as number;
      if (cellValue === 0) return;
      const number = Math.abs(cellValue);
      if (number > rows * columns) {
        throw levelError(levelId, `数字 ${number} 超过棋盘最大格数 ${rows * columns}。`);
      }
      if (pathByNumber[number - 1]) {
        throw levelError(levelId, `数字 ${number} 重复。`);
      }
      const cell = { x, y };
      pathByNumber[number - 1] = cell;
      activeCells.push(cell);
      if (cellValue < 0) hiddenCells.push(cell);
    });
  });

  if (activeCells.length === 0) throw levelError(levelId, 'data 中没有关卡格子。');
  if (
    pathByNumber.length !== activeCells.length
    || pathByNumber.some((cell) => cell === undefined)
  ) {
    throw levelError(levelId, `数字绝对值必须不重复且连续覆盖 1–${activeCells.length}。`);
  }

  const solutionPath = pathByNumber as Cell[];
  const boardShape = rows === columns ? BoardShape.Square : BoardShape.Rectangle;
  solutionPath.forEach((cell, index) => {
    if (index > 0 && !areNeighborCells(solutionPath[index - 1], cell, boardShape)) {
      throw levelError(levelId, `数字 ${index} 与 ${index + 1} 所在格子不相邻。`);
    }
  });

  const backgroundName = BACKGROUND_NAMES[(levelId - 1) % BACKGROUND_NAMES.length];
  return {
    levelId,
    boardShape,
    rows,
    columns,
    activeCells,
    solutionPath,
    pathSource: 'manual',
    hiddenCells,
    backgroundResourcePath: `LevelBackgrounds/${backgroundName}`,
    custom,
  };
};

export const encodeCompactLevelCollection = (
  levels: ReadonlyArray<LevelData>,
): CompactLevelData[] => levels.map(encodeCompactLevelData);

export const decodeCompactLevelCollection = (
  value: unknown,
  custom: boolean,
): LevelData[] => {
  const source = Array.isArray(value) ? value : [value];
  if (source.length === 0) throw new Error('关卡数组不能为空。');
  return source.map((level, index) => decodeCompactLevelData(level, index + 1, custom));
};
