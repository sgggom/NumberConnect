import { calculateHeldCellScore } from './boardNeighborhood';
import { PathCompletionSolver } from './pathCompletionSolver';
import type { BoardHoldScore, BoardShape, Cell } from './types';

export interface CompletionAwareScoreRequest {
  cells: Cell[];
  boardShape: BoardShape;
  centerIndex: number;
  availableIndices: number[];
  visibleIndices: number[];
  displayNumbers: number[];
  fixedPositions: Array<readonly [number, number]>;
  requiredEdges: Array<readonly [number, number]>;
  solutionOrder: number[];
}

export const calculateCompletionAwareScore = (
  request: CompletionAwareScoreRequest,
): BoardHoldScore => {
  const available = new Set(request.availableIndices);
  const visible = new Set(request.visibleIndices);
  const fixedPositions = new Map(request.fixedPositions);
  const solver = new PathCompletionSolver(request.cells, request.boardShape);
  const centerPosition = request.solutionOrder.indexOf(request.centerIndex);

  return calculateHeldCellScore(
    { boardShape: request.boardShape, solutionPath: request.cells },
    request.centerIndex,
    (index) => available.has(index),
    (index) => visible.has(index),
    (index) => request.displayNumbers[index] ?? index + 1,
    (index) => {
      if (request.solutionOrder[centerPosition + 1] === index) return false;
      return solver.findCompletion({
        fixedPositions,
        requiredEdges: [...request.requiredEdges, [request.centerIndex, index]],
        directedStep: { from: request.centerIndex, to: index, direction: 1 },
      }) === null;
    },
  );
};
