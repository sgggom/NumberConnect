import type {
  EditorAlgorithmResult,
  EditorAlgorithmSelection,
} from './algorithms';
import type { EditorCell, EditorShape } from './types';

export interface EditorPathGenerationWorkerContext {
  rows: number;
  columns: number;
  activeCells: string[];
  shape: EditorShape;
  generationIndex: number;
  fallbackPath?: EditorCell[];
  fixedPath?: EditorCell[];
  generationPhase?: 'combined' | 'path' | 'hidden';
  searchMode?: 'quality' | 'realtime';
}

export interface EditorPathGenerationWorkerRequest {
  type: 'generate';
  jobId: number;
  selection: EditorAlgorithmSelection;
  context: EditorPathGenerationWorkerContext;
}

export type EditorPathGenerationWorkerResponse =
  | { type: 'progress'; jobId: number; progress: number }
  | { type: 'completed'; jobId: number; result: EditorAlgorithmResult | null }
  | { type: 'error'; jobId: number; message: string };
