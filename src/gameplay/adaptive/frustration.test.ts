import { describe, it, expect } from 'vitest';
import { createStageDifficultyState, lockStageDifficulty, recordStageOutcome, replayStageAttempt, restartStageAttempt, loadStageDifficulty, predictStagePass, defaultStageRatings } from './stageDifficulty';
import { updateStress, recordFrustrationAction, finishLevelFrustration } from './frustration';

const restore = (state: unknown) => loadStageDifficulty({ getItem: () => JSON.stringify(state), setItem: () => {} });
const lock = (state: ReturnType<typeof createStageDifficultyState>, level: number, stage = 1, assessment = false) =>
  lockStageDifficulty(state, level, stage, `level_55_${stage}_1`, undefined, assessment, { day: '2026-09-08', position: 5 });

describe('whole-level frustration relief', () => {
  it('scores actual relieved difficulty while preserving the baseline and whole-level lock across reload', () => {
    const state = createStageDifficultyState(); state.skill = 8;
    updateStress(state, 11, '失败', 3);
    const entry = lock(state, 12, 3);
    const result = recordStageOutcome(state, entry, 'clean')!;
    expect(result.p).toBe(predictStagePass(8, defaultStageRatings(3)[entry.selection.difficulty - 1]));
    expect(state.lastDifficulties[2]).toBe(entry.baselineDifficulty);
    const restored = restore(state);
    const next = lockStageDifficulty(restored, 12, 4, 'level_55_4_1', undefined, false, { day: '2026-09-09', position: 2 });
    expect(restored.levelRelief[12].reliefApplied).toBe(1);
    expect(next.selection.difficulty).toBe(Math.max(1, next.baselineDifficulty! - 1));
    expect(restored.stressHistory.filter(e => e.type === '整关减压已领取')).toHaveLength(1);
  });

  it('freezes at three, keeps errors, excludes assessment, then claims once for every stage of a new level', () => {
    let state = createStageDifficultyState(); state.skill = 8;
    const assessment = lock(state, 11, 1, true);
    recordStageOutcome(state, assessment, 'fail'); expect(state.stress).toBe(2);
    recordFrustrationAction(state, assessment, 'revive'); expect(state.stress).toBe(3);
    recordFrustrationAction(state, assessment, 'revive'); expect(state.stressHistory).toHaveLength(2);
    recordFrustrationAction(state, assessment, 'error');
    updateStress(state, 11, '完成', -1); expect(state.stress).toBe(3);
    lock(state, 11, 2, true); expect(state.pendingRelief).toBe(true);
    state = restore(state); expect(state.levelRelief[11].errorCount).toBe(1);
    for (let stage = 1; stage <= 4; stage++) {
      const entry = lock(state, 12, stage);
      const rhythm = stage === 2 || stage === 3 ? 1 : 0;
      expect(entry.selection.difficulty).toBe(Math.max(1, Math.min(10, entry.baselineDifficulty! + rhythm) - 1));
      expect(state.levelRelief[12].reliefApplied).toBe(1);
      if (stage === 1) { expect(state.stress).toBe(0); updateStress(state, 12, '再次受挫', 3); }
      expect(state.pendingRelief).toBe(true);
    }
    expect(state.stressHistory.filter(e => e.type === '整关减压已领取')).toHaveLength(1);
    lock(state, 13); expect(state.stress).toBe(0); expect(state.levelRelief[13].reliefApplied).toBe(1);
  });

  it.each([[0,1],[2,1],[3,2],[4,2],[5,3]])('settles %i whole-level errors once to stress %i', (errors, expected) => {
    const state = createStageDifficultyState(); state.stress = 2;
    const a = lock(state, 12);
    for (let i = 0; i < errors; i++) recordFrustrationAction(state, a, 'error');
    recordStageOutcome(state, a, 'normal'); finishLevelFrustration(state, a, 2);
    expect(state.stress).toBe(2);
    const b = lock(state, 12, 2); recordStageOutcome(state, b, 'assisted'); finishLevelFrustration(state, b, 2);
    expect(state.stress).toBe(expected);
    finishLevelFrustration(state, b, 2); expect(state.stress).toBe(expected);
    expect(state.stressHistory).toHaveLength(1);
  });

  it('distinguishes untouched replay, abandonment and actual failure; preserves errors on retry/reload', () => {
    const state = createStageDifficultyState(), entry = lock(state, 12);
    replayStageAttempt(state, entry); expect(state.stress).toBe(0);
    const skill = state.skill, evidence = state.evidence;
    entry.started = true; recordFrustrationAction(state, entry, 'error');
    replayStageAttempt(state, entry); expect(state.stress).toBe(1);
    recordStageOutcome(state, entry, 'fail'); expect(state.stress).toBe(3);
    replayStageAttempt(state, entry); expect(state.stressHistory).toHaveLength(2);
    expect(state.skill).toBe(skill); expect(state.evidence).toBe(evidence);
    const loaded = restore(state); restartStageAttempt(loaded, loaded.stages[entry.key]);
    expect(loaded.levelRelief[12].errorCount).toBe(1); expect(loaded.pendingRelief).toBe(true);
  });

  it('counts tools, ignores excluded/completed entries, and consumes even at rank one', () => {
    const state = createStageDifficultyState(), a = lock(state, 11, 1, true);
    recordFrustrationAction(state, a, 'tool'); expect(state.stress).toBe(1);
    a.excluded = true; recordFrustrationAction(state, a, 'tool'); expect(state.stress).toBe(1);
    a.excluded = false; a.completed = true; recordFrustrationAction(state, a, 'tool'); expect(state.stress).toBe(1);
    updateStress(state, 11, '失败', 2); state.skill = 0;
    expect(lock(state, 12).selection.difficulty).toBe(1);
    expect(state.pendingRelief).toBe(false); expect(state.stress).toBe(0);
  });

  it('migrates old saves once without changing ability, locks or granting relief to old levels', () => {
    const old = createStageDifficultyState(); old.skill = 7; old.evidence = 8;
    const entry = lock(old, 12); old.stress = 3;
    const legacy = JSON.parse(JSON.stringify(old));
    for (const key of ['stressRuleVersion', 'pendingRelief', 'levelRelief', 'stressHistory']) delete legacy[key];
    const state = restore(legacy);
    expect(state.skill).toBe(7); expect(state.evidence).toBe(8); expect(state.stages[entry.key]).toEqual(entry);
    expect(state.stress).toBe(0); expect(state.levelRelief[12].completionStressSettled).toBe(true);
    updateStress(state, 12, '失败', 3); lock(state, 12, 2);
    expect(state.pendingRelief).toBe(true); expect(state.levelRelief[12].reliefApplied).toBe(0);
    expect(restore(state)).toEqual(state);
  });
});
