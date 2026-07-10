export type EditorShape = 'square' | 'diamond' | 'rectangle' | 'hex';
export type ManualEditMode = 'off' | 'path' | 'hidden';

export interface EditorCell {
  x: number;
  y: number;
}

export interface EditorSize {
  rows: number;
  columns: number;
}
