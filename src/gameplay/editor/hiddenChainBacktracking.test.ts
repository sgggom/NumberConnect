import { afterEach, describe, expect, it, vi } from 'vitest';
import { enumerateHiddenCandidates, searchHiddenChain } from './hiddenChainBacktracking';
import type { BatchPlaytestTask } from './batchPlaytest';
import type { EditorCell } from './types';

const path=Array.from({length:10},(_,x)=>({x,y:0}));
const task=(d:number):BatchPlaytestTask=>({taskIndex:d-1,generationNumber:1,config:{mode:'hidden',sourceRow:2,id:'fixture',enabled:true,shape:'square',rows:1,columns:10,targetCrossings:0,turnProbability:0,hiddenPercent:0,segmentLengthMin:5,segmentLengthMax:5,targetDifficulty:d,maxVisibleRun:9,maxHiddenRun:3,generationCount:1,simulationRunCount:1,reasoningLevel:'medium',seed:1,outputLabel:'',presetPath:path,hiddenScoreTargets:{one:Array(10).fill(0),two:Array(10).fill(0)}}});
const signature=(cells:EditorCell[]=[])=>cells.map(c=>c.x).join(',');
const rejected=()=>{const e=new Error('No match');e.name='HiddenCandidateRejected';return e;};
describe('exhaustive hidden candidate search',()=>{
  afterEach(()=>vi.useRealTimers());
  it('enumerates single additions and unordered multi-position combinations once',()=>{
    const previous=[path[1],path[5]];
    const singles=[...enumerateHiddenCandidates(task(2),previous)];
    expect(singles.map(signature)).toEqual(['1,5,6','1,5,7','1,5,8']);
    const two=task(5); two.config.hiddenScoreTargets!.one[4]=1;
    // Difficulty 5 on ten digits needs one extra, unless inherited totals force another.
    const combos=[...enumerateHiddenCandidates(two,previous)];
    expect(combos.map(signature)).toEqual(['1,5,6,7','1,5,6,8','1,5,7,8']);
    expect(new Set(combos.map(signature)).size).toBe(combos.length);
  });
  it('preserves an already-scored parallel sibling and resumes it when the next rank is exhausted',async()=>{
    vi.useFakeTimers();
    const seen:string[]=[];let firstParent='';
    const promise=searchHiddenChain({tasks:[task(1),task(2)],parallelism:()=>2,canceled:()=>false,onProgress:()=>undefined,onRetry:()=>undefined,
      start:(t,s)=>{
        const current=signature(s.candidateHiddenCells),parent=signature(s.previousHiddenCells);
        seen.push(`${t.config.targetDifficulty}:${parent}:${current}`);
        if(t.config.targetDifficulty===1 && !firstParent)firstParent=current;
        const bad=t.config.targetDifficulty===2 && parent===firstParent;
        return {promise:bad?Promise.reject(rejected()):Promise.resolve([{path,hiddenCells:s.candidateHiddenCells,targetHiddenCount:s.candidateHiddenCells!.length}]),cancel:()=>undefined};
      }});
    await vi.advanceTimersByTimeAsync(100);
    const result=await promise;
    expect(signature(result[0].hiddenCells)).not.toBe(firstParent);
    expect(seen.filter(s=>s.startsWith('1:'))).toHaveLength(2);
    expect(new Set(seen).size).toBe(seen.length);
    expect(result[0].hiddenCells!.every(c=>result[1].hiddenCells!.includes(c))).toBe(true);
  });
  it('reports exhaustion only after checking every base candidate exactly once',async()=>{
    vi.useFakeTimers();const seen:string[]=[];
    const promise=searchHiddenChain({tasks:[task(1)],parallelism:()=>3,canceled:()=>false,onProgress:()=>undefined,onRetry:()=>undefined,start:(_,s)=>{seen.push(signature(s.candidateHiddenCells));return{promise:Promise.reject(rejected()),cancel:()=>undefined};}});
    const check=expect(promise).rejects.toMatchObject({name:'HiddenCandidatesExhausted'});
    await vi.advanceTimersByTimeAsync(100);await check;
    expect(seen).toEqual([...enumerateHiddenCandidates(task(1))].map(signature));
  });
  it('does not mislabel a worker timeout as an exhausted or impossible candidate',async()=>{
    vi.useFakeTimers();
    const promise=searchHiddenChain({tasks:[task(1)],parallelism:()=>1,canceled:()=>false,onProgress:()=>undefined,onRetry:()=>undefined,start:()=>({promise:Promise.reject(new Error('timeout')),cancel:()=>undefined})});
    const check=expect(promise).rejects.toMatchObject({name:'HiddenEnumerationInterrupted'});
    await vi.advanceTimersByTimeAsync(10);await check;
  });
});
