import { BoardShape, type Cell, type LevelData } from '../../game/types';
import {
  resolveEditorAlgorithmForShape,
  serializeEditorAlgorithm,
} from './algorithms';
import {
  createAlgorithm4Selection,
  runAlgorithm4,
} from './algorithms/algorithm4';
import type { Algorithm4Selection } from './algorithms/types';
import type { EditorShape } from './types';

export const ALGORITHM4_BATCH_HEADERS = [
  '棋盘形状',
  '行数',
  '列数',
  '最大交叉数量',
  '拐弯概率 %',
  '隐藏比例 %',
  '最长连续隐藏',
  '最长连续显示',
  '生成次数',
] as const;

export const MAX_BATCH_GENERATION_PER_ROW = 100;
export const MAX_BATCH_GENERATION_TOTAL = 500;

export interface Algorithm4BatchConfig {
  sourceRow: number;
  shape: EditorShape;
  rows: number;
  columns: number;
  targetCrossings: number;
  turnProbability: number;
  hiddenPercent: number;
  maxHiddenRun: number;
  maxVisibleRun: number;
  generationCount: number;
}

export interface Algorithm4BatchFailure {
  sourceRow: number;
  generationNumber: number;
}

export interface Algorithm4BatchResult {
  levels: LevelData[];
  failures: Algorithm4BatchFailure[];
}

export type Algorithm4BatchProgress = (
  completed: number,
  total: number,
  sourceRow: number,
) => void;

const HEADER_ALIASES = {
  shape: ['棋盘形状', '形状', 'shape'],
  rows: ['行数', '高度', 'rows', 'row'],
  columns: ['列数', '宽度', 'columns', 'column', 'cols'],
  targetCrossings: ['最大交叉数量', '交叉数量', 'targetcrossings'],
  turnProbability: ['拐弯概率', '路径拐弯概率', 'turnprobability'],
  hiddenPercent: ['隐藏比例', '隐藏占比', 'hiddenpercent'],
  maxHiddenRun: ['最长连续隐藏', '最长隐藏长度', 'maxhiddenrun'],
  maxVisibleRun: ['最长连续显示', '最长显示长度', 'maxvisiblerun'],
  generationCount: ['生成次数', '数量', 'generationcount', 'count'],
} as const;

type HeaderKey = keyof typeof HEADER_ALIASES;

const normalizeHeader = (value: unknown): string => String(value ?? '')
  .trim()
  .toLowerCase()
  .replace(/[\s_%％()（）\-_/]/g, '');

const headerIndexes = (row: ReadonlyArray<unknown>): Record<HeaderKey, number> => {
  const normalized = row.map(normalizeHeader);
  return Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([key, aliases]) => [
      key,
      normalized.findIndex((header) => aliases.some((alias) => normalizeHeader(alias) === header)),
    ]),
  ) as Record<HeaderKey, number>;
};

const isBlankRow = (row: ReadonlyArray<unknown>): boolean => row.every(
  (value) => value === null || value === undefined || String(value).trim() === '',
);

const cellLabel = (sourceRow: number, header: string): string => `第 ${sourceRow} 行“${header}”`;

const parseInteger = (
  value: unknown,
  sourceRow: number,
  header: string,
  min: number,
  max: number,
  fallback?: number,
): number => {
  if ((value === null || value === undefined || String(value).trim() === '') && fallback !== undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${cellLabel(sourceRow, header)}必须是 ${min}–${max} 的整数。`);
  }
  return parsed;
};

const parsePercent = (
  value: unknown,
  sourceRow: number,
  header: string,
  max: number,
  fallback: number,
): number => {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  const text = String(value).trim();
  const hasPercentSign = /[%％]$/.test(text);
  const raw = Number(text.replace(/[%％]$/, ''));
  if (!Number.isFinite(raw)) {
    throw new Error(`${cellLabel(sourceRow, header)}必须是百分比。`);
  }
  const percent = hasPercentSign ? raw : raw >= 0 && raw <= 1 ? raw * 100 : raw;
  if (!Number.isInteger(percent) || percent < 0 || percent > max) {
    throw new Error(`${cellLabel(sourceRow, header)}必须是 0%–${max}% 的整数百分比。`);
  }
  return percent;
};

const parseShape = (value: unknown, sourceRow: number): EditorShape => {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/\s/g, '');
  if (['正方形', '方形', 'square'].includes(normalized)) return 'square';
  if (['菱形', 'diamond'].includes(normalized)) return 'diamond';
  if (['长方形', '矩形', 'rectangle'].includes(normalized)) return 'rectangle';
  if (['六边形蜂窝', '六边形', '蜂窝', 'hex'].includes(normalized)) return 'hex';
  throw new Error(`${cellLabel(sourceRow, '棋盘形状')}只支持正方形、菱形、长方形或六边形蜂窝。`);
};

const validateShapeSize = (
  shape: EditorShape,
  rows: number,
  columns: number,
  sourceRow: number,
): void => {
  if (shape !== 'rectangle' && rows !== columns) {
    throw new Error(`第 ${sourceRow} 行：${shape === 'hex' ? '六边形蜂窝' : shape === 'diamond' ? '菱形' : '正方形'}棋盘的行数和列数必须相同。`);
  }
  if (shape === 'diamond' && rows > 8) {
    throw new Error(`第 ${sourceRow} 行：菱形棋盘尺寸不能超过 8×8。`);
  }
  if (shape === 'hex' && rows > 10) {
    throw new Error(`第 ${sourceRow} 行：六边形蜂窝棋盘尺寸不能超过 10×10。`);
  }
};

export const parseAlgorithm4BatchConfigRows = (
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
): Algorithm4BatchConfig[] => {
  const headerRowIndex = rows.findIndex((row) => !isBlankRow(row));
  if (headerRowIndex < 0) throw new Error('配置表为空，请先填写表头和至少一行配置。');

  const indexes = headerIndexes(rows[headerRowIndex]);
  const missingHeaders = (Object.keys(indexes) as HeaderKey[])
    .filter((key) => indexes[key] < 0)
    .map((key) => ALGORITHM4_BATCH_HEADERS[
      (Object.keys(HEADER_ALIASES) as HeaderKey[]).indexOf(key)
    ]);
  if (missingHeaders.length > 0) {
    throw new Error(`配置表缺少列：${missingHeaders.join('、')}。`);
  }

  const defaults = createAlgorithm4Selection().parameters;
  const configs = rows.slice(headerRowIndex + 1).flatMap((row, offset) => {
    if (isBlankRow(row)) return [];
    const sourceRow = headerRowIndex + offset + 2;
    const shape = parseShape(row[indexes.shape], sourceRow);
    const parsedRows = parseInteger(row[indexes.rows], sourceRow, '行数', 3, 20);
    const columns = parseInteger(row[indexes.columns], sourceRow, '列数', 3, 20);
    validateShapeSize(shape, parsedRows, columns, sourceRow);
    return [{
      sourceRow,
      shape,
      rows: parsedRows,
      columns,
      targetCrossings: parseInteger(
        row[indexes.targetCrossings],
        sourceRow,
        '最大交叉数量',
        0,
        99,
        defaults.targetCrossings,
      ),
      turnProbability: parsePercent(
        row[indexes.turnProbability],
        sourceRow,
        '拐弯概率 %',
        100,
        defaults.turnProbability,
      ),
      hiddenPercent: parsePercent(
        row[indexes.hiddenPercent],
        sourceRow,
        '隐藏比例 %',
        90,
        defaults.hiddenPercent,
      ),
      maxHiddenRun: parseInteger(
        row[indexes.maxHiddenRun],
        sourceRow,
        '最长连续隐藏',
        1,
        8,
        defaults.maxHiddenRun,
      ),
      maxVisibleRun: parseInteger(
        row[indexes.maxVisibleRun],
        sourceRow,
        '最长连续显示',
        1,
        12,
        defaults.maxVisibleRun,
      ),
      generationCount: parseInteger(
        row[indexes.generationCount],
        sourceRow,
        '生成次数',
        1,
        MAX_BATCH_GENERATION_PER_ROW,
      ),
    }];
  });

  if (configs.length === 0) throw new Error('配置表没有可生成的配置行。');
  const total = configs.reduce((sum, config) => sum + config.generationCount, 0);
  if (total > MAX_BATCH_GENERATION_TOTAL) {
    throw new Error(`一次最多批量生成 ${MAX_BATCH_GENERATION_TOTAL} 关，当前配置为 ${total} 关。`);
  }
  return configs;
};

export const readAlgorithm4BatchConfigFile = async (
  file: Blob,
): Promise<Algorithm4BatchConfig[]> => {
  const { readSheet } = await import('read-excel-file/browser');
  const rows = await readSheet(file);
  return parseAlgorithm4BatchConfigRows(rows);
};

const boardShapeOf = (shape: EditorShape): BoardShape => {
  if (shape === 'diamond') return BoardShape.Diamond;
  if (shape === 'rectangle') return BoardShape.Rectangle;
  if (shape === 'hex') return BoardShape.Hex;
  return BoardShape.Square;
};

const createActiveCells = (rows: number, columns: number): Cell[] => Array.from(
  { length: rows * columns },
  (_, index) => ({ x: index % columns, y: Math.floor(index / columns) }),
);

const mixSeed = (
  seed: number,
  sourceRow: number,
  generationNumber: number,
  attempt: number,
): number => (
  seed
  ^ Math.imul(sourceRow + 1, 73856093)
  ^ Math.imul(generationNumber + 1, 19349663)
  ^ Math.imul(attempt + 1, 83492791)
) >>> 0;

const algorithmSelectionOf = (config: Algorithm4BatchConfig): Algorithm4Selection => {
  const defaults = createAlgorithm4Selection();
  return {
    ...defaults,
    parameters: {
      ...defaults.parameters,
      targetCrossings: config.targetCrossings,
      turnProbability: config.turnProbability,
      hiddenPercent: config.hiddenPercent,
      maxHiddenRun: config.maxHiddenRun,
      maxVisibleRun: config.maxVisibleRun,
    },
  };
};

export const generateAlgorithm4BatchLevels = async (
  configs: ReadonlyArray<Algorithm4BatchConfig>,
  firstLevelId: number,
  seed: number,
  onProgress?: Algorithm4BatchProgress,
): Promise<Algorithm4BatchResult> => {
  const total = configs.reduce((sum, config) => sum + config.generationCount, 0);
  const levels: LevelData[] = [];
  const failures: Algorithm4BatchFailure[] = [];
  let completed = 0;

  for (const config of configs) {
    const activeCells = createActiveCells(config.rows, config.columns);
    const activeCellKeys = new Set(activeCells.map((cell) => `${cell.x},${cell.y}`));
    const selection = resolveEditorAlgorithmForShape(
      algorithmSelectionOf(config),
      config.shape,
    ) as Algorithm4Selection;

    for (let generationNumber = 1; generationNumber <= config.generationCount; generationNumber += 1) {
      let generated: ReturnType<typeof runAlgorithm4> = null;
      for (let attempt = 0; attempt < 4 && !generated; attempt += 1) {
        generated = runAlgorithm4({
          rows: config.rows,
          columns: config.columns,
          activeCells: activeCellKeys,
          shape: config.shape,
          generationIndex: mixSeed(seed, config.sourceRow, generationNumber, attempt),
        }, selection);
      }

      if (generated) {
        levels.push({
          levelId: firstLevelId + levels.length,
          boardShape: boardShapeOf(config.shape),
          rows: config.rows,
          columns: config.columns,
          activeCells: activeCells.map((cell) => ({ ...cell })),
          solutionPath: generated.path.map((cell) => ({ ...cell })),
          pathSource: 'generated',
          hiddenCells: (generated.hiddenCells ?? []).map((cell) => ({ ...cell })),
          algorithm: serializeEditorAlgorithm(selection),
          custom: true,
        });
      } else {
        failures.push({ sourceRow: config.sourceRow, generationNumber });
      }

      completed += 1;
      onProgress?.(completed, total, config.sourceRow);
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    }
  }

  return { levels, failures };
};
