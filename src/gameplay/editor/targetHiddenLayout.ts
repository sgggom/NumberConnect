import { createRandom } from '../../game/random';
import { calculateHiddenDifficultyCounts } from './hiddenDifficultyCounts';
import { createProgressiveHiddenLayout, createProgressiveHiddenSegments, progressiveHiddenExtraCount, progressiveHiddenRunLimits, type ProgressiveHiddenLayoutOptions } from './progressiveHiddenLayout';
import type { EditorCell } from './types';

export interface HiddenScoreTargets { one: number[]; two: number[] }
export interface HiddenTargetSearch { seed: number; excludedLayouts?: string[] }
const key = (cell: EditorCell): string => `${cell.x},${cell.y}`;

/** Keep inherited totals; changing targets must have at least one new hidden cell. */
export const targetHiddenCounts = (length: number, baseCount: number, targets: HiddenScoreTargets): number[] => {
  const totals: number[] = [];
  for (let d = 0; d < 10; d++) {
    const previous = totals[d - 1] ?? 0;
    let count = Math.max(previous, baseCount + progressiveHiddenExtraCount(length, d + 1));
    if (d > 0 && count === previous && (targets.one[d] !== targets.one[d - 1] || targets.two[d] !== targets.two[d - 1])) count++;
    totals.push(count);
  }
  return totals;
};

/** Strict search: only a fully matched layout can leave this function. */
export const createTargetHiddenLayout = (options: ProgressiveHiddenLayoutOptions & { targets: HiddenScoreTargets; search?: HiddenTargetSearch }): EditorCell[] => {
  const { path, targets, seed, difficulty, maxVisibleRun, shape = 'square' } = options;
  const checkDeadline = (): void => {
    if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) {
      const error = new Error('目标隐藏难度链生成超时。'); error.name = 'ProgressiveHiddenTimeoutError'; throw error;
    }
  };
  checkDeadline();
  const segments = createProgressiveHiddenSegments(path.length, options.segmentLengthMin, options.segmentLengthMax, seed);
  const totals = targetHiddenCounts(path.length, segments.length, targets);
  const total = totals[difficulty - 1];
  const desired = [total - targets.one[difficulty - 1] - targets.two[difficulty - 1], targets.one[difficulty - 1], targets.two[difficulty - 1]];
  if (desired[0] < 0 || total > path.length - 2) throw new Error(`难度 ${difficulty} 的评分目标与隐藏总数 ${total} 冲突。`);
  const indexes = new Map(path.map((cell, i) => [key(cell), i]));
  const locked = new Set((options.previousHiddenCells ?? []).map(cell => {
    const index = indexes.get(key(cell));
    if (index === undefined) throw new Error('上一档包含路径以外的隐藏格。');
    return index;
  }));
  if (difficulty > 1 && locked.size !== totals[difficulty - 2]) throw new Error('评分目标生成必须继承完整的上一档布局。');
  const added = total - locked.size;
  const domain = path.map((_, i) => i).filter(i => i >= segments[0].end && i < path.length - 1 && !locked.has(i));
  const limits = progressiveHiddenRunLimits(difficulty);
  const valid = (hidden: Set<number>): boolean => {
    if (hidden.size !== total || hidden.has(0) || hidden.has(path.length - 1) || [...locked].some(i => !hidden.has(i))) return false;
    if (difficulty === 1 && segments.some(s => [...hidden].filter(i => i >= s.start && i < s.end).length !== 1)) return false;
    if (difficulty > 1 && [...hidden].some(i => !locked.has(i) && i < segments[0].end)) return false;
    let run = 0, visible = 0, doubles = 0, triples = 0;
    for (let i = 0; i <= path.length; i++) {
      if (hidden.has(i)) { if (++run > 3) return false; visible = 0; }
      else {
        doubles += Number(run === 2); triples += Number(run === 3); run = 0;
        if (i < path.length && ++visible > maxVisibleRun) return false;
      }
    }
    return doubles <= limits.doubleRuns && triples <= limits.tripleRuns;
  };
  type Candidate = { hidden: number[]; error: number; counts: number[] };
  const cache = new Map<string, Candidate>();
  const excluded = new Set(options.search?.excludedLayouts ?? []);
  let best: Candidate | undefined;
  let evaluations = 0, attempts = 0;
  const searchUntil = Date.now() + 1500;
  const budget = (): boolean => { checkDeadline(); return Date.now() < searchUntil && evaluations < 150 && attempts < 6000; };
  const evaluate = (hidden: Set<number>): Candidate | undefined => {
    checkDeadline();
    if (!valid(hidden)) return undefined;
    const ordered = [...hidden].sort((a, b) => a - b), signature = ordered.join(',');
    if (excluded.has(ordered.map(i => key(path[i])).sort().join('|'))) return undefined;
    let result = cache.get(signature);
    if (!result) {
      const counts = calculateHiddenDifficultyCounts({ path, hiddenCellKeys: new Set(ordered.map(i => key(path[i]))), shape });
      result = { hidden: ordered, counts, error: counts.reduce((sum, n, i) => sum + Math.abs(n - desired[i]), 0) };
      cache.set(signature, result); evaluations++;
    }
    if (!best || result.error < best.error) best = result;
    return result;
  };
  let current: Candidate | undefined;
  try {
    if (!options.search) {
      const baseline = createProgressiveHiddenLayout(options);
      current = evaluate(new Set(baseline.map(cell => indexes.get(key(cell))!)));
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'ProgressiveHiddenTimeoutError') throw error;
    // Forced increments can exceed the legacy generator's expected total.
  }
  if (difficulty > 1 && added === 0) evaluate(locked);
  const random = createRandom((options.search?.seed ?? seed) ^ Math.imul(difficulty, 104729));
  if (options.search) for (let i = domain.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [domain[i], domain[j]] = [domain[j], domain[i]]; }
  if (difficulty > 1 && added === 1) {
    for (const i of domain) {
      if (best?.error === 0 || !budget()) break;
      attempts++; evaluate(new Set([...locked, i]));
    }
  } else if (difficulty === 1 || added > 1) {
    while (best?.error !== 0 && budget()) {
      attempts++;
      let candidate: Set<number>;
      if (current && attempts % 80 !== 0) {
        candidate = new Set(current.hidden);
        const movable = current.hidden.filter(i => !locked.has(i));
        const removed = movable[Math.floor(random() * movable.length)];
        candidate.delete(removed);
        const segment = segments.find(s => removed >= s.start && removed < s.end)!;
        const choices = difficulty === 1 ? path.map((_, i) => i).filter(i => i >= segment.start && i < segment.end && i > 0 && i < path.length - 1) : domain;
        candidate.add(choices[Math.floor(random() * choices.length)]);
      } else if (difficulty === 1) {
        candidate = new Set(segments.map(s => {
          const low = Math.max(1, s.start), high = Math.min(path.length - 1, s.end);
          return low + Math.floor(random() * (high - low));
        }));
      } else {
        const shuffled = [...domain];
        for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
        candidate = new Set([...locked, ...shuffled.slice(0, added)]);
      }
      const score = evaluate(candidate);
      if (score && (!current || score.error <= current.error || attempts % 80 === 0)) current = score;
    }
  }
  checkDeadline();
  const chosen = best as Candidate | undefined;
  if (!chosen || chosen.error !== 0) throw new Error(`难度 ${difficulty} 评分目标未匹配：目标0/1/2档 ${desired.join('/')}，本次最接近 ${chosen?.counts.join('/') ?? '无有效布局'}。`);
  return chosen.hidden.map(i => ({ ...path[i] }));
};
