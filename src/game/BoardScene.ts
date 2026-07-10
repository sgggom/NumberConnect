import Phaser from 'phaser';
import { isConsecutiveHint } from './hint';
import { projectCell } from './topology';
import { BoardShape, backgroundUrl, cellKey, type BoardSessionInput, type Cell } from './types';

type CellShape = Phaser.GameObjects.Arc | Phaser.GameObjects.Polygon;

interface CellView {
  cell: Cell;
  index: number;
  x: number;
  y: number;
  circle: CellShape;
  glow: CellShape;
  label: Phaser.GameObjects.Text;
}

interface BoardView {
  root: Phaser.GameObjects.Container;
  panel: Phaser.GameObjects.Rectangle;
  solutionLines: Phaser.GameObjects.Graphics;
  lines: Phaser.GameObjects.Graphics;
  cells: Map<string, CellView>;
  radius: number;
  centerX: number;
  centerY: number;
  panelWidth: number;
  panelHeight: number;
}

const COLORS = {
  panel: 0x34384d,
  tile: 0xf7f9fc,
  tileBorder: 0xd9e1ec,
  selected: 0xf2c241,
  selectedBorder: 0xffdf70,
  text: '#172033',
  revealedHiddenText: '#8f99a8',
  selectedText: '#172033',
  hint: 0x6bb6ff,
  consecutiveHint: 0x57d88b,
  wrong: 0xe94c5d,
  line: 0xfff4c2,
  solutionLine: 0x7fc8ff,
};

const hexagonPoints = (radius: number): Phaser.Geom.Point[] => Array.from({ length: 6 }, (_, index) => {
  const angle = Phaser.Math.DegToRad(index * 60);
  return new Phaser.Geom.Point(radius + Math.cos(angle) * radius, radius + Math.sin(angle) * radius);
});

export class BoardScene extends Phaser.Scene {
  private session?: BoardSessionInput;
  private view?: BoardView;
  private currentPathLength = 0;
  private isDrawing = false;
  private wrongFeedbackActive = false;
  private locked = true;
  private transitioning = false;
  private solutionRevealed = false;
  private hintTween?: Phaser.Tweens.Tween;
  private hintCell?: CellView;

  public constructor() {
    super('board');
  }

  public preload(): void {
    for (let index = 1; index <= 8; index += 1) {
      this.load.audio(`combo-${index}`, `./audio/combo_${index}.mp3`);
    }
    this.load.audio('wrong', './audio/wrong_move.mp3');
    this.load.audio('victory', './audio/victory_bgm.mp3');
    for (const name of ['apple', 'banana', 'orange', 'grapes', 'basket', 'pineapple']) {
      this.load.image(`background-${name}`, `./level-backgrounds/${name}.png`);
    }
  }

  public create(): void {
    this.input.on('pointermove', this.handlePointerMove, this);
    this.input.on('pointerup', this.handlePointerUp, this);
    this.input.on('gameout', this.handlePointerUp, this);
    this.scale.on('resize', this.handleResize, this);
    this.game.events.emit('board-ready');
  }

  public setBoard(session: BoardSessionInput): void {
    this.stopHintPulse();
    this.view?.root.destroy(true);
    this.session = session;
    this.currentPathLength = 0;
    this.isDrawing = false;
    this.wrongFeedbackActive = false;
    this.locked = false;
    this.transitioning = false;
    this.view = this.buildView(session, 0);
    this.refreshView();
  }

  public setPaused(paused: boolean): void {
    this.locked = paused || this.transitioning || this.currentPathLength === this.session?.level.solutionPath.length;
    if (paused) {
      this.isDrawing = false;
      this.wrongFeedbackActive = false;
      this.stopHintPulse();
    } else {
      this.refreshView();
    }
  }

  public setSolutionReveal(revealed: boolean): void {
    this.solutionRevealed = revealed;
    this.refreshView();
  }

  public async transitionTo(session: BoardSessionInput): Promise<void> {
    if (!this.view) {
      this.setBoard(session);
      return;
    }

    this.locked = true;
    this.transitioning = true;
    this.stopHintPulse();
    this.disableViewInput(this.view);
    const oldView = this.view;
    const distance = Math.max(this.scale.height, 720) + oldView.panelHeight * 0.5 + 100;

    this.session = session;
    this.currentPathLength = 0;
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

  public async showCompletion(): Promise<void> {
    if (!this.view || !this.session) return;
    const view = this.view;
    const session = this.session;
    this.locked = true;
    this.stopHintPulse();
    this.playSound('victory');

    const resource = backgroundUrl(session.level.backgroundResourcePath);
    const imageName = resource?.split('/').pop()?.replace('.png', '');
    const textureKey = imageName ? `background-${imageName}` : undefined;
    if (!textureKey || !this.textures.exists(textureKey)) {
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

      const front = [cellView.circle, cellView.glow, cellView.label];
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

  private buildView(session: BoardSessionInput, offsetY: number): BoardView {
    const width = Math.max(this.scale.width, 320);
    const height = Math.max(this.scale.height, 420);
    const viewportCenterX = width * 0.5;
    const centerX = 0;
    const centerY = height * 0.5;
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
    const rangeX = Math.max(1, maxX - minX);
    const rangeY = Math.max(1, maxY - minY);
    const step = Math.max(30, Math.min(86, (width - 86) / (rangeX + 1.4), (height - 70) / (rangeY + 1.4)));
    const radius = isHex
      ? Math.max(16, Math.min(44, step * 0.56))
      : Math.max(13, Math.min(32, step * 0.34));

    raw.forEach((entry) => {
      positions.set(cellKey(entry.cell), {
        x: (entry.x - (minX + maxX) * 0.5) * step,
        y: centerY + (entry.y - (minY + maxY) * 0.5) * step,
      });
    });

    const panelWidth = Math.min(width - 24, (rangeX + 1.55) * step);
    const panelHeight = Math.min(height - 20, (rangeY + 1.55) * step);
    const root = this.add.container(viewportCenterX, offsetY);
    const panel = this.add.rectangle(centerX, centerY, panelWidth, panelHeight, COLORS.panel, 1);
    panel.setStrokeStyle(2, 0x48506b, 0.8);
    const solutionLines = this.add.graphics();
    const lines = this.add.graphics();
    root.add([panel, solutionLines, lines]);
    const cells = new Map<string, CellView>();

    session.level.solutionPath.forEach((cell, index) => {
      const position = positions.get(cellKey(cell));
      if (!position) return;
      const glowRadius = radius + 6;
      const glow: CellShape = isHex
        ? this.add.polygon(position.x, position.y, hexagonPoints(glowRadius), COLORS.hint, 0)
        : this.add.circle(position.x, position.y, glowRadius, COLORS.hint, 0);
      glow.setStrokeStyle(4, COLORS.hint, 0);
      const circle: CellShape = isHex
        ? this.add.polygon(position.x, position.y, hexagonPoints(radius), COLORS.tile, 1)
        : this.add.circle(position.x, position.y, radius, COLORS.tile, 1);
      circle.setStrokeStyle(2, COLORS.tileBorder, 1);
      if (isHex) {
        circle.setInteractive((circle as Phaser.GameObjects.Polygon).geom, Phaser.Geom.Polygon.Contains);
      } else {
        circle.setInteractive(
          new Phaser.Geom.Circle(radius, radius, radius * 1.25),
          Phaser.Geom.Circle.Contains,
        );
      }
      const label = this.add.text(position.x, position.y, String(index + 1), {
        fontFamily: 'Nunito Sans, sans-serif',
        fontStyle: '700',
        fontSize: `${Math.max(12, Math.round(radius * 0.72))}px`,
        color: COLORS.text,
        align: 'center',
      }).setOrigin(0.5);
      const labelTextHeight = label.height;
      const labelSize = radius * 2;
      label.setFixedSize(labelSize, labelSize);
      label.setPadding(0, Math.max(0, (labelSize - labelTextHeight) * 0.5), 0, 0);
      circle.on('pointerdown', () => this.handleCellDown(index));
      root.add([glow, circle, label]);
      cells.set(cellKey(cell), { cell, index, x: position.x, y: position.y, circle, glow, label });
    });

    return { root, panel, solutionLines, lines, cells, radius, centerX, centerY, panelWidth, panelHeight };
  }

  private refreshView(): void {
    if (!this.view || !this.session) return;
    const path = this.session.level.solutionPath;
    this.view.solutionLines.clear();
    if (this.solutionRevealed) {
      this.view.solutionLines.lineStyle(Math.max(3, this.view.radius * 0.18), COLORS.solutionLine, 0.58);
      this.view.solutionLines.beginPath();
      path.forEach((cell, index) => {
        const cellView = this.view!.cells.get(cellKey(cell));
        if (!cellView) return;
        if (index === 0) this.view!.solutionLines.moveTo(cellView.x, cellView.y);
        else this.view!.solutionLines.lineTo(cellView.x, cellView.y);
      });
      this.view.solutionLines.strokePath();
    }

    this.view.lines.clear();
    this.view.lines.lineStyle(Math.max(5, this.view.radius * 0.28), COLORS.line, 0.9);
    this.view.lines.beginPath();

    for (let index = 0; index < this.currentPathLength; index += 1) {
      const current = this.view.cells.get(cellKey(path[index]));
      if (!current) continue;
      if (index === 0) this.view.lines.moveTo(current.x, current.y);
      else this.view.lines.lineTo(current.x, current.y);
    }
    this.view.lines.strokePath();

    let nextVisibleIndex = -1;
    if (this.session.showNextNumber) {
      for (let index = this.currentPathLength; index < path.length; index += 1) {
        const key = cellKey(path[index]);
        if (!this.session.hiddenCells.has(key) || index === path.length - 1) {
          nextVisibleIndex = index;
          break;
        }
      }
    }

    const consecutiveHint = isConsecutiveHint(this.currentPathLength, nextVisibleIndex);
    let activeHintCell: CellView | undefined;

    this.view.cells.forEach((cellView, key) => {
      const selected = cellView.index < this.currentPathLength;
      const numberVisible = this.solutionRevealed
        || selected
        || !this.session!.hiddenCells.has(key)
        || cellView.index === 0
        || cellView.index === path.length - 1;
      const revealedHidden = this.solutionRevealed
        && !selected
        && this.session!.hiddenCells.has(key);
      cellView.circle.setFillStyle(selected ? COLORS.selected : COLORS.tile, 1);
      cellView.circle.setStrokeStyle(2, selected ? COLORS.selectedBorder : COLORS.tileBorder, 1);
      cellView.label.setVisible(numberVisible);
      cellView.label.setColor(selected ? COLORS.selectedText : revealedHidden ? COLORS.revealedHiddenText : COLORS.text);
      cellView.label.setFontStyle(revealedHidden ? 'italic 700' : '700');
      const hint = cellView.index === nextVisibleIndex;
      const hintColor = consecutiveHint ? COLORS.consecutiveHint : COLORS.hint;
      cellView.glow.setFillStyle(hintColor, hint ? 0.2 : 0);
      cellView.glow.setStrokeStyle(4, hintColor, hint ? 0.9 : 0);
      if (hint) activeHintCell = cellView;
    });

    this.startHintPulse(activeHintCell);
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

  private handleCellDown(index: number): void {
    if (this.locked || this.transitioning) return;
    this.isDrawing = true;
    this.wrongFeedbackActive = false;
    this.trySelect(index);
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.isDrawing || !pointer.isDown || this.locked || !this.view) return;
    const localX = pointer.x - this.view.root.x;
    const localY = pointer.y - this.view.root.y;
    let closest: CellView | undefined;
    let bestDistance = (this.view.radius * 1.55) ** 2;
    this.view.cells.forEach((candidate) => {
      const distance = (candidate.x - localX) ** 2 + (candidate.y - localY) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        closest = candidate;
      }
    });
    if (closest) this.trySelect(closest.index);
  }

  private handlePointerUp(): void {
    this.isDrawing = false;
    this.wrongFeedbackActive = false;
  }

  private trySelect(index: number): void {
    if (!this.session || !this.view || index < this.currentPathLength) return;
    if (index !== this.currentPathLength) {
      if (this.wrongFeedbackActive) return;
      this.wrongFeedbackActive = true;
      const message = this.currentPathLength === 0
        ? '请从数字 1 开始。'
        : `走错了，请寻找数字 ${this.currentPathLength + 1}。`;
      this.flashWrong(index);
      this.playSound('wrong');
      this.session.onWrong(message);
      return;
    }

    this.wrongFeedbackActive = false;
    this.currentPathLength += 1;
    if (this.currentPathLength > 1) this.playSound(`combo-${Math.min(8, this.currentPathLength - 1)}`);
    this.refreshView();
    this.session.onProgress(this.currentPathLength, this.session.level.solutionPath.length);

    if (this.currentPathLength === this.session.level.solutionPath.length) {
      this.locked = true;
      this.isDrawing = false;
      this.session.onComplete();
    }
  }

  private flashWrong(index: number): void {
    if (!this.view || !this.session) return;
    const cell = this.view.cells.get(cellKey(this.session.level.solutionPath[index]));
    if (!cell) return;
    cell.circle.setFillStyle(COLORS.wrong, 1);
    this.time.delayedCall(220, () => this.refreshView());
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
