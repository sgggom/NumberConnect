export enum BoardShape {
  Square = 0,
  Diamond = 1,
  Rectangle = 2,
  Level = 3,
}

export interface Cell {
  x: number;
  y: number;
}

export interface LevelData {
  levelId: number;
  boardShape: BoardShape;
  rows: number;
  columns: number;
  activeCells: Cell[];
  solutionPath: Cell[];
  backgroundResourcePath?: string;
  createdAtUtc?: string;
  custom?: boolean;
}

export interface GameSettings {
  shape: BoardShape;
  squareSize: number;
  diamondSize: number;
  rectangleSizeIndex: number;
  selectedLevelId: number;
  hiddenPercent: number;
  maxHiddenRun: number;
  maxVisibleRun: number;
  targetCrossings: number;
  showNextNumber: boolean;
  soundEnabled: boolean;
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
  showNextNumber: boolean;
  soundEnabled: boolean;
  mode: GameMode;
  onProgress: (current: number, total: number) => void;
  onWrong: (message: string) => void;
  onComplete: () => void;
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
  rectangleSizeIndex: 1,
  selectedLevelId: 1,
  hiddenPercent: 35,
  maxHiddenRun: 3,
  maxVisibleRun: 4,
  targetCrossings: 5,
  showNextNumber: true,
  soundEnabled: true,
};

export const cellKey = (cell: Cell): string => `${cell.x},${cell.y}`;

export const sameCell = (a: Cell, b: Cell): boolean => a.x === b.x && a.y === b.y;

export const backgroundUrl = (resourcePath?: string): string | undefined => {
  if (!resourcePath) return undefined;
  const name = resourcePath.split('/').pop();
  return name ? `./level-backgrounds/${name}.png` : undefined;
};
