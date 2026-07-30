import {
  createAlgorithm4BatchTasks,
  finalizeAlgorithm4BatchTaskResults,
  generateAlgorithm4BatchLevels,
  type Algorithm4BatchConfig,
  type Algorithm4BatchProgress,
  type Algorithm4BatchResult,
  type Algorithm4BatchTask,
  type Algorithm4BatchTaskResult,
} from './batchLevelGeneration';
import type {
  Algorithm4BatchWorkerRequest,
  Algorithm4BatchWorkerResponse,
} from './batchLevelGenerationWorkerProtocol';

export const MAX_ALGORITHM4_BATCH_WORKERS = 8;

export interface Algorithm4BatchPoolOptions {
  maxWorkers?: number;
  onProgress?: Algorithm4BatchProgress;
  onWorkerCount?: (workerCount: number) => void;
}

export const resolveAlgorithm4BatchWorkerCount = (
  taskCount: number,
  hardwareConcurrency: number | undefined = globalThis.navigator?.hardwareConcurrency,
  maxWorkers = MAX_ALGORITHM4_BATCH_WORKERS,
): number => {
  const normalizedTaskCount = Math.max(0, Math.floor(taskCount));
  if (normalizedTaskCount <= 1) return normalizedTaskCount;

  const normalizedHardwareConcurrency = Number.isFinite(hardwareConcurrency)
    ? Math.max(1, Math.floor(hardwareConcurrency ?? 1))
    : 4;
  const availableGenerationThreads = normalizedHardwareConcurrency <= 1
    ? 1
    : Math.max(2, normalizedHardwareConcurrency - 1);
  return Math.min(
    normalizedTaskCount,
    Math.max(1, Math.floor(maxWorkers)),
    availableGenerationThreads,
  );
};

const createBatchWorker = (): Worker => new Worker(
  new URL('./batchLevelGeneration.worker.ts', import.meta.url),
  {
    type: 'module',
    name: 'algorithm-4-batch-generator',
  },
);

const workerErrorMessage = (
  task: Algorithm4BatchTask | undefined,
  detail: string,
): string => {
  const taskLabel = task
    ? `配置表第 ${task.config.sourceRow} 行第 ${task.generationNumber} 次`
    : '当前任务';
  return `${taskLabel}生成线程失败：${detail}`;
};

const runWorkerPool = (
  workers: ReadonlyArray<Worker>,
  tasks: ReadonlyArray<Algorithm4BatchTask>,
  firstLevelId: number,
  onProgress?: Algorithm4BatchProgress,
): Promise<Algorithm4BatchResult> => new Promise((resolve, reject) => {
  const taskResults: Array<Algorithm4BatchTaskResult | undefined> = Array(tasks.length);
  const activeTasks = new Map<Worker, Algorithm4BatchTask>();
  let nextTaskIndex = 0;
  let completed = 0;
  let settled = false;

  const terminateWorkers = (): void => {
    workers.forEach((worker) => worker.terminate());
    activeTasks.clear();
  };

  const fail = (message: string): void => {
    if (settled) return;
    settled = true;
    terminateWorkers();
    reject(new Error(message));
  };

  const dispatchNext = (worker: Worker): void => {
    const task = tasks[nextTaskIndex];
    if (!task) return;
    nextTaskIndex += 1;
    activeTasks.set(worker, task);
    const request: Algorithm4BatchWorkerRequest = { type: 'generate', task };
    try {
      worker.postMessage(request);
    } catch (error) {
      fail(workerErrorMessage(
        task,
        error instanceof Error ? error.message : '无法发送生成任务。',
      ));
    }
  };

  workers.forEach((worker) => {
    worker.addEventListener('message', (event: MessageEvent<Algorithm4BatchWorkerResponse>) => {
      if (settled) return;
      const response = event.data;
      const activeTask = activeTasks.get(worker);

      if (response.type === 'error') {
        fail(workerErrorMessage(activeTask, response.message));
        return;
      }

      const { result } = response;
      if (
        !activeTask
        || result.taskIndex !== activeTask.taskIndex
        || result.taskIndex < 0
        || result.taskIndex >= tasks.length
        || taskResults[result.taskIndex]
      ) {
        fail(workerErrorMessage(activeTask, '返回了无效的任务结果。'));
        return;
      }

      taskResults[result.taskIndex] = result;
      activeTasks.delete(worker);
      completed += 1;
      try {
        onProgress?.(completed, tasks.length, result.sourceRow);
      } catch (error) {
        fail(error instanceof Error ? error.message : '更新生成进度失败。');
        return;
      }

      if (completed === tasks.length) {
        settled = true;
        terminateWorkers();
        resolve(finalizeAlgorithm4BatchTaskResults(
          taskResults as Algorithm4BatchTaskResult[],
          firstLevelId,
        ));
        return;
      }
      dispatchNext(worker);
    });
    worker.addEventListener('error', (event) => {
      event.preventDefault();
      fail(workerErrorMessage(
        activeTasks.get(worker),
        event.message || '线程脚本加载或运行失败。',
      ));
    });
    worker.addEventListener('messageerror', () => {
      fail(workerErrorMessage(activeTasks.get(worker), '线程结果无法解析。'));
    });
  });

  workers.forEach(dispatchNext);
});

export const generateAlgorithm4BatchLevelsInWorkers = async (
  configs: ReadonlyArray<Algorithm4BatchConfig>,
  firstLevelId: number,
  seed: number,
  options: Algorithm4BatchPoolOptions = {},
): Promise<Algorithm4BatchResult> => {
  const tasks = createAlgorithm4BatchTasks(configs, seed);
  if (tasks.length === 0) {
    options.onWorkerCount?.(0);
    return finalizeAlgorithm4BatchTaskResults([], firstLevelId);
  }

  const workerCount = resolveAlgorithm4BatchWorkerCount(
    tasks.length,
    globalThis.navigator?.hardwareConcurrency,
    options.maxWorkers,
  );
  if (workerCount <= 1 || typeof Worker === 'undefined') {
    options.onWorkerCount?.(1);
    return generateAlgorithm4BatchLevels(
      configs,
      firstLevelId,
      seed,
      options.onProgress,
    );
  }

  const workers: Worker[] = [];
  try {
    for (let index = 0; index < workerCount; index += 1) {
      workers.push(createBatchWorker());
    }
  } catch {
    workers.forEach((worker) => worker.terminate());
    options.onWorkerCount?.(1);
    return generateAlgorithm4BatchLevels(
      configs,
      firstLevelId,
      seed,
      options.onProgress,
    );
  }

  options.onWorkerCount?.(workers.length);
  return runWorkerPool(workers, tasks, firstLevelId, options.onProgress);
};
