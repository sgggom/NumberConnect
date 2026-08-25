import type { Cell } from './types';

export type BoardPathShape = 'square' | 'diamond' | 'rectangle' | 'hex';

export interface PathGenerationContext {
  rows: number;
  columns: number;
  activeCells: ReadonlySet<string>;
  shape: BoardPathShape;
  generationIndex: number;
  fallbackPath?: ReadonlyArray<Cell>;
  searchMode?: 'quality' | 'realtime';
  onProgress?: (progress: number) => void;
}
