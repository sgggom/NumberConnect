import { describe, expect, it } from 'vitest';
import { runEditorAlgorithm } from './algorithms';
import {
  BATCH_PLAYTEST_RESULT_HEADERS,
  createBatchPlaytestGenerationRequest,
  createBatchPlaytestLevel,
  createBatchPlaytestTasks,
  formatBatchPlaytestResultsTsv,
  parseBatchPlaytestConfigRows,
  runConcurrentBatchTaskPool,
  simulateBatchPlaytestLevel,
  simulateBatchPlaytestLevelAsync,
} from './batchPlaytest';

const headers = [
  '配置ID', '启用', '棋盘形状', '行数', '列数', '最大交叉数量', '路径拐弯概率 %',
  '基础隐藏占比 %', '目标难度', '实际隐藏占比 %', '最长连续显示', '最长连续隐藏',
  '生成关卡数', '每关跑关次数', '推理能力', '随机种子', '预计总跑关次数', '输出标签', '备注',
];

describe('批量跑关', () => {
  it('读取项目中的实际配置模板', async () => {
    const { readSheet } = await import('read-excel-file/node');
    const rows = await readSheet('excel/批量跑关配置模板.xlsx', '跑关配置');
    const headerIndex = rows.findIndex((row) => row[0] === '配置ID');
    expect(headerIndex).toBeGreaterThanOrEqual(0);
    const configuredRowIndex = rows.findIndex((row, index) => index > headerIndex && row[0]);
    expect(configuredRowIndex).toBeGreaterThan(headerIndex);
    const enabledRows = rows.map((row, index) => (
      index === configuredRowIndex ? row.map((value, column) => (column === 1 ? '是' : value)) : row
    ));
    const configs = parseBatchPlaytestConfigRows(enabledRows);

    expect(configs).toHaveLength(1);
    expect(configs[0].id).toBe(String(rows[configuredRowIndex][0]));
  });

  it('读取模板中的启用行并忽略公式列和停用行', () => {
    const configs = parseBatchPlaytestConfigRows([
      ['批量跑关配置模板'],
      [],
      headers,
      ['CFG-001', '是', '正方形', 3, 3, 2, 40, 35, 6, 41, 8, 4, 2, 3, '中', 20260817, 6, '默认', ''],
      ['CFG-002', '否', '长方形', 1, 2, 20, 40, 35, 6, 41, 8, 4, 5, 5, '高', 2, 25, '', ''],
    ]);

    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({
      sourceRow: 4,
      id: 'CFG-001',
      shape: 'square',
      generationCount: 2,
      simulationRunCount: 3,
      reasoningLevel: 'medium',
    });
  });

  it('校验形状尺寸、重复ID和任务总量', () => {
    const row = ['CFG-001', '是', '菱形', 8, 7, 2, 40, 35, 6, 41, 8, 4, 2, 3, '中', 1];
    expect(() => parseBatchPlaytestConfigRows([headers, row]))
      .toThrow('行数与列数必须一致');
  });

  it('生成、模拟并导出带表头的结果', async () => {
    const [config] = parseBatchPlaytestConfigRows([
      headers,
      ['CFG-001', '是', '正方形', 3, 3, 0, 40, 35, 6, 41, 8, 4, 1, 2, '中', 1234, 2, '冒烟'],
    ]);
    const [task] = createBatchPlaytestTasks([config]);
    const request = createBatchPlaytestGenerationRequest(task, 0);
    const generated = runEditorAlgorithm(request.selection, request.context);
    expect(generated).not.toBeNull();
    const level = createBatchPlaytestLevel(task, generated!);
    const simulation = simulateBatchPlaytestLevel(task, level);
    const simulationProgress: number[] = [];
    const asyncSimulation = await simulateBatchPlaytestLevelAsync(task, level, {
      onProgress: (completed) => simulationProgress.push(completed),
    });
    const text = formatBatchPlaytestResultsTsv([{ task, level, simulation }], true);

    expect(level.hiddenCells?.filter((cell) => (
      level.solutionPath.slice(0, 4).some((first) => first.x === cell.x && first.y === cell.y)
    )).length).toBeLessThanOrEqual(1);
    expect(text.split('\r\n')[0].split('\t')).toEqual([...BATCH_PLAYTEST_RESULT_HEADERS]);
    expect(BATCH_PLAYTEST_RESULT_HEADERS.slice(0, 2)).toEqual(['配置ID', '输出标签']);
    expect(BATCH_PLAYTEST_RESULT_HEADERS).not.toContain('平均错误数');
    expect(BATCH_PLAYTEST_RESULT_HEADERS).toEqual(expect.arrayContaining([
      '低推理平均错误数', '中推理平均错误数', '高推理平均错误数',
    ]));
    expect(simulation.errorCount).toBe(simulation.averageErrorCountByReasoning.medium);
    expect(asyncSimulation).toEqual(simulation);
    expect(simulationProgress).toEqual([1, 2, 3, 4, 5, 6]);
    const abortController = new AbortController();
    await expect(simulateBatchPlaytestLevelAsync(task, level, {
      signal: abortController.signal,
      onProgress: (completed) => {
        if (completed === 1) abortController.abort();
      },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(text).toContain('CFG-001\t冒烟');
    const values = text.split('\r\n')[1].split('\t');
    expect(values).toHaveLength(BATCH_PLAYTEST_RESULT_HEADERS.length);
    expect(values[BATCH_PLAYTEST_RESULT_HEADERS.indexOf('推理能力')]).toBe('中');
    expect(Number(values[BATCH_PLAYTEST_RESULT_HEADERS.indexOf('中推理平均错误数')]))
      .toBeCloseTo(simulation.errorCount);
    const rightAngleRatio = Number(values[BATCH_PLAYTEST_RESULT_HEADERS.indexOf('直角拐弯占比')]);
    expect(rightAngleRatio).toBeGreaterThanOrEqual(0);
    expect(rightAngleRatio).toBeLessThanOrEqual(1);
    expect(Number(values[BATCH_PLAYTEST_RESULT_HEADERS.indexOf('平均路径长度（拐弯的拐点算作端点，看整个棋盘中的线段平均长度）')]))
      .toBeGreaterThan(0);
    expect(['左上', '右上', '左下', '右下', '靠中'])
      .toContain(values[BATCH_PLAYTEST_RESULT_HEADERS.indexOf('起点位置（分为左上/右上/左下/右下/靠中）')]);
    expect(formatBatchPlaytestResultsTsv([{ task, level, simulation }]).startsWith('CFG-001\t冒烟'))
      .toBe(true);
  });

  it('最多并行执行指定数量的任务并保持结果顺序', async () => {
    let running = 0;
    let peakRunning = 0;
    const progress: Array<{ completed: number; running: number; failed: number }> = [];
    const results = await runConcurrentBatchTaskPool(
      [0, 1, 2, 3, 4, 5],
      async (value) => {
        running += 1;
        peakRunning = Math.max(peakRunning, running);
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 5 + (5 - value)));
        running -= 1;
        return value === 3 ? -1 : value * 10;
      },
      {
        concurrency: 3,
        isFailure: (value) => value < 0,
        onProgress: ({ completed, running: active, failed }) => {
          progress.push({ completed, running: active, failed });
        },
      },
    );

    expect(peakRunning).toBe(3);
    expect(results).toEqual([0, 10, 20, -1, 40, 50]);
    expect(progress.at(-1)).toEqual({ completed: 6, running: 0, failed: 1 });
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
