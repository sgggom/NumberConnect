export type EditorShape = 'square' | 'diamond' | 'rectangle' | 'hex';
export type ManualEditMode = 'off' | 'path' | 'hidden';
export type EditorSizeAxis = 'rows' | 'columns';

export const MIN_EDITOR_SIZE = 3;
export const MAX_EDITOR_SIZE = 20;

export interface EditorCell {
  x: number;
  y: number;
}

export interface EditorSize {
  rows: number;
  columns: number;
}
