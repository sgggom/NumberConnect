export interface SquareGridLayoutOptions {
  rows: number;
  columns: number;
  availableWidth: number;
  availableHeight: number;
  columnGap: number;
  rowGap: number;
  maxWidth?: number;
  maxHeight?: number;
}

export interface SquareGridLayout {
  cellSize: number;
  width: number;
  height: number;
}

export const calculateSquareGridLayout = ({
  rows,
  columns,
  availableWidth,
  availableHeight,
  columnGap,
  rowGap,
  maxWidth = Number.POSITIVE_INFINITY,
  maxHeight = Number.POSITIVE_INFINITY,
}: SquareGridLayoutOptions): SquareGridLayout => {
  const safeRows = Math.max(1, rows);
  const safeColumns = Math.max(1, columns);
  const horizontalGaps = Math.max(0, safeColumns - 1) * Math.max(0, columnGap);
  const verticalGaps = Math.max(0, safeRows - 1) * Math.max(0, rowGap);
  const widthLimit = Math.max(0, Math.min(availableWidth, maxWidth));
  const heightLimit = Math.max(0, Math.min(availableHeight, maxHeight));
  const cellSize = Math.max(0, Math.min(
    (widthLimit - horizontalGaps) / safeColumns,
    (heightLimit - verticalGaps) / safeRows,
  ));

  return {
    cellSize,
    width: cellSize * safeColumns + horizontalGaps,
    height: cellSize * safeRows + verticalGaps,
  };
};
