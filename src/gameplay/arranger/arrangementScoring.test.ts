import { describe, expect, it } from 'vitest';
import { crossingDensity, scoreArrangementCandidates, straightRatio } from './arrangementScoring';
import { arrangementBoardFamilies, type ArrangementLibraryIndex } from './levelArrangement';
import { generateAutoArrangement } from './autoArrangement';

const level = (id: number, crossings: number, connections: number, straight: number, later = 0, occlusion = 0): ArrangementLibraryIndex => ({
  id: `level_44_${id}_1`, boardKey: 'board', pathKey: `path-${id}`, sourceRow: id, sourceName: `level_44_${id}_1`,
  formationId: 44, pathId: id, difficultyId: 1, configId: '', shapeName: '', difficulty: 1, rows: 4, columns: 4,
  pathMetrics: { crossings, connectionCount: connections, rightAngleRatio: 1 - straight, acuteAngleRatio: 0, obtuseAngleRatio: 0,
    consecutiveOcclusionCount: occlusion, directionRatios: {} },
  difficultyMetrics: { laterHiddenNeighborCount: later },
});

describe('weighted arrangement scoring', () => {
  it('balances absolute crossings and density rather than simply favoring the larger board', () => {
    const small = level(1, 2, 4, 0);
    const large = level(2, 8, 40, 0);
    const both = level(3, 8, 16, 0);
    const scores = scoreArrangementCandidates([small, large, both], { crossingComplexityPreference: 'large' });
    expect([...scores]).toEqual([50, 50, 100]);
    expect(crossingDensity(small)).toBe(0.5);
  });

  it('derives straight continuation ratio from turns, independently of simulation visibility', () => {
    const entry = level(1, 0, 4, 0.75);
    entry.difficultyMetrics.directConnectRatio = 0;
    expect(straightRatio(entry)).toBe(0.75);
    entry.pathMetrics.connectionCount = 1;
    expect(straightRatio(entry)).toBe(0);
  });

  it.each(['straightPreference', 'crossingComplexityPreference', 'laterHiddenNeighborPreference', 'occlusionPreference'] as const)
  ('supports large, small, medium and random for %s', (key) => {
    const entries = [level(1, 0, 10, 0, 0, 0), level(2, 5, 10, 0.5, 5, 5), level(3, 10, 10, 1, 10, 10)];
    expect([...scoreArrangementCandidates(entries, { [key]: 'large' })]).toEqual([0, 50, 100]);
    expect([...scoreArrangementCandidates(entries, { [key]: 'small' })]).toEqual([100, 50, 0]);
    expect([...scoreArrangementCandidates(entries, { [key]: 'medium' })]).toEqual([0, 100, 0]);
    expect([...scoreArrangementCandidates(entries, { [key]: 'random' })]).toEqual([0, 0, 0]);
  });

  it('allows the other three criteria to outweigh the highest-weight criterion while enforcing intervals', () => {
    const entries = [level(1, 0, 10, 0, 10, 0), level(2, 10, 10, 1, 0, 10)];
    const preferences = { laterHiddenNeighborPreference: 'large' as const, crossingComplexityPreference: 'large' as const,
      straightPreference: 'large' as const, occlusionPreference: 'large' as const };
    const scores = scoreArrangementCandidates(entries, preferences);
    expect(scores[0]).toBeCloseTo(40);
    expect(scores[1]).toBeCloseTo(60);
    const result = generateAutoArrangement(arrangementBoardFamilies(entries), {
      ...preferences, levelCount: 2, boardsPerLevel: 1, pathRepeatInterval: 10,
      stages: [{ formationIds: [44], difficultyIds: [1] }], randomSource: () => 0,
    });
    expect(result.map((group) => group.levelIds[0])).toEqual([entries[1].id, entries[0].id]);
  });

  it('omits an incomplete metric instead of treating missing values as ideal zeros', () => {
    const entries = [level(1, 0, 10, 0), level(2, 10, 10, 1)];
    entries[0].pathMetrics.crossings = undefined;
    expect([...scoreArrangementCandidates(entries, { crossingComplexityPreference: 'small', straightPreference: 'large' })]).toEqual([0, 100]);
  });

  it('handles constant metrics, empty pools and zero connections without NaN', () => {
    expect(crossingDensity(level(1, 0, 0, 0))).toBe(0);
    expect([...scoreArrangementCandidates([], { straightPreference: 'small' })]).toEqual([]);
    const scores = scoreArrangementCandidates([level(1, 0, 0, 0), level(2, 0, 0, 0)], { crossingComplexityPreference: 'large' });
    expect([...scores]).toEqual([50, 50]);
  });
});
