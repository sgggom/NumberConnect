import { createRandom } from '../../game/random';
import { BoardShape, type LevelData } from '../../game/types';
import { encodeCompactLevelCollection } from '../../game/levelDataFormat';
import { createAlgorithm1Selection } from './algorithms/algorithm1';
import type {
  Algorithm1Selection,
  EditorAlgorithmContext,
  EditorAlgorithmResult,
} from './algorithms/types';
import { calculateEditorLevelMetrics } from './levelMetrics';
import { summarizeDifficultyScores } from './levelBaseDataTsv';
import { areEditorCellsNeighbors } from './findEditorPath';
import {
  averageSimulatedPlayResults,
  simulateLevelPlay,
  type SimulatedPlayResult,
  type SimulationReasoningLevel,
} from './simulateLevelPlay';
import type { EditorCell, EditorShape } from './types';
import { MAX_BATCH_PLAYTEST_CONCURRENCY } from './batchWorkerConcurrency';

export { batchPlaytestConcurrency, MAX_BATCH_PLAYTEST_CONCURRENCY } from './batchWorkerConcurrency';

export type BatchPlaytestMode = 'path' | 'hidden';
export type BatchHiddenDifficultySelection = number | 'all';

const COMMON_REQUIRED_HEADERS = [
  '配置ID',
  '棋盘形状',
  '关卡数据',
] as const;

const PATH_REQUIRED_HEADERS = [
  ...COMMON_REQUIRED_HEADERS,
  '启用',
  '最大交叉数量',
  '路径拐弯概率 %',
  '生成路径数',
] as const;

const HIDDEN_REQUIRED_HEADERS = [
  ...COMMON_REQUIRED_HEADERS,
  '基础隐藏占比 %',
  '最长连续显示',
  '最长连续隐藏',
  '生成隐藏数',
  '每关跑关次数',
] as const;

export const BATCH_PATH_RESULT_HEADERS = [
  '配置ID', '输出标签', '配置表行号', '配置内路径序号', '路径JSON',
  '棋盘形状', '行数', '列数', '格子数', '配置最大交叉数量', '配置路径拐弯概率 %',
  '实际路径交叉数量', '直角拐弯占比', '锐角拐弯占比', '钝角拐弯占比',
  '平均路径长度（拐弯的拐点算作端点，看整个棋盘中的线段平均长度）',
  '向上移动占比', '向下移动占比', '向左移动占比', '向右移动占比',
  '向左上移动占比', '向右上移动占比', '向左下移动占比', '向右下移动占比',
  '连续向右数量', '连续向下数量', '连续向右下数量', '连续遮挡计数',
  '起点位置（分为左上/右上/左下/右下/靠中）', '终点位置',
] as const;

export const BATCH_HIDDEN_RESULT_HEADERS = [
  '关卡名', '配置ID', '配置表行号', '配置内隐藏序号', '关卡JSON', '路径JSON',
  '棋盘形状', '行数', '列数', '格子数',
  '基础隐藏占比 %', '目标难度', '配置实际隐藏占比 %', '最长连续显示限制', '最长连续隐藏限制',
  '实际隐藏数', '实际隐藏占比 %', '实际最长连续显示', '实际最长连续隐藏',
  '实际路径交叉数量', '直角拐弯占比', '锐角拐弯占比', '钝角拐弯占比',
  '平均路径长度（拐弯的拐点算作端点，看整个棋盘中的线段平均长度）',
  '向上移动占比', '向下移动占比', '向左移动占比', '向右移动占比',
  '向左上移动占比', '向右上移动占比', '向左下移动占比', '向右下移动占比',
  '连续向右数量', '连续向下数量', '连续向右下数量', '连续遮挡计数',
  '起点位置（分为左上/右上/左下/右下/靠中）', '终点位置',
  '每关跑关次数', '推理能力', '平均总步数', '低推理平均错误数', '中推理平均错误数',
  '高推理平均错误数', '平均可连接数量', '直接连接占比 %',
  '平均距离下个显示数字', '平均每步难度分', '前期平均难度分', '中期平均难度分', '后期平均难度分',
] as const;

export const BATCH_PLAYTEST_RESULT_HEADERS = BATCH_HIDDEN_RESULT_HEADERS;

export const MAX_BATCH_PLAYTEST_LEVELS = 500;
export const MAX_BATCH_PLAYTEST_SIMULATIONS = 10_000;
export const MAX_BATCH_HIDDEN_LEVELS = 200_000;
export const MAX_BATCH_HIDDEN_SIMULATIONS = 5_000_000;
export const BATCH_PLAYTEST_ATTEMPT_TIMEOUT_MS = 60_000;
export const BATCH_PLAYTEST_MAX_ATTEMPTS = 4;

export interface BatchPlaytestConfig {
  mode: BatchPlaytestMode;
  sourceRow: number;
  id: string;
  enabled: boolean;
  shape: EditorShape;
  rows: number;
  columns: number;
  targetCrossings: number;
  turnProbability: number;
  hiddenPercent: number;
  targetDifficulty: number;
  maxVisibleRun: number;
  maxHiddenRun: number;
  generationCount: number;
  simulationRunCount: number;
  reasoningLevel: SimulationReasoningLevel;
  seed: number;
  outputLabel: string;
  presetActiveCells?: EditorCell[];
  presetPath?: EditorCell[];
}

export interface BatchPlaytestTask {
  taskIndex: number;
  generationNumber: number;
  config: BatchPlaytestConfig;
}

export interface BatchPlaytestResult {
  task: BatchPlaytestTask;
  level?: LevelData;
  simulation?: BatchPlaytestSimulation;
  error?: string;
}

export interface BatchPlaytestSimulation extends SimulatedPlayResult {
  averageErrorCountByReasoning: Record<SimulationReasoningLevel, number>;
}

export interface BatchTaskPoolProgress {
  completed: number;
  running: number;
  failed: number;
  total: number;
}

export interface BatchTaskPoolOptions<Result> {
  concurrency?: number;
  signal?: AbortSignal;
  isFailure?: (result: Result) => boolean;
  onProgress?: (progress: BatchTaskPoolProgress) => void;
}

const abortedError = (): Error => {
  const error = new Error('批量任务已取消。');
  error.name = 'AbortError';
  return error;
};

export const runConcurrentBatchTaskPool = async <Task, Result>(
  tasks: ReadonlyArray<Task>,
  execute: (task: Task, taskIndex: number) => Promise<Result>,
  options: BatchTaskPoolOptions<Result> = {},
): Promise<Result[]> => {
  if (tasks.length === 0) return [];
  const concurrency = Math.max(
    1,
    Math.min(tasks.length, Math.floor(options.concurrency ?? MAX_BATCH_PLAYTEST_CONCURRENCY)),
  );
  const results = new Array<Result>(tasks.length);
  let nextIndex = 0;
  let completed = 0;
  let running = 0;
  let failed = 0;
  const report = (): void => options.onProgress?.({
    completed,
    running,
    failed,
    total: tasks.length,
  });
  report();

  const consume = async (): Promise<void> => {
    while (nextIndex < tasks.length) {
      if (options.signal?.aborted) throw abortedError();
      const taskIndex = nextIndex;
      nextIndex += 1;
      running += 1;
      report();
      let result: Result;
      try {
        result = await execute(tasks[taskIndex], taskIndex);
      } finally {
        running -= 1;
      }
      if (options.signal?.aborted) throw abortedError();
      results[taskIndex] = result;
      completed += 1;
      if (options.isFailure?.(result)) failed += 1;
      report();
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => consume()));
  return results;
};

type Header = string;

const normalizedHeader = (value: unknown): string => String(value ?? '')
  .trim()
  .replace(/[％%]/g, '%')
  .replace(/\s+/g, ' ');

const isBlankRow = (row: ReadonlyArray<unknown>): boolean => row.every(
  (value) => value === null || value === undefined || String(value).trim() === '',
);

const integerCell = (
  value: unknown,
  sourceRow: number,
  header: string,
  minimum: number,
  maximum: number,
): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`第 ${sourceRow} 行“${header}”必须是 ${minimum}–${maximum} 的整数。`);
  }
  return parsed;
};

const parseShape = (value: unknown, sourceRow: number): EditorShape => {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (['正方形', '方形', 'square'].includes(normalized)) return 'square';
  if (['长方形', '矩形', 'rectangle'].includes(normalized)) return 'rectangle';
  if (['菱形', 'diamond'].includes(normalized)) return 'diamond';
  if (['六边形蜂窝', '六边形', '蜂窝', 'hex'].includes(normalized)) return 'hex';
  throw new Error(`第 ${sourceRow} 行“棋盘形状”只支持正方形、长方形、菱形或六边形蜂窝。`);
};

const parseEnabled = (value: unknown, sourceRow: number): boolean => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === '是' || normalized === 'yes' || normalized === 'true' || normalized === '1') return true;
  if (normalized === '否' || normalized === 'no' || normalized === 'false' || normalized === '0') return false;
  throw new Error(`第 ${sourceRow} 行“启用”只支持是或否。`);
};

const validateDimensions = (
  shape: EditorShape,
  rows: number,
  columns: number,
  sourceRow: number,
): void => {
  if (rows > 20 || columns > 20) {
    throw new Error(`第 ${sourceRow} 行：“关卡数据”的尺寸不能超过 20×20。`);
  }
  const minimum = shape === 'rectangle' ? 1 : 3;
  if (rows < minimum || columns < minimum) {
    throw new Error(`第 ${sourceRow} 行：${shape === 'rectangle' ? '长方形' : '当前'}棋盘每边至少 ${minimum} 格。`);
  }
  if (shape !== 'rectangle' && rows !== columns) {
    throw new Error(`第 ${sourceRow} 行：正方形、菱形和六边形蜂窝的行数与列数必须一致。`);
  }
  if (shape === 'diamond' && rows > 8) throw new Error(`第 ${sourceRow} 行：菱形棋盘不能超过 8×8。`);
  if (shape === 'hex' && rows > 10) throw new Error(`第 ${sourceRow} 行：六边形蜂窝不能超过 10×10。`);
};

const presetData = (
  value: unknown,
  sourceRow: number,
  header: string,
): number[][] | undefined => {
  if (value === null || value === undefined || String(value).trim() === '') return undefined;
  let parsed: unknown;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value.trim()) : value;
  } catch {
    throw new Error(`第 ${sourceRow} 行“${header}”不是有效的 JSON。`);
  }
  const data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'data' in parsed
    ? (parsed as { data?: unknown }).data
    : parsed;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`第 ${sourceRow} 行“${header}”必须是非空二维数组。`);
  }
  const columns = Array.isArray(data[0]) ? data[0].length : 0;
  if (columns === 0) throw new Error(`第 ${sourceRow} 行“${header}”每行至少包含 1 个整数。`);
  return data.map((row, y) => {
    if (!Array.isArray(row) || row.length !== columns) {
      throw new Error(`第 ${sourceRow} 行“${header}”第 ${y + 1} 行必须包含 ${columns} 个整数。`);
    }
    return row.map((cell, x) => {
      if (!Number.isSafeInteger(cell)) {
        throw new Error(`第 ${sourceRow} 行“${header}”data[${y}][${x}] 必须是整数。`);
      }
      return cell as number;
    });
  });
};

const activeCellsFromPreset = (data: ReadonlyArray<ReadonlyArray<number>>): EditorCell[] => data
  .flatMap((row, y) => row.flatMap((value, x) => (value === 0 ? [] : [{ x, y }])));

const formationCellsFromPreset = (
  data: ReadonlyArray<ReadonlyArray<number>>,
  sourceRow: number,
): EditorCell[] => data.flatMap((row, y) => row.flatMap((value, x) => {
  if (value === 0) return [];
  if (value !== 999) {
    throw new Error(`第 ${sourceRow} 行“关卡数据”包含 999 时只允许使用 0（空位）和 999（占位格）。`);
  }
  return [{ x, y }];
}));

const pathFromPreset = (
  data: ReadonlyArray<ReadonlyArray<number>>,
  sourceRow: number,
  shape: EditorShape,
): EditorCell[] => {
  const activeCells = activeCellsFromPreset(data);
  if (activeCells.length === 0) throw new Error(`第 ${sourceRow} 行“关卡数据”中没有关卡格子。`);
  const path: Array<EditorCell | undefined> = [];
  data.forEach((row, y) => row.forEach((value, x) => {
    if (value === 0) return;
    const number = Math.abs(value);
    if (number > data.length * row.length || path[number - 1]) {
      throw new Error(`第 ${sourceRow} 行“关卡数据”的路径数字绝对值必须不重复且连续。`);
    }
    path[number - 1] = { x, y };
  }));
  if (path.length !== activeCells.length || path.some((cell) => cell === undefined)) {
    throw new Error(`第 ${sourceRow} 行“关卡数据”的路径数字绝对值必须连续覆盖 1–${activeCells.length}。`);
  }
  const fixedPath = path as EditorCell[];
  fixedPath.forEach((cell, index) => {
    if (index > 0 && !areEditorCellsNeighbors(fixedPath[index - 1], cell, shape)) {
      throw new Error(`第 ${sourceRow} 行“关卡数据”中的路径数字 ${index} 与 ${index + 1} 不相邻。`);
    }
  });
  return fixedPath;
};

export const parseBatchPlaytestConfigRows = (
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  mode: BatchPlaytestMode,
): BatchPlaytestConfig[] => {
  const requiredHeaders = mode === 'path' ? PATH_REQUIRED_HEADERS : HIDDEN_REQUIRED_HEADERS;
  const headerRowIndex = rows.findIndex((row) => (
    requiredHeaders.every((header) => row.map(normalizedHeader).includes(header))
  ));
  if (headerRowIndex < 0) {
    const likelyHeader = rows.find((row) => COMMON_REQUIRED_HEADERS.some(
      (header) => row.map(normalizedHeader).includes(header),
    ));
    const missing = likelyHeader
      ? requiredHeaders.filter((header) => !likelyHeader.map(normalizedHeader).includes(header))
      : [];
    throw new Error(missing.length > 0
      ? `批量配置表头缺少：${missing.join('、')}。`
      : `找不到“${mode === 'path' ? '路径生成配置' : '隐藏生成配置'}”表头，请使用对应的批量配置模板。`);
  }

  const headerIndexes = new Map<string, number>(
    rows[headerRowIndex].map((value, index) => [normalizedHeader(value), index]),
  );
  const indexOf = (header: Header): number => headerIndexes.get(header) ?? -1;
  const optionalIndex = (header: string): number => headerIndexes.get(header) ?? -1;
  const configs: BatchPlaytestConfig[] = [];
  const seenIds = new Set<string>();
  const automaticSeed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;

  rows.slice(headerRowIndex + 1).forEach((row, offset) => {
    if (isBlankRow(row)) return;
    const sourceRow = headerRowIndex + offset + 2;
    const enabled = mode === 'path' ? parseEnabled(row[indexOf('启用')], sourceRow) : true;
    if (!enabled) return;
    const id = String(row[indexOf('配置ID')] ?? '').trim();
    if (!id) throw new Error(`第 ${sourceRow} 行“配置ID”不能为空。`);
    if (mode === 'path' && seenIds.has(id)) {
      throw new Error(`第 ${sourceRow} 行“配置ID”${id}重复。`);
    }
    seenIds.add(id);
    const shape = parseShape(row[indexOf('棋盘形状')], sourceRow);
    const configuredData = presetData(row[indexOf('关卡数据')], sourceRow, '关卡数据');
    if (!configuredData) throw new Error(`第 ${sourceRow} 行“关卡数据”不能为空。`);
    const parsedRows = configuredData.length;
    const columns = configuredData[0].length;
    validateDimensions(shape, parsedRows, columns, sourceRow);
    const outputLabelIndex = mode === 'path' ? optionalIndex('输出标签') : -1;
    const isPresetFormation = configuredData.some((dataRow) => dataRow.includes(999));
    if (mode === 'path' && !isPresetFormation) {
      throw new Error(`第 ${sourceRow} 行：批量生成路径只接受含 999 的棋盘造型。`);
    }
    if (mode === 'hidden' && isPresetFormation) {
      throw new Error(`第 ${sourceRow} 行：批量生成隐藏只接受不含 999 的连续编号路径。`);
    }
    const presetActiveCells = mode === 'path'
      ? formationCellsFromPreset(configuredData, sourceRow)
      : undefined;
    if (presetActiveCells?.length === 0) {
      throw new Error(`第 ${sourceRow} 行“关卡数据”的阵型中没有占位格。`);
    }
    const presetPath = mode === 'hidden'
      ? pathFromPreset(configuredData, sourceRow, shape)
      : undefined;
    configs.push({
      mode,
      sourceRow,
      id,
      enabled,
      shape,
      rows: parsedRows,
      columns,
      targetCrossings: mode === 'hidden' || shape === 'hex'
        ? 0
        : integerCell(row[indexOf('最大交叉数量')], sourceRow, '最大交叉数量', 0, 99),
      turnProbability: mode === 'path'
        ? integerCell(row[indexOf('路径拐弯概率 %')], sourceRow, '路径拐弯概率 %', 0, 100)
        : 0,
      hiddenPercent: mode === 'hidden'
        ? integerCell(row[indexOf('基础隐藏占比 %')], sourceRow, '基础隐藏占比 %', 0, 100)
        : 0,
      targetDifficulty: mode === 'hidden' ? 6 : 1,
      maxVisibleRun: mode === 'hidden'
        ? integerCell(row[indexOf('最长连续显示')], sourceRow, '最长连续显示', 1, 99)
        : 99,
      maxHiddenRun: mode === 'hidden'
        ? integerCell(row[indexOf('最长连续隐藏')], sourceRow, '最长连续隐藏', 1, 99)
        : 99,
      generationCount: integerCell(
        row[indexOf(mode === 'path' ? '生成路径数' : '生成隐藏数')],
        sourceRow,
        mode === 'path' ? '生成路径数' : '生成隐藏数',
        1,
        100,
      ),
      simulationRunCount: mode === 'hidden'
        ? integerCell(row[indexOf('每关跑关次数')], sourceRow, '每关跑关次数', 1, 100)
        : 0,
      reasoningLevel: 'medium',
      seed: (automaticSeed ^ Math.imul(sourceRow, 2654435761)) >>> 0,
      outputLabel: outputLabelIndex < 0 ? '' : String(row[outputLabelIndex] ?? '').trim(),
      presetActiveCells,
      presetPath,
    });
  });

  if (configs.length === 0) throw new Error(mode === 'path'
    ? '没有启用的跑关配置，请至少将一行“启用”设为“是”。'
    : '没有可生成的隐藏配置。');
  const totalLevels = configs.reduce((sum, config) => sum + config.generationCount, 0);
  const totalSimulations = mode === 'hidden' ? configs.reduce(
    (sum, config) => sum + config.generationCount * config.simulationRunCount * 3,
    0,
  ) : 0;
  const maximumLevels = mode === 'hidden' ? MAX_BATCH_HIDDEN_LEVELS : MAX_BATCH_PLAYTEST_LEVELS;
  const maximumSimulations = mode === 'hidden'
    ? MAX_BATCH_HIDDEN_SIMULATIONS
    : MAX_BATCH_PLAYTEST_SIMULATIONS;
  if (totalLevels > maximumLevels) {
    throw new Error(`一次最多生成 ${maximumLevels} 关，当前配置为 ${totalLevels} 关。`);
  }
  if (totalSimulations > maximumSimulations) {
    throw new Error(`一次最多执行 ${maximumSimulations} 次模拟，当前配置为 ${totalSimulations} 次。`);
  }
  return configs;
};

export const readBatchPlaytestConfigFile = async (
  file: Blob,
  mode: BatchPlaytestMode,
): Promise<BatchPlaytestConfig[]> => {
  const { readSheet } = await import('read-excel-file/browser');
  const rows = await readSheet(file, mode === 'path' ? '路径生成配置' : '隐藏生成配置');
  return parseBatchPlaytestConfigRows(rows, mode);
};

export const createBatchPlaytestTasks = (
  configs: ReadonlyArray<BatchPlaytestConfig>,
  hiddenDifficultySelection: BatchHiddenDifficultySelection = 6,
): BatchPlaytestTask[] => {
  const tasks = configs.flatMap((config) => {
    const selectedDifficulty = hiddenDifficultySelection === 'all'
      ? 6
      : Math.max(1, Math.min(10, Math.floor(hiddenDifficultySelection)));
    const difficulties = config.mode === 'hidden'
      ? hiddenDifficultySelection === 'all'
        ? Array.from({ length: 10 }, (_, index) => index + 1)
        : [selectedDifficulty]
      : [config.targetDifficulty];
    return difficulties.flatMap((targetDifficulty) => Array.from(
      { length: config.generationCount },
      (_, index) => ({
        taskIndex: 0,
        generationNumber: index + 1,
        config: targetDifficulty === config.targetDifficulty
          ? config
          : { ...config, targetDifficulty },
      }),
    ));
  }).map((task, taskIndex) => ({ ...task, taskIndex }));

  const hiddenTasks = tasks.filter((task) => task.config.mode === 'hidden');
  if (hiddenTasks.length > MAX_BATCH_HIDDEN_LEVELS) {
    throw new Error(`一次最多生成 ${MAX_BATCH_HIDDEN_LEVELS} 关，当前难度范围展开后为 ${hiddenTasks.length} 关。`);
  }
  const totalSimulations = hiddenTasks.reduce(
    (sum, task) => sum + task.config.simulationRunCount * 3,
    0,
  );
  if (totalSimulations > MAX_BATCH_HIDDEN_SIMULATIONS) {
    throw new Error(`一次最多执行 ${MAX_BATCH_HIDDEN_SIMULATIONS} 次模拟，当前难度范围展开后为 ${totalSimulations} 次。`);
  }
  return tasks;
};

const mixedSeed = (task: BatchPlaytestTask, attempt: number): number => (
  task.config.seed
  ^ Math.imul(task.config.sourceRow + 1, 73856093)
  ^ Math.imul(task.generationNumber + 1, 19349663)
  ^ Math.imul(task.config.targetDifficulty + 1, 49979687)
  ^ Math.imul(attempt + 1, 83492791)
) >>> 0;

export const createBatchPlaytestGenerationRequest = (
  task: BatchPlaytestTask,
  attempt: number,
): { selection: Algorithm1Selection; context: Omit<EditorAlgorithmContext, 'onProgress'> } => {
  const defaults = createAlgorithm1Selection();
  const presetCells = task.config.presetPath ?? task.config.presetActiveCells;
  const activeCells = new Set<string>(presetCells?.map((cell) => `${cell.x},${cell.y}`));
  if (!presetCells) {
    for (let y = 0; y < task.config.rows; y += 1) {
      for (let x = 0; x < task.config.columns; x += 1) activeCells.add(`${x},${y}`);
    }
  }
  return {
    selection: {
      ...defaults,
      parameters: {
        ...defaults.parameters,
        targetCrossings: task.config.shape === 'hex' ? 0 : task.config.targetCrossings,
        turnProbability: task.config.turnProbability,
        hiddenPercent: task.config.hiddenPercent,
        targetDifficulty: task.config.targetDifficulty,
        maxVisibleRun: task.config.maxVisibleRun,
        maxHiddenRun: task.config.maxHiddenRun,
      },
    },
    context: {
      rows: task.config.rows,
      columns: task.config.columns,
      activeCells,
      shape: task.config.shape,
      generationIndex: mixedSeed(task, attempt),
      generationPhase: task.config.mode,
      fixedPath: task.config.presetPath?.map((cell) => ({ ...cell })),
    },
  };
};

const boardShapeOf = (shape: EditorShape): BoardShape => {
  if (shape === 'diamond') return BoardShape.Diamond;
  if (shape === 'rectangle') return BoardShape.Rectangle;
  if (shape === 'hex') return BoardShape.Hex;
  return BoardShape.Square;
};

export const createBatchPlaytestLevel = (
  task: BatchPlaytestTask,
  generated: EditorAlgorithmResult,
): LevelData => ({
  levelId: task.taskIndex + 1,
  boardShape: boardShapeOf(task.config.shape),
  rows: task.config.rows,
  columns: task.config.columns,
  activeCells: [...generated.path].map((cell) => ({ ...cell })),
  solutionPath: generated.path.map((cell) => ({ ...cell })),
  pathSource: 'generated',
  hiddenCells: (generated.hiddenCells ?? []).map((cell) => ({ ...cell })),
  algorithm: {
    id: 'algorithm-1',
    parameters: { ...createBatchPlaytestGenerationRequest(task, 0).selection.parameters },
  },
  custom: true,
});

const BATCH_REASONING_LEVELS: ReadonlyArray<SimulationReasoningLevel> = ['low', 'medium', 'high'];

const createBatchSimulationRun = (
  task: BatchPlaytestTask,
  level: LevelData,
  reasoningLevel: SimulationReasoningLevel,
  runIndex: number,
): SimulatedPlayResult => {
  const hiddenCellKeys = new Set((level.hiddenCells ?? []).map((cell) => `${cell.x},${cell.y}`));
  return simulateLevelPlay({
    path: level.solutionPath,
    hiddenCellKeys,
    shape: task.config.shape,
    reasoningLevel,
    random: createRandom(mixedSeed(task, runIndex + 1000)),
  });
};

const summarizeBatchSimulations = (
  resultsByReasoning: ReadonlyMap<SimulationReasoningLevel, ReadonlyArray<SimulatedPlayResult>>,
): BatchPlaytestSimulation => {
  const summarized = (reasoningLevel: SimulationReasoningLevel): SimulatedPlayResult => {
    const results = resultsByReasoning.get(reasoningLevel) ?? [];
    return results.length === 1 ? results[0] : averageSimulatedPlayResults(results);
  };
  const mediumSimulation = summarized('medium');
  return {
    ...mediumSimulation,
    averageErrorCountByReasoning: {
      low: summarized('low').errorCount,
      medium: mediumSimulation.errorCount,
      high: summarized('high').errorCount,
    },
  };
};

export const simulateBatchPlaytestLevel = (
  task: BatchPlaytestTask,
  level: LevelData,
  onProgress?: (completed: number, total: number) => void,
): BatchPlaytestSimulation => {
  const total = task.config.simulationRunCount * BATCH_REASONING_LEVELS.length;
  const resultsByReasoning = new Map<SimulationReasoningLevel, SimulatedPlayResult[]>();
  let completed = 0;
  BATCH_REASONING_LEVELS.forEach((reasoningLevel) => {
    const results: SimulatedPlayResult[] = [];
    for (let runIndex = 0; runIndex < task.config.simulationRunCount; runIndex += 1) {
      results.push(createBatchSimulationRun(task, level, reasoningLevel, runIndex));
      completed += 1;
      onProgress?.(completed, total);
    }
    resultsByReasoning.set(reasoningLevel, results);
  });
  return summarizeBatchSimulations(resultsByReasoning);
};

interface AsyncBatchSimulationOptions {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

export const simulateBatchPlaytestLevelAsync = async (
  task: BatchPlaytestTask,
  level: LevelData,
  options: AsyncBatchSimulationOptions = {},
): Promise<BatchPlaytestSimulation> => {
  const total = task.config.simulationRunCount * BATCH_REASONING_LEVELS.length;
  const resultsByReasoning = new Map<SimulationReasoningLevel, SimulatedPlayResult[]>(
    BATCH_REASONING_LEVELS.map((reasoningLevel) => [reasoningLevel, []]),
  );
  let completed = 0;
  for (const reasoningLevel of BATCH_REASONING_LEVELS) {
    const results = resultsByReasoning.get(reasoningLevel) as SimulatedPlayResult[];
    for (let runIndex = 0; runIndex < task.config.simulationRunCount; runIndex += 1) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
      if (options.signal?.aborted) throw abortedError();
      results.push(createBatchSimulationRun(task, level, reasoningLevel, runIndex));
      completed += 1;
      options.onProgress?.(completed, total);
    }
  }
  return summarizeBatchSimulations(resultsByReasoning);
};

const rounded = (value: number): number => Math.round(value * 100) / 100;
const average = (values: ReadonlyArray<number>): number => (
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
);
const shapeLabel = (shape: EditorShape): string => {
  if (shape === 'diamond') return '菱形';
  if (shape === 'rectangle') return '长方形';
  if (shape === 'hex') return '六边形蜂窝';
  return '正方形';
};
const reasoningLabel = (level: SimulationReasoningLevel): string => (
  level === 'low' ? '低' : level === 'high' ? '高' : '中'
);
const safeTsv = (value: unknown): string => String(value ?? '').replace(/[\t\r\n]+/g, ' ');

export const formatBatchPlaytestResultsTsv = (
  results: ReadonlyArray<BatchPlaytestResult>,
  mode: BatchPlaytestMode,
  includeHeader = false,
): string => {
  const headers = mode === 'path' ? BATCH_PATH_RESULT_HEADERS : BATCH_HIDDEN_RESULT_HEADERS;
  const rows = results.map((result) => {
    const { task, level, simulation } = result;
    const config = task.config;
    if (!level || (mode === 'hidden' && !simulation)) {
      const failureRow = Array.from({ length: headers.length }, () => '');
      if (mode === 'path') {
        failureRow.splice(
          0, 8, config.id, config.outputLabel, String(config.sourceRow), String(task.generationNumber),
          '', shapeLabel(config.shape), String(config.rows), String(config.columns),
        );
      } else {
        failureRow.splice(
          0, 10, `${config.id}_${config.targetDifficulty}`, config.id, String(config.sourceRow),
          String(task.generationNumber), '', '', shapeLabel(config.shape),
          String(config.rows), String(config.columns), '',
        );
      }
      return failureRow;
    }
    const hiddenCellKeys = new Set((level.hiddenCells ?? []).map((cell) => `${cell.x},${cell.y}`));
    const metrics = calculateEditorLevelMetrics({
      path: level.solutionPath,
      hiddenCellKeys,
      shape: config.shape,
    });
    if (mode === 'path') {
      return [
        config.id, config.outputLabel, config.sourceRow, task.generationNumber,
        JSON.stringify(encodeCompactLevelCollection([level])[0]), shapeLabel(config.shape),
        config.rows, config.columns, level.activeCells.length, config.targetCrossings,
        config.turnProbability, metrics.pathCrossings, rounded(metrics.rightAngleTurnRatio),
        rounded(metrics.acuteAngleTurnRatio), rounded(metrics.obtuseAngleTurnRatio),
        rounded(metrics.averageSegmentLength), rounded(metrics.upwardMoveRatio),
        rounded(metrics.downwardMoveRatio), rounded(metrics.leftwardMoveRatio),
        rounded(metrics.rightwardMoveRatio), rounded(metrics.upperLeftMoveRatio),
        rounded(metrics.upperRightMoveRatio), rounded(metrics.lowerLeftMoveRatio),
        rounded(metrics.lowerRightMoveRatio), metrics.consecutiveRightCount,
        metrics.consecutiveDownCount, metrics.consecutiveLowerRightCount,
        metrics.consecutiveOcclusionCount,
        metrics.startRegion, metrics.endRegion,
      ];
    }
    const hiddenSimulation = simulation as BatchPlaytestSimulation;
    const difficulty = summarizeDifficultyScores(hiddenSimulation.steps.map((step) => step.difficultyScore));
    const configuredHiddenPercent = Math.min(100, config.hiddenPercent + config.targetDifficulty);
    const pathJson = JSON.stringify(encodeCompactLevelCollection([{ ...level, hiddenCells: [] }])[0]);
    return [
      `${config.id}_${config.targetDifficulty}`, config.id, config.sourceRow, task.generationNumber,
      JSON.stringify(encodeCompactLevelCollection([level])[0]), pathJson, shapeLabel(config.shape),
      config.rows, config.columns, level.activeCells.length,
      config.hiddenPercent, config.targetDifficulty, configuredHiddenPercent,
      config.maxVisibleRun, config.maxHiddenRun, metrics.hiddenCount, rounded(metrics.hiddenRatio * 100),
      metrics.longestVisibleRun, metrics.longestHiddenRun,
      metrics.pathCrossings, rounded(metrics.rightAngleTurnRatio), rounded(metrics.acuteAngleTurnRatio),
      rounded(metrics.obtuseAngleTurnRatio), rounded(metrics.averageSegmentLength),
      rounded(metrics.upwardMoveRatio), rounded(metrics.downwardMoveRatio),
      rounded(metrics.leftwardMoveRatio), rounded(metrics.rightwardMoveRatio),
      rounded(metrics.upperLeftMoveRatio), rounded(metrics.upperRightMoveRatio),
      rounded(metrics.lowerLeftMoveRatio), rounded(metrics.lowerRightMoveRatio),
      metrics.consecutiveRightCount, metrics.consecutiveDownCount, metrics.consecutiveLowerRightCount,
      metrics.consecutiveOcclusionCount,
      metrics.startRegion, metrics.endRegion,
      config.simulationRunCount, reasoningLabel('medium'), rounded(hiddenSimulation.totalSteps),
      rounded(hiddenSimulation.averageErrorCountByReasoning.low),
      rounded(hiddenSimulation.averageErrorCountByReasoning.medium),
      rounded(hiddenSimulation.averageErrorCountByReasoning.high),
      rounded(average(hiddenSimulation.steps.map((step) => step.connectableCount))),
      rounded(average(hiddenSimulation.steps.map((step) => step.directConnectRate ?? Number(step.directConnect))) * 100),
      rounded(average(hiddenSimulation.steps.map((step) => step.distanceToNextVisibleNumber))),
      rounded(difficulty.averageStepDifficultyScore), rounded(difficulty.earlyAverageDifficultyScore),
      rounded(difficulty.middleAverageDifficultyScore), rounded(difficulty.lateAverageDifficultyScore),
    ];
  });
  return [...(includeHeader ? [headers] : []), ...rows]
    .map((row) => row.map(safeTsv).join('\t'))
    .join('\r\n');
};
