import { findSwappableHiddenPairs } from '../../game/hiddenSwap';
import { BoardShape } from '../../game/types';
import { areEditorCellsNeighbors } from './findEditorPath';
import type { EditorCell, EditorShape } from './types';

export type SimulatedStepOutcome = 'error' | 'complete';

export interface SimulatedPlayStep {
  stepNumber: number;
  outcome: SimulatedStepOutcome;
  startNumber: number;
  endNumber: number;
  attemptedCells: EditorCell[];
  length: number;
  turnCount: number;
  filledHiddenCount: number;
  forkCount: number;
}

export interface SimulatedPlayResult {
  totalSteps: number;
  errorCount: number;
  steps: SimulatedPlayStep[];
}

interface SimulateLevelPlayInput {
  path: ReadonlyArray<EditorCell>;
  hiddenCellKeys: ReadonlySet<string>;
  shape: EditorShape;
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

const projectCell = (cell: EditorCell, shape: EditorShape): EditorCell => {
  if (shape === 'diamond') {
    return {
      x: (cell.x - cell.y) * Math.SQRT1_2,
      y: (cell.x + cell.y) * Math.SQRT1_2,
    };
  }
  if (shape === 'hex') {
    return {
      x: cell.x * 0.8660254,
      y: cell.y + (cell.x % 2 === 0 ? 0 : 0.5),
    };
  }
  return cell;
};

const countTurns = (cells: ReadonlyArray<EditorCell>, shape: EditorShape): number => {
  if (cells.length < 3) return 0;
  const projected = cells.map((cell) => projectCell(cell, shape));
  let turns = 0;
  for (let index = 2; index < projected.length; index += 1) {
    const previousX = projected[index - 1].x - projected[index - 2].x;
    const previousY = projected[index - 1].y - projected[index - 2].y;
    const nextX = projected[index].x - projected[index - 1].x;
    const nextY = projected[index].y - projected[index - 1].y;
    const cross = previousX * nextY - previousY * nextX;
    const dot = previousX * nextX + previousY * nextY;
    if (Math.abs(cross) > 1e-6 || dot <= 0) turns += 1;
  }
  return turns;
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
  random: () => number,
): EditorCell => {
  const safeCandidates = candidates.filter((candidate) => canReachNextVisibleNumber(
    candidate,
    currentPosition,
    route,
    routeCellKeys,
    hiddenCellKeys,
    neighborsByCell,
    shape,
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

/**
 * Simulates a forward player who follows visible numbers and only guesses when
 * two or more still-possible hidden cells are adjacent. A wrong guess is
 * remembered at that exact path position before the next attempt begins.
 */
export const simulateLevelPlay = ({
  path,
  hiddenCellKeys,
  shape,
  random = Math.random,
}: SimulateLevelPlayInput): SimulatedPlayResult => {
  if (path.length === 0) return { totalSteps: 0, errorCount: 0, steps: [] };

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

  do {
    const stepNumber = steps.length + 1;
    const startNumber = currentPosition + 1;
    const stepCells: EditorCell[] = [{ ...route[currentPosition] }];
    let filledHiddenCount = 0;
    let forkCount = 0;
    let outcome: SimulatedStepOutcome = 'complete';

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

      if (candidates.length > 1) forkCount += 1;
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
            random,
          )
        : candidates[0] ?? expected;
      const selectedKey = keyOf(selected);
      stepCells.push({ ...selected });

      const swappable = swappableByAnchor.get(currentPosition);
      const swapUndecided = swappable && !decidedSwaps.has(swappable.firstIndex);
      const alternate = swapUndecided ? route[swappable.secondIndex] : undefined;
      const selectedAuthored = selectedKey === expectedKey;
      const selectedAlternate = alternate !== undefined && selectedKey === keyOf(alternate);

      if (!selectedAuthored && !selectedAlternate) {
        let excluded = excludedChoices.get(keyOf(current));
        if (!excluded) {
          excluded = new Set<string>();
          excludedChoices.set(keyOf(current), excluded);
        }
        excluded.add(selectedKey);
        errorCount += 1;
        outcome = 'error';
        break;
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
      if (hiddenCellKeys.has(selectedKey)) filledHiddenCount += 1;
    }

    steps.push({
      stepNumber,
      outcome,
      startNumber,
      endNumber: currentPosition + 1,
      attemptedCells: stepCells,
      length: stepCells.length - 1,
      turnCount: countTurns(stepCells, shape),
      filledHiddenCount,
      forkCount,
    });
  } while (currentPosition < route.length - 1);

  return {
    totalSteps: steps.length,
    errorCount,
    steps,
  };
};
