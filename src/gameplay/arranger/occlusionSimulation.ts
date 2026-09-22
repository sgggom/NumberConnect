import { ConnectionProgress } from '../../game/connectionProgress';
import { PathCompletionSolver, type PathCompletionRequest } from '../../game/pathCompletionSolver';
import { areNeighborCells } from '../../game/topology';
import { cellKey, type BoardShape, type Cell, type LevelData } from '../../game/types';
import { reasoningCandidates, type ReasoningStrength } from './perceivedReasoning';

export interface PlayerConfig { reasoning: ReasoningStrength; normal: number; afterError: number; reasoningObservation?: number }
export const DEFAULT_PLAYER_CONFIG: Readonly<PlayerConfig> = { reasoning: 'low', normal: 0, afterError: .5, reasoningObservation: 0 };

export type HandMode = 'off' | 'index' | 'thumb';
export interface WeightConfig {
  nextNumber: number; hiddenNumber: number; occludedMultiplier: number; sameDirection: number; closerTarget: number;
}
export const DEFAULT_WEIGHT_CONFIG: Readonly<WeightConfig> = {
  nextNumber: 1, hiddenNumber: .5, occludedMultiplier: .5, sameDirection: .2, closerTarget: .3,
};
export type PlayerLevel = 1 | 2 | 3 | 4 | 5;
export const PLAYER_OBSERVATION_RATES = [
  { normal: 0, afterError: .5 }, { normal: .25, afterError: .75 },
  { normal: .5, afterError: 1 }, { normal: .75, afterError: 1 }, { normal: 1, afterError: 1 },
] as const;

export function decideHandObservation(level: PlayerLevel | PlayerConfig, afterError: boolean, hasUnblockedCandidate: boolean, random: () => number) {
  const rates = typeof level === 'number' ? PLAYER_OBSERVATION_RATES[level - 1] : level;
  const probability = afterError ? rates.afterError : rates.normal;
  const forced = afterError && !hasUnblockedCandidate;
  return { observed: forced || probability === 1 || (probability > 0 && random() < probability), forced, probability: forced ? 1 : probability };
}
export interface CellOcclusion { coverage: number; numberBlocked: boolean }
export interface NeighborhoodWeight {
  dx: number; dy: number; index?: number; weight: number; probability: number; coverage: number; reason: string;
  rejected: boolean;
}
export interface SimulationFrame {
  /** Referee-only metric; never supplied to candidate selection. */
  correctNext?: number;
  step: number;
  current: number;
  attempted: number;
  outcome: 'connected' | 'error';
  reason: string;
  candidates: number[];
  neighborhood: NeighborhoodWeight[];
  knownNumbers: Array<[number, number]>;
  labels: Array<number | null>;
  edges: Array<readonly [number, number]>;
  occlusion: CellOcclusion[];
  observation: ReturnType<typeof decideHandObservation>;
  observationReasoning?: { performed: boolean; noCandidates: boolean };
  errors: number;
  progress: number;
  after: {
    labels: Array<number | null>; edges: Array<readonly [number, number]>;
    errors: number; progress: number; complete: boolean;
  };
}
export interface OcclusionRun {
  complete: boolean;
  stoppedReason?: string;
  attempts: number;
  errors: number;
  directChoices: number;
  coveredNextSteps: number;
  meanCoverage: number;
  ambiguity: number;
  frames: SimulationFrame[];
  finalLabels: Array<number | null>;
  finalEdges: Array<readonly [number, number]>;
}
export const clearOcclusion = (count: number): CellOcclusion[] => Array.from({ length: count }, () => ({ coverage: 0, numberBlocked: false }));

/** Identify the next displayed label before checking occlusion; never skip a blocked target. */
export function nextDisplayedIndex(labels: readonly (number | null)[], nextNumber: number): number | undefined {
  let result: number | undefined;
  labels.forEach((value, index) => {
    if (value !== null && value >= nextNumber && (result === undefined || value < labels[result]!)) result = index;
  });
  return result;
}

export function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let next = Math.imul(value ^ value >>> 15, 1 | value);
    next ^= next + Math.imul(next ^ next >>> 7, 61 | next);
    return ((next ^ next >>> 14) >>> 0) / 4294967296;
  };
}

/** The chooser has no authored numbers, solution order, or completion solver. */
export function choosePerceivedMove(input: {
  cells: readonly Cell[]; shape: BoardShape; current: number; nextNumber: number;
  known: ReadonlyMap<number, number>; visited: ReadonlySet<number>; rejected: ReadonlySet<number>;
  occlusion?: readonly CellOcclusion[];
  hiddenIndices?: ReadonlySet<number>;
  previousDirection?: { dx: number; dy: number };
  center?: Cell;
  distanceCells?: readonly Cell[];
  nextDisplayed?: number;
  random: () => number;
  weights?: Readonly<WeightConfig>;
  reasoning?: ReasoningStrength;
}): { selected?: number; candidates: number[]; direct: boolean; neighborhood: NeighborhoodWeight[] } {
  const { cells, shape, current, nextNumber, known, visited, rejected, random } = input;
  const weights = input.weights ?? DEFAULT_WEIGHT_CONFIG;
  const center = input.center ?? cells[current];
  const distanceCells = input.distanceCells ?? cells;
  const targetIndex = input.nextDisplayed;
  const target = targetIndex !== undefined && !input.hiddenIndices?.has(targetIndex)
    && known.has(targetIndex) && input.occlusion?.[targetIndex]?.numberBlocked === false ? distanceCells[targetIndex] : undefined;
  const distanceSquared = (a: Cell, b: Cell) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  // Fixed spatial ordering avoids leaking the authored route through array order.
  const neighborhood: NeighborhoodWeight[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const index = cells.findIndex((cell) => cell.x === center.x + dx && cell.y === center.y + dy);
    const coverage = Math.min(1, Math.max(0, input.occlusion?.[index]?.coverage ?? 0));
    let reason = '';
    let weight = 0;
    const hidden = input.hiddenIndices?.has(index) ?? !known.has(index);
    const next = known.get(index) === nextNumber;
    if (dx === 0 && dy === 0) reason = '当前按住位置';
    else if (index < 0) reason = '棋盘外或空格';
    else if (!areNeighborCells(center, cells[index], shape)) reason = '非相邻位置';
    else if (visited.has(index)) reason = '已经连接';
    else if (rejected.has(index)) reason = '本步已试错排除';
    else if (!hidden && !next) reason = '显示数字不是已确认的下一数字，权重为 0';
    else {
      const parts: string[] = [];
      if (next) { weight += weights.nextNumber; parts.push(`已确认下一数字 +${weights.nextNumber}`); }
      if (hidden) { weight += weights.hiddenNumber; parts.push(`隐藏数字 +${weights.hiddenNumber}`); }
      if (input.occlusion?.[index]?.numberBlocked) {
        const multiplier = coverage < .5 ? .75 : weights.occludedMultiplier;
        weight *= multiplier;
        parts.push(`数字被遮挡${coverage < .5 ? '不足50%' : '至少50%'} ×${multiplier}`);
      }
      if (input.previousDirection?.dx === dx && input.previousDirection?.dy === dy) {
        weight += weights.sameDirection; parts.push(`与上一次成功连接同方向 +${weights.sameDirection}`);
      }
      if (hidden && target && distanceSquared(distanceCells[index], target) < distanceSquared(center, target)) {
        weight += weights.closerTarget; parts.push(`更接近当前看得见的下一个显示数字 +${weights.closerTarget}`);
      }
      reason = parts.join('；');
    }
    neighborhood.push({ dx, dy, index: index < 0 ? undefined : index, coverage, reason, weight, probability: 0,
      rejected: index >= 0 && rejected.has(index) });
  }
  const eligible = neighborhood.filter((cell) => cell.weight > 0).map((cell) => cell.index!);
  const safe = reasoningCandidates({ cells, shape, visited, known, nextNumber, candidates: eligible, strength: input.reasoning ?? 'low' });
  neighborhood.forEach((cell) => {
    if (cell.weight > 0 && !safe.has(cell.index!)) {
      cell.weight = 0; cell.reason += '；推理排除：预判无法继续';
    }
  });
  const candidates = neighborhood.filter((cell) => cell.weight > 0).map((cell) => cell.index!);
  const maximum = Math.max(...neighborhood.map((cell) => cell.weight));
  if (maximum <= 0) return { candidates, direct: false, neighborhood };
  // Decimal bonuses may differ by floating-point rounding only.
  const highest = neighborhood.filter((cell) => cell.weight > 0 && Math.abs(cell.weight - maximum) < 1e-9);
  highest.forEach((cell) => { cell.probability = 1 / highest.length; });
  const selected = highest[highest.length === 1 ? 0 : Math.floor(random() * highest.length)].index!;
  return { selected, candidates, direct: known.get(selected) === nextNumber, neighborhood };
}

export async function* stepOccludedPlay(input: {
  level: LevelData;
  seed?: number;
  memorySteps: number;
  playerLevel?: PlayerLevel;
  player?: PlayerConfig;
  weights?: Readonly<WeightConfig>;
  observe: (current: number) => Promise<CellOcclusion[]>;
  findCompletion: (request: PathCompletionRequest) => Promise<number[] | null>;
  signal?: AbortSignal;
  /** Workers are cancelled by termination and do not need UI timer yields. */
  yieldToUI?: boolean;
}): AsyncGenerator<SimulationFrame, OcclusionRun, void> {
  const { level, observe, signal } = input;
  const check = () => { if (signal?.aborted) throw new DOMException('模拟已取消', 'AbortError'); };
  const cells = level.solutionPath;
  const hidden = new Set((level.hiddenCells ?? []).map(cellKey));
  const visible = cells.flatMap((cell, index) => !hidden.has(cellKey(cell)) || index === 0 || index === cells.length - 1 ? [index] : []);
  const connection = new ConnectionProgress(cells.length, visible, [], new PathCompletionSolver(cells, level.boardShape));
  const frames: SimulationFrame[] = [];
  const remembered = new Map<number, { value: number; lastSeen: number }>();
  const visited = new Set<number>([0]);
  let rejected = new Set<number>();
  let previousDirection: { dx: number; dy: number } | undefined;
  const random = input.seed === undefined ? Math.random : seededRandom(input.seed);
  let errors = 0;
  let directChoices = 0;
  let coveredNextSteps = 0;
  let coverageSum = 0;
  let ambiguity = 0;
  let stoppedReason: string | undefined;
  const labels = () => cells.map((_, i) => connection.isVisible(i) ? connection.displayNumber(i) : null);
  if (cells.length > 1) connection.begin(0);
  const limit = Math.max(1, cells.length * 10);
  for (let attempt = 0; !connection.complete && cells.length > 1 && attempt < limit; attempt++) {
    check();
    const current = connection.activeIndex!;
    const occlusion = await observe(current);
    check();
    if (occlusion.length !== cells.length) throw new Error('遮挡采样与棋盘数量不一致。');
    const renderedLabels = labels();
    const nextNumber = connection.displayNumber(current) + 1;
    const hasUnblockedCandidate = cells.some((cell, index) => index !== current && !visited.has(index)
      && !rejected.has(index) && areNeighborCells(cells[current], cell, level.boardShape)
      && !occlusion[index].numberBlocked && (renderedLabels[index] === null || renderedLabels[index] === nextNumber));
    const reasoningProbability = input.player?.reasoningObservation ?? 0;
    const performed = reasoningProbability === 1 || (reasoningProbability > 0 && random() < reasoningProbability);
    let noCandidates = false;
    if (performed) {
      // Pre-observation reasoning cannot read covered labels or hidden answers.
      const beforeKnown = new Map<number, number>();
      remembered.forEach(({ value, lastSeen }, index) => {
        if (attempt - lastSeen <= input.memorySteps) beforeKnown.set(index, value);
      });
      renderedLabels.forEach((value, index) => {
        if (value !== null && !occlusion[index].numberBlocked) beforeKnown.set(index, value);
      });
      visited.forEach((index) => beforeKnown.set(index, connection.displayNumber(index)));
      const beforeChoice = choosePerceivedMove({ cells, shape: level.boardShape, current, nextNumber,
        known: beforeKnown, visited, rejected, occlusion, random: () => 0, weights: input.weights,
        hiddenIndices: new Set(renderedLabels.flatMap((value, index) => value === null ? [index] : [])),
        previousDirection, nextDisplayed: nextDisplayedIndex(renderedLabels, nextNumber) });
      noCandidates = reasoningCandidates({ cells, shape: level.boardShape, visited, known: beforeKnown,
        nextNumber, candidates: beforeChoice.candidates, strength: 'medium', fallback: false }).size === 0;
    }
    let observation = noCandidates ? { observed: true, forced: true, probability: 1 }
      : decideHandObservation(input.player ?? input.playerLevel ?? DEFAULT_PLAYER_CONFIG, rejected.size > 0, hasUnblockedCandidate, random);
    // Observation removes only the hand's obstruction, never a level's hidden-number mask.
    let perceivedOcclusion = observation.observed ? clearOcclusion(cells.length) : occlusion;
    renderedLabels.forEach((value, index) => {
      if (value !== null && !perceivedOcclusion[index].numberBlocked) remembered.set(index, { value, lastSeen: attempt });
    });
    const known = new Map<number, number>();
    remembered.forEach(({ value, lastSeen }, index) => {
      if (attempt - lastSeen <= input.memorySteps) known.set(index, value);
    });
    // Successfully connected cells stay known even if the hand covers them.
    visited.forEach((index) => known.set(index, connection.displayNumber(index)));
    const choose = () => choosePerceivedMove({ cells, shape: level.boardShape, current, nextNumber, known, visited, rejected, occlusion: perceivedOcclusion, random, weights: input.weights, reasoning: input.player?.reasoning,
      hiddenIndices: new Set(renderedLabels.flatMap((value, index) => value === null ? [index] : [])), previousDirection,
      nextDisplayed: nextDisplayedIndex(renderedLabels, nextNumber) });
    let choice = choose();
    if (choice.selected === undefined && !observation.observed) {
      observation = { observed: true, forced: true, probability: 1 };
      perceivedOcclusion = clearOcclusion(cells.length);
      renderedLabels.forEach((value, index) => {
        if (value === null) return;
        remembered.set(index, { value, lastSeen: attempt });
        known.set(index, value);
      });
      choice = choose();
    }
    if (choice.selected === undefined) { stoppedReason = '移开手指观察后，仍没有可尝试的相邻位置'; break; }
    const beforeEdges = connection.connectedNodePairs();
    const beforeProgress = connection.progress;
    // Ground truth is consulted only by the referee / metrics, never the chooser.
    const correctNext = connection.completionSnapshot().solutionOrder[nextNumber - 1];
    if (correctNext !== undefined && occlusion[correctNext].numberBlocked) coveredNextSteps++;
    coverageSum += occlusion.reduce((sum, cell) => sum + cell.coverage, 0) / cells.length;
    ambiguity += choice.neighborhood.reduce((sum, cell) => sum - (cell.probability > 0 ? cell.probability * Math.log2(cell.probability) : 0), 0);
    if (choice.direct) directChoices++;
    const action = await connection.extendAsync(choice.selected, input.findCompletion);
    check();
    if (action.type !== 'advanced' && action.type !== 'wrong') { stoppedReason = '本次连线未产生有效进展'; break; }
    const outcome = action.type === 'wrong' ? 'error' : 'connected';
    const previousErrors = errors;
    if (outcome === 'error') { errors++; rejected.add(choice.selected); }
    else {
      previousDirection = { dx: cells[choice.selected].x - cells[current].x, dy: cells[choice.selected].y - cells[current].y };
      visited.add(choice.selected); rejected = new Set();
    }
    frames.push({ step: frames.length + 1, current, correctNext, attempted: choice.selected, outcome,
      reason: `九宫格内 ${choice.candidates.length} 个有效候选中优先选择最高权重（仅并列最高时随机），本次位置概率 ${((choice.neighborhood.find((cell) => cell.index === choice.selected)?.probability ?? 0) * 100).toFixed(1)}%`,
      candidates: choice.candidates, neighborhood: choice.neighborhood, knownNumbers: [...known], labels: renderedLabels, edges: beforeEdges,
      occlusion, observation, observationReasoning: { performed, noCandidates }, errors: previousErrors, progress: beforeProgress,
      after: { labels: labels(), edges: connection.connectedNodePairs(), errors, progress: connection.progress, complete: connection.complete } });
    yield frames[frames.length - 1];
    // Yield even when geometry and authored next steps were cached.
    if (input.yieldToUI !== false && attempt % 8 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const complete = cells.length <= 1 || connection.complete;
  if (!complete && !stoppedReason) stoppedReason = '达到步数上限';
  return { complete, stoppedReason, attempts: frames.length, errors, directChoices, coveredNextSteps,
    meanCoverage: frames.length ? coverageSum / frames.length : 0,
    ambiguity: frames.length ? ambiguity / frames.length : 0, frames, finalLabels: labels(), finalEdges: connection.connectedNodePairs() };
}

export async function simulateOccludedPlay(input: Parameters<typeof stepOccludedPlay>[0]): Promise<OcclusionRun> {
  const session = stepOccludedPlay(input);
  while (true) {
    const result = await session.next();
    if (result.done) return result.value;
  }
}
