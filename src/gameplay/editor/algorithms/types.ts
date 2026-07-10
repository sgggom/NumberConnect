import type { LevelAlgorithmData } from '../../../game/types';
import type { EditorCell, EditorShape } from '../types';

export interface EditorAlgorithmContext {
  rows: number;
  columns: number;
  activeCells: ReadonlySet<string>;
  shape: EditorShape;
  generationIndex: number;
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

// Add future algorithm selections to this discriminated union. Each algorithm
// keeps its own parameter type instead of sharing a generic numeric bag.
export type EditorAlgorithmSelection = Algorithm1Selection;
export type EditorAlgorithmId = EditorAlgorithmSelection['id'];

export interface EditorAlgorithmDescriptor {
  id: EditorAlgorithmId;
  label: string;
  description: string;
}

export type EditorAlgorithmRunner = (
  context: EditorAlgorithmContext,
  selection: EditorAlgorithmSelection,
) => EditorCell[] | null;

export const serializeEditorAlgorithm = (selection: EditorAlgorithmSelection): LevelAlgorithmData => ({
  id: selection.id,
  parameters: { ...selection.parameters },
});
