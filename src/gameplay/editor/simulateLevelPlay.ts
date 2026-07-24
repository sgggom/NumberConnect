import { findSwappableHiddenPairs } from '../../game/hiddenSwap';
import { BoardShape } from '../../game/types';
import { areEditorCellsNeighbors } from './findEditorPath';
import { classifyEditorTurn, type EditorTurnType } from './levelMetrics';
import type { EditorCell, EditorShape } from './types';

export type SimulatedStepOutcome = 'error' | 'connected';
export type SimulationReasoningLevel = 'low' | 'medium' | 'high';

export interface SimulatedPlayStep {
  stepNumber: number;
  outcome: SimulatedStepOutcome;
  startNumber: number;
  endNumber: number;
  attemptedCells: EditorCell[];
  turnType: EditorTurnType;
  turnValue?: number;
  connectableCount: number;
  directConnect: boolean;
  directConnectRate?: number;
  distanceToNextVisibleNumber: number;
  errorRate?: number;
}

export interface SimulatedPlayResult {
  totalSteps: number;
  errorCount: number;
  steps: SimulatedPlayStep[];
}

const average = (values: ReadonlyArray<number>): number => (
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
);

const turnValueFor = (turnType: EditorTurnType): number => ({
  straight: 0,
  acute: 1,
  'right-angle': 2,
  obtuse: 3,
})[turnType];

export const averageSimulatedPlayResults = (
  results: ReadonlyArray<SimulatedPlayResult>,
): SimulatedPlayResult => {
  if (results.length === 0) return { totalSteps: 0, errorCount: 0, steps: [] };
  const maximumStepCount = Math.max(0, ...results.map((result) => result.steps.length));
  const steps = Array.from({ length: maximumStepCount }, (_, stepIndex): SimulatedPlayStep => {
    const samples = results
      .map((result) => result.steps[stepIndex])
      .filter((step): step is SimulatedPlayStep => step !== undefined);
    const representative = samples[0];
    if (!representative) throw new Error(`Missing simulation samples for step ${stepIndex + 1}.`);
    const directConnectRate = average(samples.map((step) => (
      step.directConnectRate ?? Number(step.directConnect)
    )));
    const errorRate = average(samples.map((step) => (
      step.errorRate ?? Number(step.outcome === 'error')
    )));
    return {
      ...representative,
      stepNumber: stepIndex + 1,
      outcome: errorRate > 0 ? 'error' : 'connected',
      turnValue: average(samples.map((step) => step.turnValue ?? turnValueFor(step.turnType))),
      connectableCount: average(samples.map((step) => step.connectableCount)),
      directConnect: directConnectRate >= 0.5,
      directConnectRate,
      distanceToNextVisibleNumber: average(
        samples.map((step) => step.distanceToNextVisibleNumber),
      ),
      errorRate,
    };
  });
  return {
    totalSteps: average(results.map((result) => result.totalSteps)),
    errorCount: average(results.map((result) => result.errorCount)),
    steps,
  };
};

interface SimulateLevelPlayInput {
  path: ReadonlyArray<EditorCell>;
  hiddenCellKeys: ReadonlySet<string>;
  shape: EditorShape;
  reasoningLevel?: SimulationReasoningLevel;
  random?: () => number;
}

type CellNeighborMap = ReadonlyMap<string, ReadonlyArray<string>>;

const keyOf = (cell: EditorCell): string => `${cell.x},${cell.y}`;

const boardShapeFor = (shape: EditorShape): BoardShape => {
  if (shape === 'diamond') return BoardShape.Diamond;
  if (shape === 'rectangle') return BoardShape.Rectangle;
  if (shape === 'hex') return BoardShape.Hex;
  return BoardShape.Square;
};

const chooseCandidate = (
  candidates: ReadonlyArray<EditorCell>,
  random: () => number,
): EditorCell => {
  const randomValue = Math.max(0, Math.min(0.999999999, random()));
  return candidates[Math.floor(randomValue * candidates.length)];
};

const buildCellNeighborMap = (
  cells: ReadonlyArray<EditorCell>,
  shape: EditorShape,
): CellNeighborMap => {
  const neighborsByCell = new Map<string, string[]>();
  cells.forEach((cell) => neighborsByCell.set(keyOf(cell), []));
  for (let leftIndex = 0; leftIndex < cells.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < cells.length; rightIndex += 1) {
      if (!areEditorCellsNeighbors(cells[leftIndex], cells[rightIndex], shape)) continue;
      neighborsByCell.get(keyOf(cells[leftIndex]))?.push(keyOf(cells[rightIndex]));
      neighborsByCell.get(keyOf(cells[rightIndex]))?.push(keyOf(cells[leftIndex]));
    }
  }
  return neighborsByCell;
};

const leavesRemainingCellsConnected = (
  current: EditorCell,
  routeCellKeys: ReadonlySet<string>,
  connectedKeys: ReadonlySet<string>,
  predictedKeys: ReadonlySet<string>,
  neighborsByCell: CellNeighborMap,
): boolean => {
  const remainingKeys = new Set<string>();
  routeCellKeys.forEach((key) => {
    if (!connectedKeys.has(key) && !predictedKeys.has(key)) remainingKeys.add(key);
  });
  if (remainingKeys.size === 0) return true;

  const currentNeighbors = neighborsByCell.get(keyOf(current)) ?? [];
  if (!currentNeighbors.some((key) => remainingKeys.has(key))) return false;

  const firstRemainingKey = remainingKeys.values().next().value as string;
  const reachableKeys = new Set([firstRemainingKey]);
  const pendingKeys = [firstRemainingKey];
  while (pendingKeys.length > 0) {
    const key = pendingKeys.pop() as string;
    for (const neighborKey of neighborsByCell.get(key) ?? []) {
      if (!remainingKeys.has(neighborKey) || reachableKeys.has(neighborKey)) continue;
      reachableKeys.add(neighborKey);
      pendingKeys.push(neighborKey);
    }
  }
  return reachableKeys.size === remainingKeys.size;
};

const minimumStepsBetween = (
  from: EditorCell,
  to: EditorCell,
  shape: EditorShape,
): number => {
  if (shape !== 'hex') {
    return Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  }

  const toCube = (cell: EditorCell): readonly [number, number, number] => {
    const cubeX = cell.x;
    const cubeZ = cell.y - (cell.x - (cell.x & 1)) / 2;
    return [cubeX, -cubeX - cubeZ, cubeZ];
  };
  const fromCube = toCube(from);
  const toCubePosition = toCube(to);
  return Math.max(
    Math.abs(toCubePosition[0] - fromCube[0]),
    Math.abs(toCubePosition[1] - fromCube[1]),
    Math.abs(toCubePosition[2] - fromCube[2]),
  );
};

const canReachNextVisibleNumber = (
  candidate: EditorCell,
  currentPosition: number,
  route: ReadonlyArray<EditorCell>,
  routeCellKeys: ReadonlySet<string>,
  hiddenCellKeys: ReadonlySet<string>,
  neighborsByCell: CellNeighborMap,
  shape: EditorShape,
  predictionDepth: number,
): boolean => {
  let anchorIndex = currentPosition + 1;
  while (anchorIndex < route.length && hiddenCellKeys.has(keyOf(route[anchorIndex]))) anchorIndex += 1;
  if (anchorIndex >= route.length) anchorIndex = route.length - 1;
  const anchor = route[anchorIndex];
  // The selected candidate is a+1. Every remaining intermediate cell must be
  // placed before the next visible-number anchor can be connected.
  const requiredIntermediateCount = anchorIndex - currentPosition - 2;
  if (requiredIntermediateCount < 0) return keyOf(candidate) === keyOf(anchor);

  const connectedKeys = new Set(route.slice(0, currentPosition + 1).map(keyOf));
  const anchorKey = keyOf(anchor);
  if (keyOf(candidate) === anchorKey) return false;
  const intermediateCells = route.filter((cell) => {
    const key = keyOf(cell);
    return key !== anchorKey && hiddenCellKeys.has(key) && !connectedKeys.has(key);
  });
  const visited = new Set([keyOf(candidate)]);
  const failedStates = new Set<string>();

  const search = (current: EditorCell, predictedSteps: number): boolean => {
    const stateKey = `${keyOf(current)}:${predictedSteps}:${[...visited].sort().join('|')}`;
    if (failedStates.has(stateKey)) return false;
    if (!leavesRemainingCellsConnected(
      current,
      routeCellKeys,
      connectedKeys,
      visited,
      neighborsByCell,
    )) {
      failedStates.add(stateKey);
      return false;
    }

    const remainingIntermediateCount = requiredIntermediateCount - predictedSteps;
    const remainingEdgesToAnchor = remainingIntermediateCount + 1;
    if (minimumStepsBetween(current, anchor, shape) > remainingEdgesToAnchor) {
      failedStates.add(stateKey);
      return false;
    }
    if (remainingIntermediateCount === 0) {
      if (!areEditorCellsNeighbors(current, anchor, shape)) {
        failedStates.add(stateKey);
        return false;
      }
      visited.add(anchorKey);
      const remainsConnectedAfterAnchor = leavesRemainingCellsConnected(
        anchor,
        routeCellKeys,
        connectedKeys,
        visited,
        neighborsByCell,
      );
      visited.delete(anchorKey);
      if (!remainsConnectedAfterAnchor) failedStates.add(stateKey);
      return remainsConnectedAfterAnchor;
    }
    // The candidate itself is the first predicted connection. Stop once the
    // selected reasoning tier's lookahead has been reached.
    if (predictedSteps + 1 >= predictionDepth) return true;

    const availableCount = intermediateCells.reduce(
      (count, cell) => count + (visited.has(keyOf(cell)) ? 0 : 1),
      0,
    );
    if (availableCount < remainingIntermediateCount) {
      failedStates.add(stateKey);
      return false;
    }

    for (const next of intermediateCells) {
      const key = keyOf(next);
      if (visited.has(key) || !areEditorCellsNeighbors(current, next, shape)) continue;
      visited.add(key);
      if (search(next, predictedSteps + 1)) return true;
      visited.delete(key);
    }
    failedStates.add(stateKey);
    return false;
  };

  return search(candidate, 0);
};

const nearbyVisibleNumberDistance = (
  candidate: EditorCell,
  current: EditorCell,
  currentPosition: number,
  route: ReadonlyArray<EditorCell>,
  hiddenCellKeys: ReadonlySet<string>,
  shape: EditorShape,
): number => {
  const targetNumber = currentPosition + 2;
  const currentKey = keyOf(current);
  let bestDistance = Number.POSITIVE_INFINITY;
  route.forEach((cell, index) => {
    const key = keyOf(cell);
    const visible = index <= currentPosition || !hiddenCellKeys.has(key);
    if (!visible || key === currentKey || !areEditorCellsNeighbors(candidate, cell, shape)) return;
    bestDistance = Math.min(bestDistance, Math.abs((index + 1) - targetNumber));
  });
  return bestDistance;
};

const chooseAnalyzedCandidate = (
  candidates: ReadonlyArray<EditorCell>,
  current: EditorCell,
  currentPosition: number,
  route: ReadonlyArray<EditorCell>,
  routeCellKeys: ReadonlySet<string>,
  hiddenCellKeys: ReadonlySet<string>,
  neighborsByCell: CellNeighborMap,
  shape: EditorShape,
  predictionDepth: number,
  random: () => number,
): EditorCell => {
  const safeCandidates = predictionDepth === 0
    ? candidates
    : candidates.filter((candidate) => canReachNextVisibleNumber(
        candidate,
        currentPosition,
        route,
        routeCellKeys,
        hiddenCellKeys,
        neighborsByCell,
        shape,
        predictionDepth,
      ));
  const available = safeCandidates.length > 0 ? safeCandidates : candidates;
  const scored = available.map((candidate) => ({
    candidate,
    distance: nearbyVisibleNumberDistance(
      candidate,
      current,
      currentPosition,
      route,
      hiddenCellKeys,
      shape,
    ),
  }));
  const bestDistance = Math.min(...scored.map(({ distance }) => distance));
  return chooseCandidate(
    scored.filter(({ distance }) => distance === bestDistance).map(({ candidate }) => candidate),
    random,
  );
};

const countConnectableCells = (
  current: EditorCell,
  currentPosition: number,
  route: ReadonlyArray<EditorCell>,
  shape: EditorShape,
): number => route.slice(currentPosition + 1).reduce(
  (count, candidate) => count + Number(areEditorCellsNeighbors(current, candidate, shape)),
  0,
);

const distanceToNextVisibleNumber = (
  currentPosition: number,
  route: ReadonlyArray<EditorCell>,
  hiddenCellKeys: ReadonlySet<string>,
): number => {
  let nextVisiblePosition = currentPosition + 1;
  while (
    nextVisiblePosition < route.length - 1
    && hiddenCellKeys.has(keyOf(route[nextVisiblePosition]))
  ) {
    nextVisiblePosition += 1;
  }
  return Math.max(1, nextVisiblePosition - currentPosition);
};

/**
 * Simulates a forward player who follows visible numbers and only guesses when
 * two or more still-possible hidden cells are adjacent. Every attempted
 * connection is one step. A wrong guess is remembered at that exact path
 * position before the next connection is attempted.
 */
export const simulateLevelPlay = ({
  path,
  hiddenCellKeys,
  shape,
  reasoningLevel = 'medium',
  random = Math.random,
}: SimulateLevelPlayInput): SimulatedPlayResult => {
  if (path.length < 2) return { totalSteps: 0, errorCount: 0, steps: [] };

  const route = path.map((cell) => ({ ...cell }));
  const pathCellKeys = new Set(route.map(keyOf));
  const neighborsByCell = buildCellNeighborMap(route, shape);
  const swappablePairs = findSwappableHiddenPairs(route, hiddenCellKeys, boardShapeFor(shape));
  const swappableByAnchor = new Map(swappablePairs.map(([firstIndex, secondIndex]) => [
    firstIndex - 1,
    { firstIndex, secondIndex },
  ]));
  const decidedSwaps = new Set<number>();
  const excludedChoices = new Map<string, Set<string>>();
  const steps: SimulatedPlayStep[] = [];
  let currentPosition = 0;
  let errorCount = 0;
  const predictionDepth = reasoningLevel === 'low' ? 0 : reasoningLevel === 'high' ? 5 : 2;

  while (currentPosition < route.length - 1) {
    const current = route[currentPosition];
    const expected = route[currentPosition + 1];
    const expectedKey = keyOf(expected);
    const excludedAtCurrent = excludedChoices.get(keyOf(current)) ?? new Set<string>();
    const expectedIsVisible = !hiddenCellKeys.has(expectedKey);
    const candidates = expectedIsVisible
      ? [expected]
      : route.slice(currentPosition + 1).filter((candidate) => {
          const key = keyOf(candidate);
          return pathCellKeys.has(key)
            && hiddenCellKeys.has(key)
            && !excludedAtCurrent.has(key)
            && areEditorCellsNeighbors(current, candidate, shape);
        });

    const selected = candidates.length > 1
      ? chooseAnalyzedCandidate(
          candidates,
          current,
          currentPosition,
          route,
          pathCellKeys,
          hiddenCellKeys,
          neighborsByCell,
          shape,
          predictionDepth,
          random,
        )
      : candidates[0] ?? expected;
    const selectedKey = keyOf(selected);
    const startNumber = currentPosition + 1;
    const swappable = swappableByAnchor.get(currentPosition);
    const swapUndecided = swappable && !decidedSwaps.has(swappable.firstIndex);
    const alternate = swapUndecided ? route[swappable.secondIndex] : undefined;
    const selectedAuthored = selectedKey === expectedKey;
    const selectedAlternate = alternate !== undefined && selectedKey === keyOf(alternate);
    const outcome: SimulatedStepOutcome = selectedAuthored || selectedAlternate
      ? 'connected'
      : 'error';

    steps.push({
      stepNumber: steps.length + 1,
      outcome,
      startNumber,
      endNumber: outcome === 'connected' ? startNumber + 1 : startNumber,
      attemptedCells: [{ ...current }, { ...selected }],
      turnType: classifyEditorTurn(
        currentPosition > 0 ? route[currentPosition - 1] : undefined,
        current,
        selected,
        shape,
      ),
      connectableCount: countConnectableCells(current, currentPosition, route, shape),
      directConnect: expectedIsVisible,
      distanceToNextVisibleNumber: distanceToNextVisibleNumber(
        currentPosition,
        route,
        hiddenCellKeys,
      ),
    });

    if (outcome === 'error') {
      let excluded = excludedChoices.get(keyOf(current));
      if (!excluded) {
        excluded = new Set<string>();
        excludedChoices.set(keyOf(current), excluded);
      }
      excluded.add(selectedKey);
      errorCount += 1;
      continue;
    }

    if (swapUndecided) {
      if (selectedAlternate) {
        [route[swappable.firstIndex], route[swappable.secondIndex]] = [
          route[swappable.secondIndex],
          route[swappable.firstIndex],
        ];
      }
      decidedSwaps.add(swappable.firstIndex);
    }

    currentPosition += 1;
  }

  return {
    totalSteps: steps.length,
    errorCount,
    steps,
  };
};
