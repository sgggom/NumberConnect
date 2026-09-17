import { describe, expect, it } from 'vitest';
import { decodeCompactLevelData } from '../../game/levelDataFormat';
import { calculateHiddenDifficultyCounts } from './hiddenDifficultyCounts';
import { createTargetHiddenLayout, targetHiddenCounts } from './targetHiddenLayout';
import { HIDDEN_SCORE_TARGET_HEADERS, parseBatchPlaytestConfigRows } from './batchPlaytest';

const targets = { one: [0,0,0,0,1,1,1,2,2,2], two: [0,0,0,0,0,0,0,1,1,1] };
const data = [[1,4,5,20,19],[2,3,21,6,18],[11,12,7,22,17],[10,8,13,16,23],[9,14,15,24,25]];
const path = decodeCompactLevelData({ data }, 1, false).solutionPath;
const key = (c: {x:number;y:number}) => `${c.x},${c.y}`;
describe('strict target hidden generation', () => {
  it('reproduces a complete ten-rank chain and independently scores every layout', () => {
    let previous;
    for (let difficulty = 1; difficulty <= 10; difficulty++) {
      const hidden = createTargetHiddenLayout({ path, targets, difficulty, seed: 98765, segmentLengthMin: 6, segmentLengthMax: 9, maxVisibleRun: 9, previousHiddenCells: previous });
      const keys = new Set(hidden.map(key));
      expect(previous?.every(c => keys.has(key(c))) ?? true).toBe(true);
      expect(calculateHiddenDifficultyCounts({ path, hiddenCellKeys: keys, shape: 'square' })).toEqual([hidden.length-targets.one[difficulty-1]-targets.two[difficulty-1],targets.one[difficulty-1],targets.two[difficulty-1]]);
      previous = hidden;
    }
  });
  it('adds one when rounded totals conflict with a changed target and inherits overrides', () => {
    const large = {one:[0,1,1,1,2,2,2,3,3,3],two:[0,0,0,0,0,1,1,2,2,3]};
    const totals = targetHiddenCounts(56, 8, large);
    expect(totals[9]).toBe(totals[8]+1);
    const changing = {one:[0,1,2,3,4,5,6,7,8,9],two:Array(10).fill(0)};
    expect(targetHiddenCounts(10, 2, changing)).toEqual([2,3,4,5,6,7,8,9,10,11]);
  });
  it('changes candidates without changing segmentation and excludes a previously exhausted layout', () => {
    const options = {path,targets,difficulty:1,seed:98765,segmentLengthMin:6,segmentLengthMax:9,maxVisibleRun:9};
    const first = createTargetHiddenLayout({...options,search:{seed:101}});
    const signature = first.map(key).sort().join('|');
    const second = createTargetHiddenLayout({...options,search:{seed:102,excludedLayouts:[signature]}});
    expect(second).toHaveLength(first.length);
    expect(second.map(key).sort().join('|')).not.toBe(signature);
    expect(calculateHiddenDifficultyCounts({path,hiddenCellKeys:new Set(second.map(key)),shape:'square'})).toEqual([second.length,0,0]);
  });
  it('validates exactly the supplied candidate without substituting a random match', () => {
    const options = {path,targets,difficulty:1,seed:98765,segmentLengthMin:6,segmentLengthMax:9,maxVisibleRun:9};
    const candidate=createTargetHiddenLayout(options);
    expect(createTargetHiddenLayout({...options,search:{seed:0,candidateHiddenCells:candidate}})).toEqual(candidate);
    expect(()=>createTargetHiddenLayout({...options,search:{seed:0,candidateHiddenCells:[path[0]]}})).toThrow('当前候选');
  });
  it('rejects impossible targets and expired deadlines instead of returning approximate results', () => {
    const options = {path,targets,difficulty:1,seed:98765,segmentLengthMin:6,segmentLengthMax:9,maxVisibleRun:9};
    expect(() => createTargetHiddenLayout({...options,targets:{one:Array(10).fill(99),two:Array(10).fill(0)}})).toThrow('冲突');
    expect(() => createTargetHiddenLayout({...options,deadlineAt:0})).toThrow('超时');
    expect(() => createTargetHiddenLayout({...options,difficulty:2})).toThrow('继承');
  });
  it('reads optional score targets and rejects partial or malformed target columns', () => {
    const headers = ['配置ID','棋盘形状','关卡数据','分段长度区间','最长连续显示','生成隐藏数','每关跑关次数',...HIDDEN_SCORE_TARGET_HEADERS];
    const base = ['level_55_7','正方形',JSON.stringify({data}),'[6,9]',9,1,1];
    expect(parseBatchPlaytestConfigRows([headers,[...base,JSON.stringify(targets.one),JSON.stringify(targets.two)]],'hidden')[0].hiddenScoreTargets).toEqual(targets);
    expect(parseBatchPlaytestConfigRows([headers,base],'hidden')[0].hiddenScoreTargets).toBeUndefined();
    expect(() => parseBatchPlaytestConfigRows([headers,[...base,'[1,2]','[]']],'hidden')).toThrow('10个');
    expect(() => parseBatchPlaytestConfigRows([headers,[...base,JSON.stringify(targets.one)]],'hidden')).toThrow('10个');
  });
});
