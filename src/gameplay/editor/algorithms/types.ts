import type { LevelAlgorithmData } from '../../../game/types';
import type { EditorCell, EditorShape } from '../types';

export interface EditorAlgorithmContext {
  rows: number;
  columns: number;
  activeCells: ReadonlySet<string>;
  shape: EditorShape;
  generationIndex: number;
  fallbackPath?: ReadonlyArray<EditorCell>;
  fixedPath?: ReadonlyArray<EditorCell>;
  generationPhase?: 'combined' | 'path' | 'hidden';
  searchMode?: 'quality' | 'realtime';
  onProgress?: (progress: number) => void;
}

export interface Algorithm1Parameters {
  topology: 'board-shape';
  pathMode: 'spatial-distribution-multiple-solutions';
  targetCrossings: number;
  turnProbability: number;
  hiddenPercent: number;
  targetDifficulty: number;
  maxVisibleRun: number;
  maxHiddenRun: number;
}

export interface Algorithm1Selection {
  id: 'algorithm-1';
  parameters: Algorithm1Parameters;
}

export type EditorAlgorithmSelection = Algorithm1Selection;
export type EditorAlgorithmId = EditorAlgorithmSelection['id'];

export interface EditorAlgorithmDescriptor {
  id: EditorAlgorithmId;
  label: string;
  description: string;
}

export interface EditorAlgorithmResult {
  path: EditorCell[];
  hiddenCells?: EditorCell[];
  targetHiddenCount?: number;
}

export const serializeEditorAlgorithm = (selection: EditorAlgorithmSelection): LevelAlgorithmData => ({
  id: selection.id,
  parameters: { ...selection.parameters },
});
