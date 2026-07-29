import { PathCompletionSolver } from '../../game/pathCompletionSolver';
import { calculateDifficultyScore } from '../../game/boardNeighborhood';
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
  reasoningDepth: number;
  availableBranchCount: number;
  lengthValidBranchCount: number;
  rejectedIsolationBranchCount: number;
  choiceCount: number;
  reasoningBranchCount: number;
  legalReasoningBranchCount: number;
  difficultyScore: number;
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
      reasoningDepth: average(samples.map((step) => step.reasoningDepth)),
      availableBranchCount: average(samples.map((step) => step.availableBranchCount)),
      lengthValidBranchCount: average(samples.map((step) => step.lengthValidBranchCount)),
      rejectedIsolationBranchCount: average(
        samples.map((step) => step.rejectedIsolationBranchCount),
      ),
      choiceCount: average(samples.map((step) => step.choiceCount)),
      reasoningBranchCount: average(samples.map((step) => step.reasoningBranchCount)),
      legalReasoningBranchCount: average(
        samples.map((step) => step.legalReasoningBranchCount),
      ),
      difficultyScore: average(samples.map((step) => step.difficultyScore)),
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
  completionSolver?: PathCompletionSolver;
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

interface CandidateReasoningAnalysis {
  candidate: EditorCell;
  canReach: boolean;
  exploredDepth: number;
  lengthValid: boolean;
  rejectedByIsolation: boolean;
}

interface CandidateSelectionAnalysis {
  selected: EditorCell;
  reasoningDepth: number;
  availableBranchCount: number;
  lengthValidBranchCount: number;
  rejectedIsolationBranchCount: number;
}

const analyzeCandidateReasoning = (
  candidate: EditorCell,
  currentPosition: number,
  route: ReadonlyArray<EditorCell>,
  routeCellKeys: ReadonlySet<string>,
  hiddenCellKeys: ReadonlySet<string>,
  neighborsByCell: CellNeighborMap,
  shape: EditorShape,
  predictionDepth: number,
): CandidateReasoningAnalysis => {
  let anchorIndex = currentPosition + 1;
  while (anchorIndex < route.length && hiddenCellKeys.has(keyOf(route[anchorIndex]))) anchorIndex += 1;
  if (anchorIndex >= route.length) anchorIndex = route.length - 1;
  const anchor = route[anchorIndex];
  const distanceToAnchor = Math.max(1, anchorIndex - currentPosition);
  const depthLimit = Math.min(predictionDepth, distanceToAnchor);
  // The selected candidate is a+1. Every remaining intermediate cell must be
  // placed before the next visible-number anchor can be connected.
  const requiredIntermediateCount = anchorIndex - currentPosition - 2;

  const connectedKeys = new Set(route.slice(0, currentPosition + 1).map(keyOf));
  const anchorKey = keyOf(anchor);
  const candidateKey = keyOf(candidate);
  const lengthValid = requiredIntermediateCount >= 0
    && candidateKey !== anchorKey
    && minimumStepsBetween(candidate, anchor, shape) <= requiredIntermediateCount + 1;
  const intermediateCells = route.filter((cell) => {
    const key = keyOf(cell);
    return key !== anchorKey && hiddenCellKeys.has(key) && !connectedKeys.has(key);
  });
  const visited = new Set([candidateKey]);
  const rejectedByIsolation = !leavesRemainingCellsConnected(
    candidate,
    routeCellKeys,
    connectedKeys,
    visited,
    neighborsByCell,
  );
  if (predictionDepth === 0) {
    return {
      candidate,
      canReach: true,
      exploredDepth: 0,
      lengthValid,
      rejectedByIsolation,
    };
  }
  if (requiredIntermediateCount < 0 || candidateKey === anchorKey) {
    return {
      candidate,
      canReach: candidateKey === anchorKey,
      exploredDepth: Math.min(1, depthLimit),
      lengthValid,
      rejectedByIsolation,
    };
  }

  const failedStates = new Set<string>();
  let exploredDepth = 0;

  const search = (current: EditorCell, predictedSteps: number): boolean => {
    exploredDepth = Math.max(exploredDepth, Math.min(depthLimit, predictedSteps + 1));
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
      const depthIncludingAnchor = predictedSteps + 2;
      if (depthIncludingAnchor > depthLimit) return true;
      exploredDepth = Math.max(exploredDepth, depthIncludingAnchor);
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
    if (predictedSteps + 1 >= depthLimit) return true;

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

  return {
    candidate,
    canReach: search(candidate, 0),
    exploredDepth,
    lengthValid,
    rejectedByIsolation,
  };
};

const chooseAnalyzedCandidate = (
  candidates: ReadonlyArray<EditorCell>,
  currentPosition: number,
  route: ReadonlyArray<EditorCell>,
  routeCellKeys: ReadonlySet<string>,
  hiddenCellKeys: ReadonlySet<string>,
  neighborsByCell: CellNeighborMap,
  shape: EditorShape,
  predictionDepth: number,
  random: () => number,
): CandidateSelectionAnalysis => {
  const analyses = candidates.map((candidate) => analyzeCandidateReasoning(
        candidate,
        currentPosition,
        route,
        routeCellKeys,
        hiddenCellKeys,
        neighborsByCell,
        shape,
        predictionDepth,
      ));
  const safeCandidates = predictionDepth === 0
    ? candidates
    : analyses.filter(({ canReach }) => canReach).map(({ candidate }) => candidate);
  const available = safeCandidates.length > 0 ? safeCandidates : candidates;
  return {
    selected: chooseCandidate(available, random),
    reasoningDepth: predictionDepth === 0
      ? 0
      : Math.max(0, ...analyses.map(({ exploredDepth }) => exploredDepth)),
    availableBranchCount: candidates.length,
    lengthValidBranchCount: analyses.filter(({ lengthValid }) => lengthValid).length,
    rejectedIsolationBranchCount: analyses.filter(
      ({ lengthValid, rejectedByIsolation }) => lengthValid && rejectedByIsolation,
    ).length,
  };
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

interface NewReasoningMetrics {
  choiceCount: number;
  reasoningBranchCount: number;
  legalReasoningBranchCount: number;
}

const calculateNewReasoningMetrics = (
  currentPosition: number,
  route: ReadonlyArray<EditorCell>,
  routeCellKeys: ReadonlySet<string>,
  hiddenCellKeys: ReadonlySet<string>,
  neighborsByCell: CellNeighborMap,
  shape: EditorShape,
  predictionDepth: number,
): NewReasoningMetrics => {
  const current = route[currentPosition];
  const connectedKeys = new Set(route.slice(0, currentPosition + 1).map(keyOf));
  const hiddenAvailableCells = route.filter((cell) => {
    const key = keyOf(cell);
    return hiddenCellKeys.has(key) && !connectedKeys.has(key);
  });
  const choiceCount = hiddenAvailableCells.reduce(
    (count, cell) => count + Number(areEditorCellsNeighbors(current, cell, shape)),
    0,
  );

  let nextVisiblePosition = currentPosition + 1;
  while (
    nextVisiblePosition < route.length
    && hiddenCellKeys.has(keyOf(route[nextVisiblePosition]))
  ) {
    nextVisiblePosition += 1;
  }
  if (nextVisiblePosition >= route.length) nextVisiblePosition = route.length - 1;
  const intermediateCount = Math.max(0, nextVisiblePosition - currentPosition - 1);
  if (intermediateCount === 0) {
    return {
      choiceCount,
      reasoningBranchCount: 0,
      legalReasoningBranchCount: 0,
    };
  }

  const target = route[nextVisiblePosition];
  const targetKey = keyOf(target);
  const visitedKeys = new Set<string>([keyOf(current)]);
  const predictedKeys = new Set<string>();
  let reasoningBranchCount = 0;
  let legalReasoningBranchCount = 0;

  const createsDeadlockAt = (cell: EditorCell, moveDepth: number): boolean => (
    predictionDepth > 0
    && moveDepth <= predictionDepth
    && !leavesRemainingCellsConnected(
      cell,
      routeCellKeys,
      connectedKeys,
      predictedKeys,
      neighborsByCell,
    )
  );

  const search = (
    position: EditorCell,
    usedIntermediateCount: number,
    deadlockDetected: boolean,
  ): void => {
    const remainingIntermediateCount = intermediateCount - usedIntermediateCount;
    const remainingMovesToTarget = remainingIntermediateCount + 1;
    if (minimumStepsBetween(position, target, shape) > remainingMovesToTarget) return;

    if (remainingIntermediateCount === 0) {
      if (!areEditorCellsNeighbors(position, target, shape)) return;
      predictedKeys.add(targetKey);
      const targetMoveDepth = usedIntermediateCount + 1;
      const branchDeadlocks = deadlockDetected || createsDeadlockAt(target, targetMoveDepth);
      predictedKeys.delete(targetKey);
      reasoningBranchCount += 1;
      if (predictionDepth === 0 || !branchDeadlocks) legalReasoningBranchCount += 1;
      return;
    }

    for (const next of hiddenAvailableCells) {
      const nextKey = keyOf(next);
      if (
        nextKey === targetKey
        || visitedKeys.has(nextKey)
        || !areEditorCellsNeighbors(position, next, shape)
      ) {
        continue;
      }
      const nextUsedCount = usedIntermediateCount + 1;
      const movesAfterNext = intermediateCount - nextUsedCount + 1;
      if (minimumStepsBetween(next, target, shape) > movesAfterNext) continue;

      visitedKeys.add(nextKey);
      predictedKeys.add(nextKey);
      const branchDeadlocks = deadlockDetected || createsDeadlockAt(next, nextUsedCount);
      search(next, nextUsedCount, branchDeadlocks);
      predictedKeys.delete(nextKey);
      visitedKeys.delete(nextKey);
    }
  };

  search(current, 0, false);
  return {
    choiceCount,
    reasoningBranchCount,
    legalReasoningBranchCount,
  };
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
  completionSolver: providedCompletionSolver,
}: SimulateLevelPlayInput): SimulatedPlayResult => {
  if (path.length < 2) return { totalSteps: 0, errorCount: 0, steps: [] };

  const route = path.map((cell) => ({ ...cell }));
  const pathCellKeys = new Set(route.map(keyOf));
  const nodeIndexByKey = new Map(route.map((cell, index) => [keyOf(cell), index]));
  const neighborsByCell = buildCellNeighborMap(route, shape);
  const completionSolver = providedCompletionSolver
    ?? new PathCompletionSolver(route, boardShapeFor(shape));
  const fixedPositions = new Map<number, number>();
  route.forEach((cell, index) => {
    if (
      index === 0
      || index === route.length - 1
      || !hiddenCellKeys.has(keyOf(cell))
    ) {
      fixedPositions.set(index, index);
    }
  });
  const requiredEdges: Array<readonly [number, number]> = [];
  const excludedChoices = new Map<string, Set<string>>();
  const steps: SimulatedPlayStep[] = [];
  const newReasoningMetricsCache = new Map<string, NewReasoningMetrics>();
  const difficultyScoreCache = new Map<string, number>();
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

    const branchAnalysis = !expectedIsVisible && candidates.length > 1
      ? chooseAnalyzedCandidate(
          candidates,
          currentPosition,
          route,
          pathCellKeys,
          hiddenCellKeys,
          neighborsByCell,
          shape,
          predictionDepth,
          random,
        )
      : !expectedIsVisible && candidates.length === 1
        ? (() => {
            const analysis = analyzeCandidateReasoning(
              candidates[0],
              currentPosition,
              route,
              pathCellKeys,
              hiddenCellKeys,
              neighborsByCell,
              shape,
              0,
            );
            return {
              selected: candidates[0],
              reasoningDepth: 0,
              availableBranchCount: 1,
              lengthValidBranchCount: Number(analysis.lengthValid),
              rejectedIsolationBranchCount: Number(
                analysis.lengthValid && analysis.rejectedByIsolation,
              ),
            };
          })()
        : {
            selected: candidates[0] ?? expected,
            reasoningDepth: 0,
            availableBranchCount: 0,
            lengthValidBranchCount: 0,
            rejectedIsolationBranchCount: 0,
          };
    const selected = branchAnalysis.selected;
    const selectedKey = keyOf(selected);
    const startNumber = currentPosition + 1;
    const currentNodeIndex = nodeIndexByKey.get(keyOf(current));
    const selectedNodeIndex = nodeIndexByKey.get(selectedKey);
    const followsCurrentCompletion = selectedKey === expectedKey;
    const completion = currentNodeIndex === undefined || selectedNodeIndex === undefined
      ? null
      : followsCurrentCompletion
        ? route.map((cell) => nodeIndexByKey.get(keyOf(cell)) as number)
        : completionSolver.findCompletion({
            fixedPositions,
            requiredEdges: [
              ...requiredEdges,
              [currentNodeIndex, selectedNodeIndex],
            ],
            directedStep: {
              from: currentNodeIndex,
              to: selectedNodeIndex,
              direction: 1,
            },
          });
    const outcome: SimulatedStepOutcome = completion ? 'connected' : 'error';
    const newReasoningMetricsKey = `${currentPosition}:${route.map(keyOf).join('|')}`;
    let newReasoningMetrics = newReasoningMetricsCache.get(newReasoningMetricsKey);
    if (!newReasoningMetrics) {
      newReasoningMetrics = calculateNewReasoningMetrics(
        currentPosition,
        route,
        pathCellKeys,
        hiddenCellKeys,
        neighborsByCell,
        shape,
        predictionDepth,
      );
      newReasoningMetricsCache.set(newReasoningMetricsKey, newReasoningMetrics);
    }
    const nextVisibleDistance = distanceToNextVisibleNumber(
      currentPosition,
      route,
      hiddenCellKeys,
    );
    let difficultyScore = difficultyScoreCache.get(newReasoningMetricsKey);
    if (difficultyScore === undefined) {
      const scoreCandidates = expectedIsVisible
        ? []
        : route.slice(currentPosition + 1).filter((candidate) => (
            hiddenCellKeys.has(keyOf(candidate))
            && areEditorCellsNeighbors(current, candidate, shape)
          ));
      const infeasibleChoiceCount = currentNodeIndex === undefined
        ? scoreCandidates.length
        : scoreCandidates.reduce((count, candidate) => {
            const candidateKey = keyOf(candidate);
            if (candidateKey === expectedKey) return count;
            const candidateNodeIndex = nodeIndexByKey.get(candidateKey);
            if (candidateNodeIndex === undefined) return count + 1;
            const candidateCompletion = completionSolver.findCompletion({
              fixedPositions,
              requiredEdges: [
                ...requiredEdges,
                [currentNodeIndex, candidateNodeIndex],
              ],
              directedStep: {
                from: currentNodeIndex,
                to: candidateNodeIndex,
                direction: 1,
              },
            });
            return count + Number(candidateCompletion === null);
          }, 0);
      difficultyScore = calculateDifficultyScore({
        choiceQuantity: newReasoningMetrics.choiceCount,
        infeasibleChoiceCount,
        nextNumberDistance: Math.max(0, nextVisibleDistance - 1),
        reasoningBranchCount: newReasoningMetrics.reasoningBranchCount,
        hasObviousAnswer: expectedIsVisible,
      }).badgeScore;
      difficultyScoreCache.set(newReasoningMetricsKey, difficultyScore);
    }
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
      distanceToNextVisibleNumber: nextVisibleDistance,
      reasoningDepth: branchAnalysis.reasoningDepth,
      availableBranchCount: branchAnalysis.availableBranchCount,
      lengthValidBranchCount: branchAnalysis.lengthValidBranchCount,
      rejectedIsolationBranchCount: branchAnalysis.rejectedIsolationBranchCount,
      choiceCount: newReasoningMetrics.choiceCount,
      reasoningBranchCount: newReasoningMetrics.reasoningBranchCount,
      legalReasoningBranchCount: newReasoningMetrics.legalReasoningBranchCount,
      difficultyScore,
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

    if (completion && currentNodeIndex !== undefined && selectedNodeIndex !== undefined) {
      requiredEdges.push([currentNodeIndex, selectedNodeIndex]);
      route.splice(0, route.length, ...completion.map((nodeIndex) => path[nodeIndex]));
      for (let position = 0; position <= currentPosition + 1; position += 1) {
        fixedPositions.set(completion[position], position);
      }
    }

    currentPosition += 1;
  }

  return {
    totalSteps: steps.length,
    errorCount,
    steps,
  };
};
