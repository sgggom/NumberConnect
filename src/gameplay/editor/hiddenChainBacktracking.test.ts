import { afterEach, describe, expect, it, vi } from 'vitest';
import { HiddenBacktrackPolicy, searchHiddenChain } from './hiddenChainBacktracking';
import type { BatchPlaytestTask } from './batchPlaytest';
import type { EditorAlgorithmResult } from './algorithms/types';

describe('hidden chain backtracking', () => {
  afterEach(() => vi.useRealTimers());
  it('escalates after ten retreats at the same difficulty, then retreats after every failed attempt', () => {
    const policy = new HiddenBacktrackPolicy();
    expect(policy.attemptLimit).toBe(100);
    for (let i = 0; i < 9; i++) expect(policy.retreat(5)).toBe(4);
    expect(policy.retreat(5)).toBe(3);
    expect(policy.attemptLimit).toBe(1);
    expect(policy.retreat(3)).toBe(2);
    expect(policy.retreat(0)).toBe(0);
  });
  it('reselects the previous rank after 100 failures, retaining the earlier prefix and excluding its dead-end layout', async () => {
    vi.useFakeTimers();
    const tasks = [1,2,3].map(difficulty => ({ config: { targetDifficulty: difficulty, seed: 1 } } as BatchPlaytestTask));
    const calls = [0,0,0];
    const seen: Array<{difficulty:number; previous:unknown; excluded:string[]}> = [];
    const first: EditorAlgorithmResult = { path: [], hiddenCells: [{x:1,y:1}], targetHiddenCount: 1 };
    const retry = vi.fn();
    const promise = searchHiddenChain({
      tasks, parallelism:()=>1, canceled:()=>false, onProgress:()=>undefined, onRetry:retry,
      start: (task, search) => {
        const d = task.config.targetDifficulty;
        calls[d-1]++;
        seen.push({difficulty:d,previous:search.previousHiddenCells,excluded:search.excludedLayouts??[]});
        if (d === 3 && calls[1] === 1) return {promise:Promise.reject(new Error('No match')),cancel:()=>undefined};
        const result = d === 1 ? first : {path:[],hiddenCells:[...(search.previousHiddenCells??[]),{x:d,y:calls[d-1]}],targetHiddenCount:d};
        return {promise:Promise.resolve([result]),cancel:()=>undefined};
      },
    });
    await vi.advanceTimersByTimeAsync(200);
    const results = await promise;
    expect(calls).toEqual([1,2,101]);
    expect(results[0]).toBe(first);
    expect(seen.filter(s=>s.difficulty===2)[1].previous).toEqual(first.hiddenCells);
    expect(seen.filter(s=>s.difficulty===2)[1].excluded).toEqual(['1,1|2,1']);
    expect(retry.mock.calls.some(c=>c[1].includes('回退到难度 2'))).toBe(true);
    expect(results[2].hiddenCells).toContainEqual({x:2,y:2});
  });
});
