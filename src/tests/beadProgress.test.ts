import { describe, expect, it, vi } from 'vitest';
import {
  advanceBeadProgress,
  advanceBeadSequence,
  beadJarLaunchInterval,
  loadBeadJar,
  loadBeadJarQueue,
  loadBeadProgress,
  loadBeadSequence,
  loadCompletedBeadPatternIds,
  markBeadPatternCompleted,
  nextBeads,
  nextBeadsAcrossPatterns,
  orderedBeads,
  parseBeadPattern,
  parseBeadPatternManifest,
  saveBeadProgress,
  saveBeadJar,
  saveBeadJarQueue,
  type BeadPatternData,
} from '../gameplay/beads';

const pattern: BeadPatternData = {
  id: 'test-pattern',
  name: 'Test',
  width: 3,
  height: 2,
  data: [
    ['#FF0000', null, '#00FF00'],
    ['#0000FF', '#FFFFFF', null],
  ],
};

describe('bead progression', () => {
  it('orders non-empty beads from left to right and top to bottom', () => {
    expect(orderedBeads(pattern)).toEqual([
      { x: 0, y: 0, color: '#FF0000' },
      { x: 2, y: 0, color: '#00FF00' },
      { x: 0, y: 1, color: '#0000FF' },
      { x: 1, y: 1, color: '#FFFFFF' },
    ]);
  });

  it('assigns the next uncollected beads to a normal level', () => {
    expect(nextBeads(pattern, { patternId: pattern.id, collected: 1 }, 2)).toEqual([
      { x: 2, y: 0, color: '#00FF00' },
      { x: 0, y: 1, color: '#0000FF' },
    ]);
  });

  it('persists progress and clamps it to the pattern size', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    };
    const completed = advanceBeadProgress(pattern, { patternId: pattern.id, collected: 3 }, 10);

    expect(completed.collected).toBe(4);
    saveBeadProgress(completed, storage);
    expect(loadBeadProgress(pattern, storage)).toEqual(completed);
  });

  it('persists jar beads and drops beads already placed in the pattern', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    };
    const reward = orderedBeads(pattern).slice(1, 4);
    saveBeadJar(pattern.id, reward, storage);

    expect(loadBeadJar(pattern, { patternId: pattern.id, collected: 1 }, storage)).toEqual(reward);
    expect(loadBeadJar(pattern, { patternId: pattern.id, collected: 3 }, storage)).toEqual([
      reward[2],
    ]);
  });

  it('continues a level reward into the next pattern without wasting beads', () => {
    const secondPattern: BeadPatternData = {
      ...pattern,
      id: 'second-pattern',
      name: 'Second',
    };
    expect(nextBeadsAcrossPatterns(
      [pattern, secondPattern],
      pattern,
      { patternId: pattern.id, collected: 3 },
      3,
    )).toEqual([
      { patternId: pattern.id, x: 1, y: 1, color: '#FFFFFF' },
      { patternId: secondPattern.id, x: 0, y: 0, color: '#FF0000' },
      { patternId: secondPattern.id, x: 2, y: 0, color: '#00FF00' },
    ]);
  });

  it('persists a jar queue containing beads from multiple patterns', () => {
    const secondPattern: BeadPatternData = {
      ...pattern,
      id: 'second-pattern',
      name: 'Second',
    };
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    };
    const queue = nextBeadsAcrossPatterns(
      [pattern, secondPattern],
      pattern,
      { patternId: pattern.id, collected: 3 },
      3,
    );
    saveBeadJarQueue(queue, storage);

    expect(loadBeadJarQueue(
      [pattern, secondPattern],
      { patternId: pattern.id, collected: 3 },
      storage,
    )).toEqual(queue);
  });

  it('keeps the normal rapid-placement speed for a small jar', () => {
    const queue = Array.from({ length: 10 }, (_, index) => ({
      patternId: pattern.id,
      x: index,
      y: 0,
      color: '#FF0000',
    }));

    expect(beadJarLaunchInterval(queue)).toBe(100);
  });

  it('accelerates a large cross-pattern jar to fit within four seconds', () => {
    const queue = Array.from({ length: 56 }, (_, index) => ({
      patternId: index < 20 ? pattern.id : 'second-pattern',
      x: index,
      y: 0,
      color: '#FF0000',
    }));
    const interval = beadJarLaunchInterval(queue);
    const segmentCount = 2;
    const projectedDuration = (
      (queue.length - segmentCount) * interval
      + segmentCount * 500
      + (segmentCount - 1) * 560
      + 150
    );

    expect(interval).toBeLessThan(100);
    expect(projectedDuration).toBeLessThanOrEqual(4_000);
  });

  it('rejects incomplete pattern rows and metadata inside the data file', () => {
    const metadata = { id: 'broken', name: 'Broken', width: 2, height: 1 };
    expect(() => parseBeadPattern({ data: [['#FFFFFF']] }, metadata))
      .toThrow('Invalid bead pattern column count at row 0: expected 2');
    expect(() => parseBeadPattern({ data: [['#FFFFFF', null]], id: 'legacy' }, metadata))
      .toThrow('Bead pattern JSON must only contain data');
  });

  it('parses an ordered pattern manifest', () => {
    expect(parseBeadPatternManifest({ patterns: [
      { id: 'first', name: 'First', width: 3, height: 2, data: 'first.json' },
      { id: 'second', name: 'Second', width: 4, height: 3, data: 'second.json' },
    ] })).toEqual([
      { id: 'first', name: 'First', width: 3, height: 2, data: 'first.json' },
      { id: 'second', name: 'Second', width: 4, height: 3, data: 'second.json' },
    ]);
  });

  it('restores an unfinished pattern from the sequence', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ patternId: pattern.id, collected: 2 })),
      setItem: vi.fn(),
    };

    expect(loadBeadSequence([pattern], storage)).toEqual({
      pattern,
      progress: { patternId: pattern.id, collected: 2 },
    });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('moves to the next pattern when the current one is complete and wraps after the last', () => {
    const secondPattern: BeadPatternData = { ...pattern, id: 'second-pattern', name: 'Second' };
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    };

    const second = advanceBeadSequence(
      [pattern, secondPattern],
      pattern,
      { patternId: pattern.id, collected: 4 },
      storage,
    );
    expect(second).toEqual({
      pattern: secondPattern,
      progress: { patternId: secondPattern.id, collected: 0 },
    });

    const firstAgain = advanceBeadSequence(
      [pattern, secondPattern],
      secondPattern,
      { patternId: secondPattern.id, collected: 4 },
      storage,
    );
    expect(firstAgain).toEqual({
      pattern,
      progress: { patternId: pattern.id, collected: 0 },
    });
  });

  it('migrates completed patterns from sequence progress and keeps collection order', () => {
    const secondPattern: BeadPatternData = { ...pattern, id: 'second-pattern', name: 'Second' };
    const thirdPattern: BeadPatternData = { ...pattern, id: 'third-pattern', name: 'Third' };
    const values = new Map<string, string>([
      ['number-connect.bead-progress.v1', JSON.stringify({ patternId: thirdPattern.id, collected: 1 })],
    ]);
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    };

    expect(loadCompletedBeadPatternIds([pattern, secondPattern, thirdPattern], storage)).toEqual([
      pattern.id,
      secondPattern.id,
    ]);
    expect(markBeadPatternCompleted(
      [pattern, secondPattern, thirdPattern],
      thirdPattern.id,
      storage,
    )).toEqual([pattern.id, secondPattern.id, thirdPattern.id]);
  });
});
