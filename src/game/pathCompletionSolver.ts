import { areNeighborCells } from './topology';
import type { BoardShape, Cell } from './types';

export interface DirectedCompletionStep {
  from: number;
  to: number;
  direction?: -1 | 1;
}

export interface PathCompletionRequest {
  fixedPositions: ReadonlyMap<number, number>;
  requiredEdges: ReadonlyArray<readonly [number, number]>;
  directedStep?: DirectedCompletionStep;
}

const pairKey = (left: number, right: number): string => (
  left < right ? `${left}:${right}` : `${right}:${left}`
);

export class PathCompletionSolver {
  private readonly neighbors: ReadonlyArray<ReadonlyArray<number>>;
  private readonly completionCache = new Map<string, readonly number[] | null>();
  private lastCompletion?: readonly number[];

  public constructor(
    private readonly cells: ReadonlyArray<Cell>,
    shape: BoardShape,
  ) {
    this.neighbors = cells.map((cell, index) => cells
      .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
      .filter(({ candidate, candidateIndex }) => (
        candidateIndex !== index && areNeighborCells(cell, candidate, shape)
      ))
      .map(({ candidateIndex }) => candidateIndex));
  }

  public findCompletion(request: PathCompletionRequest): number[] | null {
    const cacheKey = this.cacheKey(request);
    if (this.completionCache.has(cacheKey)) {
      const cached = this.completionCache.get(cacheKey);
      return cached ? [...cached] : null;
    }

    if (this.lastCompletion && this.completionSatisfies(this.lastCompletion, request)) {
      const reused = [...this.lastCompletion];
      this.completionCache.set(cacheKey, reused);
      return reused;
    }

    const completion = this.searchCompletion(request);
    if (this.completionCache.size >= 2048) {
      const oldestKey = this.completionCache.keys().next().value as string | undefined;
      if (oldestKey !== undefined) this.completionCache.delete(oldestKey);
    }
    this.completionCache.set(cacheKey, completion ? [...completion] : null);
    if (completion) this.lastCompletion = [...completion];
    return completion ? [...completion] : null;
  }

  private completionSatisfies(
    completion: ReadonlyArray<number>,
    { fixedPositions, requiredEdges, directedStep }: PathCompletionRequest,
  ): boolean {
    if (
      completion.length !== this.cells.length
      || new Set(completion).size !== this.cells.length
    ) return false;
    const positions = new Map(completion.map((node, position) => [node, position]));
    for (const [node, position] of fixedPositions) {
      if (completion[position] !== node) return false;
    }
    for (const [left, right] of requiredEdges) {
      const leftPosition = positions.get(left);
      const rightPosition = positions.get(right);
      if (
        leftPosition === undefined
        || rightPosition === undefined
        || Math.abs(leftPosition - rightPosition) !== 1
      ) return false;
    }
    if (directedStep) {
      const fromPosition = positions.get(directedStep.from);
      const toPosition = positions.get(directedStep.to);
      if (fromPosition === undefined || toPosition === undefined) return false;
      const delta = toPosition - fromPosition;
      if (
        Math.abs(delta) !== 1
        || (directedStep.direction !== undefined && delta !== directedStep.direction)
      ) return false;
    }
    return true;
  }

  private searchCompletion({
    fixedPositions,
    requiredEdges,
    directedStep,
  }: PathCompletionRequest): number[] | null {
    const total = this.cells.length;
    if (total === 0) return [];

    const fixedNodeAtPosition = Array<number | undefined>(total).fill(undefined);
    const fixedPositionByNode = Array<number | undefined>(total).fill(undefined);
    for (const [node, position] of fixedPositions) {
      if (!this.inBounds(node) || !this.inBounds(position)) return null;
      const existing = fixedNodeAtPosition[position];
      if (existing !== undefined && existing !== node) return null;
      const existingPosition = fixedPositionByNode[node];
      if (existingPosition !== undefined && existingPosition !== position) return null;
      fixedNodeAtPosition[position] = node;
      fixedPositionByNode[node] = position;
    }

    const fixNodeAtPosition = (node: number, position: number): boolean => {
      if (!this.inBounds(node) || !this.inBounds(position)) return false;
      const existingNode = fixedNodeAtPosition[position];
      const existingPosition = fixedPositionByNode[node];
      if (
        (existingNode !== undefined && existingNode !== node)
        || (existingPosition !== undefined && existingPosition !== position)
      ) return false;
      fixedNodeAtPosition[position] = node;
      fixedPositionByNode[node] = position;
      return true;
    };

    if (directedStep?.direction !== undefined) {
      const fromPosition = fixedPositionByNode[directedStep.from];
      const toPosition = fixedPositionByNode[directedStep.to];
      if (
        (fromPosition !== undefined
          && !fixNodeAtPosition(directedStep.to, fromPosition + directedStep.direction))
        || (toPosition !== undefined
          && !fixNodeAtPosition(directedStep.from, toPosition - directedStep.direction))
      ) return null;
    }

    const requiredNeighbors = Array.from({ length: total }, () => new Set<number>());
    const requiredEdgeKeys = new Set<string>();
    for (const [left, right] of requiredEdges) {
      if (
        !this.inBounds(left)
        || !this.inBounds(right)
        || left === right
        || !this.neighbors[left].includes(right)
      ) {
        return null;
      }
      const key = pairKey(left, right);
      if (requiredEdgeKeys.has(key)) continue;
      requiredEdgeKeys.add(key);
      requiredNeighbors[left].add(right);
      requiredNeighbors[right].add(left);
      if (requiredNeighbors[left].size > 2 || requiredNeighbors[right].size > 2) return null;
    }

    const order = Array<number>(total).fill(-1);
    const positionByNode = Array<number>(total).fill(-1);
    const visited = Array<boolean>(total).fill(false);
    const failedStates = new Set<string>();
    let visitedMask = 0n;

    const directedStepAllows = (node: number, position: number): boolean => {
      if (!directedStep || (node !== directedStep.from && node !== directedStep.to)) return true;
      const other = node === directedStep.from ? directedStep.to : directedStep.from;
      const otherPosition = positionByNode[other];
      if (otherPosition < 0) return true;
      const delta = positionByNode[directedStep.to] >= 0
        ? positionByNode[directedStep.to] - positionByNode[directedStep.from]
        : node === directedStep.to
          ? position - otherPosition
          : otherPosition - position;
      return Math.abs(delta) === 1
        && (directedStep.direction === undefined || delta === directedStep.direction);
    };

    const remainingIsConnected = (current: number): boolean => {
      const reachable = new Set<number>([current]);
      const pending = [current];
      while (pending.length > 0) {
        const node = pending.pop() as number;
        for (const neighbor of this.neighbors[node]) {
          if (visited[neighbor] || reachable.has(neighbor)) continue;
          reachable.add(neighbor);
          pending.push(neighbor);
        }
      }
      for (let node = 0; node < total; node += 1) {
        if (!visited[node] && !reachable.has(node)) return false;
      }
      return true;
    };

    const canReachNextFixedPosition = (current: number, position: number): boolean => {
      let fixedPosition = position + 1;
      while (fixedPosition < total && fixedNodeAtPosition[fixedPosition] === undefined) {
        fixedPosition += 1;
      }
      if (fixedPosition >= total) return true;
      const target = fixedNodeAtPosition[fixedPosition] as number;
      if (visited[target]) return false;

      const distances = new Map<number, number>([[current, 0]]);
      const pending = [current];
      while (pending.length > 0) {
        const node = pending.shift() as number;
        const distance = distances.get(node) as number;
        if (node === target) return distance <= fixedPosition - position;
        if (distance >= fixedPosition - position) continue;
        for (const neighbor of this.neighbors[node]) {
          if ((visited[neighbor] && neighbor !== current) || distances.has(neighbor)) continue;
          distances.set(neighbor, distance + 1);
          pending.push(neighbor);
        }
      }
      return false;
    };

    const unvisitedDegreesRemainPossible = (current: number): boolean => {
      for (let node = 0; node < total; node += 1) {
        if (visited[node]) continue;
        const availableNeighborCount = this.neighbors[node].reduce(
          (count, neighbor) => count + Number(neighbor === current || !visited[neighbor]),
          0,
        );
        const fixedPosition = fixedPositionByNode[node];
        const mayBeFinalNode = fixedPosition === undefined || fixedPosition === total - 1;
        if (availableNeighborCount === 0 || (!mayBeFinalNode && availableNeighborCount < 2)) {
          return false;
        }
      }
      return true;
    };

    const search = (position: number): boolean => {
      if (position === total) {
        if (directedStep) {
          const delta = positionByNode[directedStep.to] - positionByNode[directedStep.from];
          if (
            Math.abs(delta) !== 1
            || (directedStep.direction !== undefined && delta !== directedStep.direction)
          ) {
            return false;
          }
        }
        return true;
      }

      const previous = position > 0 ? order[position - 1] : undefined;
      const stateKey = `${previous ?? -1}:${visitedMask.toString(16)}`;
      if (failedStates.has(stateKey)) return false;

      let candidates: number[];
      const fixedNode = fixedNodeAtPosition[position];
      if (fixedNode !== undefined) {
        candidates = [fixedNode];
      } else if (previous !== undefined) {
        const forced = [...requiredNeighbors[previous]].filter((node) => !visited[node]);
        if (forced.length > 1) {
          failedStates.add(stateKey);
          return false;
        }
        candidates = forced.length === 1
          ? forced
          : [...this.neighbors[previous]].filter((node) => !visited[node]);
      } else {
        candidates = Array.from({ length: total }, (_, node) => node);
      }
      candidates.sort((left, right) => (
        Math.abs(left - position) - Math.abs(right - position) || left - right
      ));

      for (const node of candidates) {
        if (visited[node]) continue;
        const fixedPosition = fixedPositionByNode[node];
        if (fixedPosition !== undefined && fixedPosition !== position) continue;
        if (previous !== undefined && !this.neighbors[previous].includes(node)) continue;
        if (!directedStepAllows(node, position)) continue;

        const visitedRequiredNeighbors = [...requiredNeighbors[node]]
          .filter((neighbor) => visited[neighbor]);
        if (
          visitedRequiredNeighbors.some((neighbor) => neighbor !== previous)
          || visitedRequiredNeighbors.length > 1
        ) {
          continue;
        }
        const unvisitedRequiredCount = requiredNeighbors[node].size - visitedRequiredNeighbors.length;
        if (unvisitedRequiredCount > (position < total - 1 ? 1 : 0)) continue;

        order[position] = node;
        positionByNode[node] = position;
        visited[node] = true;
        visitedMask |= 1n << BigInt(node);

        const viable = (
          (position === total - 1 || remainingIsConnected(node))
          && canReachNextFixedPosition(node, position)
          && unvisitedDegreesRemainPossible(node)
        );
        if (viable && search(position + 1)) return true;

        visitedMask &= ~(1n << BigInt(node));
        visited[node] = false;
        positionByNode[node] = -1;
        order[position] = -1;
      }

      failedStates.add(stateKey);
      return false;
    };

    return search(0) ? [...order] : null;
  }

  private inBounds(index: number): boolean {
    return Number.isInteger(index) && index >= 0 && index < this.cells.length;
  }

  private cacheKey({
    fixedPositions,
    requiredEdges,
    directedStep,
  }: PathCompletionRequest): string {
    const fixed = [...fixedPositions]
      .sort(([left], [right]) => left - right)
      .map(([node, position]) => `${node}:${position}`)
      .join(',');
    const edges = [...new Set(requiredEdges.map(([left, right]) => pairKey(left, right)))]
      .sort()
      .join(',');
    const directed = directedStep
      ? `${directedStep.from}>${directedStep.to}:${directedStep.direction ?? 0}`
      : '-';
    return `${fixed}|${edges}|${directed}`;
  }
}
