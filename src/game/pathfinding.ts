import { createRandom } from './random';
import { areNeighborCells, neighborCells, projectCell } from './topology';
import { BoardShape, cellKey, type Cell, type LevelData } from './types';

const inside = (cell: Cell, rows: number, columns: number): boolean =>
  cell.x >= 0 && cell.y >= 0 && cell.x < columns && cell.y < rows;

export const areNeighbors = (a: Cell, b: Cell, shape: BoardShape = BoardShape.Square): boolean =>
  areNeighborCells(a, b, shape);

export const isValidPath = (
  rows: number,
  columns: number,
  path: Cell[],
  active?: Set<string>,
  shape: BoardShape = BoardShape.Square,
): boolean => {
  const expected = active?.size ?? rows * columns;
  if (path.length !== expected) return false;
  const seen = new Set<string>();

  return path.every((cell, index) => {
    const key = cellKey(cell);
    if (!inside(cell, rows, columns) || seen.has(key) || (active && !active.has(key))) return false;
    seen.add(key);
    return index === 0 || areNeighbors(path[index - 1], cell, shape);
  });
};

const orientation = (a: Cell, b: Cell, c: Cell): number =>
  (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);

const segmentsCross = (a: Cell, b: Cell, c: Cell, d: Cell): boolean => {
  const sharesEndpoint = [a, b].some((first) => [c, d].some((second) => first.x === second.x && first.y === second.y));
  if (sharesEndpoint) return false;
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
};

export const countCrossings = (path: Cell[], shape: BoardShape = BoardShape.Square): number => {
  const projectedPath = path.map((cell) => projectCell(cell, shape));
  let count = 0;
  for (let first = 0; first < projectedPath.length - 1; first += 1) {
    for (let second = first + 2; second < projectedPath.length - 1; second += 1) {
      if (segmentsCross(projectedPath[first], projectedPath[first + 1], projectedPath[second], projectedPath[second + 1])) count += 1;
    }
  }
  return count;
};

const remainingActiveConnected = (
  active: ReadonlySet<string>,
  visited: ReadonlySet<string>,
  current: Cell,
  shape: BoardShape,
): boolean => {
  const remaining = [...active].filter((key) => !visited.has(key) || key === cellKey(current));
  if (remaining.length <= 1) return true;
  const frontier = [remaining[0]];
  const seen = new Set(frontier);
  while (frontier.length > 0) {
    const key = frontier.shift()!;
    const [x, y] = key.split(',').map(Number);
    neighborCells({ x, y }, shape).forEach((neighbor) => {
      const nextKey = cellKey(neighbor);
      if (active.has(nextKey) && (!visited.has(nextKey) || nextKey === cellKey(current)) && !seen.has(nextKey)) {
        seen.add(nextKey);
        frontier.push(nextKey);
      }
    });
  }
  return seen.size === remaining.length;
};

const findActivePath = (activeCells: Cell[], shape: BoardShape): Cell[] | null => {
  const active = new Set(activeCells.map(cellKey));
  const degree = (cell: Cell, visited?: ReadonlySet<string>): number => neighborCells(cell, shape)
    .filter((neighbor) => active.has(cellKey(neighbor)) && !visited?.has(cellKey(neighbor))).length;
  const starts = [...activeCells].sort((left, right) => degree(left) - degree(right));
  let searched = 0;

  for (const start of starts) {
    const path = [start];
    const visited = new Set<string>([cellKey(start)]);
    const search = (): boolean => {
      searched += 1;
      if (searched > 2000000) return false;
      if (path.length === active.size) return true;
      const current = path[path.length - 1];
      const candidates = neighborCells(current, shape)
        .filter((cell) => active.has(cellKey(cell)) && !visited.has(cellKey(cell)))
        .sort((left, right) => degree(left, visited) - degree(right, visited));
      for (const next of candidates) {
        const key = cellKey(next);
        visited.add(key);
        path.push(next);
        const checkConnectivity = path.length % 4 === 0 || path.length > active.size - 5;
        if ((!checkConnectivity || remainingActiveConnected(active, visited, next, shape)) && search()) return true;
        path.pop();
        visited.delete(key);
      }
      return false;
    };
    if (search()) return path;
  }
  return null;
};

const fallbackPath = (rows: number, columns: number, seed: number, shape: BoardShape, activeCells: Cell[]): Cell[] => {
  const path: Cell[] = [];
  for (let row = 0; row < rows; row += 1) {
    const rowColumns = columns;
    const leftToRight = row % 2 === 0;
    if (leftToRight) {
      for (let column = 0; column < rowColumns; column += 1) path.push({ x: column, y: row });
    } else {
      for (let column = rowColumns - 1; column >= 0; column -= 1) path.push({ x: column, y: row });
    }
  }
  if (seed % 2 === 0) path.reverse();
  if (seed % 3 === 0) path.forEach((cell) => { cell.x = columns - 1 - cell.x; });
  return path;
};

const countOpenNeighbors = (
  cell: Cell,
  visited: boolean[][],
  rows: number,
  columns: number,
  shape: BoardShape,
  active: ReadonlySet<string>,
): number =>
  neighborCells(cell, shape).reduce((count, next) => {
    return count + (inside(next, rows, columns) && active.has(cellKey(next)) && !visited[next.y][next.x] ? 1 : 0);
  }, 0);

const countNewCrossings = (path: Cell[], next: Cell, shape: BoardShape): number => {
  if (path.length < 2) return 0;
  let count = 0;
  const start = projectCell(path[path.length - 1], shape);
  const projectedNext = projectCell(next, shape);
  for (let index = 0; index < path.length - 2; index += 1) {
    if (segmentsCross(start, projectedNext, projectCell(path[index], shape), projectCell(path[index + 1], shape))) count += 1;
  }
  return count;
};

const hasTrappedCell = (
  visited: boolean[][],
  current: Cell,
  rows: number,
  columns: number,
  shape: BoardShape,
  active: ReadonlySet<string>,
): boolean => {
  let remaining = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (active.has(`${column},${row}`) && !visited[row][column]) remaining += 1;
    }
  }
  if (remaining <= 1) return false;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (!active.has(`${column},${row}`) || visited[row][column]) continue;
      const cell = { x: column, y: row };
      if (countOpenNeighbors(cell, visited, rows, columns, shape, active) === 0 && !areNeighbors(current, cell, shape)) return true;
    }
  }
  return false;
};

const tryRandomPath = (
  rows: number,
  columns: number,
  seed: number,
  targetCrossings: number,
  shape: BoardShape,
  activeCells: Cell[],
): Cell[] | null => {
  const random = createRandom(seed);
  const active = new Set(activeCells.map(cellKey));
  const visited = Array.from({ length: rows }, () => Array.from({ length: columns }, () => false));
  const start = activeCells[Math.floor(random() * activeCells.length)];
  const path: Cell[] = [start];
  visited[start.y][start.x] = true;
  const maxNodes = rows * columns <= 36 ? 60000 : 30000;
  let searchedNodes = 0;

  const search = (previousDirection: Cell): boolean => {
    searchedNodes += 1;
    if (searchedNodes > maxNodes) return false;
    if (path.length === active.size) return true;

    const current = path[path.length - 1];
    const existingCrossings = countCrossings(path, shape);
    const deficit = Math.max(0, targetCrossings - existingCrossings);
    const candidates = neighborCells(current, shape).map((cell) => ({
      direction: { x: cell.x - current.x, y: cell.y - current.y },
      cell,
    }))
      .filter(({ cell }) => inside(cell, rows, columns) && active.has(cellKey(cell)) && !visited[cell.y][cell.x])
      .map(({ direction, cell }) => {
        const degree = countOpenNeighbors(cell, visited, rows, columns, shape, active);
        const straightPenalty = previousDirection.x === direction.x && previousDirection.y === direction.y ? 65 : 0;
        const newCrossings = countNewCrossings(path, cell, shape);
        const crossingScore = deficit > 0
          ? (newCrossings === 0 ? deficit * 24 : -newCrossings * 340)
          : newCrossings * 100;
        return { direction, cell, score: degree * 100 + straightPenalty + crossingScore + random() * 40 };
      })
      .sort((left, right) => left.score - right.score);

    for (const candidate of candidates) {
      visited[candidate.cell.y][candidate.cell.x] = true;
      path.push(candidate.cell);
      if (!hasTrappedCell(visited, candidate.cell, rows, columns, shape, active) && search(candidate.direction)) return true;
      path.pop();
      visited[candidate.cell.y][candidate.cell.x] = false;
    }
    return false;
  };

  return search({ x: 0, y: 0 }) ? path : null;
};

export const generateProceduralLevel = (
  rowsValue: number,
  columnsValue: number,
  seed: number,
  targetCrossings: number,
  shape: BoardShape = BoardShape.Square,
): LevelData => {
  const rows = Math.max(1, Math.floor(rowsValue));
  const columns = Math.max(1, Math.floor(columnsValue));
  const activeCells = Array.from({ length: rows * columns }, (_, index) => ({
    x: index % columns,
    y: Math.floor(index / columns),
  }));
  const attempts = activeCells.length <= 49 ? 12 : 5;
  let best: Cell[] | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const path = tryRandomPath(rows, columns, seed + attempt * 7919, Math.max(0, targetCrossings), shape, activeCells);
    if (!path) continue;
    const distance = Math.abs(countCrossings(path, shape) - targetCrossings);
    if (distance < bestDistance) {
      best = path;
      bestDistance = distance;
    }
    if (countCrossings(path, shape) >= targetCrossings) break;
  }

  const solutionPath = best ?? fallbackPath(rows, columns, seed, shape, activeCells);

  return {
    levelId: seed,
    boardShape: shape,
    rows,
    columns,
    activeCells,
    solutionPath,
  };
};
