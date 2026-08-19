export interface PathTrendPoint {
  x: number;
  y: number;
}

export const PATH_TREND_COLORS = [
  '#249bff', '#37d99a', '#f1d84b', '#ff9d3d', '#ef5350', '#f06bb5', '#9b5cff',
] as const;

const hexChannel = (color: string, offset: number): number => parseInt(color.slice(offset, offset + 2), 16);

export const pathTrendColorAt = (progress: number): string => {
  const clamped = Math.max(0, Math.min(1, progress));
  const scaled = clamped * (PATH_TREND_COLORS.length - 1);
  const leftIndex = Math.floor(scaled);
  const rightIndex = Math.min(PATH_TREND_COLORS.length - 1, leftIndex + 1);
  const ratio = scaled - leftIndex;
  const left = PATH_TREND_COLORS[leftIndex];
  const right = PATH_TREND_COLORS[rightIndex];
  const channels = [1, 3, 5].map((offset) => Math.round(
    hexChannel(left, offset) + (hexChannel(right, offset) - hexChannel(left, offset)) * ratio,
  ));
  return `rgb(${channels.join(', ')})`;
};

const distanceToLine = (
  point: PathTrendPoint,
  start: PathTrendPoint,
  end: PathTrendPoint,
): number => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = Math.max(0, Math.min(1, (
    (point.x - start.x) * dx + (point.y - start.y) * dy
  ) / lengthSquared));
  return Math.hypot(point.x - (start.x + dx * ratio), point.y - (start.y + dy * ratio));
};

export const buildPathTrend = (
  source: ReadonlyArray<PathTrendPoint>,
  maximumWaypoints = 14,
): PathTrendPoint[] => {
  if (source.length <= 2) return source.map((point) => ({ ...point }));
  const waypointCount = Math.min(source.length, Math.max(5, Math.min(
    maximumWaypoints,
    Math.ceil(Math.sqrt(source.length) * 1.35),
  )));
  const progressStep = (source.length - 1) / (waypointCount - 1);
  const sampled: PathTrendPoint[] = [{ ...source[0] }];

  for (let index = 1; index < waypointCount - 1; index += 1) {
    const center = index * progressStep;
    const radius = Math.max(1, progressStep * 0.42);
    const from = Math.max(1, Math.floor(center - radius));
    const to = Math.min(source.length - 2, Math.ceil(center + radius));
    let x = 0;
    let y = 0;
    let count = 0;
    for (let sourceIndex = from; sourceIndex <= to; sourceIndex += 1) {
      x += source[sourceIndex].x;
      y += source[sourceIndex].y;
      count += 1;
    }
    if (count > 0) {
      const centerPoint = { x: x / count, y: y / count };
      let representative = source[from];
      let representativeDistance = Number.POSITIVE_INFINITY;
      for (let sourceIndex = from; sourceIndex <= to; sourceIndex += 1) {
        const candidate = source[sourceIndex];
        const distance = Math.hypot(candidate.x - centerPoint.x, candidate.y - centerPoint.y);
        if (distance < representativeDistance) {
          representative = candidate;
          representativeDistance = distance;
        }
      }
      const previous = sampled[sampled.length - 1];
      if (previous.x !== representative.x || previous.y !== representative.y) {
        sampled.push({ ...representative });
      }
    }
  }
  const finalPoint = source[source.length - 1];
  const previous = sampled[sampled.length - 1];
  if (previous.x !== finalPoint.x || previous.y !== finalPoint.y) sampled.push({ ...finalPoint });

  const simplified: PathTrendPoint[] = [];
  sampled.forEach((point) => {
    simplified.push(point);
    while (simplified.length >= 3) {
      const end = simplified[simplified.length - 1];
      const middle = simplified[simplified.length - 2];
      const start = simplified[simplified.length - 3];
      if (distanceToLine(middle, start, end) > 0.32) break;
      simplified.splice(simplified.length - 2, 1);
    }
  });
  const octilinear: PathTrendPoint[] = [{ ...simplified[0] }];
  simplified.slice(1).forEach((target) => {
    const start = octilinear[octilinear.length - 1];
    const dx = target.x - start.x;
    const dy = target.y - start.y;
    const diagonalDistance = Math.min(Math.abs(dx), Math.abs(dy));
    if (diagonalDistance > 0.001 && Math.abs(Math.abs(dx) - Math.abs(dy)) > 0.001) {
      octilinear.push({
        x: start.x + Math.sign(dx) * diagonalDistance,
        y: start.y + Math.sign(dy) * diagonalDistance,
      });
    }
    octilinear.push({ ...target });
  });
  return octilinear;
};
