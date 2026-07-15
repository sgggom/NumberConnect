export interface BeadPatternData {
  id: string;
  name: string;
  width: number;
  height: number;
  pixels: Record<string, string | null>;
}

export interface BeadPixel {
  x: number;
  y: number;
  color: string;
}

export interface BeadProgress {
  patternId: string;
  collected: number;
}

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const PROGRESS_KEY = 'number-connect.bead-progress.v1';
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const browserStorage = (): StorageLike | undefined => {
  try {
    return typeof window !== 'undefined' && 'localStorage' in window
      ? window.localStorage
      : undefined;
  } catch {
    return undefined;
  }
};

export const parseBeadPattern = (value: unknown): BeadPatternData => {
  if (!value || typeof value !== 'object') throw new Error('Invalid bead pattern');
  const candidate = value as Partial<BeadPatternData>;
  const width = Math.floor(Number(candidate.width));
  const height = Math.floor(Number(candidate.height));
  if (!candidate.id || !candidate.name || width < 1 || height < 1 || !candidate.pixels) {
    throw new Error('Invalid bead pattern metadata');
  }

  const pixels: Record<string, string | null> = {};
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const key = `${x},${y}`;
      if (!(key in candidate.pixels)) throw new Error(`Missing bead coordinate ${key}`);
      const color = candidate.pixels[key];
      if (color !== null && (typeof color !== 'string' || !COLOR_PATTERN.test(color))) {
        throw new Error(`Invalid bead color at ${key}`);
      }
      pixels[key] = color;
    }
  }

  return { id: candidate.id, name: candidate.name, width, height, pixels };
};

export const loadBeadPattern = async (): Promise<BeadPatternData> => {
  const response = await fetch('./bead-patterns/orange-cat-20x20.json');
  if (!response.ok) throw new Error('Unable to load bead pattern');
  return parseBeadPattern(await response.json());
};

export const orderedBeads = (pattern: BeadPatternData): BeadPixel[] => {
  const beads: BeadPixel[] = [];
  for (let y = 0; y < pattern.height; y += 1) {
    for (let x = 0; x < pattern.width; x += 1) {
      const color = pattern.pixels[`${x},${y}`];
      if (color) beads.push({ x, y, color });
    }
  }
  return beads;
};

export const loadBeadProgress = (
  pattern: BeadPatternData,
  storage: StorageLike | undefined = browserStorage(),
): BeadProgress => {
  if (!storage) return { patternId: pattern.id, collected: 0 };
  try {
    const parsed = JSON.parse(storage.getItem(PROGRESS_KEY) ?? '{}') as Partial<BeadProgress>;
    const total = orderedBeads(pattern).length;
    const collected = parsed.patternId === pattern.id && Number.isFinite(Number(parsed.collected))
      ? Math.max(0, Math.min(total, Math.floor(Number(parsed.collected))))
      : 0;
    return { patternId: pattern.id, collected };
  } catch {
    return { patternId: pattern.id, collected: 0 };
  }
};

export const saveBeadProgress = (
  progress: BeadProgress,
  storage: StorageLike | undefined = browserStorage(),
): void => {
  try {
    storage?.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Progress persistence is optional when storage is unavailable.
  }
};

export const nextBeads = (
  pattern: BeadPatternData,
  progress: BeadProgress,
  maximum: number,
): BeadPixel[] => {
  const beads = orderedBeads(pattern);
  const start = Math.max(0, Math.min(beads.length, Math.floor(progress.collected)));
  const count = Math.max(0, Math.floor(maximum));
  return beads.slice(start, start + count);
};

export const advanceBeadProgress = (
  pattern: BeadPatternData,
  progress: BeadProgress,
  amount: number,
): BeadProgress => ({
  patternId: pattern.id,
  collected: Math.min(
    orderedBeads(pattern).length,
    Math.max(0, Math.floor(progress.collected)) + Math.max(0, Math.floor(amount)),
  ),
});
