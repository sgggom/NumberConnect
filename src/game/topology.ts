import { BoardShape, type Cell } from './types';

const SQUARE_OFFSETS: ReadonlyArray<Readonly<Cell>> = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: -1, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 },
];

const hexOffsets = (column: number): ReadonlyArray<Readonly<Cell>> => column % 2 === 0
  ? [
      { x: 0, y: -1 }, { x: 0, y: 1 },
      { x: -1, y: -1 }, { x: -1, y: 0 },
      { x: 1, y: -1 }, { x: 1, y: 0 },
    ]
  : [
      { x: 0, y: -1 }, { x: 0, y: 1 },
      { x: -1, y: 0 }, { x: -1, y: 1 },
      { x: 1, y: 0 }, { x: 1, y: 1 },
    ];

export const neighborCells = (cell: Cell, shape: BoardShape): Cell[] =>
  (shape === BoardShape.Hex
    ? hexOffsets(cell.x)
    : SQUARE_OFFSETS)
    .map((offset) => ({ x: cell.x + offset.x, y: cell.y + offset.y }));

export const areNeighborCells = (a: Cell, b: Cell, shape: BoardShape): boolean =>
  neighborCells(a, shape).some((cell) => cell.x === b.x && cell.y === b.y);

export const isWithinCellWindow = (center: Cell, candidate: Cell, radius = 1): boolean =>
  Math.abs(candidate.x - center.x) <= radius
  && Math.abs(candidate.y - center.y) <= radius;

export const projectCell = (cell: Cell, shape: BoardShape): Cell => {
  if (shape === BoardShape.Diamond) {
    return {
      x: (cell.x - cell.y) * 0.70710678,
      y: (cell.x + cell.y) * 0.70710678,
    };
  }
  if (shape === BoardShape.Hex) {
    return {
      x: cell.x * 0.8660254,
      y: cell.y + (cell.x % 2 === 0 ? 0 : 0.5),
    };
  }
  return { ...cell };
};
