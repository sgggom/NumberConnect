import { createRandom } from './random';
import { BoardShape, cellKey, type Cell, type LevelData } from './types';

const DIRECTIONS: ReadonlyArray<Readonly<Cell>> = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: -1, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 },
];

const inside = (cell: Cell, rows: number, columns: number): boolean =>
  cell.x >= 0 && cell.y >= 0 && cell.x < columns && cell.y < rows;

export const areNeighbors = (a: Cell, b: Cell): boolean => {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return dx <= 1 && dy <= 1 && dx + dy > 0;
};

export const isValidPath = (rows: number, columns: number, path: Cell[], active?: Set<string>): boolean => {
  const expected = active?.size ?? rows * columns;
  if (path.length !== expected) return false;
  const seen = new Set<string>();

  return path.every((cell, index) => {
    const key = cellKey(cell);
    if (!inside(cell, rows, columns) || seen.has(key) || (active && !active.has(key))) return false;
    seen.add(key);
    return index === 0 || areNeighbors(path[index - 1], cell);
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

export const countCrossings = (path: Cell[]): number => {
  let count = 0;
  for (let first = 0; first < path.length - 1; first += 1) {
    for (let second = first + 2; second < path.length - 1; second += 1) {
      if (segmentsCross(path[first], path[first + 1], path[second], path[second + 1])) count += 1;
    }
  }
  return count;
};

const fallbackPath = (rows: number, columns: number, seed: number): Cell[] => {
  const path: Cell[] = [];
  for (let row = 0; row < rows; row += 1) {
    if (row % 2 === 0) {
      for (let column = 0; column < columns; column += 1) path.push({ x: column, y: row });
    } else {
      for (let column = columns - 1; column >= 0; column -= 1) path.push({ x: column, y: row });
    }
  }
  if (seed % 2 === 0) path.reverse();
  if (seed % 3 === 0) path.forEach((cell) => { cell.x = columns - 1 - cell.x; });
  return path;
};

const countOpenNeighbors = (cell: Cell, visited: boolean[][], rows: number, columns: number): number =>
  DIRECTIONS.reduce((count, direction) => {
    const next = { x: cell.x + direction.x, y: cell.y + direction.y };
    return count + (inside(next, rows, columns) && !visited[next.y][next.x] ? 1 : 0);
  }, 0);

const countNewCrossings = (path: Cell[], next: Cell): number => {
  if (path.length < 2) return 0;
  let count = 0;
  const start = path[path.length - 1];
  for (let index = 0; index < path.length - 2; index += 1) {
    if (segmentsCross(start, next, path[index], path[index + 1])) count += 1;
  }
  return count;
};

const hasTrappedCell = (visited: boolean[][], current: Cell, rows: number, columns: number): boolean => {
  let remaining = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (!visited[row][column]) remaining += 1;
    }
  }
  if (remaining <= 1) return false;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (visited[row][column]) continue;
      const cell = { x: column, y: row };
      if (countOpenNeighbors(cell, visited, rows, columns) === 0 && !areNeighbors(current, cell)) return true;
    }
  }
  return false;
};

const tryRandomPath = (rows: number, columns: number, seed: number, targetCrossings: number): Cell[] | null => {
  const random = createRandom(seed);
  const visited = Array.from({ length: rows }, () => Array.from({ length: columns }, () => false));
  const start = { x: Math.floor(random() * columns), y: Math.floor(random() * rows) };
  const path: Cell[] = [start];
  visited[start.y][start.x] = true;
  const maxNodes = rows * columns <= 36 ? 60000 : 30000;
  let searchedNodes = 0;

  const search = (previousDirection: Cell): boolean => {
    searchedNodes += 1;
    if (searchedNodes > maxNodes) return false;
    if (path.length === rows * columns) return true;

    const current = path[path.length - 1];
    const existingCrossings = countCrossings(path);
    const deficit = Math.max(0, targetCrossings - existingCrossings);
    const candidates = DIRECTIONS.map((direction) => ({
      direction,
      cell: { x: current.x + direction.x, y: current.y + direction.y },
    }))
      .filter(({ cell }) => inside(cell, rows, columns) && !visited[cell.y][cell.x])
      .map(({ direction, cell }) => {
        const degree = countOpenNeighbors(cell, visited, rows, columns);
        const straightPenalty = previousDirection.x === direction.x && previousDirection.y === direction.y ? 65 : 0;
        const newCrossings = countNewCrossings(path, cell);
        const crossingScore = deficit > 0
          ? (newCrossings === 0 ? deficit * 24 : -newCrossings * 340)
          : newCrossings * 100;
        return { direction, cell, score: degree * 100 + straightPenalty + crossingScore + random() * 40 };
      })
      .sort((left, right) => left.score - right.score);

    for (const candidate of candidates) {
      visited[candidate.cell.y][candidate.cell.x] = true;
      path.push(candidate.cell);
      if (!hasTrappedCell(visited, candidate.cell, rows, columns) && search(candidate.direction)) return true;
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
  const attempts = rows * columns <= 49 ? 12 : 5;
  let best: Cell[] | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const path = tryRandomPath(rows, columns, seed + attempt * 7919, Math.max(0, targetCrossings));
    if (!path) continue;
    const distance = Math.abs(countCrossings(path) - targetCrossings);
    if (distance < bestDistance) {
      best = path;
      bestDistance = distance;
    }
    if (countCrossings(path) >= targetCrossings) break;
  }

  const solutionPath = best ?? fallbackPath(rows, columns, seed);
  const activeCells = Array.from({ length: rows * columns }, (_, index) => ({
    x: index % columns,
    y: Math.floor(index / columns),
  }));

  return {
    levelId: seed,
    boardShape: shape,
    rows,
    columns,
    activeCells,
    solutionPath,
  };
};

const remainingConnected = (active: Set<string>, visited: Set<string>, current: Cell): boolean => {
  const remaining = [...active].filter((key) => !visited.has(key) || key === cellKey(current));
  if (remaining.length <= 1) return true;
  const frontier = [remaining[0]];
  const seen = new Set(frontier);
  while (frontier.length > 0) {
    const key = frontier.shift()!;
    const [x, y] = key.split(',').map(Number);
    for (const direction of DIRECTIONS) {
      const nextKey = `${x + direction.x},${y + direction.y}`;
      if (active.has(nextKey) && (!visited.has(nextKey) || nextKey === cellKey(current)) && !seen.has(nextKey)) {
        seen.add(nextKey);
        frontier.push(nextKey);
      }
    }
  }
  return seen.size === remaining.length;
};

export const findHamiltonianPath = (rows: number, columns: number, active: Set<string>): Cell[] | null => {
  if (active.size === 0) return null;
  const cells = [...active].map((key) => {
    const [x, y] = key.split(',').map(Number);
    return { x, y };
  });
  if (cells.some((cell) => !inside(cell, rows, columns))) return null;
  if (cells.length === 1) return cells;

  const degree = (cell: Cell, visited?: Set<string>): number => DIRECTIONS.reduce((count, direction) => {
    const key = `${cell.x + direction.x},${cell.y + direction.y}`;
    return count + (active.has(key) && !visited?.has(key) ? 1 : 0);
  }, 0);

  if (cells.some((cell) => degree(cell) === 0)) return null;
  const degreeOneCount = cells.filter((cell) => degree(cell) === 1).length;
  if (degreeOneCount > 2) return null;
  cells.sort((left, right) => degree(left) - degree(right));

  const maxNodes = 180000;
  let searched = 0;
  for (const start of cells) {
    const path: Cell[] = [start];
    const visited = new Set<string>([cellKey(start)]);
    const search = (): boolean => {
      searched += 1;
      if (searched > maxNodes) return false;
      if (path.length === active.size) return true;
      const current = path[path.length - 1];
      const candidates = DIRECTIONS.map((direction) => ({ x: current.x + direction.x, y: current.y + direction.y }))
        .filter((cell) => active.has(cellKey(cell)) && !visited.has(cellKey(cell)))
        .sort((left, right) => degree(left, visited) - degree(right, visited));

      for (const next of candidates) {
        const key = cellKey(next);
        visited.add(key);
        path.push(next);
        const shouldCheckConnectivity = path.length % 4 === 0 || path.length > active.size - 5;
        if ((!shouldCheckConnectivity || remainingConnected(active, visited, next)) && search()) return true;
        path.pop();
        visited.delete(key);
      }
      return false;
    };
    if (search()) return path;
  }
  return null;
};
