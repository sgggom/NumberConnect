import type { StageAttempt, StageDifficultyState } from './stageDifficulty';

export const STRESS_RULE_VERSION = 'whole-level-relief-v1';
export interface LevelRelief { reliefApplied: number; errorCount: number; completionStressSettled: boolean }
export interface StressEvent { levelId: number; type: string; before: number; after: number; pending: boolean }

export const updateStress = (state: StageDifficultyState, levelId: number, type: string, delta: number): void => {
  if (state.pendingRelief) return;
  const before = state.stress;
  state.stress = Math.max(0, Math.min(3, before + delta));
  state.pendingRelief = state.stress === 3;
  state.stressHistory.push({ levelId, type, before, after: state.stress, pending: state.pendingRelief });
  state.stressHistory = state.stressHistory.slice(-200);
};

export const initializeLevelRelief = (state: StageDifficultyState, levelId: number, assessment: boolean): LevelRelief => {
  if (state.levelRelief[levelId]) return state.levelRelief[levelId];
  const oldLevel = Object.values(state.stages).some(entry => entry.levelId === levelId);
  const reliefApplied = !assessment && !oldLevel && state.pendingRelief ? 1 : 0;
  const level = { reliefApplied, errorCount: 0, completionStressSettled: oldLevel };
  state.levelRelief[levelId] = level;
  if (reliefApplied) {
    const before = state.stress;
    state.pendingRelief = false;
    state.stress = 0;
    state.stressHistory.push({ levelId, type: '整关减压已领取', before, after: 0, pending: false });
    state.stressHistory = state.stressHistory.slice(-200);
  }
  return level;
};

export const recordFrustrationAction = (state: StageDifficultyState, entry: StageAttempt, action: 'error' | 'tool' | 'revive'): void => {
  if (entry.excluded || entry.completed) return;
  const level = state.levelRelief[entry.levelId];
  if (!level) return;
  if (action === 'error') level.errorCount += 1;
  else if (action === 'tool') updateStress(state, entry.levelId, '道具生效', 1);
  else if (entry.failureRecorded) {
    updateStress(state, entry.levelId, '复活成功', 1);
    entry.failureRecorded = false;
  }
};

export const finishLevelFrustration = (state: StageDifficultyState, entry: StageAttempt, totalStages: number): void => {
  const level = state.levelRelief[entry.levelId];
  if (!level || level.completionStressSettled) return;
  const entries = Object.values(state.stages).filter(item => item.levelId === entry.levelId);
  if (!Array.from({ length: totalStages }, (_, i) => i + 1).every(stage => entries.some(item => item.stage === stage && item.completed))) return;
  level.completionStressSettled = true;
  if (entries.some(item => item.excluded)) return;
  updateStress(state, entry.levelId, `整关完成 · 错误 ${level.errorCount}`, level.errorCount <= 2 ? -1 : level.errorCount <= 4 ? 0 : 1);
};

export const migrateFrustration = (state: StageDifficultyState): void => {
  state.stressRuleVersion = STRESS_RULE_VERSION;
  state.stress = 0;
  state.pendingRelief = false;
  state.levelRelief = {};
  state.stressHistory = [];
  for (const entry of Object.values(state.stages)) {
    state.levelRelief[entry.levelId] = { reliefApplied: 0, errorCount: 0, completionStressSettled: true };
  }
};

export const validFrustration = (state: StageDifficultyState): boolean => {
  if (typeof state.pendingRelief !== 'boolean' || state.pendingRelief !== (state.stress === 3)
    || !state.levelRelief || typeof state.levelRelief !== 'object' || Array.isArray(state.levelRelief)
    || !Array.isArray(state.stressHistory)) return false;
  return Object.entries(state.levelRelief).every(([id, level]) => Number.isInteger(Number(id)) && Number(id) > 0
    && level && [0, 1].includes(level.reliefApplied) && Number.isSafeInteger(level.errorCount) && level.errorCount >= 0
    && typeof level.completionStressSettled === 'boolean')
    && state.stressHistory.every(event => event && Number.isInteger(event.levelId) && event.levelId > 0
      && typeof event.type === 'string' && [event.before, event.after].every(n => Number.isInteger(n) && n >= 0 && n <= 3)
      && typeof event.pending === 'boolean');
};
