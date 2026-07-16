import { countEditorPathCrossings } from './findEditorPath';
import type { EditorCell, EditorShape } from './types';

export interface EditorLevelMetrics {
  rightAngleTurns: number;
  acuteAngleTurns: number;
  obtuseAngleTurns: number;
  straightContinuations: number;
  pathCrossings: number;
  hiddenCount: number;
  hiddenRatio: number;
  longestHiddenRun: number;
  longestVisibleRun: number;
}

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

export const calculateEditorLevelMetrics = ({
  path,
  hiddenCellKeys,
  shape,
}: EditorLevelMetricsInput): EditorLevelMetrics => {
  const projectedPath = path.map((cell) => projectCell(cell, shape));
  let rightAngleTurns = 0;
  let acuteAngleTurns = 0;
  let obtuseAngleTurns = 0;
  let straightContinuations = 0;

  for (let index = 1; index < projectedPath.length - 1; index += 1) {
    const angle = interiorAngle(projectedPath[index - 1], projectedPath[index], projectedPath[index + 1]);
    if (Math.abs(angle - 180) < 0.5) straightContinuations += 1;
    else if (Math.abs(angle - 90) < 0.5) rightAngleTurns += 1;
    else if (angle < 90) acuteAngleTurns += 1;
    else obtuseAngleTurns += 1;
  }

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
    pathCrossings: countEditorPathCrossings(path, shape),
    hiddenCount,
    hiddenRatio: path.length === 0 ? 0 : hiddenCount / path.length,
    longestHiddenRun,
    longestVisibleRun,
  };
};
