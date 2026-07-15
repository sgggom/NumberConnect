import type { EditorCell, EditorShape } from './types';

export type EditorPathStyle = 'classic' | 'varied';
export type EditorCrossingMode = 'target' | 'maximum';

export interface EditorPathGenerationOptions {
  style?: EditorPathStyle;
  crossingMode?: EditorCrossingMode;
  turnProbability?: number;
  maxNodes?: number;
}

const DIRECTIONS: ReadonlyArray<Readonly<EditorCell>> = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: -1, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 },
];

const cellKey = (cell: EditorCell): string => `${cell.x},${cell.y}`;

const variationRank = (cell: EditorCell, generationIndex: number, salt: number): number => {
  let value = Math.imul(cell.x + 1, 73856093)
    ^ Math.imul(cell.y + 1, 19349663)
    ^ Math.imul(generationIndex + 1, 83492791)
    ^ Math.imul(salt + 1, 2654435761);
  value ^= value >>> 16;
  return value >>> 0;
};

const neighbors = (cell: EditorCell, shape: EditorShape): EditorCell[] => {
  const offsets = shape === 'hex'
    ? cell.x % 2 === 0
      ? [
          { x: 0, y: -1 }, { x: 0, y: 1 },
          { x: -1, y: -1 }, { x: -1, y: 0 },
          { x: 1, y: -1 }, { x: 1, y: 0 },
        ]
      : [
          { x: 0, y: -1 }, { x: 0, y: 1 },
          { x: -1, y: 0 }, { x: -1, y: 1 },
          { x: 1, y: 0 }, { x: 1, y: 1 },
        ]
      : DIRECTIONS;
  return offsets.map((offset) => ({ x: cell.x + offset.x, y: cell.y + offset.y }));
};

export const areEditorCellsNeighbors = (
  left: EditorCell,
  right: EditorCell,
  shape: EditorShape,
): boolean => neighbors(left, shape).some((cell) => cell.x === right.x && cell.y === right.y);

const inside = (cell: EditorCell, rows: number, columns: number): boolean =>
  cell.x >= 0 && cell.y >= 0 && cell.x < columns && cell.y < rows;

const projectCell = (cell: EditorCell, shape: EditorShape): EditorCell => {
  if (shape === 'diamond') {
    return {
      x: (cell.x - cell.y) * 0.70710678,
      y: (cell.x + cell.y) * 0.70710678,
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

const orientation = (a: EditorCell, b: EditorCell, c: EditorCell): number =>
  (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);

const segmentsCross = (a: EditorCell, b: EditorCell, c: EditorCell, d: EditorCell): boolean => {
  const sharesEndpoint = [a, b].some((first) => [c, d]
    .some((second) => first.x === second.x && first.y === second.y));
  if (sharesEndpoint) return false;
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
};

const segmentIntersectionPoint = (
  a: EditorCell,
  b: EditorCell,
  c: EditorCell,
  d: EditorCell,
): EditorCell | null => {
  if (!segmentsCross(a, b, c, d)) return null;
  const denominator = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(denominator) < 1e-8) return null;
  const determinantAB = a.x * b.y - a.y * b.x;
  const determinantCD = c.x * d.y - c.y * d.x;
  return {
    x: (determinantAB * (c.x - d.x) - (a.x - b.x) * determinantCD) / denominator,
    y: (determinantAB * (c.y - d.y) - (a.y - b.y) * determinantCD) / denominator,
  };
};

export const editorPathCrossingPoints = (
  path: ReadonlyArray<EditorCell>,
  shape: EditorShape = 'square',
): EditorCell[] => {
  const projected = path.map((cell) => projectCell(cell, shape));
  const points: EditorCell[] = [];
  for (let first = 0; first < projected.length - 1; first += 1) {
    for (let second = first + 2; second < projected.length - 1; second += 1) {
      const point = segmentIntersectionPoint(
        projected[first],
        projected[first + 1],
        projected[second],
        projected[second + 1],
      );
      if (point) points.push(point);
    }
  }
  return points;
};

export const countEditorPathCrossings = (
  path: ReadonlyArray<EditorCell>,
  shape: EditorShape = 'square',
): number => {
  const projected = path.map((cell) => projectCell(cell, shape));
  let count = 0;
  for (let first = 0; first < projected.length - 1; first += 1) {
    for (let second = first + 2; second < projected.length - 1; second += 1) {
      if (segmentsCross(projected[first], projected[first + 1], projected[second], projected[second + 1])) count += 1;
    }
  }
  return count;
};

const newCrossingPoints = (
  path: ReadonlyArray<EditorCell>,
  next: EditorCell,
  shape: EditorShape,
): EditorCell[] => {
  if (path.length < 2) return [];
  const start = projectCell(path[path.length - 1], shape);
  const end = projectCell(next, shape);
  const points: EditorCell[] = [];
  for (let index = 0; index < path.length - 2; index += 1) {
    const point = segmentIntersectionPoint(
      start,
      end,
      projectCell(path[index], shape),
      projectCell(path[index + 1], shape),
    );
    if (point) points.push(point);
  }
  return points;
};

const edgeDirection = (from: EditorCell, to: EditorCell): string =>
  `${Math.sign(to.x - from.x)},${Math.sign(to.y - from.y)}`;

const straightRunWith = (path: ReadonlyArray<EditorCell>, next: EditorCell): number => {
  if (path.length < 2) return 1;
  const direction = edgeDirection(path[path.length - 1], next);
  let length = 1;
  for (let index = path.length - 1; index > 0; index -= 1) {
    if (edgeDirection(path[index - 1], path[index]) !== direction) break;
    length += 1;
  }
  return length;
};

const straightRunPenalty = (path: ReadonlyArray<EditorCell>): number => {
  if (path.length < 3) return 0;
  let penalty = 0;
  let runLength = 1;
  let previousDirection = edgeDirection(path[0], path[1]);
  for (let index = 2; index < path.length; index += 1) {
    const direction = edgeDirection(path[index - 1], path[index]);
    if (direction === previousDirection) {
      runLength += 1;
    } else {
      const excess = Math.max(0, runLength - 2);
      penalty += excess * excess;
      runLength = 1;
      previousDirection = direction;
    }
  }
  const excess = Math.max(0, runLength - 2);
  return penalty + excess * excess;
};

const crossingClusterPenalty = (
  path: ReadonlyArray<EditorCell>,
  crossingPoints: ReadonlyArray<EditorCell>,
  shape: EditorShape,
): number => {
  if (crossingPoints.length < 2) return 0;
  const projected = path.map((cell) => projectCell(cell, shape));
  const xs = projected.map((cell) => cell.x);
  const ys = projected.map((cell) => cell.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const diagonal = Math.hypot(maxX - minX, maxY - minY);
  const desiredSpacing = diagonal / Math.max(2.4, Math.sqrt(crossingPoints.length) + 0.8);
  let proximityPenalty = 0;
  const occupiedZones = new Set<string>();

  crossingPoints.forEach((point, index) => {
    let nearest = Number.POSITIVE_INFINITY;
    crossingPoints.forEach((other, otherIndex) => {
      if (index === otherIndex) return;
      nearest = Math.min(nearest, Math.hypot(point.x - other.x, point.y - other.y));
    });
    proximityPenalty += Math.max(0, desiredSpacing - nearest) ** 2;
    const zoneX = Math.min(2, Math.floor(((point.x - minX) / Math.max(1e-6, maxX - minX)) * 3));
    const zoneY = Math.min(2, Math.floor(((point.y - minY) / Math.max(1e-6, maxY - minY)) * 3));
    occupiedZones.add(`${zoneX},${zoneY}`);
  });

  return proximityPenalty + Math.max(0, crossingPoints.length - occupiedZones.size) * 2.5;
};

export const scoreEditorPathVariety = (
  path: ReadonlyArray<EditorCell>,
  shape: EditorShape,
  targetCrossings: number,
  crossingMode: EditorCrossingMode = 'target',
): number => {
  const crossingPoints = editorPathCrossingPoints(path, shape);
  const safeCrossings = Math.max(0, Math.floor(targetCrossings));
  const crossingError = crossingMode === 'maximum'
    ? Math.max(0, crossingPoints.length - safeCrossings)
    : Math.abs(crossingPoints.length - safeCrossings);
  return crossingError * 100000
    + straightRunPenalty(path) * 160
    + crossingClusterPenalty(path, crossingPoints, shape) * 120;
};

const countPathTurns = (path: ReadonlyArray<EditorCell>): number => {
  let count = 0;
  for (let index = 2; index < path.length; index += 1) {
    if (edgeDirection(path[index - 2], path[index - 1])
      !== edgeDirection(path[index - 1], path[index])) count += 1;
  }
  return count;
};

export const randomizeEditorPath = (
  source: ReadonlyArray<EditorCell>,
  shape: EditorShape,
  maximumCrossings: number,
  seed: number,
  turnProbability = 65,
): EditorCell[] => {
  let path = source.map((cell) => ({ ...cell }));
  if (path.length < 4) return path;

  let randomState = seed >>> 0;
  const random = (): number => {
    randomState += 0x6d2b79f5;
    let value = randomState;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 0x100000000;
  };
  const safeMaximumCrossings = Math.max(0, Math.floor(maximumCrossings));
  const targetTurns = Math.round(
    Math.max(0, path.length - 2) * Math.max(0, Math.min(100, turnProbability)) / 100,
  );
  let turnDistance = Math.abs(countPathTurns(path) - targetTurns);
  const attempts = Math.max(160, path.length * 28);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let candidate: EditorCell[] | null = null;
    if (random() < 0.52) {
      const start = 1 + Math.floor(random() * (path.length - 2));
      const end = start + 1 + Math.floor(random() * (path.length - start - 1));
      if (!areEditorCellsNeighbors(path[start - 1], path[end], shape)) continue;
      if (end < path.length - 1 && !areEditorCellsNeighbors(path[start], path[end + 1], shape)) continue;
      candidate = [
        ...path.slice(0, start),
        ...path.slice(start, end + 1).reverse(),
        ...path.slice(end + 1),
      ];
    } else {
      const start = 1 + Math.floor(random() * (path.length - 2));
      const maximumLength = Math.min(8, path.length - start);
      const length = 1 + Math.floor(random() * maximumLength);
      const end = start + length - 1;
      if (end < path.length - 1
        && !areEditorCellsNeighbors(path[start - 1], path[end + 1], shape)) continue;

      const segment = path.slice(start, end + 1);
      const remainder = [...path.slice(0, start), ...path.slice(end + 1)];
      const insertAfter = Math.floor(random() * remainder.length);
      const left = remainder[insertAfter];
      const right = remainder[insertAfter + 1];
      const forwardFits = areEditorCellsNeighbors(left, segment[0], shape)
        && (!right || areEditorCellsNeighbors(segment[segment.length - 1], right, shape));
      const reversedFits = areEditorCellsNeighbors(left, segment[segment.length - 1], shape)
        && (!right || areEditorCellsNeighbors(segment[0], right, shape));
      if (!forwardFits && !reversedFits) continue;
      const insertedSegment = reversedFits && (!forwardFits || random() < 0.5)
        ? [...segment].reverse()
        : segment;
      candidate = [
        ...remainder.slice(0, insertAfter + 1),
        ...insertedSegment,
        ...remainder.slice(insertAfter + 1),
      ];
    }

    if (countEditorPathCrossings(candidate, shape) > safeMaximumCrossings) continue;

    const candidateTurnDistance = Math.abs(countPathTurns(candidate) - targetTurns);
    if (candidateTurnDistance > turnDistance && random() >= 0.22) continue;
    path = candidate;
    turnDistance = candidateTurnDistance;
  }

  return path;
};

const countNewCrossings = (
  path: ReadonlyArray<EditorCell>,
  next: EditorCell,
  shape: EditorShape,
): number => {
  if (path.length < 2) return 0;
  const start = projectCell(path[path.length - 1], shape);
  const end = projectCell(next, shape);
  let count = 0;
  for (let index = 0; index < path.length - 2; index += 1) {
    if (segmentsCross(start, end, projectCell(path[index], shape), projectCell(path[index + 1], shape))) count += 1;
  }
  return count;
};

const remainingConnected = (
  active: ReadonlySet<string>,
  visited: ReadonlySet<string>,
  current: EditorCell,
  shape: EditorShape,
): boolean => {
  const remaining = [...active].filter((key) => !visited.has(key) || key === cellKey(current));
  if (remaining.length <= 1) return true;
  const remainingSet = new Set(remaining);
  const currentKey = cellKey(current);
  let forcedEndCount = 0;
  for (const key of remaining) {
    const [x, y] = key.split(',').map(Number);
    const remainingDegree = neighbors({ x, y }, shape)
      .reduce((count, neighbor) => count + Number(remainingSet.has(cellKey(neighbor))), 0);
    if (remainingDegree === 0) return false;
    if (key !== currentKey && remainingDegree === 1) {
      forcedEndCount += 1;
      if (forcedEndCount > 1) return false;
    }
  }
  const frontier = [remaining[0]];
  const seen = new Set(frontier);
  while (frontier.length > 0) {
    const key = frontier.shift()!;
    const [x, y] = key.split(',').map(Number);
    for (const next of neighbors({ x, y }, shape)) {
      const nextKey = cellKey(next);
      if (remainingSet.has(nextKey) && !seen.has(nextKey)) {
        seen.add(nextKey);
        frontier.push(nextKey);
      }
    }
  }
  return seen.size === remaining.length;
};

export const findEditorPath = (
  rows: number,
  columns: number,
  active: ReadonlySet<string>,
  shape: EditorShape = 'square',
  targetCrossings = 0,
  generationIndex = 0,
  options: EditorPathGenerationOptions = {},
): EditorCell[] | null => {
  if (active.size === 0) return null;
  const cells = [...active].map((key) => {
    const [x, y] = key.split(',').map(Number);
    return { x, y };
  });
  if (cells.some((cell) => !inside(cell, rows, columns))) return null;
  if (cells.length === 1) return cells;

  const degree = (cell: EditorCell, visited?: ReadonlySet<string>): number => neighbors(cell, shape).reduce((count, neighbor) => {
    const key = cellKey(neighbor);
    return count + (active.has(key) && !visited?.has(key) ? 1 : 0);
  }, 0);

  if (cells.some((cell) => degree(cell) === 0)) return null;
  if (cells.filter((cell) => degree(cell) === 1).length > 2) return null;
  const style = options.style ?? 'classic';
  const crossingMode = options.crossingMode ?? 'target';
  const maximumCellDegree = Math.max(...cells.map((cell) => degree(cell)));
  const hasTwoForcedEndpoints = cells.filter((cell) => degree(cell) === 1).length === 2;
  cells.sort((left, right) => crossingMode === 'maximum'
    ? (hasTwoForcedEndpoints
        ? Number(degree(left) !== 1) - Number(degree(right) !== 1)
        : Number(degree(left) < maximumCellDegree) - Number(degree(right) < maximumCellDegree))
      || variationRank(left, generationIndex, 0) - variationRank(right, generationIndex, 0)
    : degree(left) - degree(right)
      || variationRank(left, generationIndex, 0) - variationRank(right, generationIndex, 0));

  const turnProbability = Math.max(0, Math.min(100, options.turnProbability ?? 65)) / 100;
  const maxNodes = Math.max(
    1000,
    Math.floor(options.maxNodes ?? (style === 'varied' ? 260000 : 180000)),
  );
  const safeTargetCrossings = Math.max(0, Math.floor(targetCrossings));
  let searched = 0;
  let bestPath: EditorCell[] | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestVarietyScore = Number.POSITIVE_INFINITY;
  for (const start of cells) {
    const path: EditorCell[] = [start];
    const visited = new Set<string>([cellKey(start)]);
    const search = (): boolean => {
      searched += 1;
      if (searched > maxNodes) return false;
      if (path.length === active.size) {
        const completedCrossings = countEditorPathCrossings(path, shape);
        const distance = crossingMode === 'maximum'
          ? Math.max(0, completedCrossings - safeTargetCrossings)
          : Math.abs(completedCrossings - safeTargetCrossings);
        const varietyScore = style === 'varied'
          ? scoreEditorPathVariety(path, shape, safeTargetCrossings, crossingMode)
          : 0;
        if (distance < bestDistance || (distance === bestDistance && varietyScore < bestVarietyScore)) {
          bestDistance = distance;
          bestVarietyScore = varietyScore;
          bestPath = path.map((cell) => ({ ...cell }));
        }
        return distance === 0;
      }
      const current = path[path.length - 1];
      const currentCrossingPoints = style === 'varied' ? editorPathCrossingPoints(path, shape) : [];
      const currentCrossingCount = style === 'varied'
        ? currentCrossingPoints.length
        : countEditorPathCrossings(path, shape);
      const crossingDeficit = crossingMode === 'maximum'
        ? 0
        : Math.max(0, safeTargetCrossings - currentCrossingCount);
      const previousDirection = path.length >= 2
        ? edgeDirection(path[path.length - 2], current)
        : undefined;
      const preferTurn = (variationRank(current, generationIndex, path.length + 911) / 0x100000000)
        < turnProbability;
      const useSafetyGuide = (variationRank(current, generationIndex, path.length + 1871) / 0x100000000)
        < 0.4;
      const candidates = neighbors(current, shape)
        .filter((cell) => active.has(cellKey(cell)) && !visited.has(cellKey(cell)))
        .map((cell) => {
          const crossingPoints = style === 'varied' ? newCrossingPoints(path, cell, shape) : [];
          return {
            cell,
            crossingPoints,
            newCrossings: style === 'varied'
              ? crossingPoints.length
              : countNewCrossings(path, cell, shape),
            isTurn: previousDirection === undefined || edgeDirection(current, cell) !== previousDirection,
            straightRun: straightRunWith(path, cell),
          };
        })
        .filter((candidate) => crossingMode !== 'maximum' && style !== 'varied'
          || currentCrossingCount + candidate.newCrossings <= safeTargetCrossings)
        .sort((left, right) => {
          if (crossingMode === 'maximum') {
            if (style === 'varied') {
              if (useSafetyGuide) {
                const safetyDifference = degree(left.cell, visited) - degree(right.cell, visited);
                if (safetyDifference !== 0) return safetyDifference;
              }
              const turnPreferenceDifference = Number(left.isTurn !== preferTurn)
                - Number(right.isTurn !== preferTurn);
              if (turnPreferenceDifference !== 0) return turnPreferenceDifference;
            } else {
              const safetyDifference = degree(left.cell, visited) - degree(right.cell, visited);
              if (safetyDifference !== 0) return safetyDifference;
            }
            return variationRank(left.cell, generationIndex, path.length)
              - variationRank(right.cell, generationIndex, path.length);
          }
          if (style === 'varied') {
            const progressTarget = safeTargetCrossings * (path.length / Math.max(1, active.size - 1));
            const score = (candidate: typeof left): number => {
              const totalCrossings = currentCrossingCount + candidate.newCrossings;
              const timingPenalty = Math.abs(totalCrossings - progressTarget) * 34
                + Math.max(0, totalCrossings - safeTargetCrossings) * 180;
              let clusterPenalty = 0;
              candidate.crossingPoints.forEach((point, index) => {
                const comparison = [
                  ...currentCrossingPoints,
                  ...candidate.crossingPoints.slice(0, index),
                ];
                if (comparison.length === 0) return;
                const nearest = Math.min(...comparison.map((other) =>
                  Math.hypot(point.x - other.x, point.y - other.y)));
                clusterPenalty += Math.max(0, 2.2 - nearest) * 70;
              });
              const turnPreferencePenalty = candidate.isTurn === preferTurn ? 0 : 12;
              const longStraightPenalty = Math.max(0, candidate.straightRun - 2) * 32;
              return degree(candidate.cell, visited) * 2
                + timingPenalty
                + clusterPenalty
                + turnPreferencePenalty
                + longStraightPenalty;
            };
            const scoreDifference = score(left) - score(right);
            if (scoreDifference !== 0) return scoreDifference;
          }
          const leftCrossingScore = crossingDeficit > 0 ? -left.newCrossings * 100 : left.newCrossings * 100;
          const rightCrossingScore = crossingDeficit > 0 ? -right.newCrossings * 100 : right.newCrossings * 100;
          const priorityDifference = degree(left.cell, visited) + leftCrossingScore
            - degree(right.cell, visited) - rightCrossingScore;
          return priorityDifference
            || variationRank(left.cell, generationIndex, path.length)
              - variationRank(right.cell, generationIndex, path.length);
        });

      for (const candidate of candidates) {
        const next = candidate.cell;
        const key = cellKey(next);
        visited.add(key);
        path.push(next);
        const shouldCheckConnectivity = style === 'varied'
          || path.length % 4 === 0
          || path.length > active.size - 5;
        if ((!shouldCheckConnectivity || remainingConnected(active, visited, next, shape)) && search()) return true;
        path.pop();
        visited.delete(key);
      }
      return false;
    };
    if (search()) return bestPath;
  }
  return bestPath;
};
