import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createStageDifficultyState, defaultStageRatings, loadStageDifficulty, lockStageDifficulty,
  predictStagePass, recordStageOutcome, restartStageAttempt, replayStageAttempt, saveStageDifficulty, selectStageDifficulty,
  STAGE_DDA_STORAGE_KEY, type StageOutcome,
} from './stageDifficulty';
import {
  parseThreeModeLevelLibrary, parseThreeModeLevelConfigurationText, resolveThreeModeStage,
} from './threeModeLevelData';

// Exact, unmodified source from the referenced task, frozen as the migration oracle.
const simulator = new Function('module', 'globalThis',
  readFileSync('src/gameplay/adaptive/fixtures/simulator-v3.cjs', 'utf8') + ';return module.exports;',
)({ exports: {} }, {});
const memoryStorage = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); } };
};

describe('latest simulator compatibility', () => {
  it.each(['clean', 'normal', 'assisted', 'fail', 'mixed'])('matches 240 %s results exactly', pattern => {
    const source = simulator.create();
    const state = createStageDifficultyState();
    const mixed: StageOutcome[] = ['clean', 'normal', 'fail', 'fail', 'assisted', 'clean', 'assisted', 'normal'];
    for (let n = 0; n < 240; n++) {
      const key = pattern === 'mixed' ? mixed[n % mixed.length] : pattern as StageOutcome;
      const entry = lockStageDifficulty(state, source.level, source.stage, `level_55_${source.stage}_1`);
      expect(entry.selection).toEqual(source.current);
      entry.failureRecorded = false; // Each source.apply represents a separate attempt.
      const result = recordStageOutcome(state, entry, key)!;
      const original = simulator.apply(source, key);
      expect(state.skill).toBe(source.skill);
      expect(state.evidence).toBe(source.evidence);
      expect(state.stress).toBe(source.stress);
      expect(state.lastDifficulties).toEqual(source.lastDifficulties);
      expect(result.delta).toBe(original.delta);
      expect(result.weight).toBe(original.weight);
      expect(result.evidenceUsed).toBe(original.evidenceUsed);
      expect(entry.attempt).toBe(key === 'fail' ? source.attempt : original.attempt);
    }
  });

  it('supports non-linear per-formation ratings with the same selection rule', () => {
    const ratings = [0, .1, .2, .4, .8, 1, 2, 4, 7, 12];
    const source = simulator.create({ ratings: Array.from({ length: 4 }, () => ratings) });
    expect(selectStageDifficulty(createStageDifficultyState(), 1, ratings)).toEqual(source.current);
    expect(() => selectStageDifficulty(createStageDifficultyState(), 1, [1, 2])).toThrow();
    expect(() => selectStageDifficulty(createStageDifficultyState(), 1, [...ratings].reverse())).toThrow();
  });
});

describe('stage lifecycle and persistence', () => {
  it('locks selection, scores first failure once, and never rewards retries', () => {
    const state = createStageDifficultyState();
    const entry = lockStageDifficulty(state, 1, 3, 'level_55_1_1');
    const before = structuredClone(entry.selection);
    recordStageOutcome(state, entry, 'fail');
    const skill = state.skill;
    expect(skill).toBeLessThan(4);
    expect(recordStageOutcome(state, entry, 'fail')).toBeUndefined();
    expect(state.stress).toBe(1);
    entry.failureRecorded = false;
    recordStageOutcome(state, entry, 'fail');
    entry.failureRecorded = false;
    recordStageOutcome(state, entry, 'assisted');
    expect(state.skill).toBe(skill);
    expect(state.stress).toBe(3);
    expect(state.evidence).toBe(1);
    expect(entry.selection).toEqual(before);
    expect(recordStageOutcome(state, entry, 'clean')).toBeUndefined();
  });

  it('treats first assisted completion as failure to complete independently', () => {
    const state = createStageDifficultyState();
    recordStageOutcome(state, lockStageDifficulty(state, 1, 1, 'level_55_1_1'), 'assisted');
    expect(state.skill).toBeLessThan(4);
    expect(state.evidence).toBe(.2);
    expect(state.stress).toBe(1);
  });

  it('resets attempt-local errors after retry so a clean recovery relieves pressure', () => {
    const state = createStageDifficultyState();
    const entry = lockStageDifficulty(state, 1, 3, 'level_55_1_1');
    entry.started = true;
    entry.errors = 3;
    recordStageOutcome(state, entry, 'fail');
    const skill = state.skill;
    restartStageAttempt(state, entry);
    expect(entry.errors).toBe(0);
    expect(entry.failureRecorded).toBe(false);
    recordStageOutcome(state, entry, 'clean');
    expect(state.skill).toBe(skill);
    expect(state.stress).toBe(0);
  });

  it('counts abandonment of an attempted board once, including reload after assistance', () => {
    const state = createStageDifficultyState();
    const entry = lockStageDifficulty(state, 1, 1, 'level_55_1_1');
    restartStageAttempt(state, entry);
    expect(state.history).toHaveLength(0);
    entry.assisted = true;
    restartStageAttempt(state, entry);
    const skill = state.skill;
    expect(skill).toBeLessThan(4);
    expect(state.history).toHaveLength(1);
    restartStageAttempt(state, entry);
    expect(state.history).toHaveLength(1);
    recordStageOutcome(state, entry, 'clean');
    expect(state.skill).toBe(skill);
  });

  it('uses equal ability evidence for clean and erroneous independent wins, with different protection', () => {
    const clean = createStageDifficultyState(), normal = createStageDifficultyState();
    clean.stress = normal.stress = 2;
    recordStageOutcome(clean, lockStageDifficulty(clean, 1, 1, 'level_55_1_1'), 'clean');
    recordStageOutcome(normal, lockStageDifficulty(normal, 1, 1, 'level_55_1_1'), 'normal');
    expect(clean.skill).toBe(normal.skill);
    expect(clean.stress).toBe(1);
    expect(normal.stress).toBe(2);
  });

  it('restores failed attempts and assistance without resampling or rescoring on reload', () => {
    const storage = memoryStorage();
    const state = createStageDifficultyState();
    const entry = lockStageDifficulty(state, 4, 2, 'level_55_2_1');
    entry.assisted = true;
    entry.errors = 3;
    recordStageOutcome(state, entry, 'fail');
    saveStageDifficulty(state, storage);
    const loaded = loadStageDifficulty(storage);
    const resumed = lockStageDifficulty(loaded, 4, 2, 'level_55_2_1');
    expect(resumed).toEqual(entry);
    recordStageOutcome(loaded, resumed, 'assisted');
    expect(loaded.skill).toBe(state.skill);
    expect(loaded.evidence).toBe(state.evidence);
  });

  it('does not score debug completion or change rank history', () => {
    const state = createStageDifficultyState();
    const entry = lockStageDifficulty(state, 4, 2, 'level_55_2_1');
    entry.excluded = true;
    recordStageOutcome(state, entry, 'clean');
    expect(entry.completed).toBe(true);
    expect(state.skill).toBe(4);
    expect(state.evidence).toBe(0);
    expect(state.stress).toBe(0);
    expect(state.history).toEqual([]);
    expect(state.lastDifficulties).toEqual([null, null, null, null]);
  });

  it('uses the closing profile for additional stages and bounds step changes', () => {
    const state = createStageDifficultyState();
    expect(defaultStageRatings(7)).toEqual(defaultStageRatings(4));
    state.lastDifficulties[2] = 9;
    state.skill = 0;
    const selected = selectStageDifficulty(state, 3);
    expect(selected.desired).toBe(1);
    expect(selected.difficulty).toBe(8);
    expect(selected.limited).toBe(true);
    expect(selected.bound).toBe(true);
  });

  it('balances expected win and failure evidence at the predicted probability', () => {
    const win = createStageDifficultyState(), fail = createStageDifficultyState();
    const p = predictStagePass(4, selectStageDifficulty(win, 3).rating);
    const a = recordStageOutcome(win, lockStageDifficulty(win, 1, 3, 'level_55_1_1'), 'clean')!;
    const b = recordStageOutcome(fail, lockStageDifficulty(fail, 1, 3, 'level_55_1_1'), 'fail')!;
    expect(p * a.delta + (1 - p) * b.delta).toBeCloseTo(0, 12);
  });

  it('recovers from corrupt storage and tolerates unavailable storage', () => {
    const storage = memoryStorage();
    for (const value of ['null', '{', '{}', JSON.stringify({ ...createStageDifficultyState(), skill: '4' }),
      JSON.stringify({ ...createStageDifficultyState(), stages: { invalid: {} } })]) {
      storage.setItem(STAGE_DDA_STORAGE_KEY, value);
      expect(loadStageDifficulty(storage)).toEqual(createStageDifficultyState());
    }
    const unavailable = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('full'); } };
    expect(loadStageDifficulty(unavailable)).toEqual(createStageDifficultyState());
    expect(() => saveStageDifficulty(createStageDifficultyState(), unavailable)).not.toThrow();
    storage.setItem(STAGE_DDA_STORAGE_KEY, JSON.stringify({ ...createStageDifficultyState(), history: [null, { delta: 'bad' }] }));
    expect(loadStageDifficulty(storage).history).toEqual([]);
  });
});

describe('authored campaign integration', () => {
  it('resolves every configured stage with selected ranks and keeps guide boards fixed', () => {
    const library = parseThreeModeLevelLibrary(JSON.parse(readFileSync('public/levels/three-mode-level-library.json', 'utf8')));
    const campaign = parseThreeModeLevelConfigurationText(readFileSync('public/levels/three-mode-level-config.txt', 'utf8'));
    const state = createStageDifficultyState();
    for (const level of campaign) {
      for (let index = 0; index < level.stages.length; index++) {
        const id = level.stages[index].formationId;
        const entry = id.startsWith('guide_') ? undefined : lockStageDifficulty(state, level.id, index + 1, id);
        const resolved = resolveThreeModeStage(library, level, { stage: index + 1, targetDifficulty: entry?.selection.difficulty });
        expect(resolved.level.hiddenCells).toBeDefined();
        if (entry) {
          expect(resolved.difficulty).toBe(entry.selection.difficulty);
          expect(resolved.formationId).toBe(id.replace(/_\d+$/, '_' + entry.selection.difficulty));
          recordStageOutcome(state, entry, 'normal');
        } else expect(resolved.formationId).toBe(id);
      }
    }
  });
});


describe('temporary replay relief', () => {
  it('lowers each explicit replay to rank 1 while preserving first evidence and baseline', () => {
    const state = createStageDifficultyState(); state.skill = 8;
    const entry = lockStageDifficulty(state, 11, 3, 'level_78_44_4');
    const selection = structuredClone(entry.selection);
    recordStageOutcome(state, entry, 'fail');
    const skill = state.skill, evidence = state.evidence;
    for (let n = 1; n <= 12; n++) {
      replayStageAttempt(state, entry);
      expect(entry.replayDifficulty).toBe(Math.max(1, selection.difficulty - n));
      expect(entry.selection).toEqual(selection);
      recordStageOutcome(state, entry, 'fail');
      expect(state.skill).toBe(skill); expect(state.evidence).toBe(evidence);
    }
    replayStageAttempt(state, entry);
    const result = recordStageOutcome(state, entry, 'clean')!;
    expect(result.difficulty).toBe(1); expect(result.evidenceUsed).toBe(false);
    expect(state.skill).toBe(skill); expect(state.evidence).toBe(evidence);
    expect(state.lastDifficulties[2]).toBe(selection.difficulty);
    const next = lockStageDifficulty(state, 12, 3, 'level_78_45_4');
    expect(next.replayDifficulty).toBeUndefined();
    expect(next.selection.difficulty).toBeGreaterThanOrEqual(selection.difficulty - 1);
  });

  it('scores the original board before an unplayed explicit replay, then never scores again', () => {
    const state = createStageDifficultyState(); state.skill = 8;
    const entry = lockStageDifficulty(state, 11, 3, 'level_78_44_4');
    replayStageAttempt(state, entry);
    expect(state.history).toHaveLength(1);
    expect(state.history[0].difficulty).toBe(entry.selection.difficulty);
    expect(entry.measured).toBe(true);
    const skill = state.skill;
    replayStageAttempt(state, entry);
    expect(state.history).toHaveLength(1);
    recordStageOutcome(state, entry, 'clean');
    expect(state.skill).toBe(skill);
  });

  it('persists temporary ranks and resumes without another downgrade; accepts old saves', () => {
    const storage = memoryStorage(), state = createStageDifficultyState(); state.skill = 8;
    const entry = lockStageDifficulty(state, 11, 3, 'level_78_44_4');
    saveStageDifficulty(state, storage);
    expect(loadStageDifficulty(storage)).toEqual(state);
    replayStageAttempt(state, entry); saveStageDifficulty(state, storage);
    const loaded = loadStageDifficulty(storage), restored = loaded.stages[entry.key];
    restartStageAttempt(loaded, restored);
    expect(restored.replayDifficulty).toBe(entry.replayDifficulty);
    expect(loaded.skill).toBe(state.skill); expect(loaded.history).toEqual(state.history);
    restored.replayDifficulty = 0; saveStageDifficulty(loaded, storage);
    expect(loadStageDifficulty(storage)).toEqual(createStageDifficultyState());
  });

  it('does not downgrade completed stages or manual testing', () => {
    for (const flag of ['completed', 'excluded'] as const) {
      const state = createStageDifficultyState();
      const entry = lockStageDifficulty(state, 11, 3, 'level_78_44_4'); entry[flag] = true;
      const before = structuredClone(state); replayStageAttempt(state, entry);
      expect(state).toEqual(before);
    }
  });
});


describe('first formal assessment level', () => {
  it('starts every stage at five despite changing skill, stress and rank bounds, and scores results', () => {
    const state = createStageDifficultyState(); state.skill = 0; state.stress = 3;
    state.lastDifficulties = [10, 10, 10, 10];
    for (let stage = 1; stage <= 4; stage++) {
      const entry = lockStageDifficulty(state, 11, stage, `level_55_${stage}_1`, undefined, true);
      expect(entry.selection.difficulty).toBe(5); expect(entry.selection.limited).toBe(false);
      expect(entry.selection.rating).toBe(defaultStageRatings(stage)[4]);
      const before = state.skill;
      expect(recordStageOutcome(state, entry, 'clean')!.evidenceUsed).toBe(true);
      expect(state.skill).toBeGreaterThan(before);
    }
    expect(state.evidence).toBeCloseTo(2.3);
    expect(state.lastDifficulties).toEqual([5,5,5,5]);
    const expected = selectStageDifficulty(state, 1);
    expect(lockStageDifficulty(state, 12, 1, 'level_55_9_1').selection).toEqual(expected);
  });
  it('keeps assessment replay relief and its first-score marker across reload', () => {
    const state = createStageDifficultyState(), storage = memoryStorage();
    const entry = lockStageDifficulty(state, 11, 3, 'level_78_44_4', undefined, true);
    recordStageOutcome(state, entry, 'fail'); const skill = state.skill;
    replayStageAttempt(state, entry); expect(entry.replayDifficulty).toBe(4);
    saveStageDifficulty(state, storage); const restored = loadStageDifficulty(storage);
    const resumed = lockStageDifficulty(restored, 11, 3, 'level_78_44_4', undefined, true);
    expect(resumed.selection.difficulty).toBe(5); expect(resumed.replayDifficulty).toBe(4);
    expect(recordStageOutcome(restored, resumed, 'clean')!.evidenceUsed).toBe(false);
    expect(restored.skill).toBe(skill); expect(restored.lastDifficulties[2]).toBe(5);
  });
});
