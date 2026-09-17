import type { BatchPlaytestTask } from './batchPlaytest';
import type { EditorAlgorithmResult } from './algorithms/types';
import type { ProgressiveHiddenWorkerRequest } from './progressiveHiddenWorkerProtocol';

export class HiddenBacktrackPolicy {
  public immediate = false;
  private readonly retreats = new Map<number, number>();
  public get attemptLimit(): number { return this.immediate ? 1 : 100; }
  public retreat(index: number): number {
    if (this.immediate) return Math.max(0, index - 1);
    const count = (this.retreats.get(index) ?? 0) + 1;
    this.retreats.set(index, count);
    if (count >= 10) { this.immediate = true; return Math.max(0, index - 2); }
    return Math.max(0, index - 1);
  }
}

interface Attempt { promise: Promise<EditorAlgorithmResult[]>; cancel: () => void }
const signature = (result: EditorAlgorithmResult): string => (result.hiddenCells ?? []).map(c => `${c.x},${c.y}`).sort().join('|');

export const searchHiddenChain = async (options: {
  tasks: ReadonlyArray<BatchPlaytestTask>;
  start: (task: BatchPlaytestTask, search: NonNullable<ProgressiveHiddenWorkerRequest['search']>) => Attempt;
  parallelism: () => number;
  canceled: () => boolean;
  onProgress: (completed: number, total: number, difficulty: number) => void;
  onRetry: (attempt: number, reason: string) => void;
}): Promise<EditorAlgorithmResult[]> => {
  const policy = new HiddenBacktrackPolicy();
  const results: EditorAlgorithmResult[] = [];
  const excluded = options.tasks.map(() => new Set<string>());
  let failures = 0, serial = 0, epoch = 0;
  const check = (): void => { if (options.canceled()) { const error = new Error('隐藏生成已取消'); error.name = 'AbortError'; throw error; } };
  // Register all active chains before assigning otherwise-idle slots to a single chain.
  await new Promise<void>(resolve => globalThis.setTimeout(resolve, 0));
  while (results.length < options.tasks.length) {
    check();
    const index = results.length;
    const task = options.tasks[index];
    const width = Math.max(1, policy.immediate ? options.parallelism() : Math.min(options.parallelism(), policy.attemptLimit - failures));
    const jobs: Attempt[] = [];
    let result: EditorAlgorithmResult | undefined;
    let reason = '未找到满足评分目标的布局';
    try {
      for (let i = 0; i < width; i++) {
        serial++;
        jobs.push(options.start({ ...task, config: { ...task.config, seed: (task.config.seed + Math.imul(epoch, 0x9e3779b1)) >>> 0 } }, {
          seed: (task.config.seed ^ Math.imul(serial, 104729)) >>> 0,
          previousHiddenCells: results[index - 1]?.hiddenCells,
          excludedLayouts: [...excluded[index]],
        }));
      }
      const settled = await Promise.any(jobs.map(job => job.promise));
      result = settled[0];
      if (!result) throw new Error('生成线程返回空布局');
    } catch (error) {
      reason = error instanceof AggregateError ? String(error.errors[0]?.message ?? reason) : String(error);
    } finally { jobs.forEach(job => job.cancel()); }
    check();
    if (result) {
      results.push(result); failures = 0;
      options.onProgress(results.length, options.tasks.length, task.config.targetDifficulty);
      continue;
    }
    failures += width;
    if (failures >= policy.attemptLimit) {
      const destination = policy.retreat(index);
      if (results[destination]) excluded[destination].add(signature(results[destination]));
      results.length = destination;
      for (let d = destination + 1; d < excluded.length; d++) excluded[d].clear();
      if (destination === 0) { epoch++; excluded[0].clear(); }
      options.onRetry(serial, `难度 ${index + 1} 已尝试 ${failures} 次未达标，回退到难度 ${destination + 1}${policy.immediate ? '，后续失败立即回退' : ''}。${reason}`);
      options.onProgress(destination, options.tasks.length, destination + 1);
      failures = 0;
    } else options.onRetry(serial, `难度 ${index + 1} 已尝试 ${failures}/100 次，继续搜索。${reason}`);
    await new Promise<void>(resolve => globalThis.setTimeout(resolve, 0));
  }
  return results;
};
