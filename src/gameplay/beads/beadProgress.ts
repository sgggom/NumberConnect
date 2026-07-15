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

export interface BeadPatternManifestEntry {
  id: string;
  name: string;
  width: number;
  height: number;
  data: string;
}

export interface BeadSequenceState {
  pattern: BeadPatternData;
  progress: BeadProgress;
}

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const PROGRESS_KEY = 'number-connect.bead-progress.v1';
const COLLECTION_KEY = 'number-connect.bead-collection.v1';
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

export const parseBeadPatternManifest = (value: unknown): BeadPatternManifestEntry[] => {
  if (!value || typeof value !== 'object') throw new Error('Invalid bead pattern manifest');
  const entries = (value as { patterns?: unknown }).patterns;
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('Bead pattern manifest is empty');

  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid bead pattern manifest entry');
    const candidate = entry as Partial<BeadPatternManifestEntry>;
    const width = Math.floor(Number(candidate.width));
    const height = Math.floor(Number(candidate.height));
    if (
      !candidate.id
      || !candidate.name
      || width < 1
      || height < 1
      || typeof candidate.data !== 'string'
      || !/^[a-z0-9-]+\.json$/i.test(candidate.data)
    ) {
      throw new Error('Invalid bead pattern manifest entry');
    }
    return { id: candidate.id, name: candidate.name, width, height, data: candidate.data };
  });
};

export const loadBeadPatterns = async (): Promise<BeadPatternData[]> => {
  const manifestResponse = await fetch('./bead-patterns/patterns.json');
  if (!manifestResponse.ok) throw new Error('Unable to load bead pattern manifest');
  const entries = parseBeadPatternManifest(await manifestResponse.json());

  return Promise.all(entries.map(async (entry) => {
    const response = await fetch(`./bead-patterns/${entry.data}`);
    if (!response.ok) throw new Error(`Unable to load bead pattern ${entry.id}`);
    const pattern = parseBeadPattern(await response.json());
    if (
      pattern.id !== entry.id
      || pattern.name !== entry.name
      || pattern.width !== entry.width
      || pattern.height !== entry.height
    ) {
      throw new Error(`Bead pattern metadata mismatch for ${entry.id}`);
    }
    return pattern;
  }));
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

export const loadBeadSequence = (
  patterns: readonly BeadPatternData[],
  storage: StorageLike | undefined = browserStorage(),
): BeadSequenceState => {
  if (patterns.length === 0) throw new Error('No bead patterns available');

  let storedPatternId: string | undefined;
  try {
    const parsed = JSON.parse(storage?.getItem(PROGRESS_KEY) ?? '{}') as Partial<BeadProgress>;
    if (typeof parsed.patternId === 'string') storedPatternId = parsed.patternId;
  } catch {
    // Invalid progress falls back to the first pattern.
  }

  const storedIndex = patterns.findIndex((pattern) => pattern.id === storedPatternId);
  const pattern = patterns[storedIndex >= 0 ? storedIndex : 0];
  const progress = loadBeadProgress(pattern, storage);
  if (orderedBeads(pattern).length > 0 && progress.collected >= orderedBeads(pattern).length) {
    markBeadPatternCompleted(patterns, pattern.id, storage);
    return advanceBeadSequence(patterns, pattern, progress, storage);
  }
  return { pattern, progress };
};

export const advanceBeadSequence = (
  patterns: readonly BeadPatternData[],
  pattern: BeadPatternData,
  progress: BeadProgress,
  storage: StorageLike | undefined = browserStorage(),
): BeadSequenceState => {
  if (patterns.length === 0) throw new Error('No bead patterns available');
  const total = orderedBeads(pattern).length;
  if (progress.collected < total) return { pattern, progress };

  const currentIndex = patterns.findIndex((candidate) => candidate.id === pattern.id);
  const nextPattern = patterns[(Math.max(0, currentIndex) + 1) % patterns.length];
  const nextProgress = { patternId: nextPattern.id, collected: 0 };
  saveBeadProgress(nextProgress, storage);
  return { pattern: nextPattern, progress: nextProgress };
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

const readCompletedPatternIds = (storage: StorageLike | undefined): string[] => {
  try {
    const parsed = JSON.parse(storage?.getItem(COLLECTION_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

const saveCompletedPatternIds = (
  patternIds: readonly string[],
  storage: StorageLike | undefined,
): void => {
  try {
    storage?.setItem(COLLECTION_KEY, JSON.stringify(patternIds));
  } catch {
    // Collection persistence is optional when storage is unavailable.
  }
};

export const loadCompletedBeadPatternIds = (
  patterns: readonly BeadPatternData[],
  storage: StorageLike | undefined = browserStorage(),
): string[] => {
  const completed = new Set(readCompletedPatternIds(storage));

  // Older saves only stored the active pattern. In the fixed sequence, every
  // pattern before it must already have been completed, so preserve that history.
  try {
    const progress = JSON.parse(storage?.getItem(PROGRESS_KEY) ?? '{}') as Partial<BeadProgress>;
    const activeIndex = patterns.findIndex((pattern) => pattern.id === progress.patternId);
    if (activeIndex > 0) patterns.slice(0, activeIndex).forEach((pattern) => completed.add(pattern.id));
  } catch {
    // Invalid legacy progress does not affect an otherwise valid collection.
  }

  const ordered = patterns.filter((pattern) => completed.has(pattern.id)).map((pattern) => pattern.id);
  saveCompletedPatternIds(ordered, storage);
  return ordered;
};

export const markBeadPatternCompleted = (
  patterns: readonly BeadPatternData[],
  patternId: string,
  storage: StorageLike | undefined = browserStorage(),
): string[] => {
  const completed = new Set(loadCompletedBeadPatternIds(patterns, storage));
  if (patterns.some((pattern) => pattern.id === patternId)) completed.add(patternId);
  const ordered = patterns.filter((pattern) => completed.has(pattern.id)).map((pattern) => pattern.id);
  saveCompletedPatternIds(ordered, storage);
  return ordered;
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
