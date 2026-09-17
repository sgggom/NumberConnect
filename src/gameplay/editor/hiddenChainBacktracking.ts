import { progressiveChainSeed, type BatchPlaytestTask } from './batchPlaytest';
import type { EditorAlgorithmResult } from './algorithms/types';
import type { ProgressiveHiddenWorkerRequest } from './progressiveHiddenWorkerProtocol';
import { createProgressiveHiddenSegments } from './progressiveHiddenLayout';
import { targetHiddenCounts } from './targetHiddenLayout';
import type { EditorCell } from './types';

interface Attempt { promise: Promise<EditorAlgorithmResult[]>; cancel: () => void }
const key = (cell: EditorCell): string => `${cell.x},${cell.y}`;

/** Lazy ordered combinations; never materialize the whole candidate pool. */
export function* enumerateHiddenCandidates(task: BatchPlaytestTask, previous: EditorCell[] = []): Generator<EditorCell[]> {
  const config = task.config, path = config.presetPath;
  if (!path || !config.hiddenScoreTargets) throw new Error('缺少预设路径或评分目标。');
  const segments = createProgressiveHiddenSegments(path.length, config.segmentLengthMin, config.segmentLengthMax, progressiveChainSeed(task, 0));
  const total = targetHiddenCounts(path.length, segments.length, config.hiddenScoreTargets)[config.targetDifficulty - 1];
  const indexByKey = new Map(path.map((c,i)=>[key(c),i]));
  const locked = new Set(previous.map(c => {
    const index = indexByKey.get(key(c));
    if (index === undefined) throw new Error('继承位置不在路径中。');
    return index;
  }));
  const selected: number[] = [];
  const cells = (): EditorCell[] => [...locked,...selected].sort((a,b)=>a-b).map(i=>path[i]);
  if (config.targetDifficulty === 1) {
    function* base(segmentIndex: number, last: number): Generator<EditorCell[]> {
      if (segmentIndex === segments.length) {
        if (path!.length - last - 1 <= config.maxVisibleRun) yield cells();
        return;
      }
      const segment = segments[segmentIndex];
      for (let i = Math.max(1,segment.start); i < Math.min(path!.length - 1,segment.end); i++) {
        if ((last >= 0 && i-last <= 1) || i-last-1 > config.maxVisibleRun) continue;
        selected.push(i); yield* base(segmentIndex+1,i); selected.pop();
      }
    }
    yield* base(0,-1); return;
  }
  const domain = path.map((_,i)=>i).filter(i=>i>=segments[0].end && i<path.length-1 && !locked.has(i));
  const needed = total-locked.size;
  if (needed < 0 || needed > domain.length) return;
  function* combinations(start: number, remaining: number): Generator<EditorCell[]> {
    if (remaining === 0) { yield cells(); return; }
    for (let i = start; i <= domain.length-remaining; i++) {
      selected.push(domain[i]); yield* combinations(i+1,remaining-1); selected.pop();
    }
  }
  yield* combinations(0,needed);
}

/** Depth-first enumeration for the fixed partition, retaining each rank's cursor. */
export const searchHiddenChain = async (options: {
  tasks: ReadonlyArray<BatchPlaytestTask>;
  start: (task: BatchPlaytestTask, search: NonNullable<ProgressiveHiddenWorkerRequest['search']>) => Attempt;
  parallelism: () => number;
  canceled: () => boolean;
  onProgress: (completed: number, total: number, difficulty: number) => void;
  onRetry: (attempt: number, reason: string) => void;
}): Promise<EditorAlgorithmResult[]> => {
  const results: EditorAlgorithmResult[] = [];
  const frames: Array<{ candidates: Generator<EditorCell[]>; ready: EditorAlgorithmResult[]; done: boolean; checked: number }> = [];
  let serial = 0;
  const check = (): void => { if (options.canceled()) { const error = new Error('隐藏生成已取消'); error.name = 'AbortError'; throw error; } };
  await new Promise<void>(resolve=>globalThis.setTimeout(resolve,0));
  while (results.length < options.tasks.length) {
    check();
    const index = results.length, task = options.tasks[index];
    const frame = frames[index] ??= { candidates: enumerateHiddenCandidates(task,results[index-1]?.hiddenCells),ready:[],done:false,checked:0 };
    if (frame.ready.length) {
      results.push(frame.ready.shift()!);
      options.onProgress(results.length,options.tasks.length,task.config.targetDifficulty);
      continue;
    }
    if (frame.done) {
      frames.pop();
      if (index === 0) {
        const error = new Error('当前路径在本次固定分段方案下的隐藏候选已全部穷尽，未找到满足全部难度的布局。');
        error.name = 'HiddenCandidatesExhausted'; throw error;
      }
      results.pop();
      options.onRetry(serial,`难度 ${index+1} 的 ${frame.checked} 个候选已全部用完，回退难度 ${index}，继续尚未尝试的方案。`);
      options.onProgress(index,options.tasks.length,index);
      continue;
    }
    const jobs: Attempt[] = [];
    try {
      for (let i=0;i<Math.max(1,options.parallelism());i++) {
        const candidate=frame.candidates.next();
        if (candidate.done) { frame.done=true; break; }
        serial++; frame.checked++;
        jobs.push(options.start(task,{ seed:0,previousHiddenCells:results[index-1]?.hiddenCells,candidateHiddenCells:candidate.value }));
      }
      const settled=await Promise.allSettled(jobs.map(job=>job.promise));
      check();
      // Retain every matching sibling; do not discard candidates after the first success.
      for (const result of settled) {
        if (result.status==='fulfilled') {
          if (result.value.length!==1) throw new Error('候选校验线程返回异常结果。');
          frame.ready.push(result.value[0]);
        } else if (!(result.reason instanceof Error) || result.reason.name!=='HiddenCandidateRejected') {
          const error=new Error(`候选校验中断，不能判定无解：${String(result.reason?.message ?? result.reason)}`);
          error.name=result.reason?.name==='AbortError'?'AbortError':'HiddenEnumerationInterrupted'; throw error;
        }
      }
    } finally { jobs.forEach(job=>job.cancel()); }
    options.onRetry(serial,`难度 ${index+1} 已校验 ${frame.checked} 个不同候选，待尝试达标方案 ${frame.ready.length} 个。`);
    await new Promise<void>(resolve=>globalThis.setTimeout(resolve,0));
  }
  return results;
};
