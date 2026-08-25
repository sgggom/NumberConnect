import { countEditorPathCrossings } from './findEditorPath';
import type { EditorCell, EditorShape } from './types';

export type EditorTurnType = 'straight' | 'right-angle' | 'obtuse' | 'acute';

export interface EditorLevelMetrics {
  rightAngleTurns: number;
  acuteAngleTurns: number;
  obtuseAngleTurns: number;
  straightContinuations: number;
  rightAngleTurnRatio: number;
  acuteAngleTurnRatio: number;
  obtuseAngleTurnRatio: number;
  averageSegmentLength: number;
  upwardMoveRatio: number;
  downwardMoveRatio: number;
  leftwardMoveRatio: number;
  rightwardMoveRatio: number;
  upperLeftMoveRatio: number;
  upperRightMoveRatio: number;
  lowerLeftMoveRatio: number;
  lowerRightMoveRatio: number;
  consecutiveRightCount: number;
  consecutiveDownCount: number;
  consecutiveLowerRightCount: number;
  consecutiveOcclusionCount: number;
  startRegion: EditorEndpointRegion;
  endRegion: EditorEndpointRegion;
  pathCrossings: number;
  hiddenCount: number;
  hiddenRatio: number;
  longestHiddenRun: number;
  longestVisibleRun: number;
}

export type EditorEndpointRegion = '左上' | '右上' | '左下' | '右下' | '靠中';

interface EditorLevelMetricsInput {
  path: ReadonlyArray<EditorCell>;
  hiddenCellKeys: ReadonlySet<string>;
  shape: EditorShape;
}

const keyOf = (cell: EditorCell): string => `${cell.x},${cell.y}`;

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

const interiorAngle = (previous: EditorCell, current: EditorCell, next: EditorCell): number => {
  const incomingX = previous.x - current.x;
  const incomingY = previous.y - current.y;
  const outgoingX = next.x - current.x;
  const outgoingY = next.y - current.y;
  const divisor = Math.hypot(incomingX, incomingY) * Math.hypot(outgoingX, outgoingY);
  if (divisor === 0) return 0;
  const cosine = Math.max(-1, Math.min(1, (
    incomingX * outgoingX + incomingY * outgoingY
  ) / divisor));
  return Math.acos(cosine) * 180 / Math.PI;
};

const endpointRegion = (
  cell: EditorCell | undefined,
  projectedPath: ReadonlyArray<EditorCell>,
): EditorEndpointRegion => {
  if (!cell || projectedPath.length === 0) return '靠中';
  const xs = projectedPath.map((point) => point.x);
  const ys = projectedPath.map((point) => point.y);
  const minimumX = Math.min(...xs);
  const maximumX = Math.max(...xs);
  const minimumY = Math.min(...ys);
  const maximumY = Math.max(...ys);
  const centerX = (minimumX + maximumX) / 2;
  const centerY = (minimumY + maximumY) / 2;
  const centerHalfWidth = (maximumX - minimumX) / 6;
  const centerHalfHeight = (maximumY - minimumY) / 6;
  if (
    Math.abs(cell.x - centerX) <= centerHalfWidth + Number.EPSILON
    && Math.abs(cell.y - centerY) <= centerHalfHeight + Number.EPSILON
  ) {
    return '靠中';
  }
  if (cell.y <= centerY) return cell.x <= centerX ? '左上' : '右上';
  return cell.x <= centerX ? '左下' : '右下';
};

export const classifyEditorTurn = (
  previous: EditorCell | undefined,
  current: EditorCell,
  next: EditorCell,
  shape: EditorShape,
): EditorTurnType => {
  if (!previous) return 'straight';
  const angle = interiorAngle(
    projectCell(previous, shape),
    projectCell(current, shape),
    projectCell(next, shape),
  );
  if (Math.abs(angle - 180) < 0.5) return 'straight';
  if (Math.abs(angle - 90) < 0.5) return 'right-angle';
  return angle < 90 ? 'acute' : 'obtuse';
};

export const calculateEditorLevelMetrics = ({
  path,
  hiddenCellKeys,
  shape,
}: EditorLevelMetricsInput): EditorLevelMetrics => {
  let rightAngleTurns = 0;
  let acuteAngleTurns = 0;
  let obtuseAngleTurns = 0;
  let straightContinuations = 0;
  const projectedPath = path.map((cell) => projectCell(cell, shape));

  for (let index = 1; index < path.length - 1; index += 1) {
    const turnType = classifyEditorTurn(
      path[index - 1],
      path[index],
      path[index + 1],
      shape,
    );
    if (turnType === 'straight') straightContinuations += 1;
    else if (turnType === 'right-angle') rightAngleTurns += 1;
    else if (turnType === 'acute') acuteAngleTurns += 1;
    else obtuseAngleTurns += 1;
  }

  let totalPathLength = 0;
  let upwardMoves = 0;
  let downwardMoves = 0;
  let leftwardMoves = 0;
  let rightwardMoves = 0;
  let upperLeftMoves = 0;
  let upperRightMoves = 0;
  let lowerLeftMoves = 0;
  let lowerRightMoves = 0;
  let previousWasRight = false;
  let previousWasDown = false;
  let previousWasLowerRight = false;
  let consecutiveRightCount = 0;
  let consecutiveDownCount = 0;
  let consecutiveLowerRightCount = 0;
  let previousWasOccluding = false;
  let consecutiveOcclusionCount = 0;
  for (let index = 1; index < projectedPath.length; index += 1) {
    const deltaX = projectedPath[index].x - projectedPath[index - 1].x;
    const deltaY = projectedPath[index].y - projectedPath[index - 1].y;
    totalPathLength += Math.hypot(deltaX, deltaY);
    const horizontalDirection = deltaX < -Number.EPSILON
      ? 'left'
      : deltaX > Number.EPSILON ? 'right' : 'center';
    const verticalDirection = deltaY < -Number.EPSILON
      ? 'up'
      : deltaY > Number.EPSILON ? 'down' : 'center';
    if (horizontalDirection === 'center') {
      if (verticalDirection === 'up') upwardMoves += 1;
      else if (verticalDirection === 'down') downwardMoves += 1;
    } else if (verticalDirection === 'center') {
      if (horizontalDirection === 'left') leftwardMoves += 1;
      else rightwardMoves += 1;
    } else if (verticalDirection === 'up') {
      if (horizontalDirection === 'left') upperLeftMoves += 1;
      else upperRightMoves += 1;
    } else if (horizontalDirection === 'left') {
      lowerLeftMoves += 1;
    } else {
      lowerRightMoves += 1;
    }
    const isRight = horizontalDirection === 'right' && verticalDirection === 'center';
    const isDown = horizontalDirection === 'center' && verticalDirection === 'down';
    const isLowerRight = horizontalDirection === 'right' && verticalDirection === 'down';
    if (isRight && previousWasRight) consecutiveRightCount += 1;
    if (isDown && previousWasDown) consecutiveDownCount += 1;
    if (isLowerRight && previousWasLowerRight) consecutiveLowerRightCount += 1;
    const isOccluding = isRight || isDown || isLowerRight;
    if (isOccluding && previousWasOccluding) consecutiveOcclusionCount += 1;
    previousWasRight = isRight;
    previousWasDown = isDown;
    previousWasLowerRight = isLowerRight;
    previousWasOccluding = isOccluding;
  }
  const moveCount = Math.max(0, path.length - 1);
  const segmentCount = moveCount === 0
    ? 0
    : 1 + rightAngleTurns + acuteAngleTurns + obtuseAngleTurns;
  const turnCellCount = Math.max(0, path.length - 2);

  let hiddenCount = 0;
  let hiddenRun = 0;
  let visibleRun = 0;
  let longestHiddenRun = 0;
  let longestVisibleRun = 0;
  path.forEach((cell) => {
    if (hiddenCellKeys.has(keyOf(cell))) {
      hiddenCount += 1;
      hiddenRun += 1;
      visibleRun = 0;
      longestHiddenRun = Math.max(longestHiddenRun, hiddenRun);
    } else {
      visibleRun += 1;
      hiddenRun = 0;
      longestVisibleRun = Math.max(longestVisibleRun, visibleRun);
    }
  });

  return {
    rightAngleTurns,
    acuteAngleTurns,
    obtuseAngleTurns,
    straightContinuations,
    rightAngleTurnRatio: turnCellCount === 0 ? 0 : rightAngleTurns / turnCellCount,
    acuteAngleTurnRatio: turnCellCount === 0 ? 0 : acuteAngleTurns / turnCellCount,
    obtuseAngleTurnRatio: turnCellCount === 0 ? 0 : obtuseAngleTurns / turnCellCount,
    averageSegmentLength: segmentCount === 0 ? 0 : totalPathLength / segmentCount,
    upwardMoveRatio: moveCount === 0 ? 0 : upwardMoves / moveCount,
    downwardMoveRatio: moveCount === 0 ? 0 : downwardMoves / moveCount,
    leftwardMoveRatio: moveCount === 0 ? 0 : leftwardMoves / moveCount,
    rightwardMoveRatio: moveCount === 0 ? 0 : rightwardMoves / moveCount,
    upperLeftMoveRatio: moveCount === 0 ? 0 : upperLeftMoves / moveCount,
    upperRightMoveRatio: moveCount === 0 ? 0 : upperRightMoves / moveCount,
    lowerLeftMoveRatio: moveCount === 0 ? 0 : lowerLeftMoves / moveCount,
    lowerRightMoveRatio: moveCount === 0 ? 0 : lowerRightMoves / moveCount,
    consecutiveRightCount,
    consecutiveDownCount,
    consecutiveLowerRightCount,
    consecutiveOcclusionCount,
    startRegion: endpointRegion(projectedPath[0], projectedPath),
    endRegion: endpointRegion(projectedPath.at(-1), projectedPath),
    pathCrossings: countEditorPathCrossings(path, shape),
    hiddenCount,
    hiddenRatio: path.length === 0 ? 0 : hiddenCount / path.length,
    longestHiddenRun,
    longestVisibleRun,
  };
};
