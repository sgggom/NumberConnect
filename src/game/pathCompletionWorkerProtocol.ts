import type { BoardShape, Cell } from './types';

export interface SerializablePathCompletionRequest {
  cells: Cell[];
  boardShape: BoardShape;
  fixedPositions: Array<readonly [number, number]>;
  requiredEdges: Array<readonly [number, number]>;
  directedStep?: { from: number; to: number; direction?: -1 | 1 };
}

export interface PathCompletionWorkerRequest {
  type: 'complete';
  request: SerializablePathCompletionRequest;
}

export type PathCompletionWorkerResponse =
  | { type: 'completed'; completion: number[] | null }
  | { type: 'error'; message: string };
