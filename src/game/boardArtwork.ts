import type { BoardArtworkInput } from './types';

export interface BoardArtworkSourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const positiveInteger = (value: number): number => Math.max(1, Math.floor(value));

export const boardArtworkSourceRect = (
  imageWidth: number,
  imageHeight: number,
  artwork: BoardArtworkInput,
): BoardArtworkSourceRect => {
  const sourceColumns = positiveInteger(artwork.sourceColumns);
  const sourceRows = positiveInteger(artwork.sourceRows);
  const sourceCount = sourceColumns * sourceRows;
  const sourceIndex = Math.max(0, Math.min(sourceCount - 1, Math.floor(artwork.sourceIndex)));
  const sourceColumn = sourceIndex % sourceColumns;
  const sourceRow = Math.floor(sourceIndex / sourceColumns);
  const left = Math.round(sourceColumn * imageWidth / sourceColumns);
  const right = Math.round((sourceColumn + 1) * imageWidth / sourceColumns);
  const top = Math.round(sourceRow * imageHeight / sourceRows);
  const bottom = Math.round((sourceRow + 1) * imageHeight / sourceRows);
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
};

export const sampleBoardArtworkAverageColors = (
  image: CanvasImageSource,
  source: BoardArtworkSourceRect,
  rows: number,
  columns: number,
  fallbackColor: number,
): readonly number[] => {
  const safeRows = positiveInteger(rows);
  const safeColumns = positiveInteger(columns);
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return Array<number>(safeRows * safeColumns).fill(fallbackColor);
  context.drawImage(
    image,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    source.width,
    source.height,
  );
  const pixels = context.getImageData(0, 0, source.width, source.height).data;
  return Array.from({ length: safeRows * safeColumns }, (_, index) => {
    const cellX = index % safeColumns;
    const cellY = Math.floor(index / safeColumns);
    const left = Math.floor(cellX * source.width / safeColumns);
    const right = Math.max(left + 1, Math.floor((cellX + 1) * source.width / safeColumns));
    const top = Math.floor(cellY * source.height / safeRows);
    const bottom = Math.max(top + 1, Math.floor((cellY + 1) * source.height / safeRows));
    let red = 0;
    let green = 0;
    let blue = 0;
    let weight = 0;
    for (let y = top; y < Math.min(source.height, bottom); y += 1) {
      for (let x = left; x < Math.min(source.width, right); x += 1) {
        const pixelIndex = (y * source.width + x) * 4;
        const alpha = pixels[pixelIndex + 3] / 255;
        red += pixels[pixelIndex] * alpha;
        green += pixels[pixelIndex + 1] * alpha;
        blue += pixels[pixelIndex + 2] * alpha;
        weight += alpha;
      }
    }
    if (weight <= 0) return fallbackColor;
    return (
      Math.round(red / weight) << 16
      | Math.round(green / weight) << 8
      | Math.round(blue / weight)
    );
  });
};
