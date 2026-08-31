export enum BoardShape {
  Square = 0,
  Diamond = 1,
  Rectangle = 2,
  Level = 3,
  Hex = 4,
}

export const TOUCH_PREVIEW_SIZES = ['off', 'small', 'medium', 'large', 'zoom'] as const;
export type TouchPreviewSize = typeof TOUCH_PREVIEW_SIZES[number];

export const UI_THEMES = ['default', 'night'] as const;
export type UiTheme = typeof UI_THEMES[number];

export const CHARGE_PROGRESS_MODES = ['off', 'coins', 'progress'] as const;
export type ChargeProgressMode = typeof CHARGE_PROGRESS_MODES[number];

export const isTouchPreviewSize = (value: unknown): value is TouchPreviewSize => (
  typeof value === 'string' && (TOUCH_PREVIEW_SIZES as readonly string[]).includes(value)
);

export const isUiTheme = (value: unknown): value is UiTheme => (
  typeof value === 'string' && (UI_THEMES as readonly string[]).includes(value)
);

export const isChargeProgressMode = (value: unknown): value is ChargeProgressMode => (
  typeof value === 'string' && (CHARGE_PROGRESS_MODES as readonly string[]).includes(value)
);

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
  formationId?: string | number;
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
  puzzleMainLevelId: number;
  hiddenPercent: number;
  maxHiddenRun: number;
  maxVisibleRun: number;
  targetCrossings: number;
  showNextNumber: boolean;
  showDifficultyScore: boolean;
  soundEnabled: boolean;
  chargeProgressMode: ChargeProgressMode;
  showPuzzleFlow: boolean;
  uiTheme: UiTheme;
  touchPreviewSize: TouchPreviewSize;
  touchPreviewFollowsPointer: boolean;
}

export interface BoardNeighborhoodPreviewCell {
  index: number;
  offsetX: number;
  offsetY: number;
  value: number | null;
  center: boolean;
  inFocusRing: boolean;
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

export interface BoardViewportPreview {
  zoom: number;
  scrollX: number;
  scrollY: number;
  viewportWidthRatio: number;
  viewportHeightRatio: number;
  cellDiameterToStep: number;
  numberFontToCellDiameter: number;
}

export interface BoardNeighborhoodPreview {
  clientX: number;
  clientY: number;
  originClientX: number;
  originClientY: number;
  cells: BoardNeighborhoodPreviewCell[];
  lines: BoardNeighborhoodPreviewLine[];
  pointer: BoardNeighborhoodPreviewPointer | null;
  viewport?: BoardViewportPreview;
}

export interface BoardHoldScore {
  choiceQuantity: number;
  choiceScore: number;
  feasibleChoiceCount: number;
  extraScore: number;
  nextNumberDistance: number;
  reasoningBranchCount: number;
  reasoningBranchScore: number;
  actualScore: number;
  total: number;
  totalDigitScore: number;
  badgeScore: number;
}

export interface BoardWrongStepData {
  stepNumber: number;
  score: Promise<BoardHoldScore | undefined>;
}

export interface BoardArtworkInput {
  textureKey: string;
  sourceColumns: number;
  sourceRows: number;
  sourceIndex: number;
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
  artwork?: BoardArtworkInput;
  completionGemColors?: readonly string[];
  completionGemDestination?: 'jar' | 'showcase';
  showNextNumber: boolean;
  showDifficultyScore?: boolean;
  soundEnabled: boolean;
  chargeProgressMode: ChargeProgressMode;
  touchPreviewRingDepth: 1 | 2;
  boardZoomEnabled: boolean;
  mode: GameMode;
  onProgress: (current: number, total: number) => void;
  onWrong: (message: string, shouldLoseLife: boolean, step: BoardWrongStepData) => void;
  onRelease?: () => void;
  onComplete: () => void;
  onComboComplete?: () => void;
  onNeighborhoodPreview?: (preview: BoardNeighborhoodPreview | null) => void;
  onHoldScore?: (score: BoardHoldScore | null) => void;
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
  puzzleMainLevelId: 1,
  hiddenPercent: 35,
  maxHiddenRun: 3,
  maxVisibleRun: 4,
  targetCrossings: 5,
  showNextNumber: true,
  showDifficultyScore: false,
  soundEnabled: true,
  chargeProgressMode: 'coins',
  showPuzzleFlow: true,
  uiTheme: 'default',
  touchPreviewSize: 'off',
  touchPreviewFollowsPointer: false,
};

export const cellKey = (cell: Cell): string => `${cell.x},${cell.y}`;

export const sameCell = (a: Cell, b: Cell): boolean => a.x === b.x && a.y === b.y;

export const backgroundUrl = (resourcePath?: string): string | undefined => {
  if (!resourcePath) return undefined;
  const name = resourcePath.split('/').pop();
  return name ? `./level-backgrounds/${name}.png` : undefined;
};
