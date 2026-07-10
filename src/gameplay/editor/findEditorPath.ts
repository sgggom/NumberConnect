import type { EditorCell, EditorShape } from './types';

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
  const frontier = [remaining[0]];
  const seen = new Set(frontier);
  while (frontier.length > 0) {
    const key = frontier.shift()!;
    const [x, y] = key.split(',').map(Number);
    for (const next of neighbors({ x, y }, shape)) {
      const nextKey = cellKey(next);
      if (active.has(nextKey) && (!visited.has(nextKey) || nextKey === cellKey(current)) && !seen.has(nextKey)) {
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
  cells.sort((left, right) => degree(left) - degree(right)
    || variationRank(left, generationIndex, 0) - variationRank(right, generationIndex, 0));

  const maxNodes = 180000;
  const safeTargetCrossings = Math.max(0, Math.floor(targetCrossings));
  let searched = 0;
  let bestPath: EditorCell[] | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const start of cells) {
    const path: EditorCell[] = [start];
    const visited = new Set<string>([cellKey(start)]);
    const search = (): boolean => {
      searched += 1;
      if (searched > maxNodes) return false;
      if (path.length === active.size) {
        const distance = Math.abs(countEditorPathCrossings(path, shape) - safeTargetCrossings);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestPath = path.map((cell) => ({ ...cell }));
        }
        return distance === 0;
      }
      const current = path[path.length - 1];
      const crossingDeficit = Math.max(0, safeTargetCrossings - countEditorPathCrossings(path, shape));
      const candidates = neighbors(current, shape)
        .filter((cell) => active.has(cellKey(cell)) && !visited.has(cellKey(cell)))
        .map((cell) => ({
          cell,
          newCrossings: countNewCrossings(path, cell, shape),
        }))
        .sort((left, right) => {
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
        const shouldCheckConnectivity = path.length % 4 === 0 || path.length > active.size - 5;
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
