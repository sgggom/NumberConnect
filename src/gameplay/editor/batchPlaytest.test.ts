import { describe, expect, it, vi } from 'vitest';
import { runEditorAlgorithm } from './algorithms';
import {
  BATCH_HIDDEN_RESULT_HEADERS,
  BATCH_PATH_RESULT_HEADERS,
  batchPlaytestConcurrency,
  createBatchPlaytestGenerationRequest,
  createBatchPlaytestLevel,
  createBatchPlaytestTasks,
  formatBatchPlaytestResultsTsv,
  parseBatchPlaytestConfigRows,
  runConcurrentBatchTaskPool,
  simulateBatchPlaytestLevel,
  simulateBatchPlaytestLevelAsync,
} from './batchPlaytest';

const pathHeaders = [
  '配置ID', '启用', '棋盘形状', '关卡数据', '最大交叉数量', '路径拐弯概率 %',
  '生成路径数', '输出标签', '备注',
];
const hiddenHeaders = [
  '配置ID', '棋盘形状', '关卡数据', '基础隐藏占比 %',
  '最长连续显示', '最长连续隐藏', '生成隐藏数', '每关跑关次数',
];
const formation3x3 = JSON.stringify({
  data: [[999, 999, 999], [999, 999, 999], [999, 999, 999]],
});
const path3x3 = JSON.stringify({ data: [[1, -2, 3], [6, 5, 4], [7, -8, 9]] });

describe('批量生成路径与隐藏', () => {
  it('按设备逻辑线程数动态扩展并保留一个线程', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 16 });
    expect(batchPlaytestConcurrency()).toBe(15);
    vi.stubGlobal('navigator', { hardwareConcurrency: 64 });
    expect(batchPlaytestConcurrency()).toBe(32);
    vi.unstubAllGlobals();
  });

  it('读取项目中的两个实际配置模板', async () => {
    const { readSheet } = await import('read-excel-file/node');
    const pathRows = await readSheet('excel/批量生成路径配置模板.xlsx', '路径生成配置');
    const hiddenRows = await readSheet('excel/批量生成隐藏配置模板.xlsx', '隐藏生成配置');
    expect(parseBatchPlaytestConfigRows(pathRows, 'path')[0]).toMatchObject({ mode: 'path' });
    expect(parseBatchPlaytestConfigRows(hiddenRows, 'hidden')[0]).toMatchObject({ mode: 'hidden' });
  });

  it('两个功能分别只要求自己的控制参数', () => {
    const [pathConfig] = parseBatchPlaytestConfigRows([
      pathHeaders,
      ['PATH-1', '是', '正方形', formation3x3, 2, 40, 2, '路径', ''],
    ], 'path');
    const [hiddenConfig] = parseBatchPlaytestConfigRows([
      hiddenHeaders,
      ['HIDDEN-1', '正方形', path3x3, 35, 8, 4, 2, 3],
    ], 'hidden');
    expect(pathConfig).toMatchObject({ mode: 'path', generationCount: 2, simulationRunCount: 0 });
    expect(hiddenConfig).toMatchObject({ mode: 'hidden', generationCount: 2, simulationRunCount: 3 });
  });

  it('全部难度按 1–10 分别乘以配置生成数量', () => {
    const [config] = parseBatchPlaytestConfigRows([
      hiddenHeaders,
      ['HIDDEN-ALL', '正方形', path3x3, 35, 8, 4, 2, 1],
    ], 'hidden');
    const tasks = createBatchPlaytestTasks([config], 'all');

    expect(tasks).toHaveLength(20);
    expect(tasks.map((task) => task.config.targetDifficulty)).toEqual([
      1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10,
    ]);
    expect(tasks.map((task) => task.generationNumber)).toEqual([
      1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2,
    ]);
  });

  it('单个目标难度完全由界面选择，不读取配置表', () => {
    const [config] = parseBatchPlaytestConfigRows([
      hiddenHeaders,
      ['HIDDEN-ONE', '正方形', path3x3, 35, 8, 4, 2, 1],
    ], 'hidden');
    const tasks = createBatchPlaytestTasks([config], 9);

    expect(tasks).toHaveLength(2);
    expect(tasks.every((task) => task.config.targetDifficulty === 9)).toBe(true);
  });

  it('严格区分造型和路径输入', () => {
    expect(() => parseBatchPlaytestConfigRows([
      pathHeaders,
      ['PATH-BAD', '是', '正方形', path3x3, 2, 40, 1],
    ], 'path')).toThrow('只接受含 999 的棋盘造型');
    expect(() => parseBatchPlaytestConfigRows([
      hiddenHeaders,
      ['HIDDEN-BAD', '正方形', formation3x3, 35, 8, 4, 1, 2],
    ], 'hidden')).toThrow('只接受不含 999 的连续编号路径');
  });

  it('从关卡数据推导尺寸并校验形状', () => {
    const data = Array.from({ length: 8 }, () => Array.from({ length: 7 }, () => 999));
    expect(() => parseBatchPlaytestConfigRows([
      pathHeaders,
      ['PATH-SIZE', '是', '菱形', JSON.stringify(data), 2, 40, 1],
    ], 'path')).toThrow('行数与列数必须一致');
  });

  it('生成路径功能只计算路径', () => {
    const [config] = parseBatchPlaytestConfigRows([
      pathHeaders,
      ['PATH-1', '是', '正方形', formation3x3, 0, 40, 1, '路径'],
    ], 'path');
    const [task] = createBatchPlaytestTasks([config]);
    const request = createBatchPlaytestGenerationRequest(task, 0);
    const generated = runEditorAlgorithm(request.selection, request.context);
    expect(request.context.generationPhase).toBe('path');
    expect(request.context.fixedPath).toBeUndefined();
    expect(generated?.path).toHaveLength(9);
    expect(generated?.hiddenCells).toBeUndefined();
  });

  it('生成隐藏功能固定路径并忽略原隐藏正负号', () => {
    const [config] = parseBatchPlaytestConfigRows([
      hiddenHeaders,
      ['HIDDEN-1', '正方形', path3x3, 35, 8, 4, 2, 2],
    ], 'hidden');
    const tasks = createBatchPlaytestTasks([config]);
    const request = createBatchPlaytestGenerationRequest(tasks[0], 0);
    const generated = runEditorAlgorithm(request.selection, request.context);
    expect(request.context.generationPhase).toBe('hidden');
    expect(request.context.fixedPath).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 },
      { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
    ]);
    expect(generated?.path).toEqual(request.context.fixedPath);
    expect(generated?.hiddenCells).toBeDefined();
  });

  it('路径结果只输出路径统计', () => {
    const [config] = parseBatchPlaytestConfigRows([
      pathHeaders,
      ['PATH-1', '是', '正方形', formation3x3, 0, 40, 1, '路径'],
    ], 'path');
    const [task] = createBatchPlaytestTasks([config]);
    const request = createBatchPlaytestGenerationRequest(task, 0);
    const level = createBatchPlaytestLevel(task, runEditorAlgorithm(request.selection, request.context)!);
    const text = formatBatchPlaytestResultsTsv([{ task, level }], 'path', true);
    expect(text.split('\r\n')[0].split('\t')).toEqual([...BATCH_PATH_RESULT_HEADERS]);
    expect(BATCH_PATH_RESULT_HEADERS).toContain('实际路径交叉数量');
    expect(BATCH_PATH_RESULT_HEADERS).toEqual(expect.arrayContaining([
      '连续向右数量', '连续向下数量', '连续向右下数量', '连续遮挡计数',
    ]));
    expect(BATCH_PATH_RESULT_HEADERS).not.toContain('中推理平均错误数');
    expect(text.split('\r\n')[1].split('\t')).toHaveLength(BATCH_PATH_RESULT_HEADERS.length);
  });

  it('隐藏结果输出难度和低中高错误统计', async () => {
    const [config] = parseBatchPlaytestConfigRows([
      hiddenHeaders,
      ['HIDDEN-1', '正方形', path3x3, 35, 8, 4, 1, 2],
    ], 'hidden');
    const [task] = createBatchPlaytestTasks([config]);
    const request = createBatchPlaytestGenerationRequest(task, 0);
    const level = createBatchPlaytestLevel(task, runEditorAlgorithm(request.selection, request.context)!);
    const simulation = simulateBatchPlaytestLevel(task, level);
    const progress: number[] = [];
    expect(await simulateBatchPlaytestLevelAsync(task, level, {
      onProgress: (completed) => progress.push(completed),
    })).toEqual(simulation);
    const text = formatBatchPlaytestResultsTsv([{ task, level, simulation }], 'hidden', true);
    expect(text.split('\r\n')[0].split('\t')).toEqual([...BATCH_HIDDEN_RESULT_HEADERS]);
    expect(BATCH_HIDDEN_RESULT_HEADERS).toEqual(expect.arrayContaining([
      '平均每步难度分', '低推理平均错误数', '中推理平均错误数', '高推理平均错误数',
    ]));
    expect(BATCH_HIDDEN_RESULT_HEADERS).toEqual(expect.arrayContaining([
      '关卡名', '路径JSON', '实际路径交叉数量', '直角拐弯占比', '终点位置',
    ]));
    expect(text.split('\r\n')[1].split('\t')).toHaveLength(BATCH_HIDDEN_RESULT_HEADERS.length);
    expect(text.split('\r\n')[1].split('\t')[BATCH_HIDDEN_RESULT_HEADERS.indexOf('关卡名')])
      .toBe('HIDDEN-1_6');
    expect(progress).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('最多并行执行指定数量的任务并保持结果顺序', async () => {
    let running = 0;
    let peakRunning = 0;
    const results = await runConcurrentBatchTaskPool(
      [0, 1, 2, 3, 4, 5],
      async (value) => {
        running += 1;
        peakRunning = Math.max(peakRunning, running);
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 5 + (5 - value)));
        running -= 1;
        return value * 10;
      },
      { concurrency: 3 },
    );
    expect(peakRunning).toBe(3);
    expect(results).toEqual([0, 10, 20, 30, 40, 50]);
  });

  it('收到取消信号后不再派发后续任务', async () => {
    const controller = new AbortController();
    const started: number[] = [];
    await expect(runConcurrentBatchTaskPool(
      [0, 1, 2, 3],
      async (value) => {
        started.push(value);
        controller.abort();
        return value;
      },
      { concurrency: 1, signal: controller.signal },
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(started).toEqual([0]);
  });
});
