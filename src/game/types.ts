export enum BoardShape {
  Square = 0,
  Diamond = 1,
  Rectangle = 2,
  Level = 3,
  Hex = 4,
}

export interface Cell {
  x: number;
  y: number;
}

export interface LevelAlgorithmData {
  id: string;
  parameters: Record<string, unknown>;
}

export interface LevelData {
  levelId: number;
  boardShape: BoardShape;
  rows: number;
  columns: number;
  activeCells: Cell[];
  solutionPath: Cell[];
  pathSource?: 'generated' | 'manual';
  hiddenCells?: Cell[];
  algorithm?: LevelAlgorithmData;
  backgroundResourcePath?: string;
  createdAtUtc?: string;
  custom?: boolean;
}

export interface GameSettings {
  shape: BoardShape;
  squareSize: number;
  diamondSize: number;
  hexSize: number;
  rectangleSizeIndex: number;
  selectedLevelId: number;
  hiddenPercent: number;
  maxHiddenRun: number;
  maxVisibleRun: number;
  targetCrossings: number;
  showNextNumber: boolean;
  soundEnabled: boolean;
  touchPreviewEnabled: boolean;
  touchPreviewFollowsPointer: boolean;
}

export interface BoardNeighborhoodPreviewCell {
  index: number;
  offsetX: number;
  offsetY: number;
  value: number | null;
  center: boolean;
}

export interface BoardNeighborhoodPreviewLine {
  fromIndex: number;
  toIndex: number;
}

export interface BoardNeighborhoodPreviewPointer {
  fromIndex: number;
  offsetX: number;
  offsetY: number;
}

export interface BoardNeighborhoodPreview {
  clientX: number;
  clientY: number;
  cells: BoardNeighborhoodPreviewCell[];
  lines: BoardNeighborhoodPreviewLine[];
  pointer: BoardNeighborhoodPreviewPointer | null;
}

export interface EndlessStageSettings {
  rows: number;
  columns: number;
  hiddenPercent: number;
  maxVisibleRun: number;
  maxHiddenRun: number;
  targetCrossings: number;
}

export type GameMode = 'normal' | 'endless';

export interface BoardSessionInput {
  level: LevelData;
  hiddenCells: Set<string>;
  completionGemColors?: readonly string[];
  showNextNumber: boolean;
  soundEnabled: boolean;
  mode: GameMode;
  onProgress: (current: number, total: number) => void;
  onWrong: (message: string) => void;
  onComplete: () => void;
  onNeighborhoodPreview?: (preview: BoardNeighborhoodPreview | null) => void;
}

export const RECTANGLE_SIZES: ReadonlyArray<Readonly<Cell>> = [
  { x: 3, y: 5 },
  { x: 4, y: 6 },
  { x: 5, y: 8 },
  { x: 6, y: 10 },
  { x: 7, y: 12 },
];

export const DEFAULT_SETTINGS: GameSettings = {
  shape: BoardShape.Level,
  squareSize: 6,
  diamondSize: 6,
  hexSize: 6,
  rectangleSizeIndex: 1,
  selectedLevelId: 1,
  hiddenPercent: 35,
  maxHiddenRun: 3,
  maxVisibleRun: 4,
  targetCrossings: 5,
  showNextNumber: true,
  soundEnabled: true,
  touchPreviewEnabled: true,
  touchPreviewFollowsPointer: false,
};

export const cellKey = (cell: Cell): string => `${cell.x},${cell.y}`;

export const sameCell = (a: Cell, b: Cell): boolean => a.x === b.x && a.y === b.y;

export const backgroundUrl = (resourcePath?: string): string | undefined => {
  if (!resourcePath) return undefined;
  const name = resourcePath.split('/').pop();
  return name ? `./level-backgrounds/${name}.png` : undefined;
};
