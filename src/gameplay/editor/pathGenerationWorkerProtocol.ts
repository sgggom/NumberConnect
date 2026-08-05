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
  searchMode?: 'quality' | 'realtime';
}

export interface EditorPathGenerationWorkerRequest {
  type: 'generate';
  selection: EditorAlgorithmSelection;
  context: EditorPathGenerationWorkerContext;
}

export type EditorPathGenerationWorkerResponse =
  | { type: 'progress'; progress: number }
  | { type: 'completed'; result: EditorAlgorithmResult | null }
  | { type: 'error'; message: string };
