export enum BoardShape {
  Square = 0,
  Diamond = 1,
  Rectangle = 2,
  Level = 3,
  Hex = 4,
}

export const TOUCH_PREVIEW_SIZES = ['off', 'small', 'medium', 'large', 'zoom'] as const;
export type TouchPreviewSize = typeof TOUCH_PREVIEW_SIZES[number];

export const LOBBY_THEMES = ['cool', 'warm'] as const;
export type LobbyTheme = typeof LOBBY_THEMES[number];

export const INPUT_MODES = ['drag', 'click', 'auto-click'] as const;
export type InputMode = typeof INPUT_MODES[number];

export const COMBO_SOUND_SETS = ['combo1', 'combo2'] as const;
export type ComboSoundSet = typeof COMBO_SOUND_SETS[number];

export const MAIN_GAMEPLAYS = ['beads', 'puzzle', 'mode3', 'mode4', 'mode5'] as const;
export type MainGameplay = typeof MAIN_GAMEPLAYS[number];

export const MAIN_GAMEPLAY_DIFFICULTIES = ['dynamic', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export type MainGameplayDifficulty = typeof MAIN_GAMEPLAY_DIFFICULTIES[number];

export const isTouchPreviewSize = (value: unknown): value is TouchPreviewSize => (
  typeof value === 'string' && (TOUCH_PREVIEW_SIZES as readonly string[]).includes(value)
);

export const isLobbyTheme = (value: unknown): value is LobbyTheme => (
  typeof value === 'string' && (LOBBY_THEMES as readonly string[]).includes(value)
);

export const isInputMode = (value: unknown): value is InputMode => (
  typeof value === 'string' && (INPUT_MODES as readonly string[]).includes(value)
);

export const isComboSoundSet = (value: unknown): value is ComboSoundSet => (
  typeof value === 'string' && (COMBO_SOUND_SETS as readonly string[]).includes(value)
);

export type ComboSoundPatternToken = readonly number[];

export const parseComboSoundPattern = (value: unknown): ComboSoundPatternToken[] | undefined => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return undefined;
  const tokens: ComboSoundPatternToken[] = [];
  for (let index = 0; index < value.length;) {
    const character = value[index];
    if (/^[1-8]$/.test(character)) {
      tokens.push([Number(character)]);
      index += 1;
      continue;
    }
    if (character !== '[') return undefined;
    const closeIndex = value.indexOf(']', index + 1);
    if (closeIndex < 0) return undefined;
    const choices = value.slice(index + 1, closeIndex);
    if (choices.length === 0 || !/^[1-8]+$/.test(choices)) return undefined;
    tokens.push([...choices].map(Number));
    index = closeIndex + 1;
  }
  return tokens.length > 0 ? tokens : undefined;
};

export const isComboSoundPattern = (value: unknown): value is string => (
  parseComboSoundPattern(value) !== undefined
);

export const comboSoundBracketGroupRange = (
  value: string,
  bracketIndex: number,
): { start: number; end: number } | undefined => {
  if (value[bracketIndex] === '[') {
    const closeIndex = value.indexOf(']', bracketIndex + 1);
    return closeIndex >= 0 ? { start: bracketIndex, end: closeIndex + 1 } : undefined;
  }
  if (value[bracketIndex] === ']') {
    const openIndex = value.lastIndexOf('[', bracketIndex - 1);
    return openIndex >= 0 ? { start: openIndex, end: bracketIndex + 1 } : undefined;
  }
  return undefined;
};

export const parseComboSoundArrangement = (value: unknown): ComboSoundPatternToken[] | undefined => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) return undefined;
  const tokens: ComboSoundPatternToken[] = [];
  for (let index = 0; index < value.length;) {
    if (value[index] === '[') {
      const closeIndex = value.indexOf(']', index + 1);
      if (closeIndex < 0) return undefined;
      const choices = value.slice(index + 1, closeIndex);
      if (!/^[1-9]\d*(,[1-9]\d*)*$/.test(choices)) return undefined;
      tokens.push(choices.split(',').map(Number));
      index = closeIndex + 1;
    } else {
      const match = value.slice(index).match(/^[1-9]\d*/);
      if (!match) return undefined;
      tokens.push([Number(match[0])]);
      index += match[0].length;
    }
    if (index === value.length) break;
    if (value[index] !== ',' || index === value.length - 1) return undefined;
    index += 1;
  }
  return tokens.length > 0 ? tokens : undefined;
};

export const isComboSoundArrangement = (value: unknown, melodyCount: number): value is string => {
  const tokens = parseComboSoundArrangement(value);
  return tokens !== undefined && tokens.every((choices) => (
    choices.every((melodyNumber) => melodyNumber >= 1 && melodyNumber <= melodyCount)
  ));
};

export const remapComboSoundArrangementAfterRemoval = (
  value: string,
  removedMelodyNumber: number,
): string => {
  const tokens = parseComboSoundArrangement(value) ?? [[1]];
  const remapped = tokens.flatMap((choices) => {
    const nextChoices = choices
      .filter((number) => number !== removedMelodyNumber)
      .map((number) => number > removedMelodyNumber ? number - 1 : number);
    if (nextChoices.length === 0) return [];
    return [nextChoices.length === 1 ? String(nextChoices[0]) : `[${nextChoices.join(',')}]`];
  });
  return remapped.length > 0 ? remapped.join(',') : '1';
};

export const isMainGameplay = (value: unknown): value is MainGameplay => (
  typeof value === 'string' && (MAIN_GAMEPLAYS as readonly string[]).includes(value)
);

export const isMainGameplayDifficulty = (value: unknown): value is MainGameplayDifficulty => (
  value === 'dynamic'
  || (
    typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1
    && value <= 10
  )
);

export const usesClickInput = (mode: InputMode): boolean => mode !== 'drag';

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
  mainGameplay: MainGameplay;
  mainGameplayDifficulty: MainGameplayDifficulty;
  beadMainLevelId: number;
  puzzleMainLevelId: number;
  mode3MainLevelId: number;
  mode4MainLevelId: number;
  mode5MainLevelId: number;
  hiddenPercent: number;
  maxHiddenRun: number;
  maxVisibleRun: number;
  targetCrossings: number;
  showNextNumber: boolean;
  showDifficultyScore: boolean;
  soundEnabled: boolean;
  comboSoundSet: ComboSoundSet;
  comboSoundPattern: string;
  comboSoundPatterns: string[];
  comboSoundPatternIndex: number;
  comboSoundArrangement: string;
  lobbyTheme: LobbyTheme;
  inputMode: InputMode;
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
  inputMode: InputMode;
  touchPreviewRingDepth: 1 | 2;
  boardZoomEnabled: boolean;
  inactiveNumberFillColor: number;
  inactiveNumberTextColor: string;
  mode: GameMode;
  onProgress: (current: number, total: number) => void;
  onWrong: (message: string, shouldLoseLife: boolean) => void;
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
  mainGameplay: 'beads',
  mainGameplayDifficulty: 'dynamic',
  beadMainLevelId: 1,
  puzzleMainLevelId: 1,
  mode3MainLevelId: 1,
  mode4MainLevelId: 1,
  mode5MainLevelId: 1,
  hiddenPercent: 35,
  maxHiddenRun: 3,
  maxVisibleRun: 4,
  targetCrossings: 5,
  showNextNumber: true,
  showDifficultyScore: false,
  soundEnabled: true,
  comboSoundSet: 'combo1',
  comboSoundPattern: '12345678',
  comboSoundPatterns: ['12345678'],
  comboSoundPatternIndex: 0,
  comboSoundArrangement: '1',
  lobbyTheme: 'cool',
  inputMode: 'drag',
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
