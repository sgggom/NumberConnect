import type { LevelAlgorithmData } from '../../../game/types';
import type { EditorCell, EditorShape } from '../types';

export interface EditorAlgorithmContext {
  rows: number;
  columns: number;
  activeCells: ReadonlySet<string>;
  shape: EditorShape;
  generationIndex: number;
  fallbackPath?: ReadonlyArray<EditorCell>;
  searchMode?: 'quality' | 'realtime';
}

export interface Algorithm1Parameters {
  topology: 'board-shape';
  pathMode: 'single-stroke';
  targetCrossings: number;
}

export interface Algorithm1Selection {
  id: 'algorithm-1';
  parameters: Algorithm1Parameters;
}

export interface Algorithm2Parameters {
  topology: 'board-shape';
  pathMode: 'single-stroke-no-luck';
  targetCrossings: number;
  turnProbability: number;
  hiddenPercent: number;
  maxHiddenRun: number;
  maxVisibleRun: number;
}

export interface Algorithm2Selection {
  id: 'algorithm-2';
  parameters: Algorithm2Parameters;
}

export interface Algorithm3Parameters {
  topology: 'board-shape';
  pathMode: 'single-stroke-no-luck-feature-hidden';
  targetCrossings: number;
  turnProbability: number;
  straightHiddenProbability: number;
  turnHiddenProbability: number;
  crossingHiddenProbability: number;
  hiddenPercent: number;
  maxHiddenClusterSize: number;
}

export interface Algorithm3Selection {
  id: 'algorithm-3';
  parameters: Algorithm3Parameters;
}

export type EditorAlgorithmSelection = Algorithm1Selection | Algorithm2Selection | Algorithm3Selection;
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

export type EditorAlgorithmRunner = (
  context: EditorAlgorithmContext,
  selection: EditorAlgorithmSelection,
) => EditorAlgorithmResult | null;

export const serializeEditorAlgorithm = (selection: EditorAlgorithmSelection): LevelAlgorithmData => ({
  id: selection.id,
  parameters: { ...selection.parameters },
});
