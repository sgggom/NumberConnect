import Phaser from 'phaser';
import { COLLECTION_ARTWORK_NAMES } from '../gameplay/collection/collectionArtwork';
import {
  buildBoardNeighborhoodPreview,
  stepRewardEmojiForDifficulty,
} from './boardNeighborhood';
import { calculateCompletionAwareScoreInWorker } from './completionAwareScoreWorker';
import {
  boardArtworkSourceRect,
  sampleBoardArtworkAverageColors,
  type BoardArtworkSourceRect,
} from './boardArtwork';
import {
  baseCellRadiusForStep,
  CELL_GLOW_RADIUS_MARGIN,
  CELL_GLOW_STROKE_WIDTH,
  CELL_HINT_MAX_SCALE,
  CELL_RADIUS_SCALE,
  maximumStepForExtent,
  numberFontSizeForBoard,
} from './boardSizing';
import { calculateBoardViewportLayout } from './boardViewport';
import { ConnectionProgress, type ConnectionAction, type ConnectionFailure } from './connectionProgress';
import {
  dragJudgmentMode,
  shouldHandleDragAction,
  shouldShowDragQuestion,
} from './dragJudgment';
import { findSwappableHiddenPairs } from './hiddenSwap';
import { PathCompletionSolver } from './pathCompletionSolver';
import { findPathCompletionInWorker } from './pathCompletionWorker';
import { projectCell } from './topology';
import {
  BoardShape,
  backgroundUrl,
  cellKey,
  type BoardArtworkInput,
  type BoardHoldScore,
  type BoardSessionInput,
  type Cell,
} from './types';
import { levelBallColor } from './levelTheme';

type CellShape = Phaser.GameObjects.Arc | Phaser.GameObjects.Polygon;
type AlphaGameObject = Phaser.GameObjects.Components.Alpha | Phaser.GameObjects.Components.AlphaSingle;

interface CellView {
  cell: Cell;
  index: number;
  x: number;
  y: number;
  color: number;
  slot: Phaser.GameObjects.Image;
  numberFill: Phaser.GameObjects.Image;
  liquidRing: CellShape;
  circle: CellShape;
  hollowRing: CellShape;
  glow: CellShape;
  label: Phaser.GameObjects.Text;
  questionMark: Phaser.GameObjects.Text;
  questionShown: boolean;
}

interface ArtworkColorTileView {
  column: number;
  row: number;
  rectangle: Phaser.GameObjects.Rectangle;
}

interface StepRewardFeedback {
  index: number;
  emoji: string;
}

interface PendingStepRewardFeedback {
  index: number;
  session: BoardSessionInput;
  result: Promise<StepRewardFeedback | undefined>;
}

interface BoardView {
  root: Phaser.GameObjects.Container;
  panel: Phaser.GameObjects.Rectangle;
  solutionLines: Phaser.GameObjects.Graphics;
  lines: Phaser.GameObjects.Graphics;
  pointerLine: Phaser.GameObjects.Graphics;
  choiceScore: Phaser.GameObjects.Text;
  cells: Map<string, CellView>;
  radius: number;
  step: number;
  numberFontSize: number;
  centerX: number;
  centerY: number;
  panelWidth: number;
  panelHeight: number;
  viewportLeft: number;
  viewportTop: number;
  viewportWidth: number;
  viewportHeight: number;
  ballColor: number;
  artworkEnabled: boolean;
  artworkColorTiles: ArtworkColorTileView[];
  artworkColumns: number;
  artworkRows: number;
  artworkImage?: Phaser.GameObjects.Image;
}

export interface BoardArtworkTextureRegistration {
  key: string;
  url: string;
}

interface ResolvedBoardArtwork {
  input: BoardArtworkInput;
  source: BoardArtworkSourceRect;
  colors: readonly number[];
  texture: Phaser.Textures.Texture;
}

const COLORS = {
  text: '#ffffff',
  revealedHiddenText: '#bdd0e7',
  selectedText: '#ffffff',
  hint: 0x6bb6ff,
  consecutiveHint: 0x57d88b,
  powerUpTarget: 0xf0a23a,
  powerUpReveal: 0x55c7ef,
  wrongRipple: 0xe60012,
};

const hexagonPoints = (radius: number): Phaser.Geom.Point[] => Array.from({ length: 6 }, (_, index) => {
  const angle = Phaser.Math.DegToRad(index * 60);
  return new Phaser.Geom.Point(radius + Math.cos(angle) * radius, radius + Math.sin(angle) * radius);
});

const HIDDEN_CELL_RING_WIDTH_SCALE = 0.2;
const BOARD_HORIZONTAL_PADDING = 5;
const BOARD_VERTICAL_PADDING = 10;
const BOARD_ZOOM_SCALE = 1.5;
const BOARD_ZOOM_EDGE_INSET = 16;
const HIDDEN_QUESTION_ALPHA = 0.28;
const HIDDEN_QUESTION_MIN_SCALE = 0.55;
const HIDDEN_QUESTION_SHOW_DURATION_MS = 170;
const HIDDEN_QUESTION_HIDE_DURATION_MS = 120;
const NUMBER_FILL_RADIUS_SCALE = 49 / 64;
const CELL_SLOT_RADIUS_SCALE = 54 / 64;
const CELL_SLOT_TO_FILL_SCALE = 1.12;
const INACTIVE_NUMBER_FILL_COLOR = 0xccd0d0;
const INACTIVE_NUMBER_TEXT_COLOR = '#465158';

const numberFillDisplaySize = (radius: number): number =>
  liquidBallRadius(radius) * 2 / NUMBER_FILL_RADIUS_SCALE;

const cellSlotDisplaySize = (radius: number): number =>
  liquidBallRadius(radius) * 2 * CELL_SLOT_TO_FILL_SCALE / CELL_SLOT_RADIUS_SCALE;

const colorHex = (color: number): string =>
  `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;

const mixColors = (first: number, second: number): number => {
  const red = Math.round((((first >> 16) & 0xff) + ((second >> 16) & 0xff)) * 0.5);
  const green = Math.round((((first >> 8) & 0xff) + ((second >> 8) & 0xff)) * 0.5);
  const blue = Math.round(((first & 0xff) + (second & 0xff)) * 0.5);
  return red << 16 | green << 8 | blue;
};

const blendColors = (first: number, second: number, secondWeight: number): number => {
  const weight = Phaser.Math.Clamp(secondWeight, 0, 1);
  const firstWeight = 1 - weight;
  const red = Math.round(((first >> 16) & 0xff) * firstWeight + ((second >> 16) & 0xff) * weight);
  const green = Math.round(((first >> 8) & 0xff) * firstWeight + ((second >> 8) & 0xff) * weight);
  const blue = Math.round((first & 0xff) * firstWeight + (second & 0xff) * weight);
  return red << 16 | green << 8 | blue;
};

const enrichColor = (color: number, saturationScale = 1.32, valueScale = 1.1): number => {
  const red = ((color >> 16) & 0xff) / 255;
  const green = ((color >> 8) & 0xff) / 255;
  const blue = (color & 0xff) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta > 0) {
    if (maximum === red) hue = ((green - blue) / delta) % 6;
    else if (maximum === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue /= 6;
    if (hue < 0) hue += 1;
  }
  const saturation = maximum === 0 ? 0 : Math.min(1, delta / maximum * saturationScale);
  const value = Math.min(1, maximum * valueScale);
  const sector = hue * 6;
  const chroma = value * saturation;
  const intermediate = chroma * (1 - Math.abs(sector % 2 - 1));
  const offset = value - chroma;
  const [baseRed, baseGreen, baseBlue] = sector < 1 ? [chroma, intermediate, 0]
    : sector < 2 ? [intermediate, chroma, 0]
      : sector < 3 ? [0, chroma, intermediate]
        : sector < 4 ? [0, intermediate, chroma]
          : sector < 5 ? [intermediate, 0, chroma]
            : [chroma, 0, intermediate];
  return Math.round((baseRed + offset) * 255) << 16
    | Math.round((baseGreen + offset) * 255) << 8
    | Math.round((baseBlue + offset) * 255);
};

const contrastTextForColor = (color: number): string => {
  const red = (color >> 16) & 0xff;
  const green = (color >> 8) & 0xff;
  const blue = color & 0xff;
  return red * 0.299 + green * 0.587 + blue * 0.114 > 158
    ? '#101923'
    : '#ffffff';
};

const liquidBallRadius = (radius: number): number => radius + Math.max(1.5, radius * 0.055);

const hiddenCellRingWidth = (radius: number): number => Math.max(1.5, radius * HIDDEN_CELL_RING_WIDTH_SCALE);

export class BoardScene extends Phaser.Scene {
  private resolveReady?: () => void;
  private readonly readyPromise = new Promise<void>((resolve) => {
    this.resolveReady = resolve;
  });
  private session?: BoardSessionInput;
  private view?: BoardView;
  private connection?: ConnectionProgress;
  private isDrawing = false;
  private drawingPointerId?: number;
  private drawingNativePointerId?: number;
  private wrongFeedbackActive = false;
  private readonly wrongCellIndexes = new Set<number>();
  private locked = true;
  private transitioning = false;
  private solutionRevealed = false;
  private hintTween?: Phaser.Tweens.Tween;
  private hintCell?: CellView;
  private neighborhoodPreviewIndex?: number;
  private pointerLineTarget?: { x: number; y: number };
  private raisedConnectedCellIndex?: number;
  private pendingStepReward?: PendingStepRewardFeedback;
  private completionCheckPending = false;
  private connectionComboCount = 0;
  private readonly heldScoreRequests = new Map<string, Promise<BoardHoldScore | undefined>>();
  private heldScoreDisplayToken = 0;
  private paused = true;
  private entranceAnimating = false;
  private entranceAnimationToken = 0;
  private entranceTweens: Phaser.Tweens.Tween[] = [];
  private cellSelectionHandler?: (cell: Cell) => void;
  private boardViewportScroll = { x: 0.5, y: 0.5 };
  private readonly artworkTextures = new Map<string, string>();
  private readonly artworkColorCache = new Map<string, readonly number[]>();

  public constructor() {
    super('board');
  }

  public whenReady(): Promise<void> {
    return this.readyPromise;
  }

  public registerArtworkTextures(textures: readonly BoardArtworkTextureRegistration[]): void {
    textures.forEach(({ key, url }) => this.artworkTextures.set(key, url));
  }

  public preload(): void {
    for (let index = 1; index <= 8; index += 1) {
      this.load.audio(`combo-${index}`, `./audio/combo_${index}.mp3`);
    }
    this.load.audio('wrong', './audio/wrong_move.mp3');
    this.load.audio('victory', './audio/victory_bgm.mp3');
    this.load.image('bead-gem', './ui/beads/bead-gem.png');
    this.load.svg('bead-jar', './ui/beads/open-glass-jar.svg', { width: 512, height: 512 });
    for (const name of COLLECTION_ARTWORK_NAMES) {
      this.load.image(`background-${name}`, `./level-backgrounds/${name}.png`);
    }
    this.artworkTextures.forEach((url, key) => this.load.image(key, url));
  }

  public create(): void {
    this.sys.game.canvas.addEventListener('pointerdown', this.captureBoardPointer);
    window.addEventListener('pointerup', this.handleNativePointerEnd);
    window.addEventListener('pointercancel', this.handleNativePointerEnd);
    this.input.on('pointermove', this.handlePointerMove, this);
    this.input.on('pointerup', this.handlePointerUp, this);
    this.input.on('gameout', this.handlePointerUp, this);
    this.scale.on('resize', this.handleResize, this);
    this.resolveReady?.();
    this.resolveReady = undefined;
    this.game.events.emit('board-ready');
  }

  private readonly captureBoardPointer = (event: PointerEvent): void => {
    if (this.paused || this.locked) return;
    const canvas = this.sys.game.canvas;
    this.drawingNativePointerId = event.pointerId;
    if (!canvas.hasPointerCapture(event.pointerId)) {
      canvas.setPointerCapture(event.pointerId);
    }
  };

  private readonly handleNativePointerEnd = (event: PointerEvent): void => {
    if (this.drawingNativePointerId === event.pointerId) this.finishPointerInteraction(true);
  };

  public setBoard(session: BoardSessionInput): void {
    this.resetConnectionComboEdge(true);
    this.cancelBoardEntrance();
    this.clearNeighborhoodPreview();
    this.stopHintPulse();
    this.view?.root.destroy(true);
    this.session = session;
    this.connection = this.createConnectionProgress(session);
    this.renderLevelProgressEdge();
    this.isDrawing = false;
    this.drawingPointerId = undefined;
    this.drawingNativePointerId = undefined;
    this.pointerLineTarget = undefined;
    this.raisedConnectedCellIndex = undefined;
    this.pendingStepReward = undefined;
    this.completionCheckPending = false;
    this.heldScoreRequests.clear();
    this.heldScoreDisplayToken += 1;
    this.wrongFeedbackActive = false;
    this.wrongCellIndexes.clear();
    this.cellSelectionHandler = undefined;
    this.transitioning = false;
    this.boardViewportScroll = { x: 0.5, y: 0.5 };
    this.view = this.buildView(session, 0);
    this.applyBoardViewport();
    this.refreshView();
    this.playBoardEntrance(this.view);
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
    this.input.enabled = !paused;
    this.locked = paused || this.transitioning || this.entranceAnimating || this.connection?.complete === true;
    if (paused) {
      this.clearNeighborhoodPreview();
      this.isDrawing = false;
      this.drawingPointerId = undefined;
      this.drawingNativePointerId = undefined;
      this.pointerLineTarget = undefined;
      this.connection?.endStroke();
      this.wrongFeedbackActive = false;
      this.view?.pointerLine.clear();
      this.stopHintPulse();
      this.hideDragQuestions();
    } else if (!this.entranceAnimating) {
      this.refreshView();
    }
  }

  public canUsePowerUp(): boolean {
    return Boolean(
      this.session
      && this.connection
      && !this.locked
      && !this.paused
      && !this.transitioning
      && !this.entranceAnimating
      && !this.connection.complete,
    );
  }

  public canUndoStep(): boolean {
    return this.canUsePowerUp() && this.connection?.canUndoStep === true;
  }

  public canUseUndoControl(): boolean {
    return Boolean(
      this.session
      && this.connection
      && !this.paused
      && !this.transitioning
      && !this.connection.complete
      && (!this.locked || this.entranceAnimating),
    );
  }

  public undoLastStep(): boolean {
    if (!this.session || !this.connection || !this.canUndoStep()) return false;
    this.finishPointerInteraction();
    const progress = this.connection.undoLastStep();
    if (progress === undefined) return false;

    this.wrongFeedbackActive = false;
    this.wrongCellIndexes.clear();
    this.pendingStepReward = undefined;
    this.stopHintPulse();
    this.hideDragQuestions();
    this.clearNeighborhoodPreview();
    this.refreshView();
    this.renderLevelProgressEdge();
    this.session.onProgress(progress, this.session.level.solutionPath.length);
    return true;
  }

  public quickComplete(): boolean {
    if (
      !this.session
      || !this.view
      || !this.connection
      || this.transitioning
      || this.connection.complete
    ) return false;

    const entranceWasAnimating = this.entranceAnimating;
    this.cancelBoardEntrance();
    if (entranceWasAnimating) this.finishBoardEntrance(this.view, this.entranceAnimationToken);
    this.finishPointerInteraction();
    this.clearNeighborhoodPreview();
    this.stopHintPulse();
    this.pendingStepReward = undefined;
    this.paused = false;
    this.locked = false;
    this.connection = this.createConnectionProgress(this.session);
    this.renderLevelProgressEdge();
    this.session.onProgress(0, this.session.level.solutionPath.length);
    this.handleConnectionAction(this.connection.begin(0, true), false);
    for (let nextIndex = 1; nextIndex < this.session.level.solutionPath.length; nextIndex += 1) {
      const action = this.connection.extend(nextIndex);
      this.handleConnectionAction(action, false);
      if (
        action.type === 'wrong'
        || action.type === 'ignored'
        || (action.type === 'advanced' && action.complete)
      ) break;
    }
    return true;
  }

  public concealedCellKeys(): Set<string> {
    const concealed = new Set<string>();
    if (!this.session || !this.connection || this.solutionRevealed) return concealed;
    this.session.level.solutionPath.forEach((cell, index) => {
      const key = cellKey(cell);
      if (this.session!.hiddenCells.has(key) && !this.connection!.isVisible(index)) concealed.add(key);
    });
    return concealed;
  }

  public cellClientPosition(cell: Cell): { x: number; y: number } | undefined {
    if (!this.view) return undefined;
    const cellView = this.view.cells.get(cellKey(cell));
    if (!cellView) return undefined;
    const canvasBounds = this.sys.game.canvas.getBoundingClientRect();
    const gameX = this.view.root.x + cellView.x * this.view.root.scaleX;
    const gameY = this.view.root.y + cellView.y * this.view.root.scaleY;
    return {
      x: canvasBounds.left + (gameX / Math.max(1, this.scale.width)) * canvasBounds.width,
      y: canvasBounds.top + (gameY / Math.max(1, this.scale.height)) * canvasBounds.height,
    };
  }

  public artworkClientBounds(): {
    left: number;
    top: number;
    width: number;
    height: number;
  } | undefined {
    const image = this.view?.artworkImage;
    const root = this.view?.root;
    if (!image || !root) return undefined;
    const canvasBounds = this.sys.game.canvas.getBoundingClientRect();
    const rootScaleX = Math.abs(root.scaleX);
    const rootScaleY = Math.abs(root.scaleY);
    const gameWidth = image.displayWidth * rootScaleX;
    const gameHeight = image.displayHeight * rootScaleY;
    const gameCenterX = root.x + image.x * root.scaleX;
    const gameCenterY = root.y + image.y * root.scaleY;
    const clientScaleX = canvasBounds.width / Math.max(1, this.scale.width);
    const clientScaleY = canvasBounds.height / Math.max(1, this.scale.height);
    return {
      left: canvasBounds.left + (gameCenterX - gameWidth * 0.5) * clientScaleX,
      top: canvasBounds.top + (gameCenterY - gameHeight * 0.5) * clientScaleY,
      width: gameWidth * clientScaleX,
      height: gameHeight * clientScaleY,
    };
  }

  public setArtworkCompletionVisible(visible: boolean): void {
    this.view?.artworkImage?.setVisible(visible);
  }

  public setBoardViewportPosition(scrollX: number, scrollY: number): void {
    if (!this.session?.boardZoomEnabled || !this.view) return;
    this.boardViewportScroll = { x: scrollX, y: scrollY };
    this.applyBoardViewport();
    this.emitNeighborhoodPreview(null);
  }

  public setCellSelectionHandler(handler?: (cell: Cell) => void): boolean {
    if (handler && !this.canUsePowerUp()) return false;
    this.finishPointerInteraction();
    this.cellSelectionHandler = handler;
    this.refreshView();
    return true;
  }

  public revealCells(cells: ReadonlyArray<Cell>): Cell[] {
    if (!this.session || !this.connection || !this.canUsePowerUp()) return [];
    const concealed = this.concealedCellKeys();
    const revealedIndexes: number[] = [];
    const seen = new Set<string>();
    cells.forEach((cell) => {
      const key = cellKey(cell);
      if (seen.has(key) || !concealed.has(key)) return;
      seen.add(key);
      const view = this.view?.cells.get(key);
      if (view) revealedIndexes.push(view.index);
    });
    if (revealedIndexes.length === 0) return [];

    this.connection.revealIndices(revealedIndexes);
    const revealed = revealedIndexes.map((index) => ({ ...this.session!.level.solutionPath[index] }));
    revealed.forEach((cell) => this.session!.hiddenCells.delete(cellKey(cell)));
    this.stopHintPulse();
    this.refreshView();
    this.playPowerUpReveal(revealedIndexes);
    return revealed;
  }

  public setSolutionReveal(revealed: boolean): void {
    this.solutionRevealed = revealed;
    if (this.entranceAnimating && this.view) {
      const view = this.view;
      this.cancelBoardEntrance();
      this.finishBoardEntrance(view, this.entranceAnimationToken);
    } else {
      this.refreshView();
    }
    if (!this.locked && this.isDrawing && this.neighborhoodPreviewIndex !== undefined) {
      this.emitNeighborhoodPreview(this.neighborhoodPreviewIndex);
    }
  }

  public setRuntimePreferences(
    preferences: Pick<
      BoardSessionInput,
      'showNextNumber' | 'soundEnabled' | 'chargeProgressMode' | 'touchPreviewRingDepth' | 'boardZoomEnabled'
    >,
  ): void {
    if (!this.session) return;
    const boardZoomChanged = this.session.boardZoomEnabled !== preferences.boardZoomEnabled;
    const chargeProgressModeChanged = (
      this.session.chargeProgressMode !== preferences.chargeProgressMode
    );
    this.session.showNextNumber = preferences.showNextNumber;
    this.session.soundEnabled = preferences.soundEnabled;
    this.session.chargeProgressMode = preferences.chargeProgressMode;
    this.session.touchPreviewRingDepth = preferences.touchPreviewRingDepth;
    this.session.boardZoomEnabled = preferences.boardZoomEnabled;
    if (chargeProgressModeChanged) {
      this.resetConnectionComboEdge(true);
      this.renderLevelProgressEdge();
    }
    if (boardZoomChanged) {
      this.boardViewportScroll = { x: 0.5, y: 0.5 };
      this.applyBoardViewport();
    }
    if (!this.entranceAnimating) this.refreshView();
    if (boardZoomChanged && !this.session.boardZoomEnabled) {
      this.session.onNeighborhoodPreview?.(null);
    }
    if (!this.locked && this.neighborhoodPreviewIndex !== undefined) {
      this.emitNeighborhoodPreview(this.neighborhoodPreviewIndex);
    }
  }

  private playBoardEntrance(view: BoardView): void {
    const token = this.entranceAnimationToken;
    const cells = [...view.cells.values()];
    const slotRestingScale = cellSlotDisplaySize(view.radius) / 128;
    const numberFillRestingScale = numberFillDisplaySize(view.radius) / 128;
    const outlineOrder = [...cells].sort((left, right) => {
      const diagonalOffset = (left.x + left.y) - (right.x + right.y);
      return Math.abs(diagonalOffset) > 0.5 ? diagonalOffset : left.y - right.y || left.x - right.x;
    });
    const visibleCells = cells
      .filter((cell) => this.solutionRevealed || this.connection?.isVisible(cell.index) === true)
      .sort((left, right) => left.index - right.index);

    this.entranceAnimating = true;
    this.locked = true;
    this.stopHintPulse();
    cells.forEach((cell) => {
      // These canvas textures have board-dependent resting scales. Animate
      // relative to those values so the bounce never expands them to 128px.
      cell.slot.setAlpha(0).setScale(slotRestingScale * 0.1);
      cell.numberFill.setAlpha(0).setScale(numberFillRestingScale * 0.1);
      cell.liquidRing.setAlpha(0).setScale(1);
      cell.circle.setAlpha(0).setScale(0.1);
      cell.hollowRing.setVisible(true).setAlpha(0).setScale(0.1);
      cell.glow.setAlpha(0).setScale(1);
      cell.label.setVisible(false).setAlpha(0).setScale(0.1);
    });

    if (cells.length === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.finishBoardEntrance(view, token);
      return;
    }

    const outlineStagger = Math.min(28, Math.max(7, 520 / outlineOrder.length));
    const outlineTween = this.tweens.add({
      targets: outlineOrder.map((cell) => cell.slot),
      alpha: 1,
      scaleX: slotRestingScale,
      scaleY: slotRestingScale,
      delay: this.tweens.stagger(outlineStagger, {}),
      duration: 250,
      ease: 'Back.easeOut',
      easeParams: [1.7],
      onComplete: () => this.playNumberEntrance(view, visibleCells, token),
    });
    this.entranceTweens.push(outlineTween);
  }

  private playNumberEntrance(view: BoardView, visibleCells: CellView[], token: number): void {
    if (token !== this.entranceAnimationToken || this.view !== view) return;
    if (visibleCells.length === 0) {
      this.finishBoardEntrance(view, token);
      return;
    }

    visibleCells.forEach((cell) => cell.label.setVisible(true));
    const numberStagger = Math.min(64, Math.max(22, 380 / visibleCells.length));
    const delay = this.tweens.stagger(numberStagger, {});
    const labelTween = this.tweens.add({
      targets: visibleCells.map((cell) => cell.label),
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      delay,
      duration: 240,
      ease: 'Back.easeOut',
      easeParams: [2.35],
    });
    const circleTween = this.tweens.add({
      targets: visibleCells.map((cell) => cell.circle),
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      delay,
      duration: 270,
      ease: 'Back.easeOut',
      easeParams: [2.35],
    });
    const fillTween = this.tweens.add({
      targets: visibleCells.map((cell) => cell.numberFill),
      alpha: 1,
      scaleX: numberFillDisplaySize(view.radius) / 128,
      scaleY: numberFillDisplaySize(view.radius) / 128,
      delay,
      duration: 310,
      ease: 'Back.easeOut',
      easeParams: [2.05],
      onComplete: () => this.finishBoardEntrance(view, token),
    });
    this.entranceTweens.push(labelTween, circleTween, fillTween);
  }

  private finishBoardEntrance(view: BoardView, token: number): void {
    if (token !== this.entranceAnimationToken || this.view !== view) return;
    this.entranceTweens = [];
    const slotRestingScale = cellSlotDisplaySize(view.radius) / 128;
    const numberFillRestingScale = numberFillDisplaySize(view.radius) / 128;
    view.cells.forEach((cell) => {
      cell.slot.setAlpha(1).setScale(slotRestingScale);
      cell.numberFill.setAlpha(1).setScale(numberFillRestingScale);
      cell.liquidRing.setAlpha(1).setScale(1);
      cell.circle.setAlpha(1).setScale(1);
      cell.hollowRing.setAlpha(1).setScale(1);
      cell.glow.setAlpha(1).setScale(1);
      cell.label.setAlpha(1).setScale(1);
    });
    this.entranceAnimating = false;
    this.locked = this.paused || this.transitioning || this.connection?.complete === true;
    this.refreshView();
    if (this.locked) this.stopHintPulse();
  }

  private cancelBoardEntrance(): void {
    this.entranceAnimationToken += 1;
    this.entranceTweens.forEach((tween) => tween.stop());
    this.entranceTweens = [];
    this.entranceAnimating = false;
  }

  public async transitionTo(session: BoardSessionInput): Promise<void> {
    if (!this.view) {
      this.setBoard(session);
      return;
    }

    this.cancelBoardEntrance();
    this.locked = true;
    this.transitioning = true;
    this.clearNeighborhoodPreview();
    this.stopHintPulse();
    this.disableViewInput(this.view);
    const oldView = this.view;
    const distance = (
      Math.max(this.scale.height, 720)
      + oldView.panelHeight * Math.abs(oldView.root.scaleY) * 0.5
      + 100
    );

    this.session = session;
    this.resetConnectionComboEdge(true);
    this.connection = this.createConnectionProgress(session);
    this.renderLevelProgressEdge();
    this.boardViewportScroll = { x: 0.5, y: 0.5 };
    this.isDrawing = false;
    this.drawingPointerId = undefined;
    this.drawingNativePointerId = undefined;
    this.pointerLineTarget = undefined;
    this.raisedConnectedCellIndex = undefined;
    this.pendingStepReward = undefined;
    this.heldScoreRequests.clear();
    this.heldScoreDisplayToken += 1;
    this.wrongFeedbackActive = false;
    this.wrongCellIndexes.clear();
    this.cellSelectionHandler = undefined;
    const newView = this.buildView(session, distance);
    this.view = newView;
    this.applyBoardViewport(newView, distance);
    this.refreshView();

    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: [oldView.root, newView.root],
        y: `-=${distance}`,
        duration: 720,
        ease: 'Sine.easeInOut',
        onComplete: () => resolve(),
      });
    });

    oldView.root.destroy(true);
    this.applyBoardViewport(newView);
    this.transitioning = false;
    this.locked = this.paused || this.connection?.complete === true;
  }

  public async fillChargeProgressScreen(): Promise<boolean> {
    if (this.session?.chargeProgressMode !== 'progress') return false;
    const edge = this.connectionComboEdge();
    if (!edge) return false;
    const session = this.session;
    this.ensureConnectionComboLogoGrid(edge);
    const fillDistance = Math.ceil(Math.min(edge.clientWidth, edge.clientHeight) * 0.5) + 1;
    edge.style.setProperty('--connection-combo-screen-fill-distance', `${fillDistance}px`);
    edge.classList.remove('is-screen-filling', 'is-screen-filled');
    void edge.offsetWidth;
    edge.classList.add('is-screen-filling');

    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 520));
    }
    if (this.session !== session) return false;
    edge.classList.add('is-screen-filled');
    return true;
  }

  public beginStageCompletionEdge(): boolean {
    if (this.session?.chargeProgressMode !== 'progress') return false;
    const edge = this.stageCompletionEdge();
    if (!edge) return false;
    edge.classList.remove('is-active', 'is-expanding', 'is-leaving');
    void edge.offsetWidth;
    edge.classList.add('is-active');
    requestAnimationFrame(() => edge.classList.add('is-expanding'));
    return true;
  }

  public async finishStageCompletionEdge(): Promise<void> {
    const edge = this.stageCompletionEdge();
    if (!edge?.classList.contains('is-active')) return;
    edge.classList.remove('is-expanding');
    edge.classList.add('is-leaving');
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 680));
    }
    edge.classList.remove('is-active', 'is-leaving');
  }

  private ensureConnectionComboLogoGrid(edge: HTMLElement): void {
    if (edge.querySelector('.connection-combo-logo-grid')) return;
    const grid = document.createElement('div');
    grid.className = 'connection-combo-logo-grid';
    grid.setAttribute('aria-hidden', 'true');
    grid.replaceChildren(...Array.from({ length: 162 }, () => document.createElement('i')));
    edge.append(grid);
  }

  public async showCompletion({
    revealImage = false,
    revealArtwork = true,
  }: {
    revealImage?: boolean;
    revealArtwork?: boolean;
  } = {}): Promise<void> {
    if (!this.view || !this.session) return;
    const view = this.view;
    const session = this.session;
    this.locked = true;
    this.clearNeighborhoodPreview();
    this.stopHintPulse();
    this.playSound('victory');

    if (session.completionGemColors?.length) {
      await this.showGemCompletion(
        view,
        session.completionGemColors,
        session.completionGemDestination ?? 'jar',
      );
      return;
    }

    if (view.artworkEnabled && revealArtwork) {
      await this.showArtworkCompletion(view);
      return;
    }

    if (!revealImage) {
      await this.showSimpleCompletion(view);
      return;
    }

    const resource = backgroundUrl(session.level.backgroundResourcePath);
    const imageName = resource?.split('/').pop()?.replace('.png', '');
    const textureKey = imageName ? `background-${imageName}` : undefined;
    if (!textureKey || !this.textures.exists(textureKey)) {
      await this.showSimpleCompletion(view);
      return;
    }

    const frame = this.textures.getFrame(textureKey);
    if (!frame) return;

    const inset = Math.min(view.panelWidth, view.panelHeight) * 0.06;
    const pictureWidth = view.panelWidth - inset * 2;
    const pictureHeight = view.panelHeight - inset * 2;
    const image = this.add.image(view.centerX, view.centerY, textureKey);
    image.setDisplaySize(pictureWidth, pictureHeight);
    image.setAlpha(0);
    view.root.add(image);

    const rows = Math.max(1, session.level.rows);
    const columns = Math.max(1, session.level.columns);
    const cropWidth = frame.realWidth / columns;
    const cropHeight = frame.realHeight / rows;
    const tileWidth = pictureWidth / columns;
    const tileHeight = pictureHeight / rows;
    const tileScaleX = tileWidth / cropWidth;
    const tileScaleY = tileHeight / cropHeight;
    const stagger = Math.min(48, Math.max(24, 1500 / session.level.solutionPath.length));
    const pieces: Phaser.GameObjects.Image[] = [];

    this.tweens.add({
      targets: [view.solutionLines, view.lines],
      alpha: 0,
      duration: stagger * Math.max(0, session.level.solutionPath.length - 1) + 220,
      ease: 'Sine.easeInOut',
    });

    const flips = session.level.solutionPath.map((cell, index) => {
      const cellView = view.cells.get(cellKey(cell));
      if (!cellView) return Promise.resolve();

      const piece = this.add.image(cellView.x, cellView.y, textureKey);
      piece.setCrop(cell.x * cropWidth, cell.y * cropHeight, cropWidth, cropHeight);
      piece.setOrigin((cell.x + 0.5) / columns, (cell.y + 0.5) / rows);
      piece.setScale(0, tileScaleY);
      piece.setAlpha(0.96);
      view.root.add(piece);
      pieces.push(piece);

      const front = [cellView.slot, cellView.liquidRing, cellView.circle, cellView.hollowRing, cellView.numberFill, cellView.glow, cellView.label];
      return new Promise<void>((resolve) => {
        this.tweens.add({
          targets: front,
          scaleX: 0,
          delay: index * stagger,
          duration: 90,
          ease: 'Sine.easeIn',
          onComplete: () => {
            front.forEach((object) => object.setAlpha(0));
            this.tweens.add({
              targets: piece,
              scaleX: tileScaleX,
              duration: 130,
              ease: 'Back.easeOut',
              easeParams: [1.05],
              onComplete: () => resolve(),
            });
          },
        });
      });
    });

    await Promise.all(flips);
    this.tweens.add({ targets: pieces, alpha: 0, duration: 280, ease: 'Sine.easeIn' });

    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: image,
        alpha: 0.94,
        duration: 280,
        ease: 'Sine.easeOut',
        onComplete: () => resolve(),
      });
    });
    pieces.forEach((piece) => piece.destroy());
  }

  private async showArtworkCompletion(view: BoardView): Promise<void> {
    const image = view.artworkImage;
    if (!image || view.artworkColorTiles.length === 0 || !this.session) {
      await this.showSimpleCompletion(view);
      return;
    }

    const boardGraphics: AlphaGameObject[] = [
      view.solutionLines,
      view.lines,
      view.pointerLine,
      view.choiceScore,
    ];
    const cellObjects = [...view.cells.values()].flatMap((cell) => [
      cell.slot,
      cell.liquidRing,
      cell.circle,
      cell.hollowRing,
      cell.numberFill,
      cell.glow,
      cell.label,
      cell.questionMark,
    ]);
    this.tweens.killTweensOf([...boardGraphics, ...cellObjects]);
    this.tweens.killTweensOf(view.artworkColorTiles.map(({ rectangle }) => rectangle));
    this.tweens.killTweensOf(image);
    this.fitArtworkCompletionImage(view, image);
    image.setAlpha(0).setVisible(true);
    view.artworkColorTiles.forEach(({ rectangle }) => rectangle.setAlpha(0));

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      [...boardGraphics, ...cellObjects].forEach((object) => object.setAlpha(0));
      image.setAlpha(1);
      return;
    }

    const columns = Math.max(1, view.artworkColumns);
    const rows = Math.max(1, view.artworkRows);
    const cropWidth = image.width / columns;
    const cropHeight = image.height / rows;
    const tileWidth = image.displayWidth / columns;
    const tileHeight = image.displayHeight / rows;
    const tileScaleX = tileWidth / cropWidth;
    const tileScaleY = tileHeight / cropHeight;
    const tilePositions = new Map(
      view.artworkColorTiles.map(({ column, row, rectangle }) => [
        `${column}:${row}`,
        rectangle,
      ] as const),
    );
    const stagger = Math.min(62, Math.max(28, 1500 / this.session.level.solutionPath.length));
    const pieces: Phaser.GameObjects.Image[] = [];

    this.tweens.add({
      targets: boardGraphics,
      alpha: 0,
      duration: 180,
      ease: 'Sine.easeIn',
    });

    const flips = this.session.level.solutionPath.map((cell, index) => {
      const cellView = view.cells.get(cellKey(cell));
      const tile = tilePositions.get(`${cell.x}:${cell.y}`);
      if (!cellView || !tile) return Promise.resolve();

      const piece = this.add.image(tile.x, tile.y, image.texture.key, image.frame.name);
      piece.setCrop(cell.x * cropWidth, cell.y * cropHeight, cropWidth, cropHeight);
      piece.setOrigin((cell.x + 0.5) / columns, (cell.y + 0.5) / rows);
      piece.setScale(0, tileScaleY).setAlpha(1);
      view.root.add(piece);
      pieces.push(piece);

      const front = [
        cellView.slot,
        cellView.liquidRing,
        cellView.circle,
        cellView.hollowRing,
        cellView.numberFill,
        cellView.glow,
        cellView.label,
        cellView.questionMark,
      ];
      return new Promise<void>((resolve) => {
        this.tweens.add({
          targets: front,
          scaleX: 0,
          delay: index * stagger,
          duration: 140,
          ease: 'Sine.easeIn',
          onComplete: () => {
            front.forEach((object) => object.setAlpha(0));
            this.tweens.add({
              targets: piece,
              scaleX: tileScaleX,
              duration: 270,
              ease: 'Back.easeOut',
              easeParams: [1.05],
              onComplete: () => resolve(),
            });
          },
        });
      });
    });

    await Promise.all(flips);
    image.setAlpha(1);
    pieces.forEach((piece) => piece.destroy());
  }

  private fitArtworkCompletionImage(
    view: BoardView,
    image: Phaser.GameObjects.Image,
  ): void {
    image
      .setDisplaySize(view.panelWidth, view.panelHeight)
      .setPosition(view.centerX, view.centerY);
    const tileWidth = image.displayWidth / Math.max(1, view.artworkColumns);
    const tileHeight = image.displayHeight / Math.max(1, view.artworkRows);
    const imageLeft = image.x - image.displayWidth * 0.5;
    const imageTop = image.y - image.displayHeight * 0.5;
    view.artworkColorTiles.forEach(({ column, row, rectangle }) => {
      rectangle
        .setPosition(
          imageLeft + (column + 0.5) * tileWidth,
          imageTop + (row + 0.5) * tileHeight,
        )
        .setDisplaySize(tileWidth + 1, tileHeight + 1);
    });
  }

  private async showSimpleCompletion(view: BoardView): Promise<void> {
    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: view.root,
        scale: 1.025,
        yoyo: true,
        duration: 220,
        ease: 'Sine.easeOut',
        onComplete: () => resolve(),
      });
    });
  }

  private async showGemCompletion(
    view: BoardView,
    gemColors: readonly string[],
    destination: 'jar' | 'showcase',
  ): Promise<void> {
    if (!this.session) return;
    const path = this.session.level.solutionPath.slice(0, gemColors.length);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stagger = reducedMotion ? 0 : Math.min(44, Math.max(22, 1200 / Math.max(1, path.length)));
    const fallbackColor = gemColors[gemColors.length - 1];
    const gems: Phaser.GameObjects.Container[] = [];

    this.tweens.add({
      targets: [view.solutionLines, view.lines],
      alpha: 0,
      duration: stagger * Math.max(0, path.length - 1) + 180,
      ease: 'Sine.easeInOut',
    });

    const rewardCells = new Set(path.map(cellKey));
    const unusedCellObjects: Phaser.GameObjects.GameObject[] = [];
    view.cells.forEach((cellView, key) => {
      if (!rewardCells.has(key)) {
        unusedCellObjects.push(cellView.slot, cellView.liquidRing, cellView.circle, cellView.hollowRing, cellView.numberFill, cellView.glow, cellView.label);
      }
    });
    if (unusedCellObjects.length > 0) {
      this.tweens.add({
        targets: unusedCellObjects,
        alpha: 0.12,
        duration: reducedMotion ? 1 : 260,
        ease: 'Sine.easeOut',
      });
    }

    const flips = path.map((cell, index) => {
      const cellView = view.cells.get(cellKey(cell));
      if (!cellView) return Promise.resolve();
      const gemColor = gemColors[index] ?? fallbackColor;
      const gem = this.add.container(cellView.x, cellView.y);
      const beadRadius = view.radius * 0.82;
      const textureSize = beadRadius * 2.58;
      const shadow = this.add.image(0, view.radius * 0.1, this.coloredBeadTexture('#07101A'))
        .setDisplaySize(textureSize, textureSize)
        .setAlpha(0.34);
      const body = this.add.image(0, 0, this.coloredBeadTexture(gemColor))
        .setDisplaySize(textureSize, textureSize);
      gem.add([shadow, body]);
      gem.setScale(0, 1);
      view.root.add(gem);
      gems.push(gem);

      return new Promise<void>((resolve) => {
        this.tweens.add({
          targets: [cellView.slot, cellView.liquidRing, cellView.circle, cellView.hollowRing, cellView.numberFill, cellView.glow, cellView.label],
          scaleX: 0,
          delay: index * stagger,
          duration: reducedMotion ? 1 : 90,
          ease: 'Sine.easeIn',
          onComplete: () => {
            cellView.circle.setAlpha(0);
            cellView.slot.setAlpha(0);
            cellView.numberFill.setAlpha(0);
            cellView.hollowRing.setAlpha(0);
            cellView.glow.setAlpha(0);
            cellView.liquidRing.setAlpha(0);
            cellView.label.setAlpha(0);
            this.tweens.add({
              targets: gem,
              scaleX: 1,
              duration: reducedMotion ? 1 : 150,
              ease: 'Back.easeOut',
              easeParams: [1.15],
              onComplete: () => resolve(),
            });
          },
        });
      });
    });

    await Promise.all(flips);
    this.tweens.add({
      targets: view.panel,
      alpha: 0.38,
      duration: reducedMotion ? 1 : 300,
      ease: 'Sine.easeOut',
    });

    if (destination === 'showcase') {
      this.tweens.add({
        targets: gems,
        alpha: 0,
        duration: reducedMotion ? 1 : 360,
        ease: 'Sine.easeIn',
      });
      return;
    }

    const jarSize = Math.max(150, Math.min(230, view.panelWidth * 0.58, view.panelHeight * 0.48));
    const jarX = view.centerX;
    const jarY = view.centerY + Math.min(view.panelHeight * 0.22, jarSize * 0.55);
    const jar = this.add.image(jarX, jarY, 'bead-jar').setDisplaySize(jarSize, jarSize);
    const jarScaleX = jar.scaleX;
    const jarScaleY = jar.scaleY;
    jar.setScale(jarScaleX * 0.24, jarScaleY * 0.24).setAlpha(0);
    view.root.add(jar);

    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: jar,
        alpha: 1,
        scaleX: jarScaleX,
        scaleY: jarScaleY,
        duration: reducedMotion ? 1 : 300,
        ease: 'Back.easeOut',
        easeParams: [1.25],
        onComplete: () => resolve(),
      });
    });

    const columns = Math.max(5, Math.ceil(Math.sqrt(gems.length * 1.15)));
    const stored = gems.map((gem, index) => {
      const random = (salt: number): number => {
        const raw = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
        return raw - Math.floor(raw);
      };
      const targetX = jarX + (random(1.7) - 0.5) * jarSize * 0.36;
      const targetY = jarY + jarSize * (0.08 + Math.pow(random(2.9), 0.62) * 0.25);
      const mouthX = jarX + (random(4.1) - 0.5) * jarSize * 0.1;
      const mouthY = jarY - jarSize * 0.255;
      const startX = gem.x;
      const startY = gem.y;
      const startScaleX = gem.scaleX;
      const startScaleY = gem.scaleY;
      const mouthProgress = 0.68;
      const inverseMouthProgress = 1 - mouthProgress;
      const controlWeight = 2 * inverseMouthProgress * mouthProgress;
      const controlX = (
        mouthX
        - inverseMouthProgress * inverseMouthProgress * startX
        - mouthProgress * mouthProgress * targetX
      ) / controlWeight;
      const controlY = (
        mouthY
        - inverseMouthProgress * inverseMouthProgress * startY
        - mouthProgress * mouthProgress * targetY
      ) / controlWeight;
      const storedScale = Math.max(0.22, Math.min(0.39, 2.55 / columns))
        * (0.84 + random(5.3) * 0.28);
      const storedAngle = random(6.7) * 76 - 38;
      return new Promise<void>((resolve) => {
        const flight = { progress: 0 };
        this.tweens.add({
          targets: flight,
          progress: 1,
          delay: reducedMotion ? 0 : index * 11,
          duration: reducedMotion ? 1 : 680,
          ease: 'Sine.easeInOut',
          onUpdate: () => {
            const progress = flight.progress;
            const inverse = 1 - progress;
            gem.setPosition(
              inverse * inverse * startX
                + 2 * inverse * progress * controlX
                + progress * progress * targetX,
              inverse * inverse * startY
                + 2 * inverse * progress * controlY
                + progress * progress * targetY,
            );
            gem.setScale(
              startScaleX + (storedScale - startScaleX) * progress,
              startScaleY + (storedScale - startScaleY) * progress,
            );
            gem.setAngle(storedAngle * progress);
          },
          onComplete: () => resolve(),
        });
      });
    });
    await Promise.all(stored);

    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: jar,
        scaleX: jarScaleX * 1.035,
        scaleY: jarScaleY * 0.975,
        yoyo: true,
        duration: reducedMotion ? 1 : 180,
        ease: 'Sine.easeOut',
        onComplete: () => resolve(),
      });
    });
    if (!reducedMotion) await new Promise<void>((resolve) => { this.time.delayedCall(360, resolve); });
  }

  private coloredBeadTexture(color: string): string {
    const normalizedColor = color.toUpperCase();
    const textureKey = `bead-gem-${normalizedColor.replace('#', '')}`;
    if (this.textures.exists(textureKey)) return textureKey;

    const texture = this.textures.createCanvas(textureKey, 64, 64);
    if (!texture) return 'bead-gem';
    const source = this.textures.get('bead-gem').getSourceImage() as CanvasImageSource;
    const context = texture.context;
    context.clearRect(0, 0, 64, 64);
    context.drawImage(source, 0, 0, 64, 64);
    context.globalCompositeOperation = 'multiply';
    context.fillStyle = normalizedColor;
    context.fillRect(0, 0, 64, 64);
    context.globalCompositeOperation = 'destination-in';
    context.drawImage(source, 0, 0, 64, 64);
    context.globalCompositeOperation = 'source-over';
    texture.refresh();
    return textureKey;
  }

  private recessedCellSlotTexture(): string {
    const textureKey = 'board-cell-recessed-slot-reference-v2';
    if (this.textures.exists(textureKey)) return textureKey;

    const texture = this.textures.createCanvas(textureKey, 128, 128);
    if (!texture) return '__DEFAULT';
    const context = texture.context;
    context.clearRect(0, 0, 128, 128);

    this.paintRecessedCellSlot(context);

    texture.refresh();
    return textureKey;
  }

  private wrongCellSlotTexture(): string {
    const textureKey = 'board-cell-recessed-slot-wrong-v4';
    if (this.textures.exists(textureKey)) return textureKey;

    const texture = this.textures.createCanvas(textureKey, 128, 128);
    if (!texture) return '__DEFAULT';
    const context = texture.context;
    context.clearRect(0, 0, 128, 128);

    this.paintRecessedCellSlot(context);

    context.save();
    context.beginPath();
    context.arc(64, 64, 52, 0, Math.PI * 2);
    context.clip();
    const redGlow = context.createRadialGradient(64, 64, 4, 64, 64, 52);
    redGlow.addColorStop(0, 'rgba(255,88,98,.34)');
    redGlow.addColorStop(0.55, 'rgba(230,0,18,.2)');
    redGlow.addColorStop(0.8, 'rgba(230,0,18,.3)');
    redGlow.addColorStop(0.96, 'rgba(166,0,14,.42)');
    redGlow.addColorStop(1, 'rgba(166,0,14,0)');
    context.fillStyle = redGlow;
    context.fillRect(8, 5, 112, 112);
    context.restore();

    texture.refresh();
    return textureKey;
  }

  private paintRecessedCellSlot(context: CanvasRenderingContext2D): void {
    context.beginPath();
    context.arc(64, 64, 54, 0, Math.PI * 2);
    const recess = context.createRadialGradient(82, 82, 4, 64, 64, 72);
    recess.addColorStop(0, 'rgba(255,255,255,.98)');
    recess.addColorStop(0.42, 'rgba(247,248,249,.96)');
    recess.addColorStop(0.68, 'rgba(225,228,230,.92)');
    recess.addColorStop(0.86, 'rgba(199,204,207,.78)');
    recess.addColorStop(1, 'rgba(174,181,186,.56)');
    context.fillStyle = recess;
    context.fill();

    context.save();
    context.globalCompositeOperation = 'destination-in';
    const edgeFeather = context.createRadialGradient(64, 64, 50.5, 64, 64, 55);
    edgeFeather.addColorStop(0, 'rgba(0,0,0,1)');
    edgeFeather.addColorStop(0.45, 'rgba(0,0,0,.92)');
    edgeFeather.addColorStop(0.78, 'rgba(0,0,0,.48)');
    edgeFeather.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = edgeFeather;
    context.fillRect(7, 7, 114, 114);
    context.restore();
  }

  private numberFillTexture(color: number): string {
    const normalizedColor = color & 0xffffff;
    const textureKey = `board-number-fill-${normalizedColor.toString(16).padStart(6, '0')}-frosted-opaque-v3`;
    if (this.textures.exists(textureKey)) return textureKey;

    const texture = this.textures.createCanvas(textureKey, 128, 128);
    if (!texture) return '__DEFAULT';
    const context = texture.context;
    context.clearRect(0, 0, 128, 128);

    // Opaque frosted body: saturated same-hue variation without milky white mixing.
    const enrichedColor = enrichColor(normalizedColor);
    context.beginPath();
    context.arc(64, 64, 49, 0, Math.PI * 2);
    const body = context.createLinearGradient(15, 0, 113, 0);
    body.addColorStop(0, colorHex(enrichColor(normalizedColor, 1.38, 1.2)));
    body.addColorStop(0.34, colorHex(enrichColor(normalizedColor, 1.36, 1.14)));
    body.addColorStop(0.7, colorHex(enrichedColor));
    body.addColorStop(1, colorHex(blendColors(enrichedColor, 0x000000, 0.08)));
    context.fillStyle = body;
    context.fill();

    context.save();
    context.beginPath();
    context.arc(64, 64, 49, 0, Math.PI * 2);
    context.clip();
    // Broad veils replace a hard glossy rim and keep the surface visibly frosted.
    const highlight = context.createLinearGradient(0, 12, 0, 76);
    highlight.addColorStop(0, 'rgba(255,255,255,.09)');
    highlight.addColorStop(0.58, 'rgba(255,255,255,.025)');
    highlight.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = highlight;
    context.fillRect(0, 8, 128, 74);

    const sideVeil = context.createLinearGradient(18, 0, 75, 0);
    sideVeil.addColorStop(0, 'rgba(255,255,255,.055)');
    sideVeil.addColorStop(0.66, 'rgba(255,255,255,.012)');
    sideVeil.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = sideVeil;
    context.fillRect(12, 12, 70, 98);

    context.restore();

    texture.refresh();
    return textureKey;
  }

  private createConnectionProgress(session: BoardSessionInput): ConnectionProgress {
    const lastIndex = session.level.solutionPath.length - 1;
    const visibleIndices = session.level.solutionPath
      .map((cell, index) => ({ index, hidden: session.hiddenCells.has(cellKey(cell)) }))
      .filter(({ index, hidden }) => !hidden || index === 0 || index === lastIndex)
      .map(({ index }) => index);
    const swappableHiddenPairs = findSwappableHiddenPairs(
      session.level.solutionPath,
      session.hiddenCells,
      session.level.boardShape,
    );
    const connection = new ConnectionProgress(
      session.level.solutionPath.length,
      visibleIndices,
      swappableHiddenPairs,
      new PathCompletionSolver(
        session.level.solutionPath,
        session.level.boardShape,
      ),
    );
    return connection;
  }

  private boardViewportLayout(view: BoardView) {
    const layout = calculateBoardViewportLayout({
      viewportWidth: view.viewportWidth,
      viewportHeight: view.viewportHeight,
      contentLeft: view.centerX - view.panelWidth * 0.5,
      contentTop: view.centerY - view.panelHeight * 0.5,
      contentWidth: view.panelWidth,
      contentHeight: view.panelHeight,
      zoom: this.session?.boardZoomEnabled ? BOARD_ZOOM_SCALE : 1,
      scrollX: this.boardViewportScroll.x,
      scrollY: this.boardViewportScroll.y,
      edgeInset: this.session?.boardZoomEnabled ? BOARD_ZOOM_EDGE_INSET : 0,
    });
    return {
      ...layout,
      rootX: layout.rootX + view.viewportLeft,
      rootY: layout.rootY + view.viewportTop,
    };
  }

  private applyBoardViewport(view = this.view, offsetY = 0): void {
    if (!view) return;
    const layout = this.boardViewportLayout(view);
    const zoom = this.session?.boardZoomEnabled ? BOARD_ZOOM_SCALE : 1;
    this.boardViewportScroll = { x: layout.scrollX, y: layout.scrollY };
    view.root.setScale(zoom);
    view.root.setPosition(layout.rootX, layout.rootY + offsetY);
  }

  private resolveBoardArtwork(
    session: BoardSessionInput,
    fallbackColor: number,
  ): ResolvedBoardArtwork | undefined {
    const input = session.artwork;
    if (!input || !this.textures.exists(input.textureKey)) return undefined;
    const texture = this.textures.get(input.textureKey);
    const frame = texture.get();
    const source = boardArtworkSourceRect(frame.realWidth, frame.realHeight, input);
    const cacheKey = [
      input.textureKey,
      input.sourceColumns,
      input.sourceRows,
      input.sourceIndex,
      session.level.columns,
      session.level.rows,
      'vivid-v1',
    ].join(':');
    let colors = this.artworkColorCache.get(cacheKey);
    if (!colors) {
      try {
        const sampledColors = sampleBoardArtworkAverageColors(
          texture.getSourceImage() as CanvasImageSource,
          source,
          session.level.rows,
          session.level.columns,
          fallbackColor,
        );
        // Averaging pixels naturally mutes color. Restore saturation and value
        // before the sampled palette is shared by beads, bridges, and feedback.
        colors = sampledColors.map((sampledColor) => enrichColor(sampledColor, 1.45, 1.1));
      } catch {
        colors = Array<number>(session.level.rows * session.level.columns).fill(fallbackColor);
      }
      this.artworkColorCache.set(cacheKey, colors);
    }
    return { input, source, colors, texture };
  }

  private artworkFrameName(
    artwork: BoardArtworkInput,
  ): string {
    return [
      'board-artwork',
      artwork.sourceColumns,
      artwork.sourceRows,
      artwork.sourceIndex,
    ].join('-');
  }

  private buildView(session: BoardSessionInput, offsetY: number): BoardView {
    const width = Math.max(this.scale.width, 320);
    const height = Math.max(this.scale.height, 1);
    let boardLeft = 0;
    let boardRight = width;
    let boardTop = 0;
    let boardBottom = height;
    if (session.artwork) {
      const canvasBounds = this.sys.game.canvas.getBoundingClientRect();
      if (canvasBounds.width > 0 && canvasBounds.height > 0) {
        const scaleX = width / canvasBounds.width;
        const scaleY = height / canvasBounds.height;
        const playScreen = this.sys.game.canvas.closest<HTMLElement>('.play-screen');
        const progressBar = document.querySelector<HTMLElement>('#play-puzzle-progress');
        const powerUpBar = document.querySelector<HTMLElement>('#power-up-bar');
        if (playScreen) {
          const screenBounds = playScreen.getBoundingClientRect();
          boardLeft = Phaser.Math.Clamp((screenBounds.left - canvasBounds.left) * scaleX, 0, width);
          boardRight = Phaser.Math.Clamp((screenBounds.right - canvasBounds.left) * scaleX, 0, width);
        }
        if (progressBar && !progressBar.hidden) {
          const progressBounds = progressBar.getBoundingClientRect();
          boardTop = Phaser.Math.Clamp((progressBounds.bottom - canvasBounds.top) * scaleY, 0, height);
        }
        if (powerUpBar) {
          const powerUpBounds = powerUpBar.getBoundingClientRect();
          boardBottom = Phaser.Math.Clamp((powerUpBounds.top - canvasBounds.top) * scaleY, 0, height);
        }
      }
    }
    if (boardRight <= boardLeft || boardBottom <= boardTop) {
      boardLeft = 0;
      boardRight = width;
      boardTop = 0;
      boardBottom = height;
    }
    const boardWidth = Math.max(1, boardRight - boardLeft);
    const boardHeight = Math.max(1, boardBottom - boardTop);
    const viewportCenterX = (boardLeft + boardRight) * 0.5;
    const centerX = 0;
    const centerY = (boardTop + boardBottom) * 0.5;
    const ballColor = levelBallColor(session.level.levelId);
    const artwork = this.resolveBoardArtwork(session, ballColor);
    const positions = new Map<string, { x: number; y: number }>();
    const isHex = session.level.boardShape === BoardShape.Hex;
    const raw = session.level.activeCells.map((cell) => ({
      cell,
      ...projectCell(cell, session.level.boardShape),
    }));
    const xs = raw.map((entry) => entry.x);
    const ys = raw.map((entry) => entry.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const rangeX = Math.max(0, maxX - minX);
    const rangeY = Math.max(0, maxY - minY);
    const horizontalStep = maximumStepForExtent(
      rangeX,
      Math.max(1, boardWidth - BOARD_HORIZONTAL_PADDING * 2),
      isHex,
    );
    const verticalStep = maximumStepForExtent(
      rangeY,
      Math.max(1, boardHeight - BOARD_VERTICAL_PADDING * 2),
      isHex,
    );
    let step = Math.min(horizontalStep, verticalStep);
    if (artwork && !isHex) {
      step = Math.min(
        step,
        Math.max(1, boardWidth - BOARD_HORIZONTAL_PADDING * 2) / Math.max(1, session.level.columns),
        Math.max(1, boardHeight - BOARD_VERTICAL_PADDING * 2) / Math.max(1, session.level.rows),
      );
    }
    const baseRadius = baseCellRadiusForStep(step, isHex);
    const radius = baseRadius * CELL_RADIUS_SCALE;
    const numberFontSize = numberFontSizeForBoard(
      baseRadius,
      session.level.solutionPath.length,
    );

    raw.forEach((entry) => {
      positions.set(cellKey(entry.cell), {
        x: (entry.x - (minX + maxX) * 0.5) * step,
        y: centerY + (entry.y - (minY + maxY) * 0.5) * step,
      });
    });

    const panelWidth = artwork
      ? Math.min(
          Math.max(1, boardWidth - BOARD_HORIZONTAL_PADDING * 2),
          session.level.columns * step,
        )
      : Math.min(
          Math.max(1, boardWidth - BOARD_HORIZONTAL_PADDING * 2),
          rangeX * step + radius * 2,
        );
    const panelHeight = artwork
      ? Math.min(
          Math.max(1, boardHeight - BOARD_VERTICAL_PADDING * 2),
          session.level.rows * step,
        )
      : Math.min(
          Math.max(1, boardHeight - BOARD_VERTICAL_PADDING * 2),
          rangeY * step + radius * 2,
        );
    const root = this.add.container(viewportCenterX, offsetY);
    const panel = this.add.rectangle(
      centerX,
      centerY,
      panelWidth,
      panelHeight,
      0xffffff,
      0,
    );
    const solutionLines = this.add.graphics();
    const lines = this.add.graphics();
    const pointerLine = this.add.graphics();
    root.add(panel);
    const artworkColorTiles: ArtworkColorTileView[] = [];
    if (artwork && !isHex) {
      session.level.activeCells.forEach((cell) => {
        const position = positions.get(cellKey(cell));
        if (!position) return;
        const color = artwork.colors[cell.y * session.level.columns + cell.x] ?? ballColor;
        const tile = this.add.rectangle(
          position.x,
          position.y,
          step + 1,
          step + 1,
          color,
          1,
        ).setAlpha(0);
        artworkColorTiles.push({
          column: cell.x,
          row: cell.y,
          rectangle: tile,
        });
      });
      root.add(artworkColorTiles.map(({ rectangle }) => rectangle));
    }
    let artworkImage: Phaser.GameObjects.Image | undefined;
    if (artwork) {
      const frameName = this.artworkFrameName(artwork.input);
      if (!artwork.texture.has(frameName)) {
        artwork.texture.add(
          frameName,
          0,
          artwork.source.x,
          artwork.source.y,
          artwork.source.width,
          artwork.source.height,
        );
      }
      artworkImage = this.add.image(centerX, centerY, artwork.input.textureKey, frameName)
        .setAlpha(0);
      root.add(artworkImage);
    }
    const cells = new Map<string, CellView>();
    const cellUnderlays: Phaser.GameObjects.GameObject[] = [];
    const cellForegrounds: Phaser.GameObjects.GameObject[] = [];

    session.level.solutionPath.forEach((cell, index) => {
      const position = positions.get(cellKey(cell));
      if (!position) return;
      const cellColor = artwork?.colors[cell.y * session.level.columns + cell.x] ?? ballColor;
      const glowRadius = radius + CELL_GLOW_RADIUS_MARGIN;
      const glow: CellShape = isHex
        ? this.add.polygon(position.x, position.y, hexagonPoints(glowRadius), COLORS.hint, 0)
        : this.add.circle(position.x, position.y, glowRadius, COLORS.hint, 0);
      glow.setStrokeStyle(CELL_GLOW_STROKE_WIDTH, COLORS.hint, 0);
      const slot = this.add.image(
        position.x,
        position.y,
        this.recessedCellSlotTexture(),
      ).setDisplaySize(cellSlotDisplaySize(radius), cellSlotDisplaySize(radius));
      const numberFill = this.add.image(
        position.x,
        position.y,
        this.numberFillTexture(INACTIVE_NUMBER_FILL_COLOR),
      ).setDisplaySize(numberFillDisplaySize(radius), numberFillDisplaySize(radius));
      const liquidRingRadius = liquidBallRadius(radius);
      const liquidRing: CellShape = isHex
        ? this.add.polygon(position.x, position.y, hexagonPoints(liquidRingRadius), ballColor, 0)
        : this.add.circle(position.x, position.y, liquidRingRadius, ballColor, 0);
      const circle: CellShape = isHex
        ? this.add.polygon(position.x, position.y, hexagonPoints(radius), ballColor, 1)
        : this.add.circle(position.x, position.y, radius, ballColor, 1);
      const hollowRingWidth = hiddenCellRingWidth(radius);
      const hollowRingRadius = Math.max(1, radius - hollowRingWidth * 0.5);
      const hollowRing: CellShape = isHex
        ? this.add.polygon(position.x, position.y, hexagonPoints(hollowRingRadius), ballColor, 0)
        : this.add.circle(position.x, position.y, hollowRingRadius, ballColor, 0);
      hollowRing.setStrokeStyle(hollowRingWidth, ballColor, 1);
      hollowRing.setVisible(false);
      if (isHex) {
        circle.setInteractive((circle as Phaser.GameObjects.Polygon).geom, Phaser.Geom.Polygon.Contains);
      } else if (artwork) {
        circle.setInteractive(
          new Phaser.Geom.Rectangle(
            radius - step * 0.5,
            radius - step * 0.5,
            step,
            step,
          ),
          Phaser.Geom.Rectangle.Contains,
        );
      } else {
        circle.setInteractive(
          new Phaser.Geom.Circle(radius, radius, radius),
          Phaser.Geom.Circle.Contains,
        );
      }
      const label = this.add.text(position.x, position.y, String(index + 1), {
        fontFamily: 'Nunito Sans, sans-serif',
        fontStyle: '900',
        fontSize: `${numberFontSize}px`,
        color: COLORS.text,
        align: 'center',
      }).setOrigin(0.5);
      const labelTextHeight = label.height;
      const labelSize = baseRadius * 2;
      label.setFixedSize(labelSize, labelSize);
      label.setPadding(0, Math.max(0, (labelSize - labelTextHeight) * 0.5), 0, 0);
      const questionMark = this.add.text(position.x, position.y, '?', {
        fontFamily: 'Nunito Sans, sans-serif',
        fontStyle: '700',
        fontSize: `${numberFontSize}px`,
        color: colorHex(ballColor),
        align: 'center',
      }).setOrigin(0.5);
      const questionTextHeight = questionMark.height;
      questionMark.setFixedSize(labelSize, labelSize);
      questionMark.setPadding(
        0,
        Math.max(0, (labelSize - questionTextHeight) * 0.5),
        0,
        0,
      );
      questionMark
        .setVisible(false)
        .setAlpha(0)
        .setScale(HIDDEN_QUESTION_MIN_SCALE);
      circle.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.handleCellDown(index, pointer));
      cellUnderlays.push(glow, slot);
      cellForegrounds.push(liquidRing, circle, hollowRing, numberFill, label, questionMark);
      cells.set(cellKey(cell), {
        cell,
        index,
        x: position.x,
        y: position.y,
        color: cellColor,
        slot,
        numberFill,
        liquidRing,
        circle,
        hollowRing,
        glow,
        label,
        questionMark,
        questionShown: false,
      });
    });

    root.add(cellUnderlays);
    root.add([solutionLines, lines, pointerLine]);
    root.add(cellForegrounds);

    const choiceScore = this.add.text(0, 0, '', {
      fontFamily: 'Nunito Sans, sans-serif',
      fontStyle: '900',
      fontSize: `${Math.max(11, Math.min(18, numberFontSize * 0.58))}px`,
      color: '#ffffff',
      stroke: '#26374a',
      strokeThickness: Math.max(2, numberFontSize * 0.09),
      align: 'center',
    }).setOrigin(0.5).setVisible(false);
    root.add(choiceScore);

    return {
      root,
      panel,
      solutionLines,
      lines,
      pointerLine,
      choiceScore,
      cells,
      radius,
      step,
      numberFontSize,
      centerX,
      centerY,
      panelWidth,
      panelHeight,
      viewportLeft: boardLeft,
      viewportTop: boardTop,
      viewportWidth: boardWidth,
      viewportHeight: boardHeight,
      ballColor,
      artworkEnabled: artwork !== undefined,
      artworkColorTiles,
      artworkColumns: session.level.columns,
      artworkRows: session.level.rows,
      artworkImage,
    };
  }

  private refreshView(): void {
    if (!this.view || !this.session) return;
    const path = this.session.level.solutionPath;
    const selectingCell = this.cellSelectionHandler !== undefined;
    this.view.solutionLines.clear();
    if (this.solutionRevealed) {
      this.view.solutionLines.lineStyle(Math.max(3, this.view.radius * 0.18), this.view.ballColor, 0.58);
      this.view.solutionLines.beginPath();
      path.forEach((cell, index) => {
        const cellView = this.view!.cells.get(cellKey(cell));
        if (!cellView) return;
        if (index === 0) this.view!.solutionLines.moveTo(cellView.x, cellView.y);
        else this.view!.solutionLines.lineTo(cellView.x, cellView.y);
      });
      this.view.solutionLines.strokePath();
    }

    this.drawConnectedBridges();
    if (!this.isDrawing) this.view.pointerLine.clear();

    const nextHint = this.session.showNextNumber && !selectingCell
      ? this.connection?.suggestedNextHint()
      : undefined;
    const dragQuestionCenter = this.isDrawing && this.connection?.activeIndex !== undefined
      ? path[this.connection.activeIndex]
      : undefined;
    const artworkEnabled = this.view.artworkEnabled;
    let activeHintCell: CellView | undefined;

    this.view.cells.forEach((cellView, key) => {
      const connected = this.connection?.isNodeConnected(cellView.index) === true;
      const numberVisible = this.solutionRevealed || this.connection?.isVisible(cellView.index) === true;
      const revealedHidden = this.solutionRevealed
        && this.connection?.isVisible(cellView.index) !== true
        && this.session!.hiddenCells.has(key);
      const concealed = this.session!.hiddenCells.has(key) && !numberVisible;
      const showQuestion = shouldShowDragQuestion(
        dragQuestionCenter,
        cellView.cell,
        concealed,
      );
      const cellColor = artworkEnabled && connected
        ? cellView.color
        : this.view!.ballColor;
      const numberFillColor = connected ? cellColor : INACTIVE_NUMBER_FILL_COLOR;
      const isWrongCell = this.wrongCellIndexes.has(cellView.index);
      cellView.label.setText(String(this.connection?.displayNumber(cellView.index) ?? cellView.index + 1));
      const slotTexture = isWrongCell
        ? this.wrongCellSlotTexture()
        : this.recessedCellSlotTexture();
      if (cellView.slot.texture.key !== slotTexture) {
        cellView.slot
          .setTexture(slotTexture)
          .setDisplaySize(
            cellSlotDisplaySize(this.view!.radius),
            cellSlotDisplaySize(this.view!.radius),
          );
      }
      cellView.slot.setVisible(true).setAlpha(1);
      const numberFillTexture = this.numberFillTexture(numberFillColor);
      if (cellView.numberFill.texture.key !== numberFillTexture) {
        cellView.numberFill
          .setTexture(numberFillTexture)
          .setDisplaySize(
            numberFillDisplaySize(this.view!.radius),
            numberFillDisplaySize(this.view!.radius),
          );
      }
      cellView.numberFill
        .setVisible(numberVisible && !isWrongCell)
        .setAlpha(1);
      // The legacy liquid node remains as animation state for bridge scaling,
      // but the visible node is now the consistently sized numberFill texture.
      cellView.liquidRing.setFillStyle(cellColor, 0);
      cellView.circle.setFillStyle(
        cellColor,
        0,
      );
      cellView.hollowRing.setVisible(false);
      cellView.label.setVisible(numberVisible && !isWrongCell);
      cellView.label.setAlpha(1);
      cellView.label.setColor(
        !connected
          ? INACTIVE_NUMBER_TEXT_COLOR
          : artworkEnabled
            ? contrastTextForColor(cellColor)
            : revealedHidden
              ? COLORS.revealedHiddenText
              : COLORS.selectedText,
      );
      cellView.label.setStroke('rgba(0,0,0,0)', 0);
      cellView.label.setFontStyle(revealedHidden ? 'italic 900' : '900');
      cellView.questionMark.setColor(colorHex(cellColor));
      if (artworkEnabled) {
        cellView.questionMark.setStroke(
          contrastTextForColor(cellColor),
          Math.max(1.5, this.view!.numberFontSize * 0.065),
        );
      }
      this.setQuestionMarkVisible(cellView, showQuestion && !isWrongCell);
      const hint = cellView.index === nextHint?.index;
      const hintColor = nextHint?.consecutive ? COLORS.consecutiveHint : COLORS.hint;
      const glowColor = selectingCell
        ? COLORS.powerUpTarget
        : hintColor;
      cellView.glow.setFillStyle(
        glowColor,
        selectingCell ? 0.13 : hint ? 0.2 : 0,
      );
      cellView.glow.setStrokeStyle(
        CELL_GLOW_STROKE_WIDTH,
        glowColor,
        selectingCell ? 0.72 : hint ? 0.9 : 0,
      );
      if (hint) activeHintCell = cellView;
    });

    this.startHintPulse(activeHintCell);
    if (this.session.boardZoomEnabled && this.neighborhoodPreviewIndex === undefined) {
      this.emitNeighborhoodPreview(null);
    }
  }

  private setQuestionMarkVisible(cell: CellView, visible: boolean): void {
    if (cell.questionShown === visible) return;
    cell.questionShown = visible;
    this.tweens.killTweensOf(cell.questionMark);

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      cell.questionMark
        .setVisible(visible)
        .setAlpha(visible ? HIDDEN_QUESTION_ALPHA : 0)
        .setScale(visible ? 1 : HIDDEN_QUESTION_MIN_SCALE);
      return;
    }

    if (visible) {
      if (!cell.questionMark.visible) {
        cell.questionMark
          .setAlpha(0)
          .setScale(HIDDEN_QUESTION_MIN_SCALE);
      }
      cell.questionMark.setVisible(true);
      this.tweens.add({
        targets: cell.questionMark,
        alpha: HIDDEN_QUESTION_ALPHA,
        scaleX: 1,
        scaleY: 1,
        duration: HIDDEN_QUESTION_SHOW_DURATION_MS,
        ease: 'Back.easeOut',
      });
      return;
    }

    if (!cell.questionMark.visible) {
      cell.questionMark
        .setAlpha(0)
        .setScale(HIDDEN_QUESTION_MIN_SCALE);
      return;
    }
    this.tweens.add({
      targets: cell.questionMark,
      alpha: 0,
      scaleX: HIDDEN_QUESTION_MIN_SCALE,
      scaleY: HIDDEN_QUESTION_MIN_SCALE,
      duration: HIDDEN_QUESTION_HIDE_DURATION_MS,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        if (!cell.questionShown) cell.questionMark.setVisible(false);
      },
    });
  }

  private hideDragQuestions(): void {
    this.view?.cells.forEach((cell) => this.setQuestionMarkVisible(cell, false));
  }

  private drawConnectedBridges(): void {
    if (!this.view || !this.session) return;
    const path = this.session.level.solutionPath;
    const lineWidth = Math.max(3, this.view.radius * 0.3);
    this.view.lines.clear();

    for (const [fromIndex, toIndex] of this.connection?.connectedNodePairs() ?? []) {
      const from = this.view.cells.get(cellKey(path[fromIndex]));
      const to = this.view.cells.get(cellKey(path[toIndex]));
      if (!from || !to) continue;
      this.view.lines.lineStyle(
        lineWidth,
        this.view.artworkEnabled ? mixColors(from.color, to.color) : this.view.ballColor,
        1,
      );
      this.view.lines.beginPath();
      this.view.lines.moveTo(from.numberFill.x, from.numberFill.y);
      this.view.lines.lineTo(to.numberFill.x, to.numberFill.y);
      this.view.lines.strokePath();
    }
  }

  private redrawLiquidConnections(): void {
    this.drawConnectedBridges();
    if (!this.view) return;
    if (!this.isDrawing || !this.pointerLineTarget) {
      this.view.pointerLine.clear();
      return;
    }
    this.drawPointerLine(this.pointerLineTarget.x, this.pointerLineTarget.y);
  }

  private startHintPulse(cell?: CellView): void {
    if (this.hintCell === cell && this.hintTween?.isPlaying()) return;
    this.stopHintPulse();
    if (!cell) return;

    this.hintCell = cell;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      cell.glow.setScale(1).setAlpha(1);
      return;
    }

    cell.glow.setScale(0.94).setAlpha(0.64);
    this.hintTween = this.tweens.add({
      targets: cell.glow,
      scale: CELL_HINT_MAX_SCALE,
      alpha: 1,
      duration: 880,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    });
  }

  private stopHintPulse(): void {
    this.hintTween?.stop();
    this.hintTween = undefined;
    this.hintCell?.glow.setScale(1).setAlpha(1);
    this.hintCell = undefined;
  }

  private handleCellDown(index: number, pointer: Phaser.Input.Pointer): void {
    if (this.locked || this.transitioning || !this.connection) return;
    if (this.drawingPointerId !== undefined && this.drawingPointerId !== pointer.id) return;
    if (this.cellSelectionHandler && this.session) {
      const cell = this.session.level.solutionPath[index];
      if (cell) this.cellSelectionHandler({ ...cell });
      return;
    }
    this.session?.onInteraction?.();
    this.isDrawing = true;
    this.drawingPointerId = pointer.id;
    this.wrongFeedbackActive = false;
    this.handleConnectionAction(this.connection.begin(index, this.solutionRevealed));
    this.emitNeighborhoodPreview(index, pointer);
    this.showHeldCellChoiceScore(index);
    if (this.view) {
      this.drawPointerLine(
        (pointer.x - this.view.root.x) / Math.max(0.01, Math.abs(this.view.root.scaleX)),
        (pointer.y - this.view.root.y) / Math.max(0.01, Math.abs(this.view.root.scaleY)),
      );
    }
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (
      !this.isDrawing
      || this.drawingPointerId !== pointer.id
      || !pointer.isDown
      || this.locked
      || this.completionCheckPending
      || !this.view
      || !this.connection
      || !this.session
    ) return;
    const localX = (
      (pointer.x - this.view.root.x) / Math.max(0.01, Math.abs(this.view.root.scaleX))
    );
    const localY = (
      (pointer.y - this.view.root.y) / Math.max(0.01, Math.abs(this.view.root.scaleY))
    );
    const activeIndex = this.connection.activeIndex;
    const activeCell = activeIndex === undefined
      ? undefined
      : this.session.level.solutionPath[activeIndex];
    let closest: CellView | undefined;
    let bestDistance = this.view.radius ** 2;
    this.view.cells.forEach((candidate) => {
      if (!activeCell) return;
      const judgmentMode = dragJudgmentMode(
        activeCell,
        candidate.cell,
        !this.solutionRevealed && !this.connection!.isVisible(candidate.index),
      );
      if (judgmentMode === 'ignore') return;
      const distance = (candidate.x - localX) ** 2 + (candidate.y - localY) ** 2;
      if (distance <= bestDistance) {
        bestDistance = distance;
        closest = candidate;
      }
    });
    if (closest && activeCell) {
      const closestJudgmentMode = dragJudgmentMode(
        activeCell,
        closest.cell,
        !this.solutionRevealed && !this.connection.isVisible(closest.index),
      );
      const stepReward = this.stepRewardFeedback(this.connection.activeIndex, closest.index);
      if (this.connection.canExtendWithoutSearch(closest.index)) {
        const action = this.connection.extend(closest.index);
        if (shouldHandleDragAction(closestJudgmentMode, action.type === 'wrong')) {
          this.handleConnectionAction(action, true, stepReward);
        }
      } else {
        const session = this.session;
        const connection = this.connection;
        this.completionCheckPending = true;
        void connection.extendAsync(closest.index, (request) => (
          findPathCompletionInWorker(session.level.solutionPath, session.level.boardShape, request)
        )).then((action) => {
          if (
            this.session === session
            && this.connection === connection
            && shouldHandleDragAction(closestJudgmentMode, action.type === 'wrong')
          ) this.handleConnectionAction(action, true, stepReward);
        }).catch(() => undefined).finally(() => {
          if (this.connection === connection) this.completionCheckPending = false;
        });
      }
    }
    const previewIndex = closest?.index ?? this.neighborhoodPreviewIndex;
    if (!this.locked && previewIndex !== undefined) {
      this.emitNeighborhoodPreview(previewIndex, pointer);
      this.showHeldCellChoiceScore(previewIndex);
    }
    this.drawPointerLine(localX, localY);
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.drawingPointerId !== undefined && this.drawingPointerId !== pointer.id) return;
    this.finishPointerInteraction(true);
  }

  private finishPointerInteraction(countRelease = false): void {
    const wasDrawing = this.isDrawing;
    this.isDrawing = false;
    this.drawingPointerId = undefined;
    this.drawingNativePointerId = undefined;
    this.pointerLineTarget = undefined;
    this.wrongFeedbackActive = false;
    this.connection?.endStroke();
    this.view?.pointerLine.clear();
    if (this.connection?.complete !== true) this.lowerRaisedConnectedCell();
    if (wasDrawing && this.connection?.complete !== true) this.resetConnectionComboEdge();
    if (wasDrawing) this.refreshView();
    if (wasDrawing && countRelease) this.session?.onRelease?.();
    this.clearNeighborhoodPreview();
  }

  private emitNeighborhoodPreview(
    index: number | null = null,
    pointer?: Phaser.Input.Pointer,
  ): void {
    if (!this.session || !this.connection || !this.view) return;
    const centerCell = index === null ? undefined : this.session.level.solutionPath[index];
    const centerView = centerCell ? this.view.cells.get(cellKey(centerCell)) : undefined;
    const rootScaleX = Math.max(0.01, Math.abs(this.view.root.scaleX));
    const rootScaleY = Math.max(0.01, Math.abs(this.view.root.scaleY));
    const localX = pointer ? (pointer.x - this.view.root.x) / rootScaleX : 0;
    const localY = pointer ? (pointer.y - this.view.root.y) / rootScaleY : 0;
    const canvasBounds = pointer ? this.sys.game.canvas.getBoundingClientRect() : undefined;
    const clientX = pointer && canvasBounds
      ? canvasBounds.left + (pointer.x / Math.max(1, this.scale.width)) * canvasBounds.width
      : 0;
    const clientY = pointer && canvasBounds
      ? canvasBounds.top + (pointer.y / Math.max(1, this.scale.height)) * canvasBounds.height
      : 0;
    const originGameX = centerView
      ? this.view.root.x + centerView.x * rootScaleX
      : pointer?.x ?? 0;
    const originGameY = centerView
      ? this.view.root.y + centerView.y * rootScaleY
      : pointer?.y ?? 0;
    const originClientX = canvasBounds
      ? canvasBounds.left + (originGameX / Math.max(1, this.scale.width)) * canvasBounds.width
      : clientX;
    const originClientY = canvasBounds
      ? canvasBounds.top + (originGameY / Math.max(1, this.scale.height)) * canvasBounds.height
      : clientY;
    const basePreview = buildBoardNeighborhoodPreview(
      this.session.level,
      index,
      (candidateIndex) => this.solutionRevealed || this.connection?.isVisible(candidateIndex) === true,
      (candidateIndex) => this.connection?.displayNumber(candidateIndex) ?? candidateIndex + 1,
      clientX,
      clientY,
      {
        connectedNodePairs: this.connection.connectedNodePairs(),
        focusRingDepth: this.session.touchPreviewRingDepth,
        originClientX,
        originClientY,
        pointer: index !== null && centerView && pointer ? {
          fromIndex: this.connection.activeIndex ?? index,
          offsetX: (localX - centerView.x) / this.view.step,
          offsetY: (localY - centerView.y) / this.view.step,
        } : null,
      },
    );
    if (!basePreview) return;
    const viewportLayout = this.session.boardZoomEnabled
      ? this.boardViewportLayout(this.view)
      : undefined;
    const preview = viewportLayout
      ? {
          ...basePreview,
          viewport: {
            zoom: BOARD_ZOOM_SCALE,
            scrollX: viewportLayout.scrollX,
            scrollY: viewportLayout.scrollY,
            viewportWidthRatio: viewportLayout.viewportWidthRatio,
            viewportHeightRatio: viewportLayout.viewportHeightRatio,
            cellDiameterToStep: (this.view.radius * 2) / Math.max(0.01, this.view.step),
            numberFontToCellDiameter: this.view.numberFontSize / Math.max(1, this.view.radius * 2),
          },
        }
      : basePreview;
    this.neighborhoodPreviewIndex = index ?? undefined;
    this.session.onNeighborhoodPreview?.(preview);
  }

  private clearNeighborhoodPreview(): void {
    this.neighborhoodPreviewIndex = undefined;
    this.hideHeldCellChoiceScore();
    if (this.session?.boardZoomEnabled && this.connection && this.view) {
      this.emitNeighborhoodPreview(null);
    } else {
      this.session?.onNeighborhoodPreview?.(null);
    }
  }

  private showHeldCellChoiceScore(index: number): void {
    if (!this.session || !this.connection || !this.view) return;
    if (this.session.showDifficultyScore !== true) {
      this.hideHeldCellChoiceScore();
      return;
    }
    const heldCell = this.session.level.solutionPath[index];
    const heldCellView = heldCell
      ? this.view.cells.get(cellKey(heldCell))
      : undefined;
    if (!heldCellView) {
      this.hideHeldCellChoiceScore();
      return;
    }

    const session = this.session;
    const view = this.view;
    const displayToken = ++this.heldScoreDisplayToken;
    void this.heldCellChoiceScore(index).then((score) => {
      if (
        !score
        || this.session !== session
        || this.view !== view
        || displayToken !== this.heldScoreDisplayToken
      ) return;
      view.choiceScore
        .setText(String(score.badgeScore))
        .setPosition(
          heldCellView.x - view.radius * 0.72,
          heldCellView.y - view.radius * 0.72,
        )
        .setVisible(true);
      session.onHoldScore?.(score);
    });
  }

  private heldCellChoiceScore(index: number): Promise<BoardHoldScore | undefined> {
    if (!this.session || !this.connection || !this.session.level.solutionPath[index]) {
      return Promise.resolve(undefined);
    }
    const level = this.session.level;
    const connection = this.connection;
    const snapshot = connection.completionSnapshot();
    const availableIndices = level.solutionPath.flatMap((cell, candidateIndex) => (
      !this.solutionRevealed
      && this.session?.hiddenCells.has(cellKey(cell))
      && !connection.isNodeConnected(candidateIndex)
        ? [candidateIndex]
        : []
    ));
    const visibleIndices = level.solutionPath.flatMap((_, candidateIndex) => (
      this.solutionRevealed || connection.isVisible(candidateIndex) ? [candidateIndex] : []
    ));
    const displayNumbers = level.solutionPath.map((_, candidateIndex) => (
      connection.displayNumber(candidateIndex)
    ));
    const cacheKey = JSON.stringify([
      level.levelId,
      index,
      availableIndices,
      visibleIndices,
      snapshot.fixedPositions,
      snapshot.requiredEdges,
      snapshot.solutionOrder,
    ]);
    const cached = this.heldScoreRequests.get(cacheKey);
    if (cached) return cached;
    const request = calculateCompletionAwareScoreInWorker({
      cells: level.solutionPath.map((cell) => ({ ...cell })),
      boardShape: level.boardShape,
      centerIndex: index,
      availableIndices,
      visibleIndices,
      displayNumbers,
      fixedPositions: snapshot.fixedPositions,
      requiredEdges: snapshot.requiredEdges,
      solutionOrder: snapshot.solutionOrder,
    }).catch(() => undefined);
    if (this.heldScoreRequests.size >= 256) {
      const oldestKey = this.heldScoreRequests.keys().next().value as string | undefined;
      if (oldestKey !== undefined) this.heldScoreRequests.delete(oldestKey);
    }
    this.heldScoreRequests.set(cacheKey, request);
    return request;
  }

  private stepRewardFeedback(fromIndex: number | undefined, toIndex: number): PendingStepRewardFeedback | undefined {
    if (!this.session || !this.connection || fromIndex === undefined) return undefined;
    const target = this.session.level.solutionPath[toIndex];
    if (
      !target
      || !this.session.hiddenCells.has(cellKey(target))
      || this.connection.isVisible(toIndex)
    ) return undefined;
    const session = this.session;
    return {
      index: toIndex,
      session,
      result: this.heldCellChoiceScore(fromIndex).then((score) => {
        const emoji = score ? stepRewardEmojiForDifficulty(score.badgeScore) : undefined;
        return emoji ? { index: toIndex, emoji } : undefined;
      }),
    };
  }

  private hideHeldCellChoiceScore(): void {
    this.heldScoreDisplayToken += 1;
    this.view?.choiceScore.setVisible(false);
    this.session?.onHoldScore?.(null);
  }

  private drawPointerLine(localX: number, localY: number): void {
    if (!this.view) return;
    const pointerLine = this.view.pointerLine;
    pointerLine.clear();
    if (!this.isDrawing || this.locked || !this.connection || !this.session) return;
    this.pointerLineTarget = { x: localX, y: localY };

    const activeIndex = this.connection.activeIndex;
    if (activeIndex === undefined) return;
    const activeCell = this.session.level.solutionPath[activeIndex];
    const from = activeCell ? this.view.cells.get(cellKey(activeCell)) : undefined;
    if (!from) return;

    pointerLine.lineStyle(
      Math.max(3, this.view.radius * 0.3),
      this.view.artworkEnabled ? from.color : this.view.ballColor,
      1,
    );
    pointerLine.beginPath();
    pointerLine.moveTo(from.numberFill.x, from.numberFill.y);
    pointerLine.lineTo(localX, localY);
    pointerLine.strokePath();
  }

  private handleConnectionAction(
    action: ConnectionAction,
    playFeedback = true,
    stepReward?: PendingStepRewardFeedback,
  ): void {
    if (!this.session || !this.view || !this.connection || action.type === 'ignored') return;
    if (action.type === 'wrong') {
      if (this.wrongFeedbackActive) return;
      this.wrongFeedbackActive = true;
      const shouldLoseLife = !this.wrongCellIndexes.has(action.index);
      const scoringIndex = this.connection.activeIndex ?? action.index;
      const stepNumber = this.connection.displayNumber(scoringIndex);
      this.flashWrong(action.index);
      this.resetConnectionComboEdge();
      this.playSound('wrong');
      this.pendingStepReward = undefined;
      this.finishPointerInteraction(true);
      this.connection?.endStroke();
      const score = Promise.resolve()
        .then(() => this.heldCellChoiceScore(scoringIndex))
        .catch(() => undefined);
      this.session.onWrong(
        this.connectionFailureMessage(action.reason),
        shouldLoseLife,
        { stepNumber, score },
      );
      return;
    }

    this.wrongFeedbackActive = false;
    if (action.type === 'started') {
      this.wrongCellIndexes.clear();
      this.refreshView();
      if (playFeedback) this.playConnectedCellBounce(action.index);
      this.renderLevelProgressEdge(action.index);
      return;
    }
    if (!action.added) {
      this.refreshView();
      return;
    }
    this.wrongCellIndexes.clear();
    this.refreshView();
    const rewardToPlay = this.pendingStepReward;
    this.pendingStepReward = stepReward?.index === action.index ? stepReward : undefined;
    if (playFeedback && rewardToPlay) {
      void rewardToPlay.result.then((feedback) => {
        if (feedback && this.session === rewardToPlay.session) this.playStepRewardFeedback(feedback);
      });
    }

    const completionSession = this.session;
    let completionWaitsForLanding = false;
    if (playFeedback) {
      const feedbackStarted = this.playConnectedCellBounce(action.index, () => {
        this.playCellRipple(action.index);
        if (!action.complete || this.session !== completionSession) return;
        this.lowerRaisedConnectedCell(() => {
          if (this.session === completionSession) completionSession.onComplete();
        });
      });
      completionWaitsForLanding = action.complete && feedbackStarted;
      const comboLevel = this.session.chargeProgressMode === 'coins'
        ? this.advanceConnectionComboEdge(action.index)
        : undefined;
      if (comboLevel !== undefined) this.playSound(`combo-${comboLevel}`);
    }
    this.renderLevelProgressEdge(action.index);
    this.session.onProgress(action.progress, this.session.level.solutionPath.length);

    if (action.complete) {
      this.locked = true;
      if (this.isDrawing) this.session.onRelease?.();
      this.isDrawing = false;
      this.connection?.endStroke();
      this.hideDragQuestions();
      this.clearNeighborhoodPreview();
      if (!completionWaitsForLanding) completionSession.onComplete();
    }
  }

  private playStepRewardFeedback(feedback: StepRewardFeedback): void {
    if (!this.view || !this.session) return;
    const pathCell = this.session.level.solutionPath[feedback.index];
    const cell = pathCell ? this.view.cells.get(cellKey(pathCell)) : undefined;
    if (!cell) return;

    const isThumb = feedback.emoji === '👍';
    const isClap = feedback.emoji === '👏';
    const originX = isThumb ? 0.12 : 0.5;
    const originY = isThumb ? 0.88 : 0.5;
    const tapAngle = isThumb ? 17 : -17;
    const radius = this.view.radius;

    const reward = this.add.text(cell.x, cell.y, feedback.emoji, {
      fontFamily: 'Segoe UI Emoji, Apple Color Emoji, sans-serif',
      fontSize: `${Math.max(36, radius * 2.1)}px`,
      align: 'center',
    }).setOrigin(originX, originY).setAlpha(isClap ? 1 : 0).setScale(isClap ? 1.3 : 0.42);
    reward.setPosition(
      cell.x + (originX - 0.5) * reward.width,
      cell.y + (originY - 0.5) * reward.height,
    );
    const restingY = reward.y - radius * 0.72;
    this.view.root.add(reward);

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      reward.setAlpha(1).setScale(1);
      this.time.delayedCall(420, () => reward.destroy());
      return;
    }

    if (isClap) {
      this.tweens.add({
        targets: reward,
        scaleX: 1,
        scaleY: 1,
        duration: 75,
        ease: 'Quad.easeOut',
        onComplete: () => {
          this.tweens.add({
            targets: reward,
            alpha: 0,
            duration: 100,
            ease: 'Quad.easeIn',
            onComplete: () => {
              reward.setAlpha(1).setScale(1.3);
              this.tweens.add({
                targets: reward,
                scaleX: 1,
                scaleY: 1,
                duration: 75,
                ease: 'Quad.easeOut',
                onComplete: () => {
                  this.tweens.add({
                    targets: reward,
                    alpha: 0,
                    delay: 120,
                    duration: 220,
                    ease: 'Quad.easeIn',
                    onComplete: () => reward.destroy(),
                  });
                },
              });
            },
          });
        },
      });
      return;
    }

    this.tweens.add({
      targets: reward,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      y: restingY,
      duration: 260,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: reward,
          angle: tapAngle,
          duration: 120,
          ease: 'Sine.easeInOut',
          yoyo: true,
          repeat: 1,
          repeatDelay: 70,
          onComplete: () => {
            this.tweens.add({
              targets: reward,
              alpha: 0,
              scaleX: 0.88,
              scaleY: 0.88,
              y: restingY - radius * 0.53,
              delay: 120,
              duration: 300,
              ease: 'Quad.easeIn',
              onComplete: () => reward.destroy(),
            });
          },
        });
      },
    });
  }

  private playConnectedCellBounce(index: number, onPeak?: () => void): boolean {
    if (
      !this.view
      || !this.session
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) return false;
    const pathCell = this.session.level.solutionPath[index];
    const cell = pathCell ? this.view.cells.get(cellKey(pathCell)) : undefined;
    if (!cell) return false;

    if (this.raisedConnectedCellIndex !== undefined && this.raisedConnectedCellIndex !== index) {
      this.lowerRaisedConnectedCell();
    }

    this.raisedConnectedCellIndex = index;
    const targets = [cell.numberFill, cell.liquidRing, cell.circle, cell.hollowRing, cell.label];
    this.tweens.killTweensOf(targets);
    targets.forEach((target) => target.setY(cell.y));
    const liftHeight = cell.numberFill.displayHeight / 3;
    this.tweens.add({
      targets,
      y: cell.y - liftHeight,
      duration: 150,
      ease: 'Quad.easeOut',
      onUpdate: () => this.redrawLiquidConnections(),
      onComplete: () => {
        this.redrawLiquidConnections();
        onPeak?.();
      },
    });
    return true;
  }

  private lowerRaisedConnectedCell(onLanded?: () => void): void {
    if (!this.view || !this.session || this.raisedConnectedCellIndex === undefined) {
      onLanded?.();
      return;
    }
    const raisedIndex = this.raisedConnectedCellIndex;
    this.raisedConnectedCellIndex = undefined;
    const pathCell = this.session.level.solutionPath[raisedIndex];
    const cell = pathCell ? this.view.cells.get(cellKey(pathCell)) : undefined;
    if (!cell) {
      onLanded?.();
      return;
    }

    const targets = [cell.numberFill, cell.liquidRing, cell.circle, cell.hollowRing, cell.label];
    this.tweens.killTweensOf(targets);
    this.tweens.add({
      targets,
      y: cell.y,
      duration: 150,
      ease: 'Quad.easeIn',
      onUpdate: () => this.redrawLiquidConnections(),
      onComplete: () => {
        targets.forEach((target) => target.setY(cell.y));
        this.redrawLiquidConnections();
        onLanded?.();
      },
    });
  }

  private playCellRipple(index: number, color?: number): void {
    if (
      !this.view
      || !this.session
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) return;
    const pathCell = this.session.level.solutionPath[index];
    const cell = pathCell ? this.view.cells.get(cellKey(pathCell)) : undefined;
    if (!cell) return;

    const rippleColor = color ?? (this.view.artworkEnabled ? cell.color : this.view.ballColor);
    const rippleStrokeWidth = this.view.radius * 0.3;
    const rippleMaxRadius = this.view.radius * 1.6;
    const rippleMaxScale = rippleMaxRadius / (this.view.radius + rippleStrokeWidth * 0.5);
    const ripple = this.add.circle(
      cell.numberFill.x,
      cell.numberFill.y,
      this.view.radius,
      rippleColor,
      0,
    )
      .setStrokeStyle(rippleStrokeWidth, rippleColor, 1)
      .setAlpha(0.82)
      .setScale(0.82);
    this.view.root.add(ripple);

    this.tweens.add({
      targets: ripple,
      scaleX: rippleMaxScale,
      scaleY: rippleMaxScale,
      alpha: 0,
      duration: 480,
      ease: 'Sine.easeOut',
      onComplete: () => ripple.destroy(),
    });
  }

  private playPowerUpReveal(indexes: ReadonlyArray<number>): void {
    if (!this.view || !this.session || indexes.length === 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const revealed = indexes
      .map((index) => this.view!.cells.get(cellKey(this.session!.level.solutionPath[index])))
      .filter((cell): cell is CellView => cell !== undefined);
    const targets = revealed.flatMap((cell) => [cell.circle, cell.label]);
    this.tweens.killTweensOf(targets);
    targets.forEach((target) => target.setAlpha(0.2).setScale(0.68));
    revealed.forEach((cell) => cell.numberFill.setAlpha(0.2));
    revealed.forEach((cell, index) => {
      cell.glow.setFillStyle(COLORS.powerUpReveal, 0.34);
      cell.glow.setStrokeStyle(4, COLORS.powerUpReveal, 0.92);
      cell.glow.setScale(0.82);
      this.tweens.add({
        targets: [cell.circle, cell.label],
        alpha: 1,
        scaleX: 1,
        scaleY: 1,
        delay: index * 45,
        duration: 230,
        ease: 'Back.easeOut',
      });
      this.tweens.add({
        targets: cell.numberFill,
        alpha: 1,
        delay: index * 45,
        duration: 230,
        ease: 'Sine.easeOut',
      });
      this.tweens.add({
        targets: cell.glow,
        alpha: 0,
        scaleX: 1.32,
        scaleY: 1.32,
        delay: index * 45,
        duration: 420,
        ease: 'Sine.easeOut',
        onComplete: () => {
          cell.glow.setAlpha(1).setScale(1);
          if (index === revealed.length - 1) this.refreshView();
        },
      });
    });
  }

  private connectionFailureMessage(reason: ConnectionFailure): string {
    if (reason === 'hidden-start') return '请从显示数字开始。';
    if (reason === 'start-order') return '请从数字 1 开始，并沿当前进度从小到大连续连接。';
    if (reason === 'no-completion') return '这样连接后，剩余格子无法完成一笔连。';
    if (reason === 'direction-change') return '请按从小到大的顺序连接连续数字。';
    return '请连接相邻的连续数字。';
  }

  private flashWrong(index: number): void {
    if (!this.view || !this.session) return;
    const cell = this.view.cells.get(cellKey(this.session.level.solutionPath[index]));
    if (!cell) return;
    this.wrongCellIndexes.add(index);
    this.refreshView();
    this.playCellRipple(index, COLORS.wrongRipple);
  }

  private playSound(key: string): void {
    if (!this.session?.soundEnabled || !this.cache.audio.exists(key)) return;
    try {
      this.sound.play(key, { volume: key === 'victory' ? 0.55 : 0.72 });
    } catch {
      // Browsers may keep WebAudio locked until the first explicit pointer gesture.
    }
  }

  private advanceConnectionComboEdge(index: number): number | undefined {
    this.connectionComboCount += 1;
    if (this.connectionComboCount < 2) return undefined;
    const comboProgress = this.connectionComboCount - 1;
    const soundLevel = Phaser.Math.Clamp(comboProgress, 1, 8);
    const numberCount = this.session?.level.solutionPath.length ?? 0;
    const totalComboProgress = Math.max(10, Math.ceil(numberCount / 4));
    const progress = Math.min(1, comboProgress / totalComboProgress);
    const edge = this.connectionComboEdge();
    const pathCell = this.session?.level.solutionPath[index];
    const cell = pathCell && this.view ? this.view.cells.get(cellKey(pathCell)) : undefined;
    const ballColor = this.view
      ? this.view.artworkEnabled && cell
        ? cell.color
        : this.view.ballColor
      : 0xff9f43;
    edge?.style.setProperty(
      '--connection-combo-color',
      `#${ballColor.toString(16).padStart(6, '0')}`,
    );
    edge?.style.setProperty(
      '--connection-combo-horizontal-length',
      `${Math.min(50, progress * 100)}%`,
    );
    edge?.style.setProperty(
      '--connection-combo-vertical-length',
      `${Math.max(0, (progress - 0.5) * 100)}%`,
    );
    edge?.classList.add('is-active');
    if (progress >= 1) {
      this.clearConnectionComboEdgeVisual();
      this.connectionComboCount = 0;
      this.session?.onComboComplete?.();
    }
    return soundLevel;
  }

  private resetConnectionComboEdge(forceClear = false): void {
    if (!forceClear && this.session?.chargeProgressMode === 'progress') {
      this.renderLevelProgressEdge();
      return;
    }
    this.connectionComboCount = 0;
    this.clearConnectionComboEdgeVisual();
  }

  private renderLevelProgressEdge(index = this.connection?.activeIndex): void {
    if (this.session?.chargeProgressMode !== 'progress') return;
    const total = this.session.level.solutionPath.length;
    const progress = total > 0 ? Math.min(1, (this.connection?.progress ?? 0) / total) : 0;
    if (progress <= 0) {
      this.clearConnectionComboEdgeVisual();
      return;
    }
    const edge = this.connectionComboEdge();
    const pathCell = index === undefined ? undefined : this.session.level.solutionPath[index];
    const cell = pathCell && this.view ? this.view.cells.get(cellKey(pathCell)) : undefined;
    const ballColor = this.view
      ? this.view.artworkEnabled && cell
        ? cell.color
        : this.view.ballColor
      : 0x57d88b;
    edge?.style.setProperty(
      '--connection-combo-color',
      `#${ballColor.toString(16).padStart(6, '0')}`,
    );
    edge?.style.setProperty(
      '--connection-combo-horizontal-length',
      `${Math.min(50, progress * 100)}%`,
    );
    edge?.style.setProperty(
      '--connection-combo-vertical-length',
      `${Math.max(0, (progress - 0.5) * 100)}%`,
    );
    edge?.classList.add('is-active');
  }

  private clearConnectionComboEdgeVisual(): void {
    const edge = this.connectionComboEdge();
    edge?.classList.remove('is-active', 'is-screen-filling', 'is-screen-filled');
    edge?.style.setProperty('--connection-combo-horizontal-length', '0%');
    edge?.style.setProperty('--connection-combo-vertical-length', '0%');
  }

  private connectionComboEdge(): HTMLElement | null {
    return this.sys.game.canvas
      .closest<HTMLElement>('.play-screen')
      ?.querySelector<HTMLElement>('#connection-combo-edge') ?? null;
  }

  private stageCompletionEdge(): HTMLElement | null {
    return this.sys.game.canvas
      .closest<HTMLElement>('.play-screen')
      ?.querySelector<HTMLElement>('#stage-completion-edge') ?? null;
  }

  private disableViewInput(view: BoardView): void {
    view.cells.forEach((cell) => cell.circle.disableInteractive());
  }

  private handleResize(): void {
    if (!this.session || this.transitioning) return;
    this.cancelBoardEntrance();
    this.stopHintPulse();
    this.raisedConnectedCellIndex = undefined;
    this.view?.root.destroy(true);
    this.view = this.buildView(this.session, 0);
    this.applyBoardViewport();
    this.refreshView();
    if (this.neighborhoodPreviewIndex !== undefined) {
      this.showHeldCellChoiceScore(this.neighborhoodPreviewIndex);
    }
    this.locked = this.paused || this.connection?.complete === true;
  }
}
