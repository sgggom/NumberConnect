export interface PlayPuzzlePattern {
  id: string;
  name: string;
  imageUrl: string;
  columns: 2;
  rows: 2;
}

export interface PlayPuzzleProgress {
  patternId: string;
  revealed: number;
}

export interface PlayPuzzleRotation {
  x: number;
  y: number;
  z: number;
}

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const PUZZLE_PROGRESS_KEY = 'number-connect.play-puzzle-showcase.v1';
const PUZZLE_ROTATION_KEY = 'number-connect.play-puzzle-rotation.v1';

export const DEFAULT_PLAY_PUZZLE_ROTATION: PlayPuzzleRotation = { x: 0, y: -26, z: 3 };

export const PLAY_PUZZLE_PATTERNS: PlayPuzzlePattern[] = [
  { id: 'fj22', name: '仙人掌秘境', imageUrl: './puzzle-showcase/fj22.png', columns: 2, rows: 2 },
  { id: 'fj23', name: '蘑菇森林屋', imageUrl: './puzzle-showcase/fj23.png', columns: 2, rows: 2 },
  { id: 'fj24', name: '林间小鹿', imageUrl: './puzzle-showcase/fj24.png', columns: 2, rows: 2 },
  { id: 'fj25', name: '晴日牧场', imageUrl: './puzzle-showcase/fj25.png', columns: 2, rows: 2 },
  { id: 'fj26', name: '森林露营会', imageUrl: './puzzle-showcase/fj26.png', columns: 2, rows: 2 },
  { id: 'fj27', name: '向日葵农场', imageUrl: './puzzle-showcase/fj27.png', columns: 2, rows: 2 },
  { id: 'fj28', name: '热带海滩', imageUrl: './puzzle-showcase/fj28.png', columns: 2, rows: 2 },
  { id: 'fj29', name: '南瓜田园', imageUrl: './puzzle-showcase/fj29.png', columns: 2, rows: 2 },
  { id: 'fj30', name: '夕照村庄', imageUrl: './puzzle-showcase/fj30.png', columns: 2, rows: 2 },
  { id: 'fj31', name: '雪林小屋', imageUrl: './puzzle-showcase/fj31.png', columns: 2, rows: 2 },
  { id: 'fj32', name: '冰雪村落', imageUrl: './puzzle-showcase/fj32.png', columns: 2, rows: 2 },
  { id: 'fj33', name: '碧海假日', imageUrl: './puzzle-showcase/fj33.png', columns: 2, rows: 2 },
  { id: 'fj34', name: '湖上晚霞', imageUrl: './puzzle-showcase/fj34.png', columns: 2, rows: 2 },
  { id: 'fj35', name: '金秋露营', imageUrl: './puzzle-showcase/fj35.png', columns: 2, rows: 2 },
];

const browserStorage = (): StorageLike | undefined => {
  try {
    return typeof window !== 'undefined' && 'localStorage' in window
      ? window.localStorage
      : undefined;
  } catch {
    return undefined;
  }
};

export const puzzlePieceCount = (pattern: PlayPuzzlePattern): number => (
  pattern.columns * pattern.rows
);

export const playPuzzleTextureKey = (pattern: PlayPuzzlePattern): string => (
  `play-puzzle-artwork-${pattern.id}`
);

export const loadPlayPuzzleProgress = (
  storage: StorageLike | undefined = browserStorage(),
): PlayPuzzleProgress => {
  const fallback = { patternId: PLAY_PUZZLE_PATTERNS[0].id, revealed: 0 };
  if (!storage) return fallback;
  try {
    const value = JSON.parse(storage.getItem(PUZZLE_PROGRESS_KEY) ?? '{}') as Partial<PlayPuzzleProgress>;
    const pattern = PLAY_PUZZLE_PATTERNS.find((candidate) => candidate.id === value.patternId);
    if (!pattern) return fallback;
    return {
      patternId: pattern.id,
      revealed: Math.max(0, Math.min(puzzlePieceCount(pattern), Math.floor(Number(value.revealed) || 0))),
    };
  } catch {
    return fallback;
  }
};

export const savePlayPuzzleProgress = (
  progress: PlayPuzzleProgress,
  storage: StorageLike | undefined = browserStorage(),
): void => {
  storage?.setItem(PUZZLE_PROGRESS_KEY, JSON.stringify(progress));
};

const clampRotation = (value: unknown, minimum: number, maximum: number, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};

export const loadPlayPuzzleRotation = (
  storage: StorageLike | undefined = browserStorage(),
): PlayPuzzleRotation => {
  if (!storage) return { ...DEFAULT_PLAY_PUZZLE_ROTATION };
  try {
    const value = JSON.parse(storage.getItem(PUZZLE_ROTATION_KEY) ?? '{}') as Partial<PlayPuzzleRotation>;
    return {
      x: clampRotation(value.x, -50, 50, DEFAULT_PLAY_PUZZLE_ROTATION.x),
      y: clampRotation(value.y, -65, 65, DEFAULT_PLAY_PUZZLE_ROTATION.y),
      z: clampRotation(value.z, -15, 15, DEFAULT_PLAY_PUZZLE_ROTATION.z),
    };
  } catch {
    return { ...DEFAULT_PLAY_PUZZLE_ROTATION };
  }
};

export const savePlayPuzzleRotation = (
  rotation: PlayPuzzleRotation,
  storage: StorageLike | undefined = browserStorage(),
): void => {
  storage?.setItem(PUZZLE_ROTATION_KEY, JSON.stringify(rotation));
};

export const nextPlayPuzzlePattern = (pattern: PlayPuzzlePattern): PlayPuzzlePattern => {
  const index = PLAY_PUZZLE_PATTERNS.findIndex((candidate) => candidate.id === pattern.id);
  return PLAY_PUZZLE_PATTERNS[(Math.max(0, index) + 1) % PLAY_PUZZLE_PATTERNS.length];
};

export const advancePlayPuzzleProgress = (
  pattern: PlayPuzzlePattern,
  progress: PlayPuzzleProgress,
): PlayPuzzleProgress => ({
  patternId: pattern.id,
  revealed: Math.min(puzzlePieceCount(pattern), progress.revealed + 1),
});

export const renderPlayPuzzleShowcase = (
  host: HTMLElement,
  pattern: PlayPuzzlePattern,
  revealedCount: number,
): void => {
  const cells = Array.from({ length: puzzlePieceCount(pattern) }, (_, index) => {
    const x = index % pattern.columns;
    const y = Math.floor(index / pattern.columns);
    const cell = document.createElement('i');
    cell.className = 'play-puzzle-showcase__piece';
    if (index < revealedCount) cell.classList.add('is-revealed');
    cell.dataset.puzzlePiece = String(index);
    cell.style.gridColumn = String(x + 1);
    cell.style.gridRow = String(y + 1);
    cell.style.backgroundImage = `url("${pattern.imageUrl}")`;
    cell.style.backgroundSize = `${pattern.columns * 100}% ${pattern.rows * 100}%`;
    cell.style.backgroundPosition = `${x * 100 / Math.max(1, pattern.columns - 1)}% ${y * 100 / Math.max(1, pattern.rows - 1)}%`;
    return cell;
  });
  host.replaceChildren(...cells);
  host.parentElement?.classList.toggle('is-complete', revealedCount >= puzzlePieceCount(pattern));
  host.setAttribute('aria-label', `拼图：${pattern.name}，已完成 ${revealedCount} / ${puzzlePieceCount(pattern)} 块`);
};

export const renderPlayPuzzleFinale = (
  host: HTMLElement,
  pattern: PlayPuzzlePattern,
): void => {
  const pieces = Array.from({ length: puzzlePieceCount(pattern) }, (_, index) => {
    const x = index % pattern.columns;
    const y = Math.floor(index / pattern.columns);
    const piece = document.createElement('i');
    piece.className = 'play-puzzle-finale__piece';
    piece.dataset.puzzlePiece = String(index);
    piece.style.gridColumn = String(x + 1);
    piece.style.gridRow = String(y + 1);
    piece.style.setProperty('--piece-order', String(index));
    piece.style.setProperty('--piece-delay', `${120 + index * 110}ms`);

    const face = document.createElement('span');
    face.className = 'play-puzzle-finale__piece-face';
    face.style.backgroundImage = `url("${pattern.imageUrl}")`;
    face.style.backgroundSize = `${pattern.columns * 100}% ${pattern.rows * 100}%`;
    face.style.backgroundPosition = `${x * 100 / Math.max(1, pattern.columns - 1)}% ${y * 100 / Math.max(1, pattern.rows - 1)}%`;
    piece.append(face);
    return piece;
  });
  host.replaceChildren(...pieces);
  host.setAttribute('aria-label', `已完成拼图：${pattern.name}`);
};
