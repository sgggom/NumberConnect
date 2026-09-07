/** Port of 动态难度模拟器/model.js (2026-09-07, first independent completion).
 * Ranks select authored library variants; ratings are experimental, not measured win rates.
 */
import { rhythmOffset, isRhythmPosition, type RhythmPosition, type RhythmLedger } from './fiveGameRhythm';
export const STAGE_DDA_VERSION = 'first-independent-v1';
export const STAGE_DDA_STORAGE_KEY = 'number-connect.stage-dda.v1';
export const DDA_CONFIG = {
  initial: 4, k: 0.85, step: 1, protection: 0.08,
  targets: [0.95, 0.9, 0.6, 0.85],
  weights: [0.2, 0.4, 1, 0.7],
  ranges: [[0, 1.5], [0.5, 2.5], [2, 8], [1.5, 6]],
};
export type StageOutcome = 'clean' | 'normal' | 'assisted' | 'fail';
export interface DifficultySelection {
  difficulty: number;
  rating: number;
  target: number;
  raw: number;
  desired: number;
  p: number;
  stress: number;
  skill: number;
  limited: boolean;
  bound: boolean;
}
export interface StageAttempt {
  key: string;
  levelId: number;
  stage: number;
  formationId: string;
  selection: DifficultySelection;
  measured: boolean;
  completed: boolean;
  failureRecorded: boolean;
  started: boolean;
  assisted: boolean;
  excluded: boolean;
  errors: number;
  attempt: number;
  replayDifficulty?: number;
  assessment?: boolean;
  rhythm?: RhythmPosition;
  baselineDifficulty?: number;
}
export interface DifficultyRecord {
  key: string;
  outcome: StageOutcome;
  difficulty: number;
  rating: number;
  p: number;
  target: number;
  skillBefore: number;
  skillAfter: number;
  delta: number;
  stress: number;
  weight: number;
  evidenceUsed: boolean;
  attempt: number;
}
export interface StageDifficultyState {
  rhythm?: RhythmLedger;
  version: typeof STAGE_DDA_VERSION;
  skill: number;
  evidence: number;
  stress: number;
  lastDifficulties: Array<number | null>;
  // Retain locks when leaving/revisiting a stage, including browser reloads.
  stages: Record<string, StageAttempt>;
  history: DifficultyRecord[];
}
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
// Campaigns may have fewer/more than four stages; later stages use the closing profile.
const profileIndex = (stage: number): number => clamp(stage - 1, 0, 3);
export const predictStagePass = (skill: number, rating: number): number => (
  1 / (1 + Math.exp((rating - skill) * 0.65))
);
export const defaultStageRatings = (stage: number): number[] => {
  const [low, high] = DDA_CONFIG.ranges[profileIndex(stage)];
  return Array.from({ length: 10 }, (_, i) => low + (high - low) * i / 9);
};
export const createStageDifficultyState = (): StageDifficultyState => ({
  version: STAGE_DDA_VERSION, skill: DDA_CONFIG.initial, evidence: 0, stress: 0,
  lastDifficulties: [null, null, null, null], stages: {}, history: [],
});
export const selectStageDifficulty = (
  state: StageDifficultyState, stage: number, ratings = defaultStageRatings(stage),
): DifficultySelection => {
  if (ratings.length !== 10 || ratings.some((v, i) => (
    !Number.isFinite(v) || v < 0 || v > 12 || (i > 0 && v < ratings[i - 1])
  ))) throw new Error('每个阵型需要 10 个 0–12 内不递减的难度值。');
  const i = profileIndex(stage);
  const target = clamp(DDA_CONFIG.targets[i] + state.stress * DDA_CONFIG.protection, 0.05, 0.97);
  const raw = state.skill - Math.log(target / (1 - target)) / 0.65;
  const desired = ratings.reduce((best, value, index) => (
    Math.abs(predictStagePass(state.skill, value) - target)
      < Math.abs(predictStagePass(state.skill, ratings[best]) - target) ? index : best
  ), 0) + 1;
  const last = state.lastDifficulties[i];
  const difficulty = last === null ? desired
    : clamp(desired, Math.max(1, last - DDA_CONFIG.step), Math.min(10, last + DDA_CONFIG.step));
  const rating = ratings[difficulty - 1];
  return { difficulty, rating, target, raw, desired, p: predictStagePass(state.skill, rating),
    stress: state.stress, skill: state.skill, limited: difficulty !== desired,
    bound: raw < ratings[0] || raw > ratings[9] };
};
export const lockStageDifficulty = (
  state: StageDifficultyState, levelId: number, stage: number, formationId: string,
  ratings?: number[], assessment = false, rhythm?: RhythmPosition,
): StageAttempt => {
  const key = `${levelId}:${stage}:${formationId}`;
  if (state.stages[key]) return state.stages[key];
  const entry: StageAttempt = {
    key, levelId, stage, formationId, selection: selectStageDifficulty(state, stage, ratings),
    measured: false, completed: false, failureRecorded: false, started: false,
    assisted: false, excluded: false, errors: 0, attempt: 1,
  };
  if (assessment) {
    const rating = (ratings ?? defaultStageRatings(stage))[4];
    entry.selection = { ...entry.selection, difficulty: 5, desired: 5, rating,
      p: predictStagePass(state.skill, rating), limited: false, bound: false };
    entry.assessment = true;
  }
  if (rhythm && !assessment) {
    entry.rhythm = { ...rhythm };
    entry.baselineDifficulty = entry.selection.difficulty;
    const difficulty = clamp(entry.baselineDifficulty + rhythmOffset(rhythm.position, stage), 1, 10);
    const rating = (ratings ?? defaultStageRatings(stage))[difficulty - 1];
    entry.selection = { ...entry.selection, difficulty, rating, p: predictStagePass(state.skill, rating) };
  }
  state.stages[key] = entry;
  return entry;
};
export const recordStageOutcome = (
  state: StageDifficultyState, entry: StageAttempt, outcome: StageOutcome,
): DifficultyRecord | undefined => {
  if (entry.completed || (outcome === 'fail' && entry.failureRecorded)) return;
  const passed = outcome !== 'fail';
  if (entry.excluded) {
    if (passed) entry.completed = true;
    else entry.failureRecorded = true;
    return;
  }
  const skillBefore = state.skill;
  const difficulty = entry.replayDifficulty ?? entry.selection.difficulty;
  const rating = entry.replayDifficulty === undefined ? entry.selection.rating : defaultStageRatings(entry.stage)[difficulty - 1];
  const p = predictStagePass(state.skill, rating);
  const learning = DDA_CONFIG.k * (0.4 + 0.6 * Math.exp(-state.evidence / 12));
  const evidenceUsed = !entry.measured;
  const weight = evidenceUsed ? DDA_CONFIG.weights[profileIndex(entry.stage)] : 0;
  const success = outcome === 'clean' || outcome === 'normal' ? 1 : 0;
  state.skill = clamp(state.skill + learning * weight * (success - p), 0, 12);
  state.evidence += weight;
  state.stress = clamp(state.stress + (outcome === 'clean' ? -1 : outcome === 'normal' ? 0 : 1), 0, 3);
  entry.measured = true;
  const record: DifficultyRecord = {
    key: entry.key, outcome, difficulty, rating,
    p, target: entry.selection.target, skillBefore, skillAfter: state.skill,
    delta: state.skill - skillBefore, stress: state.stress, weight, evidenceUsed, attempt: entry.attempt,
  };
  if (passed) {
    entry.completed = true;
    state.lastDifficulties[profileIndex(entry.stage)] = entry.baselineDifficulty ?? entry.selection.difficulty;
  } else {
    entry.failureRecorded = true;
    entry.attempt += 1;
  }
  state.history.push(record);
  state.history = state.history.slice(-200);
  return record;
};

/** Start a new attempt on the same locked board, without collecting another ability observation. */
export const restartStageAttempt = (state: StageDifficultyState, entry: StageAttempt): void => {
  if (entry.completed) return;
  if ((entry.started || entry.assisted || entry.errors > 0) && !entry.failureRecorded) {
    recordStageOutcome(state, entry, 'fail');
  }
  entry.failureRecorded = false;
  entry.started = false;
  entry.assisted = false;
  entry.errors = 0;
};

/** Explicit replay lowers only this stage's playable rank; the selection remains the baseline. */
export const replayStageAttempt = (state: StageDifficultyState, entry: StageAttempt): void => {
  if (entry.completed || entry.excluded) return;
  if (!entry.measured) recordStageOutcome(state, entry, 'fail');
  restartStageAttempt(state, entry);
  entry.replayDifficulty = Math.max(1, (entry.replayDifficulty ?? entry.selection.difficulty) - 1);
};

type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
const finiteBetween = (v: unknown, lo: number, hi: number): v is number => (
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
);
export const loadStageDifficulty = (storage: StoragePort): StageDifficultyState => {
  try {
    const s = JSON.parse(storage.getItem(STAGE_DDA_STORAGE_KEY) ?? 'null') as StageDifficultyState;
    if (!s || s.version !== STAGE_DDA_VERSION || !finiteBetween(s.skill, 0, 12)
      || !finiteBetween(s.evidence, 0, Number.MAX_SAFE_INTEGER) || !finiteBetween(s.stress, 0, 3)
      || !Array.isArray(s.lastDifficulties) || s.lastDifficulties.length !== 4
      || s.lastDifficulties.some(v => v !== null && (!Number.isInteger(v) || !finiteBetween(v, 1, 10)))
      || !s.stages || typeof s.stages !== 'object' || Array.isArray(s.stages)
      || !Array.isArray(s.history)) return createStageDifficultyState();
    if (s.rhythm && (!isRhythmPosition({ day: s.rhythm.day, position: 1 })
      || !Number.isSafeInteger(s.rhythm.next) || s.rhythm.next < 0
      || !s.rhythm.levels || typeof s.rhythm.levels !== 'object' || Array.isArray(s.rhythm.levels)
      || Object.values(s.rhythm.levels).some(value => !isRhythmPosition(value)))) return createStageDifficultyState();
    for (const [key, e] of Object.entries(s.stages)) {
      if (!e || key !== e.key || key !== `${e.levelId}:${e.stage}:${e.formationId}`
        || !Number.isInteger(e.levelId) || e.levelId < 1 || !Number.isInteger(e.stage) || e.stage < 1
        || typeof e.formationId !== 'string' || !e.selection
        || !Number.isInteger(e.selection.difficulty) || !finiteBetween(e.selection.difficulty, 1, 10)
        || (e.rhythm !== undefined && (!isRhythmPosition(e.rhythm)
          || !Number.isInteger(e.baselineDifficulty) || !finiteBetween(e.baselineDifficulty, 1, 10)))
        || (e.replayDifficulty !== undefined && (!Number.isInteger(e.replayDifficulty)
          || !finiteBetween(e.replayDifficulty, 1, e.selection.difficulty)))
        || !finiteBetween(e.selection.rating, 0, 12) || !finiteBetween(e.selection.p, 0, 1)
        || !finiteBetween(e.selection.target, 0, 1)
        || !Number.isInteger(e.attempt) || e.attempt < 1 || !finiteBetween(e.errors, 0, Number.MAX_SAFE_INTEGER)
        || ['measured', 'completed', 'failureRecorded', 'started', 'assisted', 'excluded']
          .some(flag => typeof e[flag as keyof StageAttempt] !== 'boolean')) return createStageDifficultyState();
    }
    s.history = s.history.filter(r => r && typeof r.key === 'string'
      && ['clean', 'normal', 'assisted', 'fail'].includes(r.outcome)
      && finiteBetween(r.delta, -12, 12) && finiteBetween(r.skillBefore, 0, 12)
      && finiteBetween(r.skillAfter, 0, 12) && finiteBetween(r.stress, 0, 3)
      && finiteBetween(r.weight, 0, 1) && typeof r.evidenceUsed === 'boolean'
      && finiteBetween(r.p, 0, 1) && finiteBetween(r.target, 0, 1)
      && finiteBetween(r.rating, 0, 12) && Number.isInteger(r.difficulty)
      && finiteBetween(r.difficulty, 1, 10) && Number.isInteger(r.attempt) && r.attempt >= 1,
    ).slice(-200);
    return s;
  } catch { return createStageDifficultyState(); }
};
export const saveStageDifficulty = (state: StageDifficultyState, storage: StoragePort): void => {
  try { storage.setItem(STAGE_DDA_STORAGE_KEY, JSON.stringify(state)); }
  catch { /* Keep the current in-memory session playable if browser storage is unavailable. */ }
};
