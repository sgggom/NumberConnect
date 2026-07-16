import {
  MAX_EDITOR_SIZE,
  MIN_EDITOR_SIZE,
  type EditorCell,
} from './types';

interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface OcrWordLike {
  text: string;
  confidence: number;
  bbox: OcrBox;
}

interface OcrBlockLike {
  paragraphs: Array<{
    lines: Array<{
      words: OcrWordLike[];
    }>;
  }>;
}

export interface ImageRecognitionProgress {
  phase: 'loading' | 'locating' | 'reading' | 'solving';
  completed: number;
  total: number;
  rows?: number;
  columns?: number;
}

export interface RecognizedImageLevel {
  rows: number;
  columns: number;
  solutionPath: EditorCell[];
  hiddenCells: EditorCell[];
  visibleCount: number;
  recognizedCount: number;
  inferredCount: number;
  scoreGap: number;
}

export interface RecognizedImageHiddenLayout {
  rows: number;
  columns: number;
  hiddenCells: EditorCell[];
  visibleCount: number;
}

export type ImageRecognitionMode = 'complete-level' | 'hidden-layout' | 'initial-formation';
type PathImageRecognitionMode = Exclude<ImageRecognitionMode, 'hidden-layout'>;

export interface GridOcrEvidence {
  value: number;
  confidence: number;
}

interface GridCellOcr {
  x: number;
  y: number;
  centerX: number;
  centerY: number;
  evidence: Map<number, number>;
}

interface GridLayout {
  rows: number;
  columns: number;
  cells: GridCellOcr[];
  horizontalSpacing: number;
  verticalSpacing: number;
}

interface OcrTileResult {
  canvas: HTMLCanvasElement;
  hasVisibleNumber: boolean;
  foregroundAspectRatio: number;
  rawRectangle: { left: number; top: number; width: number; height: number };
}

interface BeamState {
  current: number;
  mask: bigint;
  score: number;
  path: number[];
}

interface SolvedGridPath {
  path: number[];
  score: number;
  scoreGap: number;
}

export interface InitialFormationPathSolution {
  path: number[];
  ambiguous: boolean;
}

type ProgressListener = (progress: ImageRecognitionProgress) => void;

const MIN_GRID_SIZE = MIN_EDITOR_SIZE;
const MAX_GRID_SIZE = MAX_EDITOR_SIZE;
const OCR_CONFIDENCE_FLOOR = 45;
const BEAM_WIDTH = 12000;

let activeWorkerProgress: ProgressListener | undefined;
let workerPromise: Promise<Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>> | undefined;

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) * 0.5
    : sorted[middle];
};

const getWorker = async (onProgress: ProgressListener) => {
  activeWorkerProgress = onProgress;
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then(({ createWorker }) => createWorker('eng', 1, {
      logger: (message) => {
        const status = typeof message.status === 'string' ? message.status : '';
        const progress = typeof message.progress === 'number' ? message.progress : 0;
        if (status.includes('recognizing')) return;
        activeWorkerProgress?.({ phase: 'loading', completed: Math.round(progress * 100), total: 100 });
      },
    })).catch((error) => {
      workerPromise = undefined;
      throw error;
    });
  }
  return workerPromise;
};

const loadImageCanvas = async (blob: Blob): Promise<HTMLCanvasElement> => {
  if (!blob.type.startsWith('image/')) throw new Error('剪贴板内容不是图片。');
  const bitmap = await createImageBitmap(blob);
  const maximumDimension = 1800;
  const scale = Math.min(1, maximumDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error('浏览器无法读取图片像素。');
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
};

const flattenWords = (blocks: OcrBlockLike[] | null | undefined): OcrWordLike[] => (
  blocks ?? []
).flatMap((block) => block.paragraphs)
  .flatMap((paragraph) => paragraph.lines)
  .flatMap((line) => line.words)
  .filter((word) => /^\d{1,3}$/.test(word.text.trim()));

interface CoordinateCluster {
  center: number;
  values: number[];
}

const clusterCoordinates = (values: number[], threshold: number): CoordinateCluster[] => {
  const clusters: CoordinateCluster[] = [];
  [...values].sort((left, right) => left - right).forEach((value) => {
    const cluster = clusters[clusters.length - 1];
    if (!cluster || value - cluster.center > threshold) {
      clusters.push({ center: value, values: [value] });
      return;
    }
    cluster.values.push(value);
    cluster.center = cluster.values.reduce((sum, entry) => sum + entry, 0) / cluster.values.length;
  });
  return clusters;
};

const removeIsolatedClusters = (clusters: CoordinateCluster[]): CoordinateCluster[] => {
  if (clusters.length <= MAX_GRID_SIZE) return clusters;
  const substantial = clusters.filter((cluster) => cluster.values.length >= 2);
  return substantial.length >= MIN_GRID_SIZE ? substantial : clusters;
};

const regularizeAxis = (clusters: CoordinateCluster[]): number[] => {
  const centers = clusters.map((cluster) => cluster.center).sort((left, right) => left - right);
  if (centers.length < 2) return centers;
  const gaps = centers.slice(1).map((center, index) => center - centers[index]);
  const typicalGap = median(gaps.filter((gap) => gap > 0));
  if (typicalGap <= 0) return centers;
  const regularized: number[] = [centers[0]];
  gaps.forEach((gap, index) => {
    const steps = gap > typicalGap * 1.65 ? Math.max(2, Math.round(gap / typicalGap)) : 1;
    for (let step = 1; step <= steps; step += 1) {
      regularized.push(centers[index] + gap * step / steps);
    }
  });
  return regularized;
};

const extendAxisToImageEdges = (axes: number[], extent: number): number[] => {
  if (axes.length < 2) return axes;
  const gap = median(axes.slice(1).map((axis, index) => axis - axes[index]));
  if (gap <= 0) return axes;
  const extended = [...axes];
  while (extended.length < MAX_GRID_SIZE && extended[0] > gap * 0.9) {
    extended.unshift(extended[0] - gap);
  }
  while (extended.length < MAX_GRID_SIZE && extent - extended[extended.length - 1] > gap * 0.9) {
    extended.push(extended[extended.length - 1] + gap);
  }
  return extended;
};

const closestAxisIndex = (axes: number[], value: number): number => axes.reduce(
  (bestIndex, axis, index) => Math.abs(axis - value) < Math.abs(axes[bestIndex] - value) ? index : bestIndex,
  0,
);

const createGridLayout = (
  words: OcrWordLike[],
  imageWidth?: number,
  imageHeight?: number,
): GridLayout => {
  if (words.length < 6) throw new Error('识别到的数字太少，请粘贴清晰、完整且尽量裁紧的关卡图片。');
  const heights = words.map((word) => word.bbox.y1 - word.bbox.y0).filter((height) => height > 0);
  const typicalTextHeight = median(heights);
  if (typicalTextHeight <= 0) throw new Error('无法定位图片中的数字。');
  const xCenters = words.map((word) => (word.bbox.x0 + word.bbox.x1) * 0.5);
  const yCenters = words.map((word) => (word.bbox.y0 + word.bbox.y1) * 0.5);
  const xClusters = removeIsolatedClusters(clusterCoordinates(xCenters, typicalTextHeight * 1.8));
  const yClusters = removeIsolatedClusters(clusterCoordinates(yCenters, typicalTextHeight * 1.9));
  const regularXAxes = regularizeAxis(xClusters);
  const regularYAxes = regularizeAxis(yClusters);
  const xAxes = imageWidth === undefined ? regularXAxes : extendAxisToImageEdges(regularXAxes, imageWidth);
  const yAxes = imageHeight === undefined ? regularYAxes : extendAxisToImageEdges(regularYAxes, imageHeight);
  if (
    xAxes.length < MIN_GRID_SIZE
    || xAxes.length > MAX_GRID_SIZE
    || yAxes.length < MIN_GRID_SIZE
    || yAxes.length > MAX_GRID_SIZE
  ) {
    throw new Error(`无法确定棋盘尺寸（暂时识别为 ${xAxes.length}×${yAxes.length}），请只截取规则的数字棋盘。`);
  }

  const cells = Array.from({ length: xAxes.length * yAxes.length }, (_, index): GridCellOcr => {
    const x = index % xAxes.length;
    const y = Math.floor(index / xAxes.length);
    return { x, y, centerX: xAxes[x], centerY: yAxes[y], evidence: new Map() };
  });
  const cellWords = new Map<number, OcrWordLike[]>();
  words.forEach((word) => {
    const centerX = (word.bbox.x0 + word.bbox.x1) * 0.5;
    const centerY = (word.bbox.y0 + word.bbox.y1) * 0.5;
    const x = closestAxisIndex(xAxes, centerX);
    const y = closestAxisIndex(yAxes, centerY);
    const index = y * xAxes.length + x;
    const value = Number(word.text.trim());
    const cell = cells[index];
    if (value >= 1 && value <= cells.length) {
      cell.evidence.set(value, Math.max(cell.evidence.get(value) ?? 0, word.confidence));
    }
    const entries = cellWords.get(index) ?? [];
    entries.push(word);
    cellWords.set(index, entries);
  });
  cellWords.forEach((entries, index) => {
    const trusted = entries.filter((word) => word.confidence >= 20);
    if (trusted.length === 0) return;
    cells[index].centerX = trusted.reduce((sum, word) => sum + (word.bbox.x0 + word.bbox.x1) * 0.5, 0) / trusted.length;
    cells[index].centerY = trusted.reduce((sum, word) => sum + (word.bbox.y0 + word.bbox.y1) * 0.5, 0) / trusted.length;
  });

  const horizontalSpacing = median(xAxes.slice(1).map((axis, index) => axis - xAxes[index]));
  const verticalSpacing = median(yAxes.slice(1).map((axis, index) => axis - yAxes[index]));
  return {
    rows: yAxes.length,
    columns: xAxes.length,
    cells,
    horizontalSpacing,
    verticalSpacing,
  };
};

const dominantColor = (data: Uint8ClampedArray): [number, number, number] => {
  const buckets = new Map<number, { count: number; red: number; green: number; blue: number }>();
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const key = (red >> 3) << 10 | (green >> 3) << 5 | blue >> 3;
    const bucket = buckets.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
    bucket.count += 1;
    bucket.red += red;
    bucket.green += green;
    bucket.blue += blue;
    buckets.set(key, bucket);
  }
  const winner = [...buckets.values()].sort((left, right) => right.count - left.count)[0];
  return [winner.red / winner.count, winner.green / winner.count, winner.blue / winner.count];
};

const removeDecorationLines = (pixels: Uint8ClampedArray, width: number, height: number): void => {
  for (let y = Math.floor(height * 0.58); y < height; y += 1) {
    let longestRun = 0;
    let currentRun = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (pixels[offset] === 0) {
        currentRun += 1;
        longestRun = Math.max(longestRun, currentRun);
      } else {
        currentRun = 0;
      }
    }
    if (longestRun < width * 0.43) continue;
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
    }
  }
};

const createOcrTile = (
  source: HTMLCanvasElement,
  cell: GridCellOcr,
  horizontalSpacing: number,
  verticalSpacing: number,
): OcrTileResult => {
  const cropWidth = Math.max(22, Math.round(horizontalSpacing * 0.61));
  const cropHeight = Math.max(20, Math.round(verticalSpacing * 0.5));
  const left = Math.max(0, Math.min(source.width - cropWidth, Math.round(cell.centerX - cropWidth * 0.5)));
  const top = Math.max(0, Math.min(source.height - cropHeight, Math.round(cell.centerY - cropHeight * 0.5)));
  const sourceContext = source.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) throw new Error('浏览器无法处理图片。');
  const image = sourceContext.getImageData(left, top, cropWidth, cropHeight);
  const [backgroundRed, backgroundGreen, backgroundBlue] = dominantColor(image.data);
  for (let index = 0; index < image.data.length; index += 4) {
    const redDistance = image.data[index] - backgroundRed;
    const greenDistance = image.data[index + 1] - backgroundGreen;
    const blueDistance = image.data[index + 2] - backgroundBlue;
    const distance = Math.hypot(redDistance, greenDistance, blueDistance);
    const value = distance > 48 ? 0 : 255;
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
    image.data[index + 3] = 255;
  }
  removeDecorationLines(image.data, cropWidth, cropHeight);
  let foregroundPixels = 0;
  let minimumX = cropWidth;
  let maximumX = -1;
  let minimumY = cropHeight;
  let maximumY = -1;
  for (let index = 0; index < image.data.length; index += 4) {
    if (image.data[index] !== 0) continue;
    foregroundPixels += 1;
    const pixelIndex = index / 4;
    const x = pixelIndex % cropWidth;
    const y = Math.floor(pixelIndex / cropWidth);
    minimumX = Math.min(minimumX, x);
    maximumX = Math.max(maximumX, x);
    minimumY = Math.min(minimumY, y);
    maximumY = Math.max(maximumY, y);
  }

  const scale = 3;
  const padding = 12;
  const tile = document.createElement('canvas');
  tile.width = cropWidth * scale + padding * 2;
  tile.height = cropHeight * scale + padding * 2;
  const tileContext = tile.getContext('2d');
  if (!tileContext) throw new Error('浏览器无法创建 OCR 画布。');
  tileContext.fillStyle = '#fff';
  tileContext.fillRect(0, 0, tile.width, tile.height);
  const cleaned = document.createElement('canvas');
  cleaned.width = cropWidth;
  cleaned.height = cropHeight;
  cleaned.getContext('2d')?.putImageData(image, 0, 0);
  tileContext.imageSmoothingEnabled = false;
  tileContext.drawImage(cleaned, padding, padding, cropWidth * scale, cropHeight * scale);
  const foregroundWidth = Math.max(0, maximumX - minimumX + 1);
  const foregroundHeight = Math.max(1, maximumY - minimumY + 1);
  const rawWidth = Math.max(cropWidth, Math.round(horizontalSpacing * 0.72));
  const rawHeight = Math.max(cropHeight, Math.round(verticalSpacing * 0.64));
  return {
    canvas: tile,
    hasVisibleNumber: foregroundPixels >= Math.max(16, cropWidth * 0.5),
    foregroundAspectRatio: foregroundWidth / foregroundHeight,
    rawRectangle: {
      left: Math.max(0, Math.min(source.width - rawWidth, Math.round(cell.centerX - rawWidth * 0.5))),
      top: Math.max(0, Math.min(source.height - rawHeight, Math.round(cell.centerY - rawHeight * 0.5))),
      width: rawWidth,
      height: rawHeight,
    },
  };
};

const neighborIndexes = (index: number, rows: number, columns: number): number[] => {
  const x = index % columns;
  const y = Math.floor(index / columns);
  const neighbors: number[] = [];
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue;
      const nextX = x + offsetX;
      const nextY = y + offsetY;
      if (nextX >= 0 && nextX < columns && nextY >= 0 && nextY < rows) {
        neighbors.push(nextY * columns + nextX);
      }
    }
  }
  return neighbors;
};

interface FormationIntervalCandidate {
  path: number[];
  intermediateMask: bigint;
}

interface FormationInterval {
  candidates: FormationIntervalCandidate[];
}

const gridDistance = (left: number, right: number, columns: number): number => {
  const leftX = left % columns;
  const leftY = Math.floor(left / columns);
  const rightX = right % columns;
  const rightY = Math.floor(right / columns);
  return Math.max(Math.abs(leftX - rightX), Math.abs(leftY - rightY));
};

const enumerateFormationInterval = (
  startCell: number,
  endCell: number,
  requiredSteps: number,
  adjacency: ReadonlyArray<ReadonlyArray<number>>,
  anchorCells: ReadonlySet<number>,
  columns: number,
): FormationIntervalCandidate[] => {
  const candidates: FormationIntervalCandidate[] = [];
  const path = [startCell];
  const visited = new Set([startCell]);
  const maximumCandidates = 100000;

  const search = (current: number, stepsTaken: number, mask: bigint): void => {
    if (candidates.length >= maximumCandidates) return;
    const stepsRemaining = requiredSteps - stepsTaken;
    if (gridDistance(current, endCell, columns) > stepsRemaining) return;
    if (stepsRemaining === 0) {
      if (current === endCell) candidates.push({ path: [...path], intermediateMask: mask });
      return;
    }

    const finalStep = stepsRemaining === 1;
    for (const next of adjacency[current]) {
      if (visited.has(next)) continue;
      if (finalStep ? next !== endCell : next === endCell || anchorCells.has(next)) continue;
      if (gridDistance(next, endCell, columns) > stepsRemaining - 1) continue;
      visited.add(next);
      path.push(next);
      search(
        next,
        stepsTaken + 1,
        finalStep ? mask : mask | (1n << BigInt(next)),
      );
      path.pop();
      visited.delete(next);
    }
  };

  search(startCell, 0, 0n);
  return candidates;
};

export const solveInitialFormationPath = (
  rows: number,
  columns: number,
  clueCellByValue: ReadonlyMap<number, number>,
): InitialFormationPathSolution | null => {
  const total = rows * columns;
  if (total === 0 || !clueCellByValue.has(1) || !clueCellByValue.has(total)) return null;
  const clues = [...clueCellByValue]
    .filter(([value, cell]) => value >= 1 && value <= total && cell >= 0 && cell < total)
    .sort(([left], [right]) => left - right);
  if (clues.length !== clueCellByValue.size || new Set(clues.map(([, cell]) => cell)).size !== clues.length) return null;

  const adjacency = Array.from({ length: total }, (_, index) => neighborIndexes(index, rows, columns));
  const anchorCells = new Set(clues.map(([, cell]) => cell));
  const intervals: FormationInterval[] = [];
  for (let index = 0; index < clues.length - 1; index += 1) {
    const [startValue, startCell] = clues[index];
    const [endValue, endCell] = clues[index + 1];
    const candidates = enumerateFormationInterval(
      startCell,
      endCell,
      endValue - startValue,
      adjacency,
      anchorCells,
      columns,
    );
    if (candidates.length === 0) return null;
    intervals.push({ candidates });
  }

  let nonAnchorUniverse = 0n;
  for (let index = 0; index < total; index += 1) {
    if (!anchorCells.has(index)) nonAnchorUniverse |= 1n << BigInt(index);
  }
  const selected: Array<FormationIntervalCandidate | undefined> = Array(intervals.length);
  const searchOrder = intervals.map((_, index) => index)
    .sort((left, right) => intervals[left].candidates.length - intervals[right].candidates.length);
  const solutions: number[][] = [];

  const combine = (orderIndex: number, usedMask: bigint): void => {
    if (solutions.length >= 2) return;
    if (orderIndex === searchOrder.length) {
      if (usedMask !== nonAnchorUniverse) return;
      const path = [selected[0]!.path[0]];
      selected.forEach((candidate) => path.push(...candidate!.path.slice(1)));
      solutions.push(path);
      return;
    }
    const intervalIndex = searchOrder[orderIndex];
    for (const candidate of intervals[intervalIndex].candidates) {
      if ((candidate.intermediateMask & usedMask) !== 0n) continue;
      selected[intervalIndex] = candidate;
      combine(orderIndex + 1, usedMask | candidate.intermediateMask);
      selected[intervalIndex] = undefined;
      if (solutions.length >= 2) return;
    }
  };

  combine(0, 0n);
  return solutions.length === 0 ? null : { path: solutions[0], ambiguous: solutions.length > 1 };
};

const evidenceScore = (evidence: ReadonlyMap<number, number>, value: number): number => {
  const exact = evidence.get(value) ?? 0;
  const strongest = Math.max(0, ...evidence.values());
  if (exact > 0) return exact * 1.6;
  return strongest > 0 ? -strongest * 0.65 : 0;
};

export const solveRecognizedGridPath = (
  rows: number,
  columns: number,
  cellEvidence: ReadonlyArray<ReadonlyArray<GridOcrEvidence>>,
  beamWidth = BEAM_WIDTH,
): SolvedGridPath | null => {
  const total = rows * columns;
  if (cellEvidence.length !== total || total === 0) return null;
  const evidenceMaps = cellEvidence.map((entries) => {
    const map = new Map<number, number>();
    entries.forEach(({ value, confidence }) => {
      if (value >= 1 && value <= total) map.set(value, Math.max(map.get(value) ?? 0, confidence));
    });
    return map;
  });
  const neighbors = Array.from({ length: total }, (_, index) => neighborIndexes(index, rows, columns));
  let beam: BeamState[] = Array.from({ length: total }, (_, index) => ({
    current: index,
    mask: 1n << BigInt(index),
    score: evidenceScore(evidenceMaps[index], 1),
    path: [index],
  })).sort((left, right) => right.score - left.score).slice(0, beamWidth);

  for (let value = 2; value <= total; value += 1) {
    const nextBeam: BeamState[] = [];
    beam.forEach((state) => {
      neighbors[state.current].forEach((next) => {
        const bit = 1n << BigInt(next);
        if ((state.mask & bit) !== 0n) return;
        nextBeam.push({
          current: next,
          mask: state.mask | bit,
          score: state.score + evidenceScore(evidenceMaps[next], value),
          path: [...state.path, next],
        });
      });
    });
    if (nextBeam.length === 0) return null;
    nextBeam.sort((left, right) => right.score - left.score);
    beam = nextBeam.slice(0, beamWidth);
  }

  const best = beam[0];
  const runnerUp = beam.find((state) => state.path.some((cell, index) => cell !== best.path[index]));
  return {
    path: best.path,
    score: best.score,
    scoreGap: runnerUp ? best.score - runnerUp.score : Number.POSITIVE_INFINITY,
  };
};

const evidenceArrays = (cells: GridCellOcr[]): GridOcrEvidence[][] => cells.map((cell) => (
  [...cell.evidence].map(([value, confidence]) => ({ value, confidence }))
));

const formationClues = (
  cells: ReadonlyArray<GridCellOcr>,
  visibleCellIndexes: ReadonlySet<number>,
  columns: number,
): Map<number, number> => {
  interface FormationClueCandidate {
    cellIndex: number;
    value: number;
    confidence: number;
  }
  const substitutions: Readonly<Record<string, ReadonlyArray<string>>> = {
    '2': ['3', '8'],
    '3': ['2', '8'],
    '6': ['8'],
    '8': ['2', '3', '6', '9'],
    '9': ['8'],
  };
  const exactCandidates = cells.flatMap((cell, cellIndex): FormationClueCandidate[] => {
    if (!visibleCellIndexes.has(cellIndex)) return [];
    return [...cell.evidence].map(([value, confidence]) => ({ cellIndex, value, confidence }));
  }).filter((candidate) => candidate.confidence >= 30);
  const candidates = [...exactCandidates];
  exactCandidates.forEach((candidate) => {
    const digits = String(candidate.value).split('');
    digits.forEach((digit, digitIndex) => {
      substitutions[digit]?.forEach((replacement) => {
        const variantDigits = [...digits];
        variantDigits[digitIndex] = replacement;
        const value = Number(variantDigits.join(''));
        if (value < 1 || value > cells.length) return;
        candidates.push({
          cellIndex: candidate.cellIndex,
          value,
          confidence: Math.max(30, candidate.confidence - 24),
        });
      });
    });
  });
  candidates.sort((left, right) => right.confidence - left.confidence);
  const optionsByCell = new Map<number, FormationClueCandidate[]>();
  candidates.forEach((candidate) => {
    const options = optionsByCell.get(candidate.cellIndex) ?? [];
    const duplicate = options.find((option) => option.value === candidate.value);
    if (!duplicate) options.push(candidate);
    else duplicate.confidence = Math.max(duplicate.confidence, candidate.confidence);
    optionsByCell.set(candidate.cellIndex, options);
  });
  optionsByCell.forEach((options) => options.sort((left, right) => right.confidence - left.confidence));

  const usedCells = new Set<number>();
  const usedValues = new Set<number>();
  const selectedByCell = new Map<number, FormationClueCandidate>();
  candidates.forEach((candidate) => {
    if (usedCells.has(candidate.cellIndex) || usedValues.has(candidate.value)) return;
    usedCells.add(candidate.cellIndex);
    usedValues.add(candidate.value);
    selectedByCell.set(candidate.cellIndex, candidate);
  });

  const violationCount = (assignments: ReadonlyArray<FormationClueCandidate>): number => {
    const sorted = [...assignments].sort((left, right) => left.value - right.value);
    return sorted.slice(1).reduce((count, current, index) => (
      gridDistance(sorted[index].cellIndex, current.cellIndex, columns) > current.value - sorted[index].value
        ? count + 1
        : count
    ), 0);
  };
  for (let guard = 0; guard < 12; guard += 1) {
    const selected = [...selectedByCell.values()];
    const currentViolations = violationCount(selected);
    if (currentViolations === 0) break;
    let bestReplacement: FormationClueCandidate | undefined;
    let bestViolations = currentViolations;
    selected.forEach((current) => {
      optionsByCell.get(current.cellIndex)?.forEach((option) => {
        if (option.value === current.value) return;
        if (selected.some((assignment) => assignment.cellIndex !== current.cellIndex && assignment.value === option.value)) return;
        const next = selected.map((assignment) => assignment.cellIndex === current.cellIndex ? option : assignment);
        const violations = violationCount(next);
        if (
          violations < bestViolations
          || violations === bestViolations && option.confidence > (bestReplacement?.confidence ?? -1)
        ) {
          bestViolations = violations;
          bestReplacement = option;
        }
      });
    });
    if (!bestReplacement || bestViolations >= currentViolations) break;
    selectedByCell.set(bestReplacement.cellIndex, bestReplacement);
  }

  const result = new Map<number, number>();
  selectedByCell.forEach((candidate) => result.set(candidate.value, candidate.cellIndex));
  return result;
};

const locateImageGrid = async (
  blob: Blob,
  extendToImageEdges: boolean,
  onProgress: ProgressListener,
) => {
  onProgress({ phase: 'loading', completed: 0, total: 100 });
  const [source, worker, tesseract] = await Promise.all([
    loadImageCanvas(blob),
    getWorker(onProgress),
    import('tesseract.js'),
  ]);

  onProgress({ phase: 'locating', completed: 0, total: 1 });
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789',
    tessedit_pageseg_mode: tesseract.PSM.SPARSE_TEXT,
  });
  const rawResult = await worker.recognize(source, {}, { blocks: true });
  const words = flattenWords(rawResult.data.blocks as OcrBlockLike[] | null);
  const layout = createGridLayout(
    words,
    extendToImageEdges ? source.width : undefined,
    extendToImageEdges ? source.height : undefined,
  );
  onProgress({
    phase: 'locating',
    completed: 1,
    total: 1,
    rows: layout.rows,
    columns: layout.columns,
  });

  const tiles = layout.cells.map((cell) => createOcrTile(
    source,
    cell,
    layout.horizontalSpacing,
    layout.verticalSpacing,
  ));
  const visibleCellIndexes = new Set<number>();
  tiles.forEach((tile, index) => {
    if (tile.hasVisibleNumber) visibleCellIndexes.add(index);
  });
  return { source, worker, tesseract, layout, tiles, visibleCellIndexes };
};

export const recognizeImageHiddenLayout = async (
  blob: Blob,
  onProgress: ProgressListener = () => undefined,
): Promise<RecognizedImageHiddenLayout> => {
  const { layout, visibleCellIndexes } = await locateImageGrid(blob, true, onProgress);
  const cellCount = layout.cells.length;
  onProgress({ phase: 'reading', completed: cellCount, total: cellCount });
  if (visibleCellIndexes.size < 2 || visibleCellIndexes.size >= cellCount) {
    throw new Error('没有检测到有效空位，请确认图片中同时包含显示数字和空白圆格。');
  }
  const hiddenCellIndexes = Array.from({ length: cellCount }, (_, index) => index)
    .filter((index) => !visibleCellIndexes.has(index));
  onProgress({ phase: 'solving', completed: 1, total: 1 });
  return {
    rows: layout.rows,
    columns: layout.columns,
    hiddenCells: hiddenCellIndexes.map((cellIndex) => ({
      x: cellIndex % layout.columns,
      y: Math.floor(cellIndex / layout.columns),
    })),
    visibleCount: visibleCellIndexes.size,
  };
};

export const recognizeImageLevel = async (
  blob: Blob,
  mode: PathImageRecognitionMode = 'complete-level',
  onProgress: ProgressListener = () => undefined,
): Promise<RecognizedImageLevel> => {
  const {
    source,
    worker,
    tesseract,
    layout,
    tiles,
    visibleCellIndexes,
  } = await locateImageGrid(blob, true, onProgress);
  const processedIndexes = mode === 'initial-formation'
    ? [...visibleCellIndexes]
    : layout.cells.map((_, index) => index);
  const readingTotal = processedIndexes.length + (mode === 'initial-formation' ? visibleCellIndexes.size : 0);
  let readingCompleted = 0;
  const recordEvidence = (cellIndex: number, value: number, confidence: number): void => {
    if (value < 1 || value > layout.cells.length) return;
    const previous = layout.cells[cellIndex].evidence.get(value) ?? 0;
    layout.cells[cellIndex].evidence.set(value, Math.max(previous, confidence));
  };

  await worker.setParameters({
    tessedit_char_whitelist: '0123456789',
    tessedit_pageseg_mode: mode === 'initial-formation'
      ? tesseract.PSM.SINGLE_LINE
      : tesseract.PSM.SINGLE_WORD,
  });
  for (const index of processedIndexes) {
    onProgress({ phase: 'reading', completed: readingCompleted, total: readingTotal });
    const tile = tiles[index];
    const result = await worker.recognize(tile.canvas);
    const value = Number(result.data.text.replace(/\D/g, ''));
    recordEvidence(index, value, result.data.confidence);
    if (mode === 'initial-formation' && value === 1 && tile.foregroundAspectRatio >= 0.82) {
      recordEvidence(index, 11, Math.max(75, result.data.confidence));
    }
    readingCompleted += 1;
  }
  if (mode === 'initial-formation') {
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789',
      tessedit_pageseg_mode: tesseract.PSM.SINGLE_WORD,
    });
    for (const index of visibleCellIndexes) {
      onProgress({ phase: 'reading', completed: readingCompleted, total: readingTotal });
      const result = await worker.recognize(source, { rectangle: tiles[index].rawRectangle });
      recordEvidence(index, Number(result.data.text.replace(/\D/g, '')), result.data.confidence);
      readingCompleted += 1;
    }
  }
  onProgress({ phase: 'reading', completed: readingTotal, total: readingTotal });
  onProgress({ phase: 'solving', completed: 0, total: 1 });
  let solvedPath: number[];
  let scoreGap: number;
  if (mode === 'initial-formation') {
    if (visibleCellIndexes.size < 2 || visibleCellIndexes.size >= layout.cells.length) {
      throw new Error('没有检测到有效的初始阵型空白格，请确认图片中同时包含显示数字和空白圆格。');
    }
    const clues = formationClues(layout.cells, visibleCellIndexes, layout.columns);
    if (!clues.has(1) || !clues.has(layout.cells.length)) {
      throw new Error(`初始阵型必须清晰显示数字 1 和 ${layout.cells.length}。`);
    }
    const solved = solveInitialFormationPath(layout.rows, layout.columns, clues);
    if (!solved) throw new Error('已显示的数字无法组成覆盖全部格子的连续路径，请使用更清晰的初始阵型图片。');
    solvedPath = solved.path;
    scoreGap = solved.ambiguous ? 0 : Number.POSITIVE_INFINITY;
  } else {
    const solved = solveRecognizedGridPath(layout.rows, layout.columns, evidenceArrays(layout.cells));
    if (!solved) throw new Error('数字之间无法组成一条覆盖全部格子的连续路径。');
    solvedPath = solved.path;
    scoreGap = solved.scoreGap;
  }

  const recognizedCount = solvedPath.reduce((count, cellIndex, pathIndex) => (
    (layout.cells[cellIndex].evidence.get(pathIndex + 1) ?? 0) >= OCR_CONFIDENCE_FLOOR ? count + 1 : count
  ), 0);
  const minimumRecognized = Math.ceil(
    (mode === 'initial-formation' ? visibleCellIndexes.size : layout.cells.length) * 0.65,
  );
  if (recognizedCount < minimumRecognized) {
    const expected = mode === 'initial-formation' ? visibleCellIndexes.size : layout.cells.length;
    throw new Error(`只可靠识别出 ${recognizedCount}/${expected} 个显示数字，请粘贴更清晰的图片。`);
  }
  if (mode === 'complete-level' && Number.isFinite(scoreGap) && scoreGap < 5) {
    throw new Error('图片中有多种可能的数字路径，请换用更清晰或裁剪更紧的图片。');
  }

  onProgress({ phase: 'solving', completed: 1, total: 1 });
  const hiddenCellIndexes = mode === 'initial-formation'
    ? Array.from({ length: layout.cells.length }, (_, index) => index)
      .filter((index) => !visibleCellIndexes.has(index))
    : [];
  return {
    rows: layout.rows,
    columns: layout.columns,
    solutionPath: solvedPath.map((cellIndex) => ({
      x: cellIndex % layout.columns,
      y: Math.floor(cellIndex / layout.columns),
    })),
    hiddenCells: hiddenCellIndexes.map((cellIndex) => ({
      x: cellIndex % layout.columns,
      y: Math.floor(cellIndex / layout.columns),
    })),
    visibleCount: mode === 'initial-formation' ? visibleCellIndexes.size : layout.cells.length,
    recognizedCount,
    inferredCount: layout.cells.length - recognizedCount,
    scoreGap,
  };
};
