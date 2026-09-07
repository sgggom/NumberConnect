import { describe, expect, it } from 'vitest';
import { assignLevelRhythm, RHYTHM_OFFSETS } from './fiveGameRhythm';
import { createStageDifficultyState, lockStageDifficulty, recordStageOutcome, replayStageAttempt,
  selectStageDifficulty, defaultStageRatings, predictStagePass, saveStageDifficulty, loadStageDifficulty } from './stageDifficulty';

const today = new Date(2026, 8, 7, 10);
const tomorrow = new Date(2026, 8, 8, 10);
describe('five game experience rhythm', () => {
  it('allocates once per whole level, loops after five and excludes guides, assessment and old saves', () => {
    const state = createStageDifficultyState();
    expect(assignLevelRhythm(state, 1, today)).toBeUndefined();
    expect(assignLevelRhythm(state, 11, today)).toBeUndefined();
    lockStageDifficulty(state, 20, 1, 'old');
    expect(assignLevelRhythm(state, 20, today)).toBeUndefined();
    for (let i = 0; i < 7; i++) {
      const rhythm = assignLevelRhythm(state, 12 + i, today)!;
      expect(rhythm.position).toBe(i % 5 + 1);
      for (let stage = 1; stage <= 4; stage++) {
        expect(assignLevelRhythm(state, 12 + i, today)).toEqual(rhythm);
        const base = selectStageDifficulty(state, stage);
        const entry = lockStageDifficulty(state, 12 + i, stage, `family${stage}`, undefined, false, rhythm);
        const rank = Math.max(1, Math.min(10, base.difficulty + RHYTHM_OFFSETS[i % 5][stage - 1]));
        expect(entry.baselineDifficulty).toBe(base.difficulty);
        expect(entry.selection.difficulty).toBe(rank);
        recordStageOutcome(state, entry, 'clean');
        expect(state.lastDifficulties[stage - 1]).toBe(base.difficulty);
      }
    }
  });

  it('scores actual difficulty, keeps the baseline on replay, and protects rank bounds', () => {
    const state = createStageDifficultyState();
    const entry = lockStageDifficulty(state, 14, 3, 'family', undefined, false, { day: '2026-09-07', position: 3 });
    const rank = entry.selection.difficulty;
    const p = predictStagePass(4, defaultStageRatings(3)[rank - 1]);
    const record = recordStageOutcome(state, entry, 'fail')!;
    expect(record.p).toBe(p); expect(record.delta).toBeCloseTo(-.85 * p);
    const skill = state.skill, evidence = state.evidence;
    replayStageAttempt(state, entry);
    expect(entry.replayDifficulty).toBe(rank - 1);
    recordStageOutcome(state, entry, 'clean');
    expect(state.skill).toBe(skill); expect(state.evidence).toBe(evidence);
    expect(state.lastDifficulties[2]).toBe(entry.baselineDifficulty);
    for (const [ability, position, expected] of [[0, 1, 1], [12, 3, 10]]) {
      const fresh = createStageDifficultyState(); fresh.skill = ability;
      expect(lockStageDifficulty(fresh, 40, 3, 'family', undefined, false, { day: '2026-09-07', position }).selection.difficulty).toBe(expected);
    }
  });

  it('restores assignments, retains an unfinished level across midnight and resets new levels daily', () => {
    const state = createStageDifficultyState();
    assignLevelRhythm(state, 12, today); assignLevelRhythm(state, 13, today);
    const rhythm = assignLevelRhythm(state, 14, today)!;
    const entry = lockStageDifficulty(state, 14, 1, 'family', undefined, false, rhythm);
    let data = '';
    const storage = { getItem: () => data, setItem: (_key: string, value: string) => { data = value; } };
    saveStageDifficulty(state, storage);
    const restored = loadStageDifficulty(storage);
    expect(restored).toEqual(state);
    expect(assignLevelRhythm(restored, 14, tomorrow)).toEqual(rhythm);
    expect(assignLevelRhythm(restored, 15, tomorrow)?.position).toBe(1);
    expect(assignLevelRhythm(restored, 16, tomorrow)?.position).toBe(2);
    expect(restored.stages[entry.key].selection).toEqual(entry.selection);
    restored.stages[entry.key].rhythm!.position = 6;
    saveStageDifficulty(restored, storage);
    expect(loadStageDifficulty(storage)).toEqual(createStageDifficultyState());
  });
});
