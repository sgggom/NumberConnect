import { describe, expect, it, vi } from 'vitest';
import { BoardShape, type LevelData } from '../../game/types';
import { PathCompletionSolver } from '../../game/pathCompletionSolver';
import { choosePerceivedMove, clearOcclusion, decideHandObservation, nextDisplayedIndex, seededRandom, simulateOccludedPlay, stepOccludedPlay, type PlayerLevel } from './occlusionSimulation';
import { sampleCellOcclusion } from './handOcclusion';

const level: LevelData = { levelId: 1, rows: 2, columns: 2, boardShape: BoardShape.Square,
  activeCells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
  solutionPath: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], hiddenCells: [] };
const run = (blocked: boolean, seed = 1, memorySteps = 0) => {
  const solver = new PathCompletionSolver(level.solutionPath, level.boardShape);
  return simulateOccludedPlay({ level, seed, memorySteps,
    observe: async () => blocked ? level.solutionPath.map(() => ({ coverage: 1, numberBlocked: true })) : clearOcclusion(4),
    findCompletion: async (request) => solver.findCompletion(request) });
};

describe('actual alpha occlusion', () => {
  it('does not count transparent pixels or faint alpha as obstruction', () => {
    expect(sampleCellOcclusion({ x: 0, y: 0 }, 10, () => 0)).toEqual({ coverage: 0, numberBlocked: false });
    expect(sampleCellOcclusion({ x: 0, y: 0 }, 10, () => 100)).toEqual({ coverage: 0, numberBlocked: false });
  });
  it('distinguishes a covered edge from unreadable central numbers', () => {
    const edge = sampleCellOcclusion({ x: 0, y: 0 }, 10, (x) => x >= 7 ? 255 : 0);
    expect(edge.coverage).toBeGreaterThan(0);
    expect(edge.numberBlocked).toBe(false);
    expect(sampleCellOcclusion({ x: 0, y: 0 }, 10, () => 255)).toEqual({ coverage: 1, numberBlocked: true });
  });
});
describe('independent perceived-player simulator', () => {
  it('adds the approach bonus only to hidden cells strictly closer to a readable target', () => {
    const cells = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 1, y: -1 }, { x: 2, y: 1 }];
    const choice = choosePerceivedMove({ cells, shape: level.boardShape, current: 0, nextNumber: 2,
      known: new Map([[4, 5]]), hiddenIndices: new Set([1, 2, 3]), visited: new Set([0]), rejected: new Set(),
      nextDisplayed: nextDisplayedIndex([1, null, null, null, 5], 2), occlusion: clearOcclusion(5), random: () => 0 });
    expect(choice.neighborhood.find((cell) => cell.index === 1)?.weight).toBe(.8);
    expect(choice.neighborhood.find((cell) => cell.index === 2)?.weight).toBe(.5);
    expect(choice.neighborhood.find((cell) => cell.index === 3)?.weight).toBe(.5);
  });
  it('disables the bonus when the target is blocked even if remembered and later labels are readable', () => {
    const cells = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 1 }, { x: 3, y: 0 }];
    const occlusion = clearOcclusion(4);
    occlusion[2] = { coverage: .5, numberBlocked: true };
    const nextDisplayed = nextDisplayedIndex([1, null, 5, 9], 2);
    expect(nextDisplayed).toBe(2);
    const input = { cells, shape: level.boardShape, current: 0, nextNumber: 2,
      known: new Map([[2, 5], [3, 9]]), hiddenIndices: new Set([1]), visited: new Set([0]), rejected: new Set<number>(),
      nextDisplayed, occlusion, random: () => 0 };
    expect(choosePerceivedMove(input).neighborhood.find((cell) => cell.index === 1)?.weight).toBe(.5);
    occlusion[2] = { coverage: .1, numberBlocked: false };
    expect(choosePerceivedMove(input).neighborhood.find((cell) => cell.index === 1)?.weight).toBe(.8);
    expect(choosePerceivedMove({ ...input, known: new Map() }).neighborhood.find((cell) => cell.index === 1)?.weight).toBe(.5);
  });
  it('adds approach after occlusion and direction bonuses', () => {
    const cells = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
    const occlusion = clearOcclusion(3); occlusion[1] = { coverage: 1, numberBlocked: true };
    const choice = choosePerceivedMove({ cells, shape: level.boardShape, current: 0, nextNumber: 2,
      known: new Map([[2, 3]]), hiddenIndices: new Set([1]), visited: new Set([0]), rejected: new Set(),
      nextDisplayed: 2, previousDirection: { dx: 1, dy: 0 }, occlusion, random: () => 0 });
    expect(choice.neighborhood.find((cell) => cell.index === 1)?.weight).toBe(.75);
  });
  it('always selects the unique maximum without drawing randomness', () => {
    const input = { cells: level.solutionPath, shape: level.boardShape, current: 0, nextNumber: 2,
      known: new Map<number, number>(), visited: new Set([0]), rejected: new Set([3]),
      occlusion: [{ coverage: 0, numberBlocked: false }, { coverage: 0, numberBlocked: false },
        { coverage: 1, numberBlocked: true }, { coverage: 0, numberBlocked: false }] };
    const random = vi.fn(() => .5);
    const choice = choosePerceivedMove({ ...input, random });
    expect(random).not.toHaveBeenCalled();
    expect(choice.neighborhood).toHaveLength(9);
    expect(choice.neighborhood.reduce((sum, cell) => sum + cell.probability, 0)).toBeCloseTo(1);
    expect(choice.neighborhood.find((cell) => cell.index === 1)?.probability).toBe(1);
    expect(choice.neighborhood.find((cell) => cell.index === 2)?.probability).toBe(0);
    expect(choice.neighborhood.find((cell) => cell.index === 3)?.probability).toBe(0);
    expect(choice.neighborhood[4].probability).toBe(0);
    expect(choice.selected).toBe(1);
    expect(choosePerceivedMove({ ...input, random: () => .99 }).selected).toBe(1);
  });
  it('halves a remembered next weight without discarding hidden candidates', () => {
    const choice = choosePerceivedMove({ cells: level.solutionPath, shape: level.boardShape, current: 0, nextNumber: 2,
      known: new Map([[2, 2]]), visited: new Set([0]), rejected: new Set(), random: () => .99,
      occlusion: level.solutionPath.map(() => ({ coverage: 1, numberBlocked: true })) });
    expect(choice.selected).toBe(2);
    expect(choice.neighborhood.find((cell) => cell.index === 2)?.probability).toBe(1);
    expect(choice.neighborhood.filter((cell) => cell.probability > 0)).toHaveLength(1);
  });
  it('finishes visible, unobstructed boards without guessing', async () => {
    const result = await run(false);
    expect(result).toMatchObject({ complete: true, errors: 0, attempts: 3, directChoices: 3, meanCoverage: 0 });
  });
  it('forces observation when every weight is zero even without a previous error', async () => {
    const result = await run(true);
    expect(result.complete).toBe(true);
    expect(result.errors).toBe(0);
    expect(result.attempts).toBe(3);
    expect(result.frames.every((frame) => frame.observation.observed && frame.observation.forced)).toBe(true);
    expect(result.frames[0].knownNumbers).toContainEqual([1, 2]);
  });
  it('stops after one observation when there truly is no adjacent move', async () => {
    const cells = [{ x: 0, y: 0 }, { x: 3, y: 0 }];
    const disconnected = { ...level, columns: 4, rows: 1, activeCells: cells, solutionPath: cells };
    const observe = vi.fn(async () => cells.map(() => ({ coverage: 1, numberBlocked: true })));
    const result = await simulateOccludedPlay({ level: disconnected, memorySteps: 0, playerLevel: 1,
      observe, findCompletion: async () => null });
    expect(result.complete).toBe(false);
    expect(result.attempts).toBe(0);
    expect(result.stoppedReason).toBe('移开手指观察后，仍没有可尝试的相邻位置');
    expect(observe).toHaveBeenCalledTimes(1);
  });
  it('applies additive weights, binary occlusion and the previous direction in order', () => {
    const choice = choosePerceivedMove({ cells: level.solutionPath, shape: level.boardShape, current: 0, nextNumber: 2,
      known: new Map([[1, 2], [3, 4]]), hiddenIndices: new Set([2]), visited: new Set([0]), rejected: new Set(),
      previousDirection: { dx: 1, dy: 1 }, random: () => .9,
      occlusion: [{ coverage: 0, numberBlocked: false }, { coverage: .4, numberBlocked: true },
        { coverage: .4, numberBlocked: true }, { coverage: 0, numberBlocked: false }] });
    expect(choice.neighborhood.find((cell) => cell.index === 1)?.weight).toBe(.5);
    expect(choice.neighborhood.find((cell) => cell.index === 2)?.weight).toBe(.45);
    expect(choice.neighborhood.find((cell) => cell.index === 3)?.weight).toBe(0);
    expect(choice.neighborhood[4].weight).toBe(0);
  });
  it('keeps other displayed numbers zero even in the previous direction', () => {
    const choice = choosePerceivedMove({ cells: level.solutionPath, shape: level.boardShape, current: 0, nextNumber: 2,
      known: new Map([[1, 2], [3, 4]]), hiddenIndices: new Set([2]), visited: new Set([0]), rejected: new Set(),
      previousDirection: { dx: 0, dy: 1 }, random: () => 0 });
    expect(choice.neighborhood.find((cell) => cell.index === 1)?.weight).toBe(1);
    expect(choice.neighborhood.find((cell) => cell.index === 2)?.weight).toBe(.5);
    expect(choice.neighborhood.find((cell) => cell.index === 3)?.weight).toBe(0);
  });
  it('adds both next and hidden bonuses and does not halve for edge-only coverage', () => {
    const choice = choosePerceivedMove({ cells: level.solutionPath, shape: level.boardShape, current: 0, nextNumber: 2,
      known: new Map([[1, 2]]), hiddenIndices: new Set([1]), visited: new Set([0]), rejected: new Set(),
      previousDirection: { dx: 1, dy: 0 }, random: () => 0,
      occlusion: [{ coverage: 0, numberBlocked: false }, { coverage: .3, numberBlocked: false },
        { coverage: 0, numberBlocked: false }, { coverage: 0, numberBlocked: false }] });
    expect(choice.neighborhood.find((cell) => cell.index === 1)?.weight).toBe(1.7);
  });
  it('reproduces all choices with the same seed', async () => {
    expect(await run(true, 123)).toEqual(await run(true, 123));
  });
  it('uses recently seen numbers while occluded and forgets them after the configured window', async () => {
    const trial = (memorySteps: number) => {
      const solver = new PathCompletionSolver(level.solutionPath, level.boardShape);
      return simulateOccludedPlay({ level, seed: 3, memorySteps,
        observe: async (current) => current === 0 ? clearOcclusion(4) : level.solutionPath.map(() => ({ coverage: 1, numberBlocked: true })),
        findCompletion: async (request) => solver.findCompletion(request) });
    };
    const remembered = await trial(20);
    const forgotten = await trial(0);
    expect(remembered.directChoices).toBe(3);
    expect(remembered.errors).toBe(0);
    expect(forgotten.directChoices).toBe(3);
    expect(forgotten.complete).toBe(true);
    expect(forgotten.attempts).toBe(3);
    expect(forgotten.frames.slice(1).every((frame) => frame.observation.forced)).toBe(true);
    expect(remembered.frames.every((frame) => !frame.observation.forced)).toBe(true);
  });
  it('does not favor solution-array order when choosing unknown cells', () => {
    const choose = (cells: typeof level.solutionPath) => {
      const choice = choosePerceivedMove({ cells, shape: level.boardShape, current: 0, nextNumber: 2,
        known: new Map(), visited: new Set([0]), rejected: new Set(), random: seededRandom(24) });
      return cells[choice.selected!];
    };
    expect(choose(level.solutionPath)).toEqual(choose([level.solutionPath[0], ...level.solutionPath.slice(1).reverse()]));
  });
  it('honors cancellation instead of publishing a partial success', async () => {
    const abort = new AbortController(); abort.abort();
    await expect(simulateOccludedPlay({ level, seed: 1, memorySteps: 0, signal: abort.signal,
      observe: async () => clearOcclusion(4), findCompletion: async () => null })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('allows legal alternate hidden routes through the same gameplay referee', async () => {
    const hiddenLevel = { ...level, hiddenCells: level.solutionPath.slice(1, 3) };
    const solver = new PathCompletionSolver(level.solutionPath, level.boardShape);
    const result = await simulateOccludedPlay({ level: hiddenLevel, seed: 0, memorySteps: 2,
      observe: async () => clearOcclusion(4), findCompletion: async (request) => solver.findCompletion(request) });
    expect(result.complete).toBe(true);
    expect(result.errors).toBe(0);
  });
});


describe('incremental simulation', () => {
  it('implements all five normal and after-error observation rates', () => {
    const rates = [[0, .5], [.25, .75], [.5, 1], [.75, 1], [1, 1]];
    rates.forEach((pair, i) => pair.forEach((probability, afterError) => {
      const low = decideHandObservation((i + 1) as PlayerLevel, !!afterError, true, () => 0);
      const high = decideHandObservation((i + 1) as PlayerLevel, !!afterError, true, () => .999);
      expect(low).toMatchObject({ probability, observed: probability > 0, forced: false });
      expect(high.observed).toBe(probability === 1);
      if (probability > 0 && probability < 1) {
        expect(decideHandObservation((i + 1) as PlayerLevel, !!afterError, true, () => probability - .001).observed).toBe(true);
        expect(decideHandObservation((i + 1) as PlayerLevel, !!afterError, true, () => probability).observed).toBe(false);
      }
    }));
    expect(decideHandObservation(1, true, false, () => .99)).toMatchObject({ observed: true, forced: true });
    expect(decideHandObservation(1, false, false, () => .99)).toMatchObject({ observed: false, forced: false });
  });
  it('forces observation after an error exhausts unblocked eligible positions', async () => {
    const cells = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    const testLevel = { ...level, columns: 3, activeCells: cells, solutionPath: cells, hiddenCells: [cells[4]] };
    const solver = new PathCompletionSolver(cells, level.boardShape);
    const occlusion = clearOcclusion(6); occlusion[1] = { coverage: 1, numberBlocked: true };
    const session = stepOccludedPlay({ level: testLevel, playerLevel: 1, seed: 1, memorySteps: 0,
      observe: async () => occlusion, findCompletion: async (request) => solver.findCompletion(request) });
    const first = await session.next();
    expect(first.value).toMatchObject({ attempted: 4, outcome: 'error', observation: { observed: false } });
    const second = await session.next();
    expect(second.value).toMatchObject({ attempted: 1, outcome: 'connected', observation: { observed: true, forced: true } });
    if (!second.done) {
      expect(second.value.occlusion[1].numberBlocked).toBe(true);
      expect(second.value.knownNumbers).toContainEqual([1, 2]);
      expect(second.value.labels[4]).toBe(null);
      expect(second.value.knownNumbers.some(([index]) => index === 4)).toBe(false);
      expect(second.value.neighborhood.find((cell) => cell.index === 4)?.weight).toBe(0);
    }
  });
  it('level five sees through the hand but never through hidden-number masks', async () => {
    const hiddenLevel = { ...level, hiddenCells: level.solutionPath.slice(1, 3) };
    const solver = new PathCompletionSolver(level.solutionPath, level.boardShape);
    const session = stepOccludedPlay({ level: hiddenLevel, playerLevel: 5, memorySteps: 0,
      observe: async () => level.solutionPath.map(() => ({ coverage: 1, numberBlocked: true })),
      findCompletion: async (request) => solver.findCompletion(request) });
    const first = await session.next();
    if (first.done) throw new Error('Expected a decision');
    expect(first.value.observation).toMatchObject({ observed: true, forced: false });
    expect(first.value.knownNumbers).toContainEqual([3, 4]);
    expect(first.value.labels.slice(1, 3)).toEqual([null, null]);
    expect(first.value.knownNumbers.some(([index]) => index === 1 || index === 2)).toBe(false);
  });
  it('draws fresh randomness for each new session when no seed is supplied', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(.01).mockReturnValueOnce(.99);
    const solver = new PathCompletionSolver(level.solutionPath, level.boardShape);
    const input = { level: { ...level, hiddenCells: level.solutionPath.slice(1, 3) }, memorySteps: 0,
      observe: async () => clearOcclusion(4), findCompletion: async (request: Parameters<typeof solver.findCompletion>[0]) => solver.findCompletion(request) };
    try {
      const first = await stepOccludedPlay(input).next();
      const second = await stepOccludedPlay(input).next();
      expect(first.value).toMatchObject({ attempted: 1 });
      expect(second.value).toMatchObject({ attempted: 2 });
      expect(random).toHaveBeenCalledTimes(2);
    } finally { random.mockRestore(); }
  });
  it('executes one decision per next call and matches batch results', async () => {
    let observations = 0;
    const solver = new PathCompletionSolver(level.solutionPath, level.boardShape);
    const session = stepOccludedPlay({ level, seed: 7, memorySteps: 0,
      observe: async () => { observations++; return clearOcclusion(4); },
      findCompletion: async (request) => solver.findCompletion(request) });
    expect(observations).toBe(0);
    const first = await session.next();
    expect(first.done).toBe(false);
    expect(observations).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(observations).toBe(1);
    const second = await session.next();
    expect(second.value).toMatchObject({ step: 2 });
    expect(observations).toBe(2);
    await session.next();
    const finished = await session.next();
    expect(finished.done).toBe(true);
    expect(finished.value).toEqual(await run(false, 7));
  });
  it('cancels a paused session without making another observation', async () => {
    const abort = new AbortController();
    let observations = 0;
    const solver = new PathCompletionSolver(level.solutionPath, level.boardShape);
    const session = stepOccludedPlay({ level, seed: 1, memorySteps: 0, signal: abort.signal,
      observe: async () => { observations++; return clearOcclusion(4); },
      findCompletion: async (request) => solver.findCompletion(request) });
    await session.next(); abort.abort();
    await expect(session.next()).rejects.toMatchObject({ name: 'AbortError' });
    expect(observations).toBe(1);
  });
});
