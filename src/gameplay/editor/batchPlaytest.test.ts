import { describe, expect, it, vi } from 'vitest';
import { runEditorAlgorithm } from './algorithms';
import {
  BATCH_HIDDEN_RESULT_HEADERS,
  BATCH_PATH_RESULT_HEADERS,
  batchPlaytestConcurrency,
  createBatchPlaytestGenerationRequest,
  createBatchPlaytestLevel,
  createBatchPlaytestTaskChains,
  createBatchPlaytestTasks,
  createProgressiveBatchHiddenResult,
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
  '配置ID', '棋盘形状', '关卡数据', '分段长度区间',
  '最长连续显示', '生成隐藏数', '每关跑关次数',
];
const formation3x3 = JSON.stringify({
  data: [[999, 999, 999], [999, 999, 999], [999, 999, 999]],
});
const path3x3 = JSON.stringify({ data: [[1, -2, 3], [6, 5, 4], [7, -8, 9]] });
const path5x5 = JSON.stringify({
  data: [
    [1, -2, 3, 4, 5],
    [10, 9, 8, 7, 6],
    [11, 12, 13, -14, 15],
    [20, 19, 18, 17, 16],
    [21, 22, 23, 24, 25],
  ],
});

describe('批量生成路径与隐藏', () => {
  it('按设备逻辑线程数动态扩展并保留一个线程', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 16 });
    expect(batchPlaytestConcurrency()).toBe(15);
    vi.stubGlobal('navigator', { hardwareConcurrency: 64 });
    expect(batchPlaytestConcurrency()).toBe(32);
    vi.unstubAllGlobals();
  });

  it('两个功能分别只要求自己的控制参数', () => {
    const [pathConfig] = parseBatchPlaytestConfigRows([
      pathHeaders,
      ['PATH-1', '是', '正方形', formation3x3, 2, 40, 2, '路径', ''],
    ], 'path');
    const [hiddenConfig] = parseBatchPlaytestConfigRows([
      hiddenHeaders,
      ['HIDDEN-1', '正方形', path5x5, '[5,9]', 8, 2, 3],
    ], 'hidden');
    expect(pathConfig).toMatchObject({ mode: 'path', generationCount: 2, simulationRunCount: 0 });
    expect(hiddenConfig).toMatchObject({
      mode: 'hidden',
      segmentLengthMin: 5,
      segmentLengthMax: 9,
      generationCount: 2,
      simulationRunCount: 3,
    });
  });

  it('批量生成路径不限制单行或总生成数量', () => {
    const configs = parseBatchPlaytestConfigRows([
      pathHeaders,
      ['PATH-MANY-1', '是', '正方形', formation3x3, 2, 40, 600, '路径', ''],
      ['PATH-MANY-2', '是', '正方形', formation3x3, 2, 40, 600, '路径', ''],
    ], 'path');

    expect(configs.map(({ generationCount }) => generationCount)).toEqual([600, 600]);
    expect(createBatchPlaytestTasks(configs)).toHaveLength(1200);
  });

  it('默认按每个生成序号依次展开难度 1–10', () => {
    const [config] = parseBatchPlaytestConfigRows([
      hiddenHeaders,
      ['HIDDEN-ALL', '正方形', path5x5, '[5,9]', 8, 2, 1],
    ], 'hidden');
    const tasks = createBatchPlaytestTasks([config]);

    expect(tasks).toHaveLength(20);
    expect(tasks.map((task) => task.config.targetDifficulty)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(tasks.map((task) => task.generationNumber)).toEqual([
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    ]);
    expect(createBatchPlaytestTaskChains(tasks).map((chain) => chain.length)).toEqual([10, 10]);
  });

  it('隐藏任务不再接受单难度选择', () => {
    const [config] = parseBatchPlaytestConfigRows([
      hiddenHeaders,
      ['HIDDEN-ONE', '正方形', path5x5, '[5,9]', 8, 1, 1],
    ], 'hidden');
    const tasks = createBatchPlaytestTasks([config]);

    expect(tasks.map((task) => task.config.targetDifficulty)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('严格区分造型和路径输入', () => {
    expect(() => parseBatchPlaytestConfigRows([
      pathHeaders,
      ['PATH-BAD', '是', '正方形', path3x3, 2, 40, 1],
    ], 'path')).toThrow('只接受含 999 的棋盘造型');
    expect(() => parseBatchPlaytestConfigRows([
      hiddenHeaders,
      ['HIDDEN-BAD', '正方形', formation3x3, '[5,9]', 8, 1, 2],
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
      ['HIDDEN-1', '正方形', path5x5, '[5,9]', 8, 2, 2],
    ], 'hidden');
    const tasks = createBatchPlaytestTasks([config]);
    const generated = createProgressiveBatchHiddenResult(tasks[0]);
    expect(tasks[0].config.presetPath).toHaveLength(25);
    expect(tasks[0].config.presetPath?.[1]).toEqual({ x: 1, y: 0 });
    expect(tasks[0].config.presetPath?.[13]).toEqual({ x: 3, y: 2 });
    expect(generated.path).toEqual(tasks[0].config.presetPath);
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
      ['HIDDEN-1', '正方形', path5x5, '[5,9]', 8, 1, 2],
    ], 'hidden');
    const [task] = createBatchPlaytestTasks([config]);
    const level = createBatchPlaytestLevel(task, createProgressiveBatchHiddenResult(task));
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
      .toBe('HIDDEN-1_1');
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
