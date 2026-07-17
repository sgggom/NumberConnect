import Phaser from 'phaser';
import { beadClusterPose, beadRewardTiming } from '../gameplay/beads/beadRewardAnimation';
import { COLLECTION_ARTWORK_NAMES } from '../gameplay/collection/collectionArtwork';
import { buildBoardNeighborhoodPreview } from './boardNeighborhood';
import { ConnectionProgress, type ConnectionAction, type ConnectionFailure } from './connectionProgress';
import { findSwappableHiddenPairs } from './hiddenSwap';
import { areNeighborCells, projectCell } from './topology';
import { BoardShape, backgroundUrl, cellKey, type BoardSessionInput, type Cell } from './types';
import { levelBallColor } from './levelTheme';

type CellShape = Phaser.GameObjects.Arc | Phaser.GameObjects.Polygon;

interface CellView {
  cell: Cell;
  index: number;
  x: number;
  y: number;
  liquidRing: CellShape;
  circle: CellShape;
  hollowRing: CellShape;
  glow: CellShape;
  label: Phaser.GameObjects.Text;
}

interface BoardView {
  root: Phaser.GameObjects.Container;
  panel: Phaser.GameObjects.Rectangle;
  solutionLines: Phaser.GameObjects.Graphics;
  lines: Phaser.GameObjects.Graphics;
  pointerLine: Phaser.GameObjects.Graphics;
  cells: Map<string, CellView>;
  radius: number;
  step: number;
  centerX: number;
  centerY: number;
  panelWidth: number;
  panelHeight: number;
  ballColor: number;
}

const COLORS = {
  text: '#ffffff',
  revealedHiddenText: '#bdd0e7',
  selectedText: '#ffffff',
  hint: 0x6bb6ff,
  consecutiveHint: 0x57d88b,
  wrong: 0xf5b4bb,
};

const hexagonPoints = (radius: number): Phaser.Geom.Point[] => Array.from({ length: 6 }, (_, index) => {
  const angle = Phaser.Math.DegToRad(index * 60);
  return new Phaser.Geom.Point(radius + Math.cos(angle) * radius, radius + Math.sin(angle) * radius);
});

const colorNumber = (hexColor: string): number => Number.parseInt(hexColor.slice(1), 16);

const METABALL_BLEND = 0.5;
const METABALL_HANDLE_LENGTH_RATE = 2.4;
const METABALL_CURVE_SAMPLES = 12;
const CELL_RADIUS_SCALE = 0.9;
const CELL_NUMBER_SCALE = 1.5;
const HIDDEN_CELL_RING_WIDTH_SCALE = 0.2;
const BOARD_HORIZONTAL_PADDING = 5;
const BOARD_VERTICAL_PADDING = 10;
const MAX_CELL_STEP = 86;

const baseCellRadiusForStep = (step: number, isHex: boolean): number => (isHex
  ? Math.max(16, Math.min(44, step * 0.56))
  : Math.max(13, Math.min(32, step * 0.34)));

const maximumStepForExtent = (
  projectedRange: number,
  availableExtent: number,
  isHex: boolean,
): number => {
  let lower = 0;
  let upper = MAX_CELL_STEP;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const candidate = (lower + upper) * 0.5;
    const radius = baseCellRadiusForStep(candidate, isHex) * CELL_RADIUS_SCALE;
    const extent = projectedRange * candidate + radius * 2;
    if (extent <= availableExtent) lower = candidate;
    else upper = candidate;
  }
  return lower;
};

const liquidBallRadius = (radius: number): number => radius + Math.max(1.5, radius * 0.055);

const hiddenCellRingWidth = (radius: number): number => Math.max(1.5, radius * HIDDEN_CELL_RING_WIDTH_SCALE);

const clampUnit = (value: number): number => Math.max(-1, Math.min(1, value));

const polarPoint = (
  originX: number,
  originY: number,
  angle: number,
  length: number,
): Phaser.Geom.Point => new Phaser.Geom.Point(
  originX + Math.cos(angle) * length,
  originY + Math.sin(angle) * length,
);

const cubicBezierPoint = (
  start: Phaser.Geom.Point,
  control1: Phaser.Geom.Point,
  control2: Phaser.Geom.Point,
  end: Phaser.Geom.Point,
  progress: number,
): Phaser.Geom.Point => {
  const inverse = 1 - progress;
  const inverseSquared = inverse * inverse;
  const progressSquared = progress * progress;
  return new Phaser.Geom.Point(
    inverseSquared * inverse * start.x
      + 3 * inverseSquared * progress * control1.x
      + 3 * inverse * progressSquared * control2.x
      + progressSquared * progress * end.x,
    inverseSquared * inverse * start.y
      + 3 * inverseSquared * progress * control1.y
      + 3 * inverse * progressSquared * control2.y
      + progressSquared * progress * end.y,
  );
};

// Geometry adapted from the Paper.js Meta Balls example:
// https://paperjs.org/examples/meta-balls/
const metaballBridgePoints = (
  firstX: number,
  firstY: number,
  firstRadius: number,
  secondX: number,
  secondY: number,
  secondRadius: number,
): Phaser.Geom.Point[] => {
  const deltaX = secondX - firstX;
  const deltaY = secondY - firstY;
  const distance = Math.hypot(deltaX, deltaY);
  if (
    firstRadius <= 0
    || secondRadius <= 0
    || distance < 0.5
    || distance <= Math.abs(firstRadius - secondRadius)
  ) return [];

  let firstOverlapAngle = 0;
  let secondOverlapAngle = 0;
  if (distance < firstRadius + secondRadius) {
    firstOverlapAngle = Math.acos(clampUnit(
      (firstRadius * firstRadius + distance * distance - secondRadius * secondRadius)
        / (2 * firstRadius * distance),
    ));
    secondOverlapAngle = Math.acos(clampUnit(
      (secondRadius * secondRadius + distance * distance - firstRadius * firstRadius)
        / (2 * secondRadius * distance),
    ));
  }

  const centerAngle = Math.atan2(deltaY, deltaX);
  const radiusAngle = Math.acos(clampUnit((firstRadius - secondRadius) / distance));
  const firstAngleA = centerAngle
    + firstOverlapAngle
    + (radiusAngle - firstOverlapAngle) * METABALL_BLEND;
  const firstAngleB = centerAngle
    - firstOverlapAngle
    - (radiusAngle - firstOverlapAngle) * METABALL_BLEND;
  const secondAngleA = centerAngle
    + Math.PI
    - secondOverlapAngle
    - (Math.PI - secondOverlapAngle - radiusAngle) * METABALL_BLEND;
  const secondAngleB = centerAngle
    - Math.PI
    + secondOverlapAngle
    + (Math.PI - secondOverlapAngle - radiusAngle) * METABALL_BLEND;

  const firstA = polarPoint(firstX, firstY, firstAngleA, firstRadius);
  const firstB = polarPoint(firstX, firstY, firstAngleB, firstRadius);
  const secondA = polarPoint(secondX, secondY, secondAngleA, secondRadius);
  const secondB = polarPoint(secondX, secondY, secondAngleB, secondRadius);
  const totalRadius = firstRadius + secondRadius;
  const endpointDistance = Math.hypot(firstA.x - secondA.x, firstA.y - secondA.y);
  let handleScale = Math.min(
    METABALL_BLEND * METABALL_HANDLE_LENGTH_RATE,
    endpointDistance / totalRadius,
  );
  handleScale *= Math.min(1, distance * 2 / totalRadius);

  const firstHandleLength = firstRadius * handleScale;
  const secondHandleLength = secondRadius * handleScale;
  const firstControlA = polarPoint(
    firstA.x,
    firstA.y,
    firstAngleA - Math.PI / 2,
    firstHandleLength,
  );
  const secondControlA = polarPoint(
    secondA.x,
    secondA.y,
    secondAngleA + Math.PI / 2,
    secondHandleLength,
  );
  const secondControlB = polarPoint(
    secondB.x,
    secondB.y,
    secondAngleB - Math.PI / 2,
    secondHandleLength,
  );
  const firstControlB = polarPoint(
    firstB.x,
    firstB.y,
    firstAngleB + Math.PI / 2,
    firstHandleLength,
  );

  const points: Phaser.Geom.Point[] = [];
  for (let sample = 0; sample <= METABALL_CURVE_SAMPLES; sample += 1) {
    points.push(cubicBezierPoint(
      firstA,
      firstControlA,
      secondControlA,
      secondA,
      sample / METABALL_CURVE_SAMPLES,
    ));
  }
  points.push(secondB);
  for (let sample = 1; sample <= METABALL_CURVE_SAMPLES; sample += 1) {
    points.push(cubicBezierPoint(
      secondB,
      secondControlB,
      firstControlB,
      firstB,
      sample / METABALL_CURVE_SAMPLES,
    ));
  }
  return points;
};

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
  private locked = true;
  private transitioning = false;
  private solutionRevealed = false;
  private hintTween?: Phaser.Tweens.Tween;
  private hintCell?: CellView;
  private neighborhoodPreviewIndex?: number;
  private pointerLineTarget?: { x: number; y: number };

  public constructor() {
    super('board');
  }

  public whenReady(): Promise<void> {
    return this.readyPromise;
  }

  public preload(): void {
    for (let index = 1; index <= 8; index += 1) {
      this.load.audio(`combo-${index}`, `./audio/combo_${index}.mp3`);
    }
    this.load.audio('wrong', './audio/wrong_move.mp3');
    this.load.audio('victory', './audio/victory_bgm.mp3');
    for (const name of COLLECTION_ARTWORK_NAMES) {
      this.load.image(`background-${name}`, `./level-backgrounds/${name}.png`);
    }
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
    const canvas = this.sys.game.canvas;
    this.drawingNativePointerId = event.pointerId;
    if (!canvas.hasPointerCapture(event.pointerId)) {
      canvas.setPointerCapture(event.pointerId);
    }
  };

  private readonly handleNativePointerEnd = (event: PointerEvent): void => {
    if (this.drawingNativePointerId === event.pointerId) this.finishPointerInteraction();
  };

  public setBoard(session: BoardSessionInput): void {
    this.clearNeighborhoodPreview();
    this.stopHintPulse();
    this.view?.root.destroy(true);
    this.session = session;
    this.connection = this.createConnectionProgress(session);
    this.isDrawing = false;
    this.drawingPointerId = undefined;
    this.drawingNativePointerId = undefined;
    this.pointerLineTarget = undefined;
    this.wrongFeedbackActive = false;
    this.locked = false;
    this.transitioning = false;
    this.view = this.buildView(session, 0);
    this.refreshView();
  }

  public setPaused(paused: boolean): void {
    this.locked = paused || this.transitioning || this.connection?.complete === true;
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
    } else {
      this.refreshView();
    }
  }

  public setSolutionReveal(revealed: boolean): void {
    this.solutionRevealed = revealed;
    this.refreshView();
    if (!this.locked && this.isDrawing && this.neighborhoodPreviewIndex !== undefined) {
      this.emitNeighborhoodPreview(this.neighborhoodPreviewIndex);
    }
  }

  public async transitionTo(session: BoardSessionInput): Promise<void> {
    if (!this.view) {
      this.setBoard(session);
      return;
    }

    this.locked = true;
    this.transitioning = true;
    this.clearNeighborhoodPreview();
    this.stopHintPulse();
    this.disableViewInput(this.view);
    const oldView = this.view;
    const distance = Math.max(this.scale.height, 720) + oldView.panelHeight * 0.5 + 100;

    this.session = session;
    this.connection = this.createConnectionProgress(session);
    this.isDrawing = false;
    this.drawingPointerId = undefined;
    this.drawingNativePointerId = undefined;
    this.pointerLineTarget = undefined;
    this.wrongFeedbackActive = false;
    const newView = this.buildView(session, distance);
    this.view = newView;
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
    newView.root.y = 0;
    this.transitioning = false;
    this.locked = false;
  }

  public async showCompletion({ revealImage = false }: { revealImage?: boolean } = {}): Promise<void> {
    if (!this.view || !this.session) return;
    const view = this.view;
    const session = this.session;
    this.locked = true;
    this.clearNeighborhoodPreview();
    this.stopHintPulse();
    this.playSound('victory');

    if (session.completionGemColors?.length) {
      await this.showGemCompletion(view, session.completionGemColors);
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

      const front = [cellView.liquidRing, cellView.circle, cellView.hollowRing, cellView.glow, cellView.label];
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

  private async showGemCompletion(view: BoardView, gemColors: readonly string[]): Promise<void> {
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
        unusedCellObjects.push(cellView.liquidRing, cellView.circle, cellView.hollowRing, cellView.glow, cellView.label);
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
      const shadow = this.add.circle(0, view.radius * 0.1, beadRadius * 1.04, 0x07101a, 0.3);
      const body = this.add.circle(0, 0, beadRadius, colorNumber(gemColor), 1);
      body.setStrokeStyle(Math.max(1, view.radius * 0.07), 0xffffff, 0.24);
      const softHighlight = this.add.circle(
        -view.radius * 0.18,
        -view.radius * 0.2,
        Math.max(3, view.radius * 0.27),
        0xffffff,
        0.16,
      );
      const shine = this.add.circle(
        -view.radius * 0.27,
        -view.radius * 0.3,
        Math.max(2, view.radius * 0.14),
        0xffffff,
        0.76,
      );
      gem.add([shadow, body, softHighlight, shine]);
      gem.setScale(0, 1);
      view.root.add(gem);
      gems.push(gem);

      return new Promise<void>((resolve) => {
        this.tweens.add({
          targets: [cellView.liquidRing, cellView.circle, cellView.hollowRing, cellView.glow, cellView.label],
          scaleX: 0,
          delay: index * stagger,
          duration: reducedMotion ? 1 : 90,
          ease: 'Sine.easeIn',
          onComplete: () => {
            cellView.circle.setAlpha(0);
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
    const timing = beadRewardTiming(gems.length, reducedMotion);
    this.tweens.add({
      targets: view.panel,
      alpha: 0.38,
      duration: reducedMotion ? 1 : 300,
      ease: 'Sine.easeOut',
    });

    const gathers = gems.map((gem, index) => {
      const pose = beadClusterPose(index, gems.length);
      return new Promise<void>((resolve) => {
        this.tweens.add({
          targets: gem,
          x: view.centerX + pose.x,
          y: view.centerY + pose.y,
          angle: pose.rotation,
          scale: pose.scale,
          delay: reducedMotion ? 0 : index * 8,
          duration: reducedMotion ? 1 : 560,
          ease: 'Cubic.easeInOut',
          onComplete: () => resolve(),
        });
      });
    });
    await Promise.all(gathers);

    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: gems,
        scaleX: `+=0.05`,
        scaleY: `-=0.04`,
        yoyo: true,
        duration: timing.settleDuration * 0.5,
        ease: 'Sine.easeOut',
        onComplete: () => resolve(),
      });
    });
    if (!reducedMotion) await new Promise<void>((resolve) => { this.time.delayedCall(220, resolve); });
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
    return new ConnectionProgress(
      session.level.solutionPath.length,
      visibleIndices,
      swappableHiddenPairs,
    );
  }

  private buildView(session: BoardSessionInput, offsetY: number): BoardView {
    const width = Math.max(this.scale.width, 320);
    const height = Math.max(this.scale.height, 420);
    const viewportCenterX = width * 0.5;
    const centerX = 0;
    const centerY = height * 0.5;
    const ballColor = levelBallColor(session.level.levelId);
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
      Math.max(1, width - BOARD_HORIZONTAL_PADDING * 2),
      isHex,
    );
    const verticalStep = maximumStepForExtent(
      rangeY,
      Math.max(1, height - BOARD_VERTICAL_PADDING * 2),
      isHex,
    );
    const step = Math.min(horizontalStep, verticalStep);
    const baseRadius = baseCellRadiusForStep(step, isHex);
    const radius = baseRadius * CELL_RADIUS_SCALE;
    const numberFontSize = Math.round(
      Math.max(12, Math.round(baseRadius * 0.72)) * CELL_NUMBER_SCALE,
    );

    raw.forEach((entry) => {
      positions.set(cellKey(entry.cell), {
        x: (entry.x - (minX + maxX) * 0.5) * step,
        y: centerY + (entry.y - (minY + maxY) * 0.5) * step,
      });
    });

    const panelWidth = Math.min(
      Math.max(1, width - BOARD_HORIZONTAL_PADDING * 2),
      rangeX * step + radius * 2,
    );
    const panelHeight = Math.min(
      Math.max(1, height - BOARD_VERTICAL_PADDING * 2),
      rangeY * step + radius * 2,
    );
    const root = this.add.container(viewportCenterX, offsetY);
    const panel = this.add.rectangle(centerX, centerY, panelWidth, panelHeight, 0xffffff, 0);
    const solutionLines = this.add.graphics();
    const lines = this.add.graphics();
    const pointerLine = this.add.graphics();
    root.add([panel, solutionLines, lines, pointerLine]);
    const cells = new Map<string, CellView>();

    session.level.solutionPath.forEach((cell, index) => {
      const position = positions.get(cellKey(cell));
      if (!position) return;
      const glowRadius = radius + 6;
      const glow: CellShape = isHex
        ? this.add.polygon(position.x, position.y, hexagonPoints(glowRadius), COLORS.hint, 0)
        : this.add.circle(position.x, position.y, glowRadius, COLORS.hint, 0);
      glow.setStrokeStyle(4, COLORS.hint, 0);
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
      circle.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.handleCellDown(index, pointer));
      root.add([glow, liquidRing, circle, hollowRing, label]);
      cells.set(cellKey(cell), {
        cell,
        index,
        x: position.x,
        y: position.y,
        liquidRing,
        circle,
        hollowRing,
        glow,
        label,
      });
    });

    return {
      root,
      panel,
      solutionLines,
      lines,
      pointerLine,
      cells,
      radius,
      step,
      centerX,
      centerY,
      panelWidth,
      panelHeight,
      ballColor,
    };
  }

  private refreshView(): void {
    if (!this.view || !this.session) return;
    const path = this.session.level.solutionPath;
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

    const nextHint = this.session.showNextNumber
      ? this.connection?.suggestedNextHint()
      : undefined;
    let activeHintCell: CellView | undefined;

    this.view.cells.forEach((cellView, key) => {
      const selected = this.connection?.isNodeConnected(cellView.index) === true
        || this.connection?.activeIndex === cellView.index;
      const numberVisible = this.solutionRevealed || this.connection?.isVisible(cellView.index) === true;
      const revealedHidden = this.solutionRevealed
        && this.connection?.isVisible(cellView.index) !== true
        && this.session!.hiddenCells.has(key);
      const concealed = this.session!.hiddenCells.has(key) && !numberVisible;
      cellView.label.setText(String(this.connection?.displayNumber(cellView.index) ?? cellView.index + 1));
      cellView.liquidRing.setFillStyle(this.view!.ballColor, selected ? 1 : 0);
      cellView.circle.setFillStyle(this.view!.ballColor, concealed ? 0 : 1);
      cellView.hollowRing.setStrokeStyle(
        hiddenCellRingWidth(this.view!.radius),
        this.view!.ballColor,
        1,
      );
      cellView.hollowRing.setVisible(concealed);
      cellView.label.setVisible(numberVisible);
      cellView.label.setColor(selected ? COLORS.selectedText : revealedHidden ? COLORS.revealedHiddenText : COLORS.text);
      cellView.label.setFontStyle(revealedHidden ? 'italic 900' : '900');
      const hint = cellView.index === nextHint?.index;
      const hintColor = nextHint?.consecutive ? COLORS.consecutiveHint : COLORS.hint;
      cellView.glow.setFillStyle(hintColor, hint ? 0.2 : 0);
      cellView.glow.setStrokeStyle(4, hintColor, hint ? 0.9 : 0);
      if (hint) activeHintCell = cellView;
    });

    this.startHintPulse(activeHintCell);
  }

  private drawConnectedBridges(): void {
    if (!this.view || !this.session) return;
    const path = this.session.level.solutionPath;
    const baseRadius = liquidBallRadius(this.view.radius);
    this.view.lines.clear();
    this.view.lines.fillStyle(this.view.ballColor, 1);

    for (const [fromIndex, toIndex] of this.connection?.connectedNodePairs() ?? []) {
      const from = this.view.cells.get(cellKey(path[fromIndex]));
      const to = this.view.cells.get(cellKey(path[toIndex]));
      if (!from || !to) continue;
      const fromScale = Math.max(
        0.01,
        (Math.abs(from.liquidRing.scaleX) + Math.abs(from.liquidRing.scaleY)) * 0.5,
      );
      const toScale = Math.max(
        0.01,
        (Math.abs(to.liquidRing.scaleX) + Math.abs(to.liquidRing.scaleY)) * 0.5,
      );
      const bridge = metaballBridgePoints(
        from.x,
        from.y,
        baseRadius * fromScale,
        to.x,
        to.y,
        baseRadius * toScale,
      );
      if (bridge.length > 0) this.view.lines.fillPoints(bridge, true, true);
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
      scale: 1.13,
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
    this.isDrawing = true;
    this.drawingPointerId = pointer.id;
    this.wrongFeedbackActive = false;
    this.handleConnectionAction(this.connection.begin(index, this.solutionRevealed));
    this.emitNeighborhoodPreview(index, pointer);
    if (this.view) {
      this.drawPointerLine(pointer.x - this.view.root.x, pointer.y - this.view.root.y);
    }
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (
      !this.isDrawing
      || this.drawingPointerId !== pointer.id
      || !pointer.isDown
      || this.locked
      || !this.view
      || !this.connection
      || !this.session
    ) return;
    const localX = pointer.x - this.view.root.x;
    const localY = pointer.y - this.view.root.y;
    const activeIndex = this.connection.activeIndex;
    const activeCell = activeIndex === undefined
      ? undefined
      : this.session.level.solutionPath[activeIndex];
    let closest: CellView | undefined;
    let bestDistance = this.view.radius ** 2;
    this.view.cells.forEach((candidate) => {
      if (
        !activeCell
        || (
          candidate.index !== activeIndex
          && !areNeighborCells(activeCell, candidate.cell, this.session!.level.boardShape)
        )
      ) return;
      const distance = (candidate.x - localX) ** 2 + (candidate.y - localY) ** 2;
      if (distance <= bestDistance) {
        bestDistance = distance;
        closest = candidate;
      }
    });
    if (closest) this.handleConnectionAction(this.connection.extend(closest.index));
    const previewIndex = closest?.index ?? this.neighborhoodPreviewIndex;
    if (!this.locked && previewIndex !== undefined) this.emitNeighborhoodPreview(previewIndex, pointer);
    this.drawPointerLine(localX, localY);
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.drawingPointerId !== undefined && this.drawingPointerId !== pointer.id) return;
    this.finishPointerInteraction();
  }

  private finishPointerInteraction(): void {
    const wasDrawing = this.isDrawing;
    this.isDrawing = false;
    this.drawingPointerId = undefined;
    this.drawingNativePointerId = undefined;
    this.pointerLineTarget = undefined;
    this.wrongFeedbackActive = false;
    this.connection?.endStroke();
    this.view?.pointerLine.clear();
    if (wasDrawing) this.refreshView();
    this.clearNeighborhoodPreview();
  }

  private emitNeighborhoodPreview(
    index: number | null = null,
    pointer?: Phaser.Input.Pointer,
  ): void {
    if (!this.session || !this.connection || !this.view) return;
    const centerCell = index === null ? undefined : this.session.level.solutionPath[index];
    const centerView = centerCell ? this.view.cells.get(cellKey(centerCell)) : undefined;
    const localX = pointer ? pointer.x - this.view.root.x : 0;
    const localY = pointer ? pointer.y - this.view.root.y : 0;
    const canvasBounds = pointer ? this.sys.game.canvas.getBoundingClientRect() : undefined;
    const clientX = pointer && canvasBounds
      ? canvasBounds.left + (pointer.x / Math.max(1, this.scale.width)) * canvasBounds.width
      : 0;
    const clientY = pointer && canvasBounds
      ? canvasBounds.top + (pointer.y / Math.max(1, this.scale.height)) * canvasBounds.height
      : 0;
    const originGameX = centerView ? this.view.root.x + centerView.x : pointer?.x ?? 0;
    const originGameY = centerView ? this.view.root.y + centerView.y : pointer?.y ?? 0;
    const originClientX = canvasBounds
      ? canvasBounds.left + (originGameX / Math.max(1, this.scale.width)) * canvasBounds.width
      : clientX;
    const originClientY = canvasBounds
      ? canvasBounds.top + (originGameY / Math.max(1, this.scale.height)) * canvasBounds.height
      : clientY;
    const preview = buildBoardNeighborhoodPreview(
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
    if (!preview) return;
    this.neighborhoodPreviewIndex = index ?? undefined;
    this.session.onNeighborhoodPreview?.(preview);
  }

  private clearNeighborhoodPreview(): void {
    this.neighborhoodPreviewIndex = undefined;
    this.session?.onNeighborhoodPreview?.(null);
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

    const pointerRadius = Math.max(4, this.view.radius * 0.38);
    const activeScale = Math.max(
      0.01,
      (Math.abs(from.liquidRing.scaleX) + Math.abs(from.liquidRing.scaleY)) * 0.5,
    );
    const bridge = metaballBridgePoints(
      from.x,
      from.y,
      liquidBallRadius(this.view.radius) * activeScale,
      localX,
      localY,
      pointerRadius,
    );
    pointerLine.fillStyle(this.view.ballColor, 1);
    if (bridge.length > 0) pointerLine.fillPoints(bridge, true, true);
    pointerLine.fillCircle(localX, localY, pointerRadius);
  }

  private handleConnectionAction(action: ConnectionAction): void {
    if (!this.session || !this.view || action.type === 'ignored') return;
    if (action.type === 'wrong') {
      if (this.wrongFeedbackActive) return;
      this.wrongFeedbackActive = true;
      this.flashWrong(action.index);
      this.playSound('wrong');
      this.session.onWrong(this.connectionFailureMessage(action.reason));
      return;
    }

    this.wrongFeedbackActive = false;
    this.refreshView();
    if (action.type === 'started' || !action.added) return;

    this.playConnectedCellBounce(action.index);
    this.playSound(`combo-${Math.min(8, action.progress - 1)}`);
    this.session.onProgress(action.progress, this.session.level.solutionPath.length);

    if (action.complete) {
      this.locked = true;
      this.isDrawing = false;
      this.connection?.endStroke();
      this.clearNeighborhoodPreview();
      this.session.onComplete();
    }
  }

  private playConnectedCellBounce(index: number): void {
    if (
      !this.view
      || !this.session
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) return;
    const pathCell = this.session.level.solutionPath[index];
    const cell = pathCell ? this.view.cells.get(cellKey(pathCell)) : undefined;
    if (!cell) return;

    const targets = [cell.liquidRing, cell.circle, cell.hollowRing, cell.label];
    this.tweens.killTweensOf(targets);
    targets.forEach((target) => target.setScale(0.84));
    this.redrawLiquidConnections();
    this.tweens.add({
      targets,
      scaleX: 1,
      scaleY: 1,
      duration: 240,
      ease: 'Back.easeInOut',
      onUpdate: () => this.redrawLiquidConnections(),
      onComplete: () => this.redrawLiquidConnections(),
    });
  }

  private connectionFailureMessage(reason: ConnectionFailure): string {
    if (reason === 'hidden-start') return '请从显示数字开始。';
    if (reason === 'direction-change') return '一次连线请保持同一数字方向。';
    return '请连接相邻的连续数字。';
  }

  private flashWrong(index: number): void {
    if (!this.view || !this.session) return;
    const cell = this.view.cells.get(cellKey(this.session.level.solutionPath[index]));
    if (!cell) return;
    cell.circle.setFillStyle(COLORS.wrong, 1);
    this.time.delayedCall(360, () => this.refreshView());
  }

  private playSound(key: string): void {
    if (!this.session?.soundEnabled || !this.cache.audio.exists(key)) return;
    try {
      this.sound.play(key, { volume: key === 'victory' ? 0.55 : 0.72 });
    } catch {
      // Browsers may keep WebAudio locked until the first explicit pointer gesture.
    }
  }

  private disableViewInput(view: BoardView): void {
    view.cells.forEach((cell) => cell.circle.disableInteractive());
  }

  private handleResize(): void {
    if (!this.session || this.transitioning) return;
    this.stopHintPulse();
    this.view?.root.destroy(true);
    this.view = this.buildView(this.session, 0);
    this.refreshView();
  }
}
