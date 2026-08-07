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
  pathMode: 'single-stroke';
  targetCrossings: number;
}

export interface Algorithm1Selection {
  id: 'algorithm-1';
  parameters: Algorithm1Parameters;
}

export interface Algorithm2Parameters {
  topology: 'board-shape';
  pathMode: 'single-stroke-multiple-solutions';
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
  pathMode: 'single-stroke-multiple-solutions-feature-hidden';
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

export interface Algorithm4Parameters {
  topology: 'board-shape';
  pathMode: 'single-stroke-multiple-solutions';
  targetCrossings: number;
  turnProbability: number;
  earlyHiddenProbability: number;
  middleHiddenProbability: number;
  lateHiddenProbability: number;
  earlyAdjacentHiddenSkipProbability: number;
  middleAdjacentHiddenSkipProbability: number;
  lateAdjacentHiddenSkipProbability: number;
  maxHiddenRun: number;
  maxVisibleRun: number;
}

export interface Algorithm4Selection {
  id: 'algorithm-4';
  parameters: Algorithm4Parameters;
}

export interface Algorithm5Parameters extends Omit<
  Algorithm4Parameters,
  | 'earlyAdjacentHiddenSkipProbability'
  | 'middleAdjacentHiddenSkipProbability'
  | 'lateAdjacentHiddenSkipProbability'
> {
  earlyRowColumnHiddenSkipProbability: number;
  middleRowColumnHiddenSkipProbability: number;
  lateRowColumnHiddenSkipProbability: number;
}

export interface Algorithm5Selection {
  id: 'algorithm-5';
  parameters: Algorithm5Parameters;
}

export interface Algorithm6Parameters {
  topology: 'board-shape';
  pathMode: 'single-stroke-multiple-solutions';
  targetCrossings: number;
  turnProbability: number;
  earlyHiddenProbability: number;
  middleHiddenProbability: number;
  lateHiddenProbability: number;
  earlyRowColumnHiddenSkipProbability: number;
  middleRowColumnHiddenSkipProbability: number;
  lateRowColumnHiddenSkipProbability: number;
  maxHiddenRun: number;
  maxVisibleRun: number;
}

export interface Algorithm6Selection {
  id: 'algorithm-6';
  parameters: Algorithm6Parameters;
}

export interface Algorithm7Parameters {
  topology: 'board-shape';
  pathMode: 'difficulty-inversion-multiple-solutions';
  targetCrossings: number;
  turnProbability: number;
  targetDifficulty: number;
  searchIterations: number;
  minimumHiddenPercent: number;
  maximumHiddenPercent: number;
  maxHiddenRun: number;
  maxVisibleRun: number;
}

export interface Algorithm7Selection {
  id: 'algorithm-7';
  parameters: Algorithm7Parameters;
}

export type EditorAlgorithmSelection =
  | Algorithm1Selection
  | Algorithm2Selection
  | Algorithm3Selection
  | Algorithm4Selection
  | Algorithm5Selection
  | Algorithm6Selection
  | Algorithm7Selection;
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
