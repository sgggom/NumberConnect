import { describe, expect, it } from 'vitest';
import { buildDifficultyFlow, type FlowInput } from './difficultyFlow';
import { createStageDifficultyState, lockStageDifficulty, recordStageOutcome, restartStageAttempt } from './stageDifficulty';

function setup() {
  const state = createStageDifficultyState();
  const entry = lockStageDifficulty(state, 11, 3, 'level_78_44_4');
  const input: FlowInput = { active: true, phase: 'playing', levelId: 11, stage: 3,
    totalStages: 4, formationId: `level_78_44_${entry.selection.difficulty}`, entry,
    skill: state.skill, stress: state.stress, progress: 3, total: 56 };
  return { state, entry, input };
}
describe('live difficulty flow', () => {
  it('shows actual locked selection and progress without modifying scoring state', () => {
    const { state, entry, input } = setup();
    const saved = JSON.stringify(state);
    const flow = buildDifficultyFlow(input);
    expect(flow.currentStep).toBe(5);
    expect(flow.nodes.slice(0, 4).every(node => node.state === 'done')).toBe(true);
    expect(flow.nodes[4].detail).toContain('3/56');
    expect(flow.nodes[3].detail).toContain(`第 ${entry.selection.difficulty} 档`);
    expect(flow.nodes[5].state).toBe('waiting');
    expect(JSON.stringify(state)).toBe(saved);
  });

  it('highlights retry after failure and shows actual score and stress changes', () => {
    const { state, entry, input } = setup();
    const record = recordStageOutcome(state, entry, 'fail')!;
    const flow = buildDifficultyFlow({ ...input, phase: 'result', skill: state.skill, stress: state.stress,
      lastResult: { levelId: 11, stage: 3, outcome: 'fail', record, skillBefore: 4, stressBefore: 0 } });
    expect(flow.currentStep).toBe(8);
    expect(flow.branch).toBe('retry');
    expect(flow.nodes[5].detail).toContain(record.skillAfter.toFixed(3));
    expect(flow.nodes[6].detail).toContain('0 → 1');
    expect(flow.nodes[7].detail).toContain('第 5 步');
  });

  it('returns to the same locked board on retry and does not claim a second score', () => {
    const { state, entry, input } = setup();
    recordStageOutcome(state, entry, 'fail');
    restartStageAttempt(state, entry);
    const playing = buildDifficultyFlow({ ...input, skill: state.skill, stress: state.stress });
    expect(playing.currentStep).toBe(5);
    expect(playing.nodes[5].detail).toContain('不再加减能力');
    const record = recordStageOutcome(state, entry, 'assisted')!;
    const result = buildDifficultyFlow({ ...input, phase: 'result', skill: state.skill, stress: state.stress,
      lastResult: { levelId: 11, stage: 3, outcome: 'assisted', record, stressBefore: 1, skillBefore: record.skillBefore } });
    expect(result.branch).toBe('advance');
    expect(result.nodes[5].detail).toContain('+0.000');
    expect(result.nodes[5].detail).toContain('不重复计分');
  });

  it('marks guide, disabled mode, debug and completed replay as non-scoring', () => {
    const { input, entry } = setup();
    for (const variant of [{ ...input, entry: undefined, formationId: 'guide_41_1' },
      { ...input, entry: undefined }, { ...input, entry: { ...entry, excluded: true } },
      { ...input, entry: { ...entry, completed: true } }]) {
      const flow = buildDifficultyFlow(variant);
      expect(flow.currentStep).toBe(5);
      expect(flow.nodes[5].state).toBe('skipped');
      expect(flow.nodes[6].state).toBe('skipped');
    }
  });

  it('does not attribute a previous stage result to the new stage', () => {
    const { input } = setup();
    const flow = buildDifficultyFlow({ ...input, phase: 'result',
      lastResult: { levelId: 11, stage: 2, outcome: 'fail', stressBefore: 0, skillBefore: 4 } });
    expect(flow.currentStep).toBe(5);
    expect(flow.branch).toBe('waiting');
    expect(flow.summary).toContain('Level 11-2');
  });

  it('does not show automatic prediction for a manually overridden rank', () => {
    const { input, entry } = setup();
    const flow = buildDifficultyFlow({ ...input, formationId: 'level_78_44_10', entry: { ...entry, excluded: true } });
    expect(flow.nodes[2].detail).toContain('手动第 10 档');
    expect(flow.nodes[2].detail).not.toContain('%');
    expect(flow.nodes[3].state).toBe('skipped');
  });

  it('shows no active step outside ordinary puzzle play', () => {
    const { input } = setup();
    const flow = buildDifficultyFlow({ ...input, active: false });
    expect(flow.currentStep).toBe(0);
    expect(flow.nodes.every(node => node.state === 'waiting')).toBe(true);
  });
});
