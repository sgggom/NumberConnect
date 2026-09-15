import { createRandom } from '../../game/random';
import type { EditorCell, EditorShape } from './types';

export type FormationSymmetry = 'random' | 'central' | 'vertical' | 'horizontal' | 'diagonal' | 'rotate-2' | 'rotate-4';
export interface HollowFormationRequest {
  rows: number;
  columns: number;
  shape: EditorShape;
  symmetry: FormationSymmetry;
  seed: number;
  hollowPercentMin?: number;
  hollowPercentMax?: number;
}

export const validateHollowFormationRequest = (request: HollowFormationRequest): void => {
  const { rows, columns, shape, symmetry } = request;
  if (![rows, columns].every((size) => Number.isInteger(size) && size >= 3 && size <= 20)) {
    throw new Error('镂空造型需要至少 3×3、最多 20×20 的棋盘。');
  }
  if (shape === 'hex') throw new Error('对称镂空造型暂不支持六边形蜂窝，请选择正方形、长方形或菱形。');
  if (!['random', 'central', 'vertical', 'horizontal', 'diagonal', 'rotate-2', 'rotate-4'].includes(symmetry)) throw new Error('请选择有效的对称样式。');
  const minimum = request.hollowPercentMin ?? 20;
  const maximum = request.hollowPercentMax ?? 40;
  if (![minimum, maximum].every((value) => Number.isFinite(value) && value >= 0 && value <= 90)) throw new Error('镂空比例上下限请输入 0–90 之间的数值。');
  if (minimum > maximum) throw new Error('镂空比例下限不能大于上限。');
  if ((symmetry === 'diagonal' || symmetry === 'rotate-4' || shape === 'diamond') && rows !== columns) {
    throw new Error('对角线对称和四边旋转对称需要等宽高棋盘。');
  }
};

const orbit = (cell: EditorCell, request: HollowFormationRequest): EditorCell[] => {
  const { rows, columns, shape, symmetry } = request;
  const { x, y } = cell;
  if (symmetry === 'central' || symmetry === 'rotate-2') return [cell, { x: columns - 1 - x, y: rows - 1 - y }];
  if (symmetry === 'horizontal') return [cell, shape === 'diamond'
    ? { x: y, y: x }
    : { x: columns - 1 - x, y }];
  if (symmetry === 'vertical') return [cell, shape === 'diamond'
    ? { x: columns - 1 - y, y: rows - 1 - x }
    : { x, y: rows - 1 - y }];
  if (symmetry === 'diagonal') return [cell, shape === 'diamond'
    ? { x, y: rows - 1 - y }
    : { x: y, y: x }];
  return [cell, { x: columns - 1 - y, y: x }, { x: columns - 1 - x, y: rows - 1 - y }, { x: y, y: rows - 1 - x }];
};

const connected = (active: Uint8Array, rows: number, columns: number): boolean => {
  const start = active.findIndex((value) => value === 1);
  if (start < 0) return false;
  const seen = new Set([start]);
  const queue = [start];
  for (let i = 0; i < queue.length; i += 1) {
    const index = queue[i];
    const x = index % columns;
    const y = Math.floor(index / columns);
    // Require edge-connected cells, even though gameplay also allows diagonals.
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      const next = ny * columns + nx;
      if (nx >= 0 && nx < columns && ny >= 0 && ny < rows && active[next] && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen.size === active.reduce((total, value) => total + value, 0);
};

const findWitness = (
  active: Uint8Array, rows: number, columns: number, random: () => number, deadline: number,
): EditorCell[] | undefined => {
  const cells = Array.from(active.keys()).filter((index) => active[index]);
  const adjacent = Array.from(active, (_, index) => {
    if (!active[index]) return [];
    const x = index % columns;
    const y = Math.floor(index / columns);
    const result: number[] = [];
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < columns && ny >= 0 && ny < rows && active[ny * columns + nx]) result.push(ny * columns + nx);
    }
    return result;
  });
  const visited = new Uint8Array(active.length);
  const degrees = adjacent.map((neighbors) => neighbors.length);
  const rank = Array.from(active, () => random());
  const diagonalEdges = new Int8Array(active.length);
  let nodes = 0;
  const path: number[] = [];
  const search = (current: number): boolean => {
    if (++nodes > 18000 || (nodes % 128 === 0 && Date.now() >= deadline)) return false;
    visited[current] = 1;
    path.push(current);
    for (const next of adjacent[current]) degrees[next] -= 1;
    if (path.length === cells.length) return true;
    const candidates = adjacent[current].filter((next) => !visited[next])
      .sort((a, b) => degrees[a] - degrees[b] || rank[a] - rank[b]);
    const remaining = cells.filter((index) => !visited[index]);
    // Remaining cells must still form one traversable component.
    let viable = !remaining.some((index) => degrees[index] === 0) || remaining.length === 1;
    if (viable && nodes % 8 === 0) {
      const reached = new Set([current]);
      const queue = [current];
      for (let i = 0; i < queue.length; i += 1) for (const next of adjacent[queue[i]]) {
        if (!visited[next] && !reached.has(next)) { reached.add(next); queue.push(next); }
      }
      viable = reached.size === remaining.length + 1;
    }
    if (viable) for (const next of candidates) {
      const x = current % columns;
      const y = Math.floor(current / columns);
      const nx = next % columns;
      const ny = Math.floor(next / columns);
      const diagonal = x !== nx && y !== ny;
      const square = Math.min(y, ny) * columns + Math.min(x, nx);
      const direction = (nx - x) * (ny - y) > 0 ? 1 : -1;
      if (diagonal && diagonalEdges[square] === -direction) continue;
      if (diagonal) diagonalEdges[square] = direction;
      if (search(next)) return true;
      if (diagonal) diagonalEdges[square] = 0;
      if (nodes > 18000 || Date.now() >= deadline) break;
    }
    for (const next of adjacent[current]) degrees[next] += 1;
    visited[current] = 0;
    path.pop();
    return false;
  };
  cells.sort((a, b) => degrees[a] - degrees[b] || rank[a] - rank[b]);
  for (const start of cells.slice(0, 8)) {
    if (search(start)) return path.map((index) => ({ x: index % columns, y: Math.floor(index / columns) }));
    if (nodes > 18000 || Date.now() >= deadline) break;
  }
  return undefined;
};

export const generateHollowFormation = (
  request: HollowFormationRequest,
  onProgress: (progress: number) => void = () => undefined,
): EditorCell[] => {
  validateHollowFormationRequest(request);
  const { rows, columns } = request;
  const random = createRandom(request.seed);
  if (request.symmetry === 'random') {
    const types: FormationSymmetry[] = rows === columns
      ? ['central', 'vertical', 'horizontal', 'diagonal', 'rotate-2', 'rotate-4']
      : ['central', 'vertical', 'horizontal', 'rotate-2'];
    return generateHollowFormation({ ...request, symmetry: types[Math.floor(random() * types.length)] }, onProgress);
  }
  const total = rows * columns;
  const groups: number[][] = [];
  const grouped = new Set<number>();
  for (let index = 0; index < total; index += 1) {
    if (grouped.has(index)) continue;
    const members = [...new Set(orbit({ x: index % columns, y: Math.floor(index / columns) }, request)
      .map(({ x, y }) => y * columns + x))];
    members.forEach((member) => grouped.add(member));
    groups.push(members);
  }
  // Choose the nearest count representable by whole symmetry groups, retaining at least two cells.
  const reachable = new Uint8Array(total + 1);
  reachable[0] = 1;
  for (const group of groups) for (let count = total - 2; count >= group.length; count -= 1) {
    if (reachable[count - group.length]) reachable[count] = 1;
  }
  const minimumPercent = request.hollowPercentMin ?? 20;
  const maximumPercent = request.hollowPercentMax ?? 40;
  const minimumCount = Math.ceil(total * minimumPercent / 100 - 1e-9);
  const maximumCount = Math.min(total - 2, Math.floor(total * maximumPercent / 100 + 1e-9));
  const requestedCount = total * (minimumPercent + random() * (maximumPercent - minimumPercent)) / 100;
  const fullSnake = (): EditorCell[] => {
    const path: EditorCell[] = [];
    for (let y = 0; y < rows; y += 1) for (let i = 0; i < columns; i += 1) path.push({ x: y % 2 === 0 ? i : columns - 1 - i, y });
    return path;
  };
  const targets = Array.from(reachable.keys()).filter((count) => count >= minimumCount && count <= maximumCount && reachable[count])
    .sort((a, b) => Math.abs(a - requestedCount) - Math.abs(b - requestedCount) || a - b);
  if (targets.length === 0) throw new Error('当前尺寸与对称类型在比例范围内没有可用格数，请扩大镂空比例范围。');
  const target = targets[0];
  if (target === 0) {
    onProgress(1);
    return fullSnake();
  }
  const deadline = Date.now() + 3500;
  for (let attempt = 0; attempt < 40 && Date.now() < deadline; attempt += 1) {
    const attemptTarget = targets[Math.min(targets.length - 1, Math.floor(attempt / 10))];
    if (attemptTarget === 0) { onProgress(1); return fullSnake(); }
    const active = new Uint8Array(rows * columns).fill(1);
    const shuffled = [...groups];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    // Cluster most holes around a random interior or edge location to avoid many thin dead ends.
    if (attempt % 3 !== 0) {
      const centerX = random() * (columns - 1);
      const centerY = random() * (rows - 1);
      const scores = new Map(shuffled.map((group) => [group, Math.min(...group.map((index) => (
        (index % columns - centerX) ** 2 + (Math.floor(index / columns) - centerY) ** 2
      ))) + random() * 2]));
      shuffled.sort((a, b) => scores.get(a)! - scores.get(b)!);
    }
    let removed = 0;
    for (const group of shuffled) {
      if (removed + group.length > attemptTarget) continue;
      group.forEach((index) => { active[index] = 0; });
      if (connected(active, rows, columns)) removed += group.length;
      else group.forEach((index) => { active[index] = 1; });
      if (removed === attemptTarget) break;
    }
    onProgress(attempt / 40);
    if (removed !== attemptTarget) continue;
    const path = findWitness(active, rows, columns, random, Math.min(deadline, Date.now() + 220));
    if (path) { onProgress(1); return path; }
  }
  throw new Error('当前比例与对称样式未找到可一笔连的造型，请重试或降低镂空比例。原棋盘已保留。');
};
