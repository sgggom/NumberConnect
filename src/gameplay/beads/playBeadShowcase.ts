export interface PlayBeadShowcasePattern {
  id: string;
  name: string;
  width: 20;
  height: 10;
  pixels: Array<{ x: number; y: number; color: string }>;
}

interface PatternDefinition {
  id: string;
  name: string;
  palette: Record<string, string>;
  art: string[];
}

const SHOWCASE_WIDTH = 20;
const SHOWCASE_HEIGHT = 10;
const SHOWCASE_PROGRESS_KEY = 'number-connect.play-bead-showcase.v1';

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface PlayBeadShowcaseProgress {
  patternId: string;
  collected: number;
}

const browserStorage = (): StorageLike | undefined => {
  try {
    return typeof window !== 'undefined' && 'localStorage' in window
      ? window.localStorage
      : undefined;
  } catch {
    return undefined;
  }
};

const compilePattern = (definition: PatternDefinition): PlayBeadShowcasePattern => {
  if (definition.art.length !== SHOWCASE_HEIGHT) {
    throw new Error(`拼豆横幅 ${definition.id} 必须为 ${SHOWCASE_HEIGHT} 行`);
  }
  const pixels: PlayBeadShowcasePattern['pixels'] = [];

  definition.art.forEach((row, y) => {
    if (row.length !== SHOWCASE_WIDTH) {
      throw new Error(`拼豆横幅 ${definition.id} 第 ${y + 1} 行必须为 ${SHOWCASE_WIDTH} 列`);
    }
    [...row].forEach((symbol, x) => {
      const color = definition.palette[symbol];
      if (!color) throw new Error(`拼豆横幅 ${definition.id} 使用了未知颜色 ${symbol}`);
      pixels.push({ x, y, color });
    });
  });

  return {
    id: definition.id,
    name: definition.name,
    width: SHOWCASE_WIDTH,
    height: SHOWCASE_HEIGHT,
    pixels,
  };
};

export const PLAY_BEAD_SHOWCASE_PATTERNS: PlayBeadShowcasePattern[] = [
  compilePattern({
    id: 'rainbow-whale-bay',
    name: '彩虹鲸湾',
    palette: {
      S: '#CDEEFF', W: '#F8FCFF', Y: '#FFD34E', D: '#2677C9',
      B: '#59B9F5', P: '#FF82A8', A: '#65D7D0', V: '#A987F5',
    },
    art: [
      'SSSSSSSSSSSSSSSYYYYS',
      'SSSWWWSSSSSSSSSYYYSS',
      'SSWWWWWSSSSSSSSSSSSS',
      'SSSSSDDDSSSSSSSSSSSS',
      'SSSSDDDBBBBBBBSSSSSS',
      'SSSDDDBBBBBBBBBPSSSS',
      'SSSSSBBBBBBBBBBBSSSS',
      'AAAAAAAAAAAAAAAAAAAA',
      'AABBAAAAAAVVVAAAAAAA',
      'BBBBBBBBBBBBBBBBBBBB',
    ],
  }),
  compilePattern({
    id: 'cloud-balloon-trip',
    name: '云端热气球',
    palette: {
      S: '#CDEEFF', W: '#F8FCFF', R: '#FF6F61', O: '#FF9F43',
      Y: '#FFD34E', P: '#FF82A8', V: '#9A7BEF', N: '#8A5A3C',
      G: '#65C98C', D: '#39996D',
    },
    art: [
      'SSSSSSWWWWSSSSSSSSSS',
      'SSSSSWWWWWWSSSSSSSSS',
      'SSSSSSSRRRRRRSSSSSSS',
      'SSSSSRROYYORRSSSSSSS',
      'SSSSROYYPYYORSSSSSSS',
      'SSSSRVVYPYVVRSSSSSSS',
      'SSSSSSVVVVVVSSSSSSSS',
      'SSSSSSSSNNSSSSSSSSSS',
      'GGGGGGGGNNGGGGGGGGGG',
      'DDGGDDGGDDGGDDGGDDGG',
    ],
  }),
  compilePattern({
    id: 'starlight-train',
    name: '星光小火车',
    palette: {
      N: '#294A80', Y: '#FFD34E', W: '#F8FCFF', R: '#F45D6F',
      B: '#5EA8EE', V: '#9B7BEF', K: '#334052', G: '#65C98C',
    },
    art: [
      'NNYNNNNNNNNNNNYNNNNN',
      'NYYYNNWWWNNNNYYYNYNN',
      'NNYNNNNWNNNNNNYNNNNN',
      'NNNNNNNNNNNNNNNRRRRN',
      'NNBBBBBBNNVVVVNRRYRN',
      'NBBYYYYBBNVYYYYVRRRR',
      'NBBBBBBBBNVVVVVVRRRR',
      'KKKKKKKKKKKKKKKKKKKK',
      'GKGKGKGKGKGKGKGKGKGK',
      'GGGGGGGGGGGGGGGGGGGG',
    ],
  }),
  compilePattern({
    id: 'flower-field-cottage',
    name: '花田小屋',
    palette: {
      S: '#CDEEFF', Y: '#FFD34E', W: '#F8FCFF', R: '#F46F7B',
      C: '#FFF0CC', U: '#62B9EA', N: '#8A5A3C', G: '#65C98C', P: '#FF9CC5',
    },
    art: [
      'SSSSSSSSSSSSSSSYYYYS',
      'SSWWWSSSSSSSSSSYYYYS',
      'SWWWWWSSSSSSSSSSSSSS',
      'SSSSSSSSRRRRRRRSSSSS',
      'SSSSSSSRRRRRRRRRSSSS',
      'SSSSSSCCCCCCCCCSSSSS',
      'SSSSSSCCUUCCUUCCSSSS',
      'SSSSSSCCCCNNCCCCSSSS',
      'GGPGGGCCCCNNCCCCGGYG',
      'GGGGPGGGGGGGYGGPGGGG',
    ],
  }),
];

export const playBeadShowcasePatternFor = (levelId: number): PlayBeadShowcasePattern => {
  const index = Math.abs(Math.trunc(levelId) - 1) % PLAY_BEAD_SHOWCASE_PATTERNS.length;
  return PLAY_BEAD_SHOWCASE_PATTERNS[index];
};

export const playBeadShowcaseColorsForBoard = (
  pixels: readonly PlayBeadShowcasePattern['pixels'][number][],
  numberCount: number,
): string[] => {
  const count = Math.max(0, Math.floor(numberCount));
  if (pixels.length === 0) return [];
  return Array.from({ length: count }, (_, index) => (
    pixels[Math.floor(index * pixels.length / Math.max(1, count))].color
  ));
};

export const loadPlayBeadShowcaseProgress = (
  storage: StorageLike | undefined = browserStorage(),
): PlayBeadShowcaseProgress => {
  const fallback = { patternId: PLAY_BEAD_SHOWCASE_PATTERNS[0].id, collected: 0 };
  if (!storage) return fallback;
  try {
    const value = JSON.parse(storage.getItem(SHOWCASE_PROGRESS_KEY) ?? '{}') as Partial<PlayBeadShowcaseProgress>;
    const pattern = PLAY_BEAD_SHOWCASE_PATTERNS.find((candidate) => candidate.id === value.patternId);
    if (!pattern) return fallback;
    return {
      patternId: pattern.id,
      collected: Math.max(0, Math.min(pattern.pixels.length, Math.floor(Number(value.collected) || 0))),
    };
  } catch {
    return fallback;
  }
};

export const savePlayBeadShowcaseProgress = (
  progress: PlayBeadShowcaseProgress,
  storage: StorageLike | undefined = browserStorage(),
): void => {
  storage?.setItem(SHOWCASE_PROGRESS_KEY, JSON.stringify(progress));
};

export const nextPlayBeadShowcasePattern = (
  pattern: PlayBeadShowcasePattern,
): PlayBeadShowcasePattern => {
  const index = PLAY_BEAD_SHOWCASE_PATTERNS.findIndex((candidate) => candidate.id === pattern.id);
  return PLAY_BEAD_SHOWCASE_PATTERNS[(Math.max(0, index) + 1) % PLAY_BEAD_SHOWCASE_PATTERNS.length];
};

export const renderPlayBeadShowcase = (
  host: HTMLElement,
  pattern: PlayBeadShowcasePattern,
  filledCount: number,
): PlayBeadShowcasePattern['pixels'] => {
  const cells = pattern.pixels.map((pixel, index) => {
    const cell = document.createElement('i');
    cell.className = 'bead-pattern-cell play-bead-showcase__cell is-target';
    if (index < filledCount) cell.classList.add('is-filled');
    cell.dataset.beadOrder = String(index);
    cell.style.gridColumn = String(pixel.x + 1);
    cell.style.gridRow = String(pixel.y + 1);
    cell.style.setProperty('--bead-color', pixel.color);
    return cell;
  });

  host.replaceChildren(...cells);
  host.parentElement?.classList.remove('is-complete');
  host.setAttribute('aria-label', `拼豆图案：${pattern.name}`);
  return [...pattern.pixels];
};
