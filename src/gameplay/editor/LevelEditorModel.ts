import { BoardShape, type LevelData } from '../../game/types';
import {
  DEFAULT_EDITOR_ALGORITHM_ID,
  createEditorAlgorithm,
  normalizeEditorAlgorithm,
  resolveEditorAlgorithmForShape,
  runEditorAlgorithm,
  serializeEditorAlgorithm,
  type EditorAlgorithmId,
  type EditorAlgorithmSelection,
} from './algorithms';
import { areEditorCellsNeighbors } from './findEditorPath';
import type { EditorCell, EditorShape, EditorSize, ManualEditMode } from './types';

const RECTANGLE_SIZES: ReadonlyArray<Readonly<EditorCell>> = [
  { x: 3, y: 5 },
  { x: 4, y: 6 },
  { x: 5, y: 8 },
  { x: 6, y: 10 },
  { x: 7, y: 12 },
];

const BACKGROUNDS = ['apple', 'banana', 'orange', 'grapes', 'basket', 'pineapple'] as const;
const wrap = (value: number, min: number, max: number): number => value < min ? max : value > max ? min : value;
const keyOf = (cell: EditorCell): string => `${cell.x},${cell.y}`;
const createGenerationSeed = (): number => {
  if (globalThis.crypto?.getRandomValues) {
    const value = new Uint32Array(1);
    globalThis.crypto.getRandomValues(value);
    return value[0];
  }
  return Math.floor(Math.random() * 0x100000000) >>> 0;
};

interface DeletionUndoSnapshot {
  paintedCells: string[];
  path: EditorCell[];
  hiddenCells: string[];
  manualHiddenConfigured: boolean;
  manualMode: ManualEditMode;
  pathSource: 'generated' | 'manual';
  generationCount: number;
  targetHiddenCount?: number;
}

export class LevelEditorModel {
  private currentShape: EditorShape = 'square';
  private squareSize = 8;
  private diamondSize = 6;
  private hexSize = 6;
  private rectangleIndex = 2;
  private readonly paintedCells = new Set<string>();
  private path: EditorCell[] = [];
  private algorithm: EditorAlgorithmSelection = createEditorAlgorithm(DEFAULT_EDITOR_ALGORITHM_ID);
  private generationCount = 0;
  private manualMode: ManualEditMode = 'off';
  private readonly manualHiddenCells = new Set<string>();
  private manualHiddenConfigured = false;
  private pathSource: 'generated' | 'manual' = 'generated';
  private generatedTargetHiddenCount?: number;
  private deletionUndo?: DeletionUndoSnapshot;

  public get shape(): EditorShape { return this.currentShape; }
  public get activeCells(): ReadonlySet<string> { return this.paintedCells; }
  public get solutionPath(): ReadonlyArray<EditorCell> { return this.path; }
  public get hasGeneratedPath(): boolean { return this.path.length > 0 && this.path.length === this.paintedCells.size; }
  public get algorithmSelection(): EditorAlgorithmSelection { return this.algorithm; }
  public get pathGenerationCount(): number { return this.generationCount; }
  public get manualEditMode(): ManualEditMode { return this.manualMode; }
  public get hiddenCellKeys(): ReadonlySet<string> { return this.manualHiddenCells; }
  public get targetHiddenCount(): number | undefined { return this.generatedTargetHiddenCount; }
  public get canUndoDeletion(): boolean { return this.deletionUndo !== undefined; }

  public reset(): void {
    this.deletionUndo = undefined;
    this.paintedCells.clear();
    this.path = [];
    this.generationCount = 0;
    this.manualMode = 'off';
    this.manualHiddenCells.clear();
    this.manualHiddenConfigured = false;
    this.pathSource = 'generated';
    this.generatedTargetHiddenCount = undefined;
  }

  public clear(): void {
    this.deletionUndo = undefined;
    this.paintedCells.clear();
    this.path = [];
    this.generationCount = 0;
    this.manualHiddenCells.clear();
    this.manualHiddenConfigured = this.manualMode === 'hidden';
    this.generatedTargetHiddenCount = undefined;
  }

  public fill(): void {
    const { rows, columns } = this.size();
    this.paintedCells.clear();
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        if (this.isAvailableCell(x, y)) this.paintedCells.add(`${x},${y}`);
      }
    }
    this.invalidatePath();
  }

  public applyLevel(level: LevelData): void {
    this.deletionUndo = undefined;
    if (level.boardShape === BoardShape.Diamond) {
      this.currentShape = 'diamond';
      this.diamondSize = Math.max(level.rows, level.columns);
    } else if (level.boardShape === BoardShape.Rectangle) {
      this.currentShape = 'rectangle';
      const exactIndex = RECTANGLE_SIZES.findIndex((size) => size.x === level.columns && size.y === level.rows);
      this.rectangleIndex = exactIndex >= 0 ? exactIndex : 0;
    } else if (level.boardShape === BoardShape.Hex) {
      this.currentShape = 'hex';
      this.hexSize = Math.max(level.rows, level.columns);
    } else {
      this.currentShape = 'square';
      this.squareSize = Math.max(level.rows, level.columns);
    }

    this.paintedCells.clear();
    level.activeCells.forEach((cell) => this.paintedCells.add(keyOf(cell)));
    this.path = level.solutionPath.map((cell) => ({ ...cell }));
    this.manualHiddenCells.clear();
    level.hiddenCells?.forEach((cell) => this.manualHiddenCells.add(keyOf(cell)));
    this.manualHiddenConfigured = Array.isArray(level.hiddenCells);
    this.manualMode = 'off';
    this.pathSource = level.pathSource === 'manual' ? 'manual' : 'generated';
    this.generatedTargetHiddenCount = level.hiddenCells?.length;
    this.algorithm = normalizeEditorAlgorithm(level.algorithm);
    this.generationCount = 0;
    this.trimCells();
  }

  public setAlgorithm(id: EditorAlgorithmId): void {
    this.algorithm = createEditorAlgorithm(id);
    this.invalidatePath();
  }

  public setAlgorithmSelection(selection: EditorAlgorithmSelection): void {
    this.algorithm = selection;
    this.invalidatePath();
  }

  public setManualEditMode(mode: ManualEditMode): void {
    if (mode === this.manualMode) return;
    this.deletionUndo = undefined;
    this.manualMode = mode;
    if (mode === 'path') {
      this.path = [];
      this.generationCount = 0;
      this.manualHiddenCells.clear();
      this.manualHiddenConfigured = false;
      this.pathSource = 'manual';
      this.generatedTargetHiddenCount = undefined;
    } else if (mode === 'hidden') {
      this.manualHiddenConfigured = true;
    }
  }

  public setShape(shape: EditorShape): void {
    this.currentShape = shape;
    this.trimCells();
    this.invalidatePath();
  }

  public size(): EditorSize {
    if (this.currentShape === 'rectangle') {
      const size = RECTANGLE_SIZES[this.rectangleIndex];
      return { rows: size.y, columns: size.x };
    }
    const size = this.currentShape === 'diamond'
      ? this.diamondSize
      : this.currentShape === 'hex'
        ? this.hexSize
        : this.squareSize;
    return { rows: size, columns: size };
  }

  public changeSize(direction: number): void {
    if (this.currentShape === 'rectangle') {
      this.rectangleIndex = wrap(this.rectangleIndex + direction, 0, RECTANGLE_SIZES.length - 1);
    } else if (this.currentShape === 'diamond') {
      this.diamondSize = wrap(this.diamondSize + direction, 3, 8);
    } else if (this.currentShape === 'hex') {
      this.hexSize = wrap(this.hexSize + direction, 3, 10);
    } else {
      this.squareSize = wrap(this.squareSize + direction, 3, 10);
    }
    this.trimCells();
    this.invalidatePath();
  }

  public shouldPaintCell(key: string): boolean {
    return !this.paintedCells.has(key);
  }

  public isAvailableCell(_x: number, _y: number): boolean {
    return true;
  }

  public paintCell(key: string, active: boolean): void {
    const [x, y] = key.split(',').map(Number);
    if (!this.isAvailableCell(x, y)) return;
    if (active) this.paintedCells.add(key);
    else this.paintedCells.delete(key);
    this.invalidatePath();
  }

  public appendManualPathCell(key: string): string | null {
    const [x, y] = key.split(',').map(Number);
    const cell = { x, y };
    if (!this.isAvailableCell(x, y)) return '该格子不可用。';
    if (this.path.some((pathCell) => keyOf(pathCell) === key)) return '该格子已经经过，手动路径不能重复绘制。';
    const previous = this.path[this.path.length - 1];
    if (previous && !areEditorCellsNeighbors(previous, cell, this.currentShape)) {
      return '下一个格子必须与当前路径末端相邻。';
    }
    this.deletionUndo = undefined;
    this.paintedCells.add(key);
    this.path.push(cell);
    this.pathSource = 'manual';
    this.generationCount = 0;
    return null;
  }

  public toggleManualHiddenCell(key: string): string | null {
    const index = this.path.findIndex((cell) => keyOf(cell) === key);
    if (index < 0) return '只能将路径中的格子设为隐藏。';
    if (index === 0 || index === this.path.length - 1) return '路径起点和终点必须保持显示。';
    this.deletionUndo = undefined;
    this.manualHiddenConfigured = true;
    this.generatedTargetHiddenCount = undefined;
    if (this.manualHiddenCells.has(key)) this.manualHiddenCells.delete(key);
    else this.manualHiddenCells.add(key);
    return null;
  }

  public removeManualHiddenCell(key: string): boolean {
    if (!this.manualHiddenCells.has(key)) return false;
    this.deletionUndo = undefined;
    this.manualHiddenCells.delete(key);
    this.manualHiddenConfigured = true;
    this.generatedTargetHiddenCount = undefined;
    return true;
  }

  public truncatePathAfter(key: string): number | null {
    const index = this.path.findIndex((cell) => keyOf(cell) === key);
    if (index < 0) return null;
    const removedCount = this.path.length - index - 1;
    if (removedCount <= 0) return 0;
    this.deletionUndo = {
      paintedCells: [...this.paintedCells],
      path: this.path.map((cell) => ({ ...cell })),
      hiddenCells: [...this.manualHiddenCells],
      manualHiddenConfigured: this.manualHiddenConfigured,
      manualMode: this.manualMode,
      pathSource: this.pathSource,
      generationCount: this.generationCount,
      targetHiddenCount: this.generatedTargetHiddenCount,
    };
    const removedCells = this.path.slice(index + 1);
    removedCells.forEach((cell) => this.paintedCells.delete(keyOf(cell)));
    this.path = this.path.slice(0, index + 1);
    this.manualMode = 'path';
    this.pathSource = 'manual';
    this.generationCount = 0;
    this.manualHiddenCells.clear();
    this.manualHiddenConfigured = false;
    this.generatedTargetHiddenCount = undefined;
    return removedCount;
  }

  public undoLastDeletion(): number {
    const snapshot = this.deletionUndo;
    if (!snapshot) return 0;
    const restoredCount = Math.max(0, snapshot.path.length - this.path.length);
    this.paintedCells.clear();
    snapshot.paintedCells.forEach((key) => this.paintedCells.add(key));
    this.path = snapshot.path.map((cell) => ({ ...cell }));
    this.manualHiddenCells.clear();
    snapshot.hiddenCells.forEach((key) => this.manualHiddenCells.add(key));
    this.manualHiddenConfigured = snapshot.manualHiddenConfigured;
    this.manualMode = snapshot.manualMode;
    this.pathSource = snapshot.pathSource;
    this.generationCount = snapshot.generationCount;
    this.generatedTargetHiddenCount = snapshot.targetHiddenCount;
    this.deletionUndo = undefined;
    return restoredCount;
  }

  public generatePath(): boolean {
    const { rows, columns } = this.size();
    const generationIndex = (
      createGenerationSeed()
      ^ Math.imul(this.generationCount + 1, 2654435761)
    ) >>> 0;
    this.deletionUndo = undefined;
    this.generationCount += 1;
    this.pathSource = 'generated';
    this.manualHiddenCells.clear();
    this.manualHiddenConfigured = false;
    this.generatedTargetHiddenCount = undefined;
    const result = runEditorAlgorithm(this.algorithm, {
      rows,
      columns,
      activeCells: this.paintedCells,
      shape: this.currentShape,
      generationIndex,
    });
    this.path = result?.path ?? [];
    if (result?.hiddenCells) {
      result.hiddenCells.forEach((cell) => this.manualHiddenCells.add(keyOf(cell)));
      this.manualHiddenConfigured = true;
      this.generatedTargetHiddenCount = result.targetHiddenCount;
    }
    return result !== null;
  }

  public previewName(levelId: number): string {
    return BACKGROUNDS[(levelId - 1) % BACKGROUNDS.length];
  }

  public createLevel(levelId: number): LevelData | null {
    if (!this.hasGeneratedPath) return null;
    const { rows, columns } = this.size();
    const boardShape = this.currentShape === 'diamond'
      ? BoardShape.Diamond
      : this.currentShape === 'rectangle'
        ? BoardShape.Rectangle
        : this.currentShape === 'hex'
          ? BoardShape.Hex
          : BoardShape.Square;
    const activeCells = [...this.paintedCells].map((key) => {
      const [x, y] = key.split(',').map(Number);
      return { x, y };
    }).sort((left, right) => left.y - right.y || left.x - right.x);
    return {
      levelId,
      boardShape,
      rows,
      columns,
      activeCells,
      solutionPath: this.path.map((cell) => ({ ...cell })),
      pathSource: this.pathSource,
      ...(this.manualHiddenConfigured
        ? { hiddenCells: [...this.manualHiddenCells].map((key) => {
            const [x, y] = key.split(',').map(Number);
            return { x, y };
          }) }
        : {}),
      algorithm: serializeEditorAlgorithm(resolveEditorAlgorithmForShape(this.algorithm, this.currentShape)),
      backgroundResourcePath: `LevelBackgrounds/${this.previewName(levelId)}`,
      createdAtUtc: new Date().toISOString(),
      custom: true,
    };
  }

  public pathOrder(): Map<string, number> {
    return new Map(this.path.map((cell, index) => [keyOf(cell), index + 1]));
  }

  private trimCells(): void {
    const { rows, columns } = this.size();
    this.paintedCells.forEach((key) => {
      const [x, y] = key.split(',').map(Number);
      if (x >= columns || y >= rows || !this.isAvailableCell(x, y)) this.paintedCells.delete(key);
    });
  }

  private invalidatePath(): void {
    this.deletionUndo = undefined;
    this.path = [];
    this.generationCount = 0;
    this.manualHiddenCells.clear();
    this.manualHiddenConfigured = false;
    this.generatedTargetHiddenCount = undefined;
  }
}
