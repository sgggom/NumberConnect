import Phaser from 'phaser';
import './styles.css';
import type { GameEventMap } from './app/GameEvents';
import { startLobbyAmbientNetwork } from './app/LobbyAmbientNetwork';
import { ScreenRouter, type ScreenName } from './app/ScreenRouter';
import { query } from './app/dom';
import { EventBus } from './core/events/EventBus';
import { BoardScene } from './game/BoardScene';
import { getEndlessStageSettings } from './game/difficulty';
import { selectHiddenCells } from './game/hidden';
import { formatLives } from './game/lives';
import { levelBallColorCss } from './game/levelTheme';
import {
  getNextLevelId,
  loadBuiltInLevels,
  loadLevelCollection,
  loadSettings,
  saveLevelCollection,
  saveSettings,
} from './game/storage';
import {
  BoardShape,
  cellKey,
  isTouchPreviewSize,
  type BoardNeighborhoodPreview,
  type BoardSessionInput,
  type EndlessStageSettings,
  type GameMode,
  type GameSettings,
  type LevelData,
  type TouchPreviewSize,
} from './game/types';
import {
  createVideoView,
  groupVideoViews,
  loadVideoViews,
  saveVideoViews,
  videoPlacementLabel,
  type VideoViewRecord,
} from './game/videoStats';
import { LevelEditorController } from './gameplay/editor';
import {
  advanceBeadProgress,
  advanceBeadSequence,
  beadClusterPose,
  beadRewardTiming,
  loadBeadPatterns,
  loadBeadSequence,
  loadCompletedBeadPatternIds,
  markBeadPatternCompleted,
  nextBeads,
  orderedBeads,
  saveBeadProgress,
  type BeadPatternData,
  type BeadPixel,
  type BeadProgress,
} from './gameplay/beads';
import {
  collectionArtworkResourcePath,
  collectionArtworkUrl,
} from './gameplay/collection/collectionArtwork';
import { generateEndlessLevel } from './gameplay/endless/generateEndlessLevel';

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const waitFor = (duration: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, duration));
const TOUCH_PREVIEW_ENTER_DURATION_MS = 240;
const TOUCH_PREVIEW_EXIT_DURATION_MS = 170;
const COLLECTION_MIN_LEVELS = 7;
const COLLECTION_PROGRESS_KEY = 'number-connect.collection-route.v1';

const loadCollectionCompletedCount = (): number => {
  try {
    const value = Number(window.localStorage.getItem(COLLECTION_PROGRESS_KEY));
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  } catch {
    return 0;
  }
};

const saveCollectionCompletedCount = (count: number): void => {
  try {
    window.localStorage.setItem(COLLECTION_PROGRESS_KEY, String(Math.max(0, Math.floor(count))));
  } catch {
    // Collection progress remains available for the current session when storage is unavailable.
  }
};

interface RoutePoint { x: number; y: number }

const roundedRoutePath = (points: RoutePoint[], radius = 20): string => {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const incomingLength = Math.hypot(current.x - previous.x, current.y - previous.y) || 1;
    const outgoingLength = Math.hypot(next.x - current.x, next.y - current.y) || 1;
    const cornerRadius = Math.min(radius, incomingLength * 0.35, outgoingLength * 0.35);
    const before = {
      x: current.x - (current.x - previous.x) / incomingLength * cornerRadius,
      y: current.y - (current.y - previous.y) / incomingLength * cornerRadius,
    };
    const after = {
      x: current.x + (next.x - current.x) / outgoingLength * cornerRadius,
      y: current.y + (next.y - current.y) / outgoingLength * cornerRadius,
    };
    path += ` L ${before.x} ${before.y} Q ${current.x} ${current.y} ${after.x} ${after.y}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
};

type ResultContext = 'normal' | 'collection' | 'endless-stage' | 'life-depleted' | 'editor-playtest' | 'editor-playtest-failed';
type PlayContext = 'normal' | 'collection' | 'editor-playtest' | 'bead';

interface BeadFlightCluster {
  layer: HTMLElement;
  gems: HTMLElement[];
}

interface TouchPreviewVisibilityAnimation {
  fromScale: number;
  fromOpacity: number;
  toScale: number;
  toOpacity: number;
  duration: number;
  hideOnComplete: boolean;
  startTime?: number;
}

class NumberConnectApp {
  private readonly appShell = query<HTMLElement>('#app');
  private readonly screenRouter = new ScreenRouter();
  private readonly events = new EventBus<GameEventMap>();
  private readonly playScreen = query<HTMLElement>('#play-screen');
  private readonly gameHost = query<HTMLElement>('#game-host');
  private readonly playBackButton = query<HTMLButtonElement>('#back-button');
  private readonly levelLabel = query<HTMLElement>('#play-level-label');
  private readonly progressLabel = query<HTMLElement>('#play-progress');
  private readonly livesLabel = query<HTMLElement>('#play-lives');
  private readonly solutionToggle = query<HTMLInputElement>('#solution-toggle');
  private readonly touchPreview = query<HTMLElement>('#touch-preview');
  private readonly touchPreviewSurface = query<HTMLElement>('#touch-preview-surface');
  private readonly touchPreviewBoard = query<HTMLElement>('#touch-preview-board');
  private readonly touchPreviewCells = query<HTMLElement>('#touch-preview-cells');
  private readonly touchPreviewPathLines = query<SVGGElement>('#touch-preview-path-lines');
  private readonly touchPreviewPointerLine = query<SVGLineElement>('#touch-preview-pointer-line');
  private readonly touchPreviewSizeControl = query<HTMLElement>('#touch-preview-size');
  private readonly resultOverlay = query<HTMLElement>('#result-overlay');
  private readonly resultKicker = query<HTMLElement>('#result-kicker');
  private readonly resultTitle = query<HTMLElement>('#result-title');
  private readonly resultMessage = query<HTMLElement>('#result-message');
  private readonly resultReward = query<HTMLElement>('#result-reward');
  private readonly resultActions = query<HTMLElement>('#result-actions');
  private readonly restartButton = query<HTMLButtonElement>('#restart-button');
  private readonly nextButton = query<HTMLButtonElement>('#next-button');
  private readonly resultLobbyButton = query<HTMLButtonElement>('#result-lobby-button');
  private readonly settingsDialog = query<HTMLDialogElement>('#settings-dialog');
  private readonly videoStatsDialog = query<HTMLDialogElement>('#video-stats-dialog');
  private readonly videoStatsCount = query<HTMLElement>('#video-stats-count');
  private readonly videoStatsTotal = query<HTMLElement>('#video-stats-total');
  private readonly videoStatsEmpty = query<HTMLElement>('#video-stats-empty');
  private readonly videoStatsList = query<HTMLOListElement>('#video-stats-list');
  private readonly beadBoard = query<HTMLElement>('#bead-pattern-board');
  private readonly beadScreen = query<HTMLElement>('#bead-screen');
  private readonly beadBackButton = query<HTMLButtonElement>('#bead-back-button');
  private readonly beadPatternName = query<HTMLElement>('#bead-pattern-name');
  private readonly beadProgressText = query<HTMLElement>('#bead-progress-text');
  private readonly beadProgressFill = query<HTMLElement>('#bead-progress-fill');
  private readonly beadStatus = query<HTMLElement>('#bead-screen-status');
  private readonly beadStartButton = query<HTMLButtonElement>('#bead-start-button');
  private readonly beadGalleryButton = query<HTMLButtonElement>('#bead-gallery-button');
  private readonly beadGalleryCount = query<HTMLElement>('#bead-gallery-count');
  private readonly collectionModeCount = query<HTMLElement>('#collection-mode-count');
  private readonly collectionScreen = query<HTMLElement>('#collection-screen');
  private readonly collectionRoute = query<HTMLElement>('#collection-route');
  private readonly collectionRouteLines = query<SVGSVGElement>('#collection-route-lines');
  private readonly collectionRouteBase = query<SVGPathElement>('#collection-route-base');
  private readonly collectionRouteComplete = query<SVGPathElement>('#collection-route-complete');
  private readonly collectionRouteProgress = query<HTMLElement>('#collection-route-progress');
  private readonly beadGalleryDialog = query<HTMLDialogElement>('#bead-gallery-dialog');
  private readonly beadGalleryTotal = query<HTMLElement>('#bead-gallery-total');
  private readonly beadGalleryEmpty = query<HTMLElement>('#bead-gallery-empty');
  private readonly beadGalleryGrid = query<HTMLElement>('#bead-gallery-grid');
  private readonly beadGalleryListView = query<HTMLElement>('#bead-gallery-list-view');
  private readonly beadGalleryDetail = query<HTMLElement>('#bead-gallery-detail');
  private readonly beadGalleryDetailName = query<HTMLElement>('#bead-gallery-detail-name');
  private readonly beadGalleryDetailSize = query<HTMLElement>('#bead-gallery-detail-size');
  private readonly beadGalleryDetailImage = query<HTMLImageElement>('#bead-gallery-detail-image');

  private builtInLevels: LevelData[] = [];
  private levels: LevelData[] = [];
  private settings: GameSettings = loadSettings();
  private mode: GameMode = 'normal';
  private stage = 1;
  private lives = 3;
  private endlessSeed = 1;
  private currentLevel?: LevelData;
  private currentProgress = 0;
  private currentTotal = 0;
  private settingsContext: 'lobby' | 'play' = 'lobby';
  private resultContext: ResultContext = 'normal';
  private resultActionBusy = false;
  private solutionRevealed = false;
  private videoViews: VideoViewRecord[] = loadVideoViews();
  private playContext: PlayContext = 'normal';
  private beadPatterns: BeadPatternData[] = [];
  private completedBeadPatternIds = new Set<string>();
  private beadPattern?: BeadPatternData;
  private beadProgress?: BeadProgress;
  private currentBeadReward: BeadPixel[] = [];
  private beadRewardAnimating = false;
  private collectionCompletedCount = loadCollectionCompletedCount();
  private currentCollectionIndex = 0;
  private activeNeighborhoodPreview: BoardNeighborhoodPreview | null = null;
  private manualTouchPreviewPosition?: { left: number; top: number };
  private touchPreviewDrag?: { pointerId: number; offsetX: number; offsetY: number };
  private activeGameTouchPointerId?: number;
  private touchPreviewVisibilityAnimation?: TouchPreviewVisibilityAnimation;
  private touchPreviewVisibilityFrame?: number;
  private touchPreviewVisibilityScale = 0.08;
  private touchPreviewVisibilityOpacity = 0;
  private touchPreviewHiding = false;
  private touchPreviewLastOrigin?: { x: number; y: number };
  private readonly touchPreviewCellNodes = new Map<number, HTMLElement>();
  private readonly touchPreviewPathLineNodes = new Map<string, SVGLineElement>();
  private touchPreviewTargetPosition?: { left: number; top: number };
  private touchPreviewRenderedPosition?: { left: number; top: number };
  private touchPreviewPositionFrame?: number;
  private touchPreviewLastFrameTime?: number;

  private readonly boardScene = new BoardScene();
  private readonly game: Phaser.Game;
  private readonly editor: LevelEditorController;

  public constructor() {
    startLobbyAmbientNetwork();
    this.game = new Phaser.Game({
      type: Phaser.CANVAS,
      parent: this.gameHost,
      width: 640,
      height: 620,
      transparent: true,
      backgroundColor: 'rgba(0,0,0,0)',
      render: { antialias: true, roundPixels: false },
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
      input: {
        activePointers: 1,
        touch: { capture: true },
        windowEvents: true,
      },
      scene: [this.boardScene],
    });
    this.editor = new LevelEditorController(query<HTMLElement>('#editor-screen'), {
      getLevels: () => this.levels,
      getNextLevelId: () => getNextLevelId(this.levels),
      onLevelsChange: (levels) => {
        saveLevelCollection(levels);
        this.refreshLevels();
        this.refreshLevelOptions();
      },
      onPlaytest: (level) => void this.startEditorPlaytest(level),
      onBack: () => this.backToLobby(),
    });
    window.addEventListener('resize', () => requestAnimationFrame(() => {
      this.syncBeadCellSize();
      if (!this.collectionScreen.hidden) this.renderCollectionPath();
      if (this.isTouchPreviewEnabled()) {
        this.renderNeighborhoodPreview(this.activeNeighborhoodPreview);
      }
      this.repositionTouchPreview();
    }));
  }

  public async initialize(): Promise<void> {
    const [builtInLevels, beadPatterns] = await Promise.all([
      loadBuiltInLevels(),
      loadBeadPatterns(),
      this.boardScene.whenReady(),
    ]);
    const beadSequence = loadBeadSequence(beadPatterns);
    this.builtInLevels = builtInLevels;
    this.beadPatterns = beadPatterns;
    this.beadPattern = beadSequence.pattern;
    this.beadProgress = beadSequence.progress;
    this.completedBeadPatternIds = new Set(loadCompletedBeadPatternIds(beadPatterns));
    this.refreshLevels();
    this.bindLobby();
    this.bindPlayControls();
    this.bindSettings();
    this.editor.bind();
    this.refreshLevelOptions();
    this.renderVideoStats();
    this.renderBeadScreen();
    this.renderCollectionEntryProgress();
    this.renderTouchPreviewState();
  }

  private bindLobby(): void {
    query('#start-button').addEventListener('click', () => void this.startNormalMode());
    query('#endless-button').addEventListener('click', () => void this.startEndlessMode());
    query('#bead-mode-button').addEventListener('click', () => this.openBeadMode());
    query('#collection-mode-button').addEventListener('click', () => this.openCollectionMode());
    query('#collection-back-button').addEventListener('click', () => this.backToLobby());
    query('#collection-gallery-button').addEventListener('click', () => this.openBeadGallery());
    this.beadBackButton.addEventListener('click', () => this.closeBeadMode());
    this.beadStartButton.addEventListener('click', () => void this.startBeadLevel());
    this.beadGalleryButton.addEventListener('click', () => this.openBeadGallery());
    query('#bead-gallery-close').addEventListener('click', () => this.beadGalleryDialog.close());
    query('#bead-gallery-detail-back').addEventListener('click', () => this.showBeadGalleryList());
    this.beadGalleryDialog.addEventListener('click', (event) => {
      if (event.target === this.beadGalleryDialog) this.beadGalleryDialog.close();
    });
    query('#editor-button').addEventListener('click', () => this.openEditor());
    query('#lobby-settings-button').addEventListener('click', () => this.openSettings('lobby'));
  }

  private bindPlayControls(): void {
    this.playBackButton.addEventListener('click', () => this.leavePlayScreen());
    query('#play-settings-button').addEventListener('click', () => this.openSettings('play'));
    this.bindSingleTouchInput();
    this.bindTouchPreviewDrag();
    this.restartButton.addEventListener('click', () => this.handleResultPrimary());
    this.nextButton.addEventListener('click', () => this.handleResultSecondary());
    this.resultLobbyButton.addEventListener('click', () => this.leavePlayScreen());
  }

  private bindSingleTouchInput(): void {
    this.playScreen.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch') return;
      if (this.activeGameTouchPointerId === undefined) {
        this.activeGameTouchPointerId = event.pointerId;
        return;
      }
      if (this.activeGameTouchPointerId !== event.pointerId) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, { capture: true });

    const releaseTouch = (event: PointerEvent): void => {
      if (event.pointerType === 'touch' && this.activeGameTouchPointerId === event.pointerId) {
        this.activeGameTouchPointerId = undefined;
      }
    };
    this.playScreen.addEventListener('pointerup', releaseTouch, { capture: true });
    this.playScreen.addEventListener('pointercancel', releaseTouch, { capture: true });
  }

  private bindTouchPreviewDrag(): void {
    this.touchPreview.addEventListener('pointerdown', (event) => {
      if (
        !this.isTouchPreviewEnabled()
        || !this.activeNeighborhoodPreview
        || this.settings.touchPreviewFollowsPointer
        || this.touchPreviewHiding
        || this.touchPreview.hidden
        || event.button !== 0
      ) return;
      event.preventDefault();
      event.stopPropagation();
      const bounds = this.touchPreview.getBoundingClientRect();
      this.touchPreviewDrag = {
        pointerId: event.pointerId,
        offsetX: event.clientX - bounds.left,
        offsetY: event.clientY - bounds.top,
      };
      this.touchPreview.classList.add('is-dragging');
      this.touchPreview.setPointerCapture(event.pointerId);
    });
    this.touchPreview.addEventListener('pointermove', (event) => {
      if (this.touchPreviewDrag?.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const playBounds = this.playScreen.getBoundingClientRect();
      this.placeTouchPreview(
        event.clientX - playBounds.left - this.touchPreviewDrag.offsetX,
        event.clientY - playBounds.top - this.touchPreviewDrag.offsetY,
        true,
      );
    });
    const finishDrag = (event: PointerEvent): void => this.finishTouchPreviewDrag(event.pointerId);
    this.touchPreview.addEventListener('pointerup', finishDrag);
    this.touchPreview.addEventListener('pointercancel', finishDrag);
    this.touchPreview.addEventListener('lostpointercapture', finishDrag);
  }

  private finishTouchPreviewDrag(pointerId: number): void {
    if (this.touchPreviewDrag?.pointerId !== pointerId) return;
    this.touchPreviewDrag = undefined;
    this.touchPreview.classList.remove('is-dragging');
    if (this.touchPreview.hasPointerCapture(pointerId)) {
      this.touchPreview.releasePointerCapture(pointerId);
    }
  }

  private handleNeighborhoodPreview(preview: BoardNeighborhoodPreview | null): void {
    const previousPreview = this.activeNeighborhoodPreview;
    const focusIndex = preview?.cells.find((cell) => cell.center)?.index;
    const activePreview = focusIndex === undefined ? null : preview;
    this.activeNeighborhoodPreview = activePreview;
    if (!this.isTouchPreviewEnabled() || !activePreview) {
      this.hideTouchPreview(previousPreview);
      return;
    }

    const shouldAnimateIn = previousPreview === null || this.touchPreview.hidden || this.touchPreviewHiding;
    this.touchPreviewLastOrigin = {
      x: activePreview.originClientX,
      y: activePreview.originClientY,
    };
    this.touchPreview.hidden = false;
    this.renderNeighborhoodPreview(activePreview);
    if (activePreview.pointer && this.settings.touchPreviewFollowsPointer && !this.touchPreviewDrag) {
      this.placeTouchPreviewAbove(activePreview.clientX, activePreview.clientY, !shouldAnimateIn);
    } else if (shouldAnimateIn) {
      this.repositionTouchPreview();
    }
    if (shouldAnimateIn) this.animateTouchPreviewIn(activePreview);
  }

  private renderTouchPreviewState(): void {
    const previewSize = this.settings.touchPreviewSize;
    const enabled = previewSize !== 'off';
    const followsPointer = enabled && this.settings.touchPreviewFollowsPointer;
    this.touchPreview.dataset.size = previewSize;
    if (!enabled || !followsPointer) this.cancelTouchPreviewPositionAnimation();
    this.touchPreview.classList.toggle('is-following', followsPointer);
    this.touchPreview.setAttribute(
      'aria-label',
      followsPointer
        ? '正在跟随触摸位置的关卡小窗'
        : '关卡小窗，可按住任意位置拖动',
    );
    if (!enabled) {
      const previousPreview = this.activeNeighborhoodPreview;
      this.activeNeighborhoodPreview = null;
      this.hideTouchPreview(previousPreview);
      return;
    }
    if (!this.activeNeighborhoodPreview) {
      this.hideTouchPreview();
      return;
    }
    const shouldAnimateIn = this.touchPreview.hidden || this.touchPreviewHiding;
    this.touchPreview.hidden = false;
    this.renderNeighborhoodPreview(this.activeNeighborhoodPreview);
    if (this.settings.touchPreviewFollowsPointer && this.activeNeighborhoodPreview.pointer) {
      this.placeTouchPreviewAbove(
        this.activeNeighborhoodPreview.clientX,
        this.activeNeighborhoodPreview.clientY,
        !shouldAnimateIn,
      );
    } else {
      this.repositionTouchPreview();
    }
    if (shouldAnimateIn) this.animateTouchPreviewIn(this.activeNeighborhoodPreview);
  }

  private animateTouchPreviewIn(preview: BoardNeighborhoodPreview): void {
    const wasAnimating = this.touchPreviewVisibilityFrame !== undefined;
    this.cancelTouchPreviewVisibilityAnimation();
    this.touchPreviewHiding = false;
    this.setTouchPreviewAnimationOrigin(preview.originClientX, preview.originClientY);
    if (!wasAnimating) this.applyTouchPreviewVisibility(0.08, 0);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.applyTouchPreviewVisibility(1, 1);
      return;
    }

    this.touchPreviewVisibilityAnimation = {
      fromScale: this.touchPreviewVisibilityScale,
      fromOpacity: this.touchPreviewVisibilityOpacity,
      toScale: 1,
      toOpacity: 1,
      duration: TOUCH_PREVIEW_ENTER_DURATION_MS,
      hideOnComplete: false,
    };
    this.touchPreviewVisibilityFrame = requestAnimationFrame((timestamp) => (
      this.animateTouchPreviewVisibility(timestamp)
    ));
  }

  private hideTouchPreview(preview?: BoardNeighborhoodPreview | null): void {
    if (this.touchPreview.hidden || this.touchPreviewHiding) return;
    this.touchPreviewHiding = true;
    this.cancelTouchPreviewPositionAnimation();
    const drag = this.touchPreviewDrag;
    this.touchPreviewDrag = undefined;
    this.touchPreview.classList.remove('is-dragging');
    if (drag && this.touchPreview.hasPointerCapture(drag.pointerId)) {
      this.touchPreview.releasePointerCapture(drag.pointerId);
    }

    const origin = preview
      ? { x: preview.originClientX, y: preview.originClientY }
      : this.touchPreviewLastOrigin;
    if (!origin || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.finishTouchPreviewHide();
      return;
    }

    this.cancelTouchPreviewVisibilityAnimation();
    this.setTouchPreviewAnimationOrigin(origin.x, origin.y);
    this.touchPreviewVisibilityAnimation = {
      fromScale: this.touchPreviewVisibilityScale,
      fromOpacity: this.touchPreviewVisibilityOpacity,
      toScale: 0.08,
      toOpacity: 0,
      duration: TOUCH_PREVIEW_EXIT_DURATION_MS,
      hideOnComplete: true,
    };
    this.touchPreviewVisibilityFrame = requestAnimationFrame((timestamp) => (
      this.animateTouchPreviewVisibility(timestamp)
    ));
  }

  private animateTouchPreviewVisibility(timestamp: number): void {
    this.touchPreviewVisibilityFrame = undefined;
    const animation = this.touchPreviewVisibilityAnimation;
    if (!animation) return;
    if (animation.startTime === undefined) animation.startTime = timestamp;
    const progress = Math.min(1, Math.max(0, (timestamp - animation.startTime) / animation.duration));
    const scaleProgress = animation.hideOnComplete
      ? progress ** 3
      : 1 + 2.35 * (progress - 1) ** 3 + 1.35 * (progress - 1) ** 2;
    const opacityProgress = animation.hideOnComplete
      ? progress ** 2
      : 1 - (1 - progress) ** 3;
    this.applyTouchPreviewVisibility(
      animation.fromScale + (animation.toScale - animation.fromScale) * scaleProgress,
      animation.fromOpacity + (animation.toOpacity - animation.fromOpacity) * opacityProgress,
    );

    if (progress < 1) {
      this.touchPreviewVisibilityFrame = requestAnimationFrame((nextTimestamp) => (
        this.animateTouchPreviewVisibility(nextTimestamp)
      ));
      return;
    }

    this.touchPreviewVisibilityAnimation = undefined;
    if (animation.hideOnComplete && !this.activeNeighborhoodPreview) {
      this.finishTouchPreviewHide();
      return;
    }
    this.touchPreviewHiding = false;
    this.applyTouchPreviewVisibility(1, 1);
  }

  private applyTouchPreviewVisibility(scale: number, opacity: number): void {
    this.touchPreviewVisibilityScale = scale;
    this.touchPreviewVisibilityOpacity = opacity;
    this.touchPreviewSurface.style.transform = `scale(${scale})`;
    this.touchPreviewSurface.style.opacity = String(opacity);
  }

  private setTouchPreviewAnimationOrigin(clientX: number, clientY: number): void {
    const bounds = this.touchPreview.getBoundingClientRect();
    this.touchPreviewSurface.style.transformOrigin = (
      `${clientX - bounds.left}px ${clientY - bounds.top}px`
    );
  }

  private cancelTouchPreviewVisibilityAnimation(): void {
    if (this.touchPreviewVisibilityFrame !== undefined) {
      cancelAnimationFrame(this.touchPreviewVisibilityFrame);
      this.touchPreviewVisibilityFrame = undefined;
    }
    this.touchPreviewVisibilityAnimation = undefined;
  }

  private finishTouchPreviewHide(): void {
    this.cancelTouchPreviewVisibilityAnimation();
    this.touchPreviewHiding = false;
    this.touchPreview.hidden = true;
    this.applyTouchPreviewVisibility(0.08, 0);
    this.renderNeighborhoodPreview(null);
  }

  private renderNeighborhoodPreview(preview: BoardNeighborhoodPreview | null): void {
    this.touchPreviewBoard.style.setProperty(
      '--level-ball-color',
      levelBallColorCss(this.currentLevel?.levelId ?? 1),
    );
    this.touchPreviewBoard.classList.toggle('is-active', preview !== null);
    if (!preview) {
      this.touchPreviewBoard.classList.remove('has-focus');
      this.touchPreviewCells.replaceChildren();
      this.touchPreviewCellNodes.clear();
      this.touchPreviewPathLines.replaceChildren();
      this.touchPreviewPathLineNodes.clear();
      this.touchPreviewPointerLine.toggleAttribute('hidden', true);
      this.touchPreviewBoard.setAttribute('aria-label', '等待关卡载入');
      return;
    }

    const center = preview.cells.find((cell) => cell.center);
    const hasFocus = center !== undefined;
    this.touchPreviewBoard.classList.toggle('has-focus', hasFocus);
    const maxOffset = Math.max(
      0.5,
      ...preview.cells.flatMap((cell) => [Math.abs(cell.offsetX), Math.abs(cell.offsetY)]),
    );
    const offsetPercent = (offset: number): number => (
      50 + (Math.max(-maxOffset, Math.min(maxOffset, offset)) / maxOffset) * 42
    );
    const boardSize = Math.max(
      1,
      Math.min(
        this.touchPreviewBoard.clientWidth || 144,
        this.touchPreviewBoard.clientHeight || this.touchPreviewBoard.clientWidth || 144,
      ),
    );
    const gridUnitSize = (boardSize * 0.84) / Math.max(1, maxOffset * 2);
    const contentScale = this.settings.touchPreviewSize === 'large' ? 0.6 : 1;
    const targetGridUnitSize = boardSize * 0.31 * contentScale;
    const cameraScale = Math.max(0.25, Math.min(12, targetGridUnitSize / gridUnitSize));
    const targetCellSize = boardSize * 0.2 * contentScale;
    const cellSize = targetCellSize / cameraScale;
    this.touchPreviewBoard.style.setProperty('--touch-preview-cell-size', `${cellSize.toFixed(2)}px`);
    this.touchPreviewBoard.style.setProperty(
      '--touch-preview-line-width',
      `${Math.max(3.5, Math.min(4.5, boardSize * 0.03)).toFixed(2)}px`,
    );
    const positions = new Map<number, { x: number; y: number }>();

    preview.cells.forEach((previewCell) => {
      const position = {
        x: offsetPercent(previewCell.offsetX),
        y: offsetPercent(previewCell.offsetY),
      };
      positions.set(previewCell.index, position);
      let cell = this.touchPreviewCellNodes.get(previewCell.index);
      if (!cell) {
        cell = document.createElement('span');
        this.touchPreviewCellNodes.set(previewCell.index, cell);
        this.touchPreviewCells.append(cell);
      }
      const className = [
        'touch-preview-cell',
        previewCell.value === null ? 'is-hidden' : '',
        previewCell.center ? 'is-center' : '',
        previewCell.inFocusRing ? 'is-in-focus-ring' : '',
      ].filter(Boolean).join(' ');
      if (cell.className !== className) cell.className = className;
      const x = `${position.x.toFixed(3)}%`;
      const y = `${position.y.toFixed(3)}%`;
      if (cell.style.getPropertyValue('--preview-x') !== x) cell.style.setProperty('--preview-x', x);
      if (cell.style.getPropertyValue('--preview-y') !== y) cell.style.setProperty('--preview-y', y);
      const text = previewCell.value === null ? '' : String(previewCell.value);
      if (cell.textContent !== text) cell.textContent = text;
      const fontScale = text.length >= 3 ? 0.37 : text.length === 2 ? 0.48 : 0.6;
      const fontSize = `${Math.max(3.5 / cameraScale, cellSize * fontScale).toFixed(2)}px`;
      if (cell.style.getPropertyValue('--touch-preview-font-size') !== fontSize) {
        cell.style.setProperty('--touch-preview-font-size', fontSize);
      }
      cell.setAttribute('aria-hidden', 'true');
    });

    this.touchPreviewCellNodes.forEach((cell, index) => {
      if (positions.has(index)) return;
      cell.remove();
      this.touchPreviewCellNodes.delete(index);
    });

    const focusPosition = center ? positions.get(center.index) : undefined;
    if (focusPosition) {
      const cameraX = boardSize * 0.5 - (focusPosition.x / 100) * boardSize * cameraScale;
      const cameraY = boardSize * 0.5 - (focusPosition.y / 100) * boardSize * cameraScale;
      const cameraProperties = {
        '--preview-camera-x': `${cameraX.toFixed(3)}px`,
        '--preview-camera-y': `${cameraY.toFixed(3)}px`,
        '--preview-camera-scale': cameraScale.toFixed(5),
      };
      Object.entries(cameraProperties).forEach(([name, value]) => {
        if (this.touchPreviewBoard.style.getPropertyValue(name) !== value) {
          this.touchPreviewBoard.style.setProperty(name, value);
        }
      });
    }

    const setLineCoordinates = (
      line: SVGLineElement,
      from: { x: number; y: number },
      to: { x: number; y: number },
    ): void => {
      const coordinates = {
        x1: from.x.toFixed(3),
        y1: from.y.toFixed(3),
        x2: to.x.toFixed(3),
        y2: to.y.toFixed(3),
      };
      Object.entries(coordinates).forEach(([name, value]) => {
        if (line.getAttribute(name) !== value) line.setAttribute(name, value);
        const property = `--preview-${name}`;
        const percentage = `${value}%`;
        if (line.style.getPropertyValue(property) !== percentage) {
          line.style.setProperty(property, percentage);
        }
      });
    };
    const activeLineKeys = new Set<string>();
    const focusRingIndices = new Set(
      preview.cells.filter((cell) => cell.inFocusRing).map((cell) => cell.index),
    );
    preview.lines.forEach(({ fromIndex, toIndex }) => {
      const from = positions.get(fromIndex);
      const to = positions.get(toIndex);
      if (!from || !to) return;
      const key = fromIndex < toIndex ? `${fromIndex}:${toIndex}` : `${toIndex}:${fromIndex}`;
      activeLineKeys.add(key);
      let line = this.touchPreviewPathLineNodes.get(key);
      if (!line) {
        line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.classList.add('touch-preview-path-line');
        this.touchPreviewPathLineNodes.set(key, line);
        this.touchPreviewPathLines.append(line);
      }
      line.classList.toggle(
        'is-in-focus-ring',
        focusRingIndices.has(fromIndex) && focusRingIndices.has(toIndex),
      );
      setLineCoordinates(line, from, to);
    });

    this.touchPreviewPathLineNodes.forEach((line, key) => {
      if (activeLineKeys.has(key)) return;
      line.remove();
      this.touchPreviewPathLineNodes.delete(key);
    });

    const pointerStart = preview.pointer ? positions.get(preview.pointer.fromIndex) : undefined;
    if (preview.pointer && pointerStart) {
      const pointerEnd = {
        x: offsetPercent(preview.pointer.offsetX),
        y: offsetPercent(preview.pointer.offsetY),
      };
      this.touchPreviewPointerLine.toggleAttribute('hidden', false);
      setLineCoordinates(this.touchPreviewPointerLine, pointerStart, pointerEnd);
    } else {
      this.touchPreviewPointerLine.toggleAttribute('hidden', true);
    }

    this.touchPreviewBoard.setAttribute(
      'aria-label',
      center === undefined
        ? `按住棋盘数字查看当前格周围${this.settings.touchPreviewSize === 'large' ? '两圈' : '一圈'}`
        : `完整关卡网格，当前格${center.value === null ? '为隐藏数字' : `数字为 ${center.value}`}`,
    );
  }

  private repositionTouchPreview(): void {
    if (!this.isTouchPreviewEnabled() || this.touchPreview.hidden || this.touchPreviewDrag) return;
    if (this.settings.touchPreviewFollowsPointer && this.activeNeighborhoodPreview?.pointer) {
      this.placeTouchPreviewAbove(
        this.activeNeighborhoodPreview.clientX,
        this.activeNeighborhoodPreview.clientY,
      );
      return;
    }
    if (this.manualTouchPreviewPosition) {
      this.placeTouchPreview(
        this.manualTouchPreviewPosition.left,
        this.manualTouchPreviewPosition.top,
        true,
      );
      return;
    }
    const playBounds = this.playScreen.getBoundingClientRect();
    const hostBounds = this.gameHost.getBoundingClientRect();
    this.placeTouchPreview(
      hostBounds.right - playBounds.left - this.touchPreview.offsetWidth - 10,
      hostBounds.top - playBounds.top + 10,
      true,
    );
  }

  private placeTouchPreviewAbove(clientX: number, clientY: number, smooth = true): void {
    const playBounds = this.playScreen.getBoundingClientRect();
    this.placeTouchPreview(
      clientX - playBounds.left - this.touchPreview.offsetWidth * 0.5,
      clientY - playBounds.top - this.touchPreview.offsetHeight - 24,
      false,
      smooth,
    );
  }

  private placeTouchPreview(
    left: number,
    top: number,
    rememberManualPosition: boolean,
    smooth = false,
  ): void {
    const playBounds = this.playScreen.getBoundingClientRect();
    const margin = 8;
    const maxLeft = Math.max(margin, playBounds.width - this.touchPreview.offsetWidth - margin);
    const maxTop = Math.max(margin, playBounds.height - this.touchPreview.offsetHeight - margin);
    const nextPosition = {
      left: Math.min(maxLeft, Math.max(margin, left)),
      top: Math.min(maxTop, Math.max(margin, top)),
    };
    if (rememberManualPosition) this.manualTouchPreviewPosition = nextPosition;
    if (smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.touchPreviewTargetPosition = nextPosition;
      if (!this.touchPreviewRenderedPosition) {
        const bounds = this.touchPreview.getBoundingClientRect();
        this.touchPreviewRenderedPosition = {
          left: bounds.left - playBounds.left,
          top: bounds.top - playBounds.top,
        };
      }
      if (this.touchPreviewPositionFrame === undefined) {
        this.touchPreviewLastFrameTime = undefined;
        this.touchPreviewPositionFrame = requestAnimationFrame((timestamp) => (
          this.animateTouchPreviewPosition(timestamp)
        ));
      }
      return;
    }
    this.cancelTouchPreviewPositionAnimation();
    this.applyTouchPreviewPosition(nextPosition);
  }

  private animateTouchPreviewPosition(timestamp: number): void {
    this.touchPreviewPositionFrame = undefined;
    const target = this.touchPreviewTargetPosition;
    if (!target) return;
    const current = this.touchPreviewRenderedPosition ?? target;
    const deltaX = target.left - current.left;
    const deltaY = target.top - current.top;
    if (Math.abs(deltaX) < 0.35 && Math.abs(deltaY) < 0.35) {
      this.applyTouchPreviewPosition(target);
      this.touchPreviewTargetPosition = undefined;
      this.touchPreviewLastFrameTime = undefined;
      return;
    }
    const elapsed = this.touchPreviewLastFrameTime === undefined
      ? 1000 / 60
      : Math.min(40, Math.max(1, timestamp - this.touchPreviewLastFrameTime));
    this.touchPreviewLastFrameTime = timestamp;
    const interpolation = 1 - Math.exp(-elapsed / 55);
    this.applyTouchPreviewPosition({
      left: current.left + deltaX * interpolation,
      top: current.top + deltaY * interpolation,
    });
    this.touchPreviewPositionFrame = requestAnimationFrame((nextTimestamp) => (
      this.animateTouchPreviewPosition(nextTimestamp)
    ));
  }

  private applyTouchPreviewPosition(position: { left: number; top: number }): void {
    this.touchPreview.style.right = 'auto';
    this.touchPreview.style.left = '0';
    this.touchPreview.style.top = '0';
    this.touchPreview.style.transform = `translate3d(${position.left}px, ${position.top}px, 0)`;
    this.touchPreviewRenderedPosition = position;
  }

  private cancelTouchPreviewPositionAnimation(): void {
    if (this.touchPreviewPositionFrame !== undefined) cancelAnimationFrame(this.touchPreviewPositionFrame);
    this.touchPreviewPositionFrame = undefined;
    this.touchPreviewTargetPosition = undefined;
    this.touchPreviewLastFrameTime = undefined;
  }

  private isTouchPreviewEnabled(): boolean {
    return this.settings.touchPreviewSize !== 'off';
  }

  private selectedTouchPreviewSize(): TouchPreviewSize {
    const value = this.touchPreviewSizeControl.querySelector<HTMLInputElement>(
      'input[name="touch-preview-size"]:checked',
    )?.value;
    return isTouchPreviewSize(value) ? value : 'small';
  }

  private setTouchPreviewSizeControl(size: TouchPreviewSize): void {
    this.touchPreviewSizeControl.querySelectorAll<HTMLInputElement>(
      'input[name="touch-preview-size"]',
    ).forEach((input) => {
      input.checked = input.value === size;
    });
  }

  private bindSettings(): void {
    query('#settings-apply-button').addEventListener('click', () => void this.applySettings());
    this.touchPreviewSizeControl.addEventListener('change', () => this.refreshSettingsControls());
    query('#video-stats-button').addEventListener('click', () => this.openVideoStats());
    query('#video-stats-reset').addEventListener('click', () => this.resetVideoStats());
    query('#settings-lobby-button').addEventListener('click', () => {
      this.settingsDialog.close();
      if (this.settingsContext === 'play') this.leavePlayScreen();
      else this.backToLobby();
    });
    this.settingsDialog.addEventListener('close', () => {
      if (this.settingsContext === 'play') this.boardScene.setPaused(false);
    });
  }

  private refreshLevels(): void {
    this.levels = loadLevelCollection(this.builtInLevels);
    if (!this.levels.some((level) => level.levelId === this.settings.selectedLevelId)) {
      this.settings.selectedLevelId = this.levels[0]?.levelId ?? 1;
    }
  }

  private showScreen(name: ScreenName): void {
    this.screenRouter.show(name);
  }

  private async showPlayScreen(): Promise<void> {
    this.setSolutionReveal(false);
    this.showScreen('play');
    this.renderTouchPreviewState();
    this.resultOverlay.hidden = true;
    this.resultActionBusy = false;
    this.setResultActionsDisabled(false);
    const backLabel = this.playContext === 'editor-playtest'
      ? '返回关卡编辑器'
      : this.playContext === 'bead'
        ? '返回拼豆图纸'
        : this.playContext === 'collection'
          ? '返回收集路线'
        : '返回大厅';
    this.playBackButton.setAttribute('aria-label', backLabel);
    this.playBackButton.title = backLabel;
    await nextFrame();
    this.game.scale.resize(Math.max(320, this.gameHost.clientWidth), Math.max(420, this.gameHost.clientHeight));
    await nextFrame();
    this.game.scale.resize(Math.max(320, this.gameHost.clientWidth), Math.max(420, this.gameHost.clientHeight));
  }

  private setSolutionReveal(revealed: boolean): void {
    this.solutionRevealed = revealed;
    this.solutionToggle.checked = revealed;
    this.boardScene.setSolutionReveal(revealed);
  }

  private async startNormalMode(): Promise<void> {
    this.playContext = 'normal';
    this.mode = 'normal';
    this.lives = 3;
    this.renderLives();
    await this.showPlayScreen();
    this.setCurrentBoard(this.createNormalLevel());
  }

  private async startEndlessMode(): Promise<void> {
    this.playContext = 'normal';
    this.mode = 'endless';
    this.stage = 1;
    this.lives = 3;
    this.renderLives();
    this.endlessSeed = Date.now() & 0x7fffffff;
    await this.showPlayScreen();
    const profile = getEndlessStageSettings(this.stage);
    const level = this.createEndlessLevel(this.stage, profile);
    this.setCurrentBoard(level, profile);
  }

  private async startBeadLevel(): Promise<void> {
    if (!this.beadPattern || !this.beadProgress) return;
    const level = this.createNormalLevel();
    const reward = nextBeads(this.beadPattern, this.beadProgress, level.solutionPath.length);
    if (reward.length === 0) {
      this.renderBeadScreen(undefined, '图案已经全部完成。');
      return;
    }

    this.playContext = 'bead';
    this.mode = 'normal';
    this.currentBeadReward = reward;
    this.lives = 3;
    this.renderLives();
    await this.showPlayScreen();
    this.setCurrentBoard(level);
  }

  private async startEditorPlaytest(level: LevelData): Promise<void> {
    this.playContext = 'editor-playtest';
    this.mode = 'normal';
    this.lives = 3;
    this.renderLives();
    await this.showPlayScreen();
    this.setCurrentBoard(level);
  }

  private createNormalLevel(): LevelData {
    const selected = this.levels.find((level) => level.levelId === this.settings.selectedLevelId) ?? this.levels[0];
    if (!selected) throw new Error('没有可用的关卡。');
    return selected;
  }

  private createEndlessLevel(stage: number, profile: EndlessStageSettings): LevelData {
    return generateEndlessLevel(profile, this.endlessSeed + stage * 1000003);
  }

  private makeSession(level: LevelData, profile?: EndlessStageSettings): BoardSessionInput {
    const hiddenPercent = profile?.hiddenPercent ?? this.settings.hiddenPercent;
    const maxHiddenRun = profile?.maxHiddenRun ?? this.settings.maxHiddenRun;
    const maxVisibleRun = profile?.maxVisibleRun ?? this.settings.maxVisibleRun;
    const seed = (this.mode === 'endless' ? this.endlessSeed + this.stage * 1000003 : level.levelId) | 0;
    const eventContext = {
      mode: this.mode,
      levelId: level.levelId,
      stage: this.mode === 'endless' ? this.stage : undefined,
    };
    return {
      level,
      hiddenCells: level.hiddenCells === undefined
        ? selectHiddenCells(level.solutionPath, hiddenPercent, maxHiddenRun, maxVisibleRun, seed)
        : new Set(level.hiddenCells.map(cellKey)),
      completionGemColors: this.playContext === 'bead'
        ? this.currentBeadReward.map((bead) => bead.color)
        : undefined,
      showNextNumber: this.settings.showNextNumber,
      soundEnabled: this.settings.soundEnabled,
      touchPreviewRingDepth: this.settings.touchPreviewSize === 'large' ? 2 : 1,
      mode: this.mode,
      onProgress: (current, total) => {
        this.currentProgress = current;
        this.currentTotal = total;
        this.renderProgress();
        if (this.playContext !== 'editor-playtest') {
          this.events.emit('level.progressed', { ...eventContext, current, total });
        }
      },
      onWrong: (message) => {
        if (this.playContext !== 'editor-playtest') {
          this.events.emit('level.wrong-move', { ...eventContext, current: this.currentProgress, message });
        }
        this.handleWrong();
      },
      onComplete: () => {
        if (this.playContext !== 'editor-playtest') {
          this.events.emit('level.completed', { ...eventContext, total: level.solutionPath.length });
        }
        void this.handleComplete();
      },
      onNeighborhoodPreview: (preview) => this.handleNeighborhoodPreview(preview),
    };
  }

  private setCurrentBoard(level: LevelData, profile?: EndlessStageSettings): void {
    this.currentLevel = level;
    this.currentProgress = 0;
    this.currentTotal = level.solutionPath.length;
    this.updateGameHeading(level);
    this.renderProgress();
    this.boardScene.setBoard(this.makeSession(level, profile));
    if (this.playContext !== 'editor-playtest') {
      this.events.emit('level.started', {
        mode: this.mode,
        levelId: level.levelId,
        stage: this.mode === 'endless' ? this.stage : undefined,
        total: level.solutionPath.length,
      });
    }
  }

  private updateGameHeading(level: LevelData): void {
    if (this.playContext === 'collection') {
      this.levelLabel.textContent = `收集关卡 ${this.currentCollectionIndex + 1}`;
      return;
    }
    if (this.playContext === 'bead') {
      this.levelLabel.textContent = `拼豆关卡 · 关卡 ${level.levelId}`;
      return;
    }
    if (this.playContext === 'editor-playtest') {
      this.levelLabel.textContent = `试玩关卡 · ${level.columns} × ${level.rows}`;
      return;
    }
    if (this.mode === 'endless') {
      this.levelLabel.textContent = `无尽 · 阶段 ${this.stage}`;
      return;
    }
    this.levelLabel.textContent = `${level.custom ? '自制关卡' : '关卡'} ${level.levelId}`;
  }

  private renderProgress(): void {
    this.progressLabel.textContent = `${this.currentProgress} / ${this.currentTotal}`;
  }

  private renderLives(): void {
    this.livesLabel.hidden = false;
    this.livesLabel.textContent = formatLives(this.lives);
    this.livesLabel.setAttribute('aria-label', `生命值 ${this.lives}`);
  }

  private handleWrong(): void {
    if (this.lives <= 0) return;
    this.lives -= 1;
    this.renderLives();
    if (this.lives === 0) this.handleLifeDepleted();
  }

  private handleLifeDepleted(): void {
    this.boardScene.setPaused(true);
    if (this.playContext === 'editor-playtest') {
      this.resultContext = 'editor-playtest-failed';
      this.resultKicker.textContent = 'PLAYTEST PAUSED';
      this.resultTitle.textContent = '试玩结束';
      this.resultMessage.textContent = `当前数字进度 ${this.currentProgress} / ${this.currentTotal}`;
      this.resultReward.hidden = true;
      this.restartButton.textContent = '重新试玩';
      this.nextButton.hidden = true;
      this.resultLobbyButton.textContent = '返回编辑器';
      this.resultActions.classList.add('is-single');
      this.setResultActionsDisabled(false);
      this.resultOverlay.hidden = false;
      return;
    }

    this.resultContext = 'life-depleted';
    this.resultKicker.textContent = 'OUT OF HEARTS';
    this.resultTitle.textContent = '生命已耗尽';
    const progress = `当前数字进度 ${this.currentProgress} / ${this.currentTotal}`;
    this.resultMessage.textContent = this.mode === 'endless' ? `阶段 ${this.stage} · ${progress}` : progress;
    this.resultReward.hidden = true;
    this.restartButton.textContent = '重新开始';
    this.nextButton.textContent = '观看视频获取 1♥';
    this.nextButton.hidden = false;
    this.resultLobbyButton.textContent = this.playContext === 'bead'
      ? '返回拼豆图纸'
      : this.playContext === 'collection'
        ? '返回收集路线'
        : '放弃';
    this.resultActions.classList.remove('is-single');
    this.setResultActionsDisabled(false);
    this.resultOverlay.hidden = false;
  }

  private showEditorPlaytestResult(): void {
    this.resultContext = 'editor-playtest';
    this.resultKicker.textContent = 'PLAYTEST COMPLETE';
    this.resultTitle.textContent = '试玩完成';
    this.resultMessage.textContent = '当前编辑器关卡可以完整通关。';
    this.resultReward.hidden = true;
    this.restartButton.textContent = '再试一次';
    this.nextButton.hidden = true;
    this.resultLobbyButton.textContent = '返回编辑器';
    this.resultActions.classList.add('is-single');
    this.setResultActionsDisabled(false);
    this.resultOverlay.hidden = false;
  }

  private showNormalResult(): void {
    this.resultContext = 'normal';
    this.resultKicker.textContent = 'PUZZLE COMPLETE';
    this.resultTitle.textContent = '漂亮的一笔！';
    this.resultMessage.textContent = '你已连接棋盘上的所有数字。';
    this.resultReward.hidden = true;
    this.restartButton.textContent = '重新挑战';
    this.nextButton.hidden = false;
    this.nextButton.textContent = '下一关';
    this.resultLobbyButton.textContent = '返回大厅';
    this.resultActions.classList.remove('is-single');
    this.setResultActionsDisabled(false);
    this.resultOverlay.hidden = false;
  }

  private showCollectionResult(): void {
    const total = this.collectionLevelCount();
    const hasNext = this.currentCollectionIndex + 1 < total;
    this.resultContext = 'collection';
    this.resultKicker.textContent = 'ROUTE CLEARED';
    this.resultTitle.textContent = `图片 ${this.currentCollectionIndex + 1} 已收集`;
    this.resultMessage.textContent = hasNext
      ? `图片已放入路线节点，关卡 ${this.currentCollectionIndex + 2} 已解锁。`
      : '最后一张图片已放入路线节点，整条收集路线已经完成。';
    this.resultReward.hidden = true;
    this.restartButton.textContent = '重新挑战';
    this.nextButton.hidden = !hasNext;
    this.nextButton.textContent = '下一关';
    this.resultLobbyButton.textContent = '返回收集路线';
    this.resultActions.classList.toggle('is-single', !hasNext);
    this.setResultActionsDisabled(false);
    this.resultOverlay.hidden = false;
  }

  private showEndlessStageResult(): void {
    this.resultContext = 'endless-stage';
    this.resultKicker.textContent = 'STAGE COMPLETE';
    this.resultTitle.textContent = `阶段 ${this.stage}`;
    this.resultMessage.textContent = '已完成';
    this.resultReward.textContent = '♥ +1';
    this.resultReward.hidden = false;
    this.restartButton.textContent = '下一阶段';
    this.nextButton.textContent = '观看视频 · 额外 +1♥';
    this.nextButton.hidden = false;
    this.resultLobbyButton.textContent = '返回大厅';
    this.resultActions.classList.remove('is-single');
    this.setResultActionsDisabled(false);
    this.resultOverlay.hidden = false;
  }

  private setResultActionsDisabled(disabled: boolean): void {
    this.restartButton.disabled = disabled;
    this.nextButton.disabled = disabled;
  }

  private handleResultPrimary(): void {
    if (this.resultActionBusy) return;
    if (this.resultContext === 'endless-stage') {
      void this.advanceEndlessStage(false);
    } else if (this.resultContext === 'life-depleted' || this.resultContext === 'editor-playtest-failed') {
      this.restartAfterFailure();
    } else if (this.resultContext === 'editor-playtest') {
      this.lives = 3;
      this.renderLives();
      this.restartCurrent();
    } else {
      this.lives = 3;
      this.renderLives();
      this.restartCurrent();
    }
  }

  private handleResultSecondary(): void {
    if (this.resultActionBusy) return;
    if (this.resultContext === 'endless-stage') {
      void this.advanceEndlessStage(true);
    } else if (this.resultContext === 'life-depleted') {
      this.continueAfterFailureVideo();
    } else if (this.resultContext === 'collection') {
      this.nextCollectionLevel();
    } else if (this.resultContext === 'normal') {
      this.nextLevel();
    }
  }

  private async handleComplete(): Promise<void> {
    if (this.playContext === 'bead') {
      await this.boardScene.showCompletion();
      if (this.playContext !== 'bead' || !this.beadPattern || !this.beadProgress) return;

      const previousCollected = this.beadProgress.collected;
      const reward = [...this.currentBeadReward];
      const rewardCount = reward.length;
      const completedPattern = this.beadPattern;
      this.beadProgress = advanceBeadProgress(this.beadPattern, this.beadProgress, rewardCount);
      saveBeadProgress(this.beadProgress);
      this.currentBeadReward = [];
      this.selectNextNormalLevel();
      const flightCluster = this.createBeadFlightCluster(reward);
      this.beadRewardAnimating = true;
      this.beadBackButton.disabled = true;
      this.beadGalleryButton.disabled = true;
      this.showScreen('bead');
      this.renderBeadScreen(
        undefined,
        `${rewardCount} 颗拼豆正在归位…`,
        previousCollected,
      );
      this.beadStartButton.disabled = true;
      this.beadStartButton.textContent = '拼豆正在归位…';

      try {
        await nextFrame();
        await nextFrame();
        await this.animateBeadFlightCluster(
          flightCluster,
          reward,
          completedPattern,
          previousCollected,
        );

        const patternCompleted = this.beadProgress.collected >= orderedBeads(completedPattern).length;
        this.renderBeadScreen(
          undefined,
          patternCompleted
            ? `${completedPattern.name}完成！`
            : `本关获得 ${rewardCount} 颗拼豆，已放入图纸。`,
        );

        if (patternCompleted) {
          this.completedBeadPatternIds = new Set(markBeadPatternCompleted(
            this.beadPatterns,
            completedPattern.id,
          ));
          const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          if (!reducedMotion) await waitFor(620);
          const nextSequence = advanceBeadSequence(
            this.beadPatterns,
            completedPattern,
            this.beadProgress,
          );
          this.beadPattern = nextSequence.pattern;
          this.beadProgress = nextSequence.progress;
          this.beadScreen.scrollTop = 0;
          this.renderBeadScreen(
            undefined,
            `${completedPattern.name}已收藏，下一个图案：${nextSequence.pattern.name}`,
          );
        }
      } finally {
        flightCluster.layer.remove();
        this.beadRewardAnimating = false;
        this.beadBackButton.disabled = false;
        this.beadGalleryButton.disabled = false;
      }
      return;
    }
    if (this.playContext === 'editor-playtest') {
      await this.boardScene.showCompletion();
      if (this.playContext === 'editor-playtest') this.showEditorPlaytestResult();
      return;
    }
    if (this.mode === 'endless') {
      this.lives += 1;
      this.renderLives();
      this.showEndlessStageResult();
      return;
    }

    if (this.playContext === 'collection') {
      await this.boardScene.showCompletion({ revealImage: true });
      this.completeCollectionLevel();
      this.showCollectionResult();
    } else {
      await this.boardScene.showCompletion();
      this.showNormalResult();
    }
  }

  private async advanceEndlessStage(watchedVideo: boolean): Promise<void> {
    if (this.resultActionBusy || this.resultContext !== 'endless-stage') return;
    this.resultActionBusy = true;
    this.setResultActionsDisabled(true);

    if (watchedVideo) {
      this.lives += 1;
      this.renderLives();
      this.videoViews.push(createVideoView('endless-stage-complete', this.stage));
      this.events.emit('video.rewarded', { placement: 'endless-stage-complete', stage: this.stage });
      saveVideoViews(this.videoViews);
      this.renderVideoStats();
    }

    this.resultOverlay.hidden = true;
    this.stage += 1;
    const profile = getEndlessStageSettings(this.stage);
    const next = this.createEndlessLevel(this.stage, profile);
    this.currentLevel = next;
    this.currentProgress = 0;
    this.currentTotal = next.solutionPath.length;
    this.updateGameHeading(next);
    this.renderProgress();

    try {
      await this.boardScene.transitionTo(this.makeSession(next, profile));
    } finally {
      this.resultActionBusy = false;
      this.setResultActionsDisabled(false);
    }
  }

  private restartAfterFailure(): void {
    this.lives = 3;
    this.renderLives();
    this.restartCurrent();
  }

  private continueAfterFailureVideo(): void {
    this.lives = 1;
    this.renderLives();
    const placement = this.mode === 'endless' ? 'endless-life-depleted' : 'normal-life-depleted';
    this.videoViews.push(createVideoView(placement, this.mode === 'endless' ? this.stage : undefined));
    this.events.emit('video.rewarded', { placement, stage: this.mode === 'endless' ? this.stage : undefined });
    saveVideoViews(this.videoViews);
    this.renderVideoStats();
    this.resultOverlay.hidden = true;
    this.boardScene.setPaused(false);
  }

  private restartCurrent(): void {
    this.resultOverlay.hidden = true;
    if (this.mode === 'endless') {
      const profile = getEndlessStageSettings(this.stage);
      this.setCurrentBoard(this.createEndlessLevel(this.stage, profile), profile);
    } else if (this.currentLevel) {
      this.setCurrentBoard(this.currentLevel);
    }
  }

  private nextLevel(): void {
    this.resultOverlay.hidden = true;
    this.lives = 3;
    this.renderLives();
    this.selectNextNormalLevel();
    this.setCurrentBoard(this.createNormalLevel());
  }

  private nextCollectionLevel(): void {
    const nextIndex = this.currentCollectionIndex + 1;
    if (nextIndex >= this.collectionLevelCount()) {
      this.leavePlayScreen();
      return;
    }
    this.resultOverlay.hidden = true;
    this.currentCollectionIndex = nextIndex;
    this.lives = 3;
    this.renderLives();
    this.setCurrentBoard(this.createCollectionLevel(nextIndex));
  }

  private selectNextNormalLevel(): void {
    if (this.levels.length === 0) return;
    const currentId = this.currentLevel?.levelId ?? this.settings.selectedLevelId;
    const index = this.levels.findIndex((level) => level.levelId === currentId);
    const nextIndex = (Math.max(0, index) + 1) % this.levels.length;
    this.settings.selectedLevelId = this.levels[nextIndex].levelId;
    saveSettings(this.settings);
  }

  private backToLobby(): void {
    this.playContext = 'normal';
    this.resultOverlay.hidden = true;
    this.boardScene.setPaused(true);
    this.showScreen('lobby');
  }

  private leavePlayScreen(): void {
    this.resultOverlay.hidden = true;
    this.boardScene.setPaused(true);
    if (this.playContext === 'bead') {
      this.currentBeadReward = [];
      this.renderBeadScreen(undefined, '本关未完成，没有消耗拼豆进度。');
      this.showScreen('bead');
      return;
    }
    if (this.playContext === 'editor-playtest') {
      this.showScreen('editor');
      this.editor.resumeFromPlaytest();
      return;
    }
    if (this.playContext === 'collection') {
      this.showScreen('collection');
      this.renderCollectionMap();
      return;
    }
    this.backToLobby();
  }

  private openSettings(context: 'lobby' | 'play'): void {
    this.settingsContext = context;
    if (context === 'play') this.boardScene.setPaused(true);
    this.populateSettingsForm();
    this.renderVideoStats();
    const leaveButton = query<HTMLButtonElement>('#settings-lobby-button');
    leaveButton.hidden = context === 'lobby';
    leaveButton.textContent = this.playContext === 'editor-playtest'
      ? '返回编辑器'
      : this.playContext === 'bead'
        ? '返回拼豆图纸'
        : this.playContext === 'collection'
          ? '返回收集路线'
        : '返回大厅';
    query<HTMLElement>('#endless-settings-note').hidden = !(context === 'play' && this.mode === 'endless');
    query<HTMLElement>('#settings-solution-row').hidden = context !== 'play';
    this.settingsDialog.showModal();
  }

  private openVideoStats(): void {
    this.renderVideoStats();
    this.videoStatsDialog.showModal();
  }

  private resetVideoStats(): void {
    this.videoViews = [];
    saveVideoViews(this.videoViews);
    this.renderVideoStats();
  }

  private renderVideoStats(): void {
    const count = this.videoViews.length;
    this.videoStatsCount.textContent = `${count} 次 ›`;
    this.videoStatsTotal.textContent = String(count);
    this.videoStatsEmpty.hidden = count > 0;
    this.videoStatsList.hidden = count === 0;

    const items = groupVideoViews(this.videoViews).map((group) => {
      const item = document.createElement('li');
      const placement = document.createElement('b');
      placement.textContent = videoPlacementLabel(group.placement);
      const placementCount = document.createElement('strong');
      placementCount.textContent = `${group.count} 次`;
      item.append(placement, placementCount);
      return item;
    });
    this.videoStatsList.replaceChildren(...items);
  }

  private populateSettingsForm(): void {
    query<HTMLSelectElement>('#settings-level').value = String(this.settings.selectedLevelId);
    query<HTMLInputElement>('#settings-next').checked = this.settings.showNextNumber;
    query<HTMLInputElement>('#settings-sound').checked = this.settings.soundEnabled;
    this.solutionToggle.checked = this.solutionRevealed;
    this.setTouchPreviewSizeControl(this.settings.touchPreviewSize);
    query<HTMLInputElement>('#settings-touch-preview-follow').checked = this.settings.touchPreviewFollowsPointer;
    this.refreshSettingsControls();
  }

  private refreshLevelOptions(): void {
    const select = query<HTMLSelectElement>('#settings-level');
    select.replaceChildren(...this.levels.map((level) => {
      const option = document.createElement('option');
      option.value = String(level.levelId);
      option.textContent = `${level.custom ? '自制关卡' : '关卡'} ${level.levelId}`;
      return option;
    }));
    select.value = String(this.settings.selectedLevelId);
  }

  private refreshSettingsControls(): void {
    const levelLocked = this.settingsContext === 'play'
      && (this.mode === 'endless' || this.playContext === 'editor-playtest' || this.playContext === 'bead' || this.playContext === 'collection');
    query<HTMLSelectElement>('#settings-level').disabled = levelLocked;
    query<HTMLInputElement>('#settings-touch-preview-follow').disabled = this.selectedTouchPreviewSize() === 'off';
  }

  private async applySettings(): Promise<void> {
    const revealSolution = this.settingsContext === 'play' && this.solutionToggle.checked;
    this.settings.shape = BoardShape.Level;
    this.settings.selectedLevelId = Number(query<HTMLSelectElement>('#settings-level').value) || this.settings.selectedLevelId;
    this.settings.showNextNumber = query<HTMLInputElement>('#settings-next').checked;
    this.settings.soundEnabled = query<HTMLInputElement>('#settings-sound').checked;
    this.settings.touchPreviewSize = this.selectedTouchPreviewSize();
    this.settings.touchPreviewFollowsPointer = query<HTMLInputElement>('#settings-touch-preview-follow').checked;
    saveSettings(this.settings);
    this.renderTouchPreviewState();
    this.settingsDialog.close();

    if (this.settingsContext === 'play') {
      if (this.mode === 'endless') {
        const profile = getEndlessStageSettings(this.stage);
        this.setCurrentBoard(this.createEndlessLevel(this.stage, profile), profile);
      } else if ((this.playContext === 'editor-playtest' || this.playContext === 'bead' || this.playContext === 'collection') && this.currentLevel) {
        this.setCurrentBoard(this.currentLevel);
      } else {
        this.setCurrentBoard(this.createNormalLevel());
      }
      this.setSolutionReveal(revealSolution);
      await nextFrame();
    }
  }

  private openEditor(): void {
    this.playContext = 'normal';
    this.showScreen('editor');
    this.editor.open();
  }

  private openCollectionMode(): void {
    this.playContext = 'collection';
    this.showScreen('collection');
    this.renderCollectionMap();
  }

  private collectionLevelCount(): number {
    return Math.max(COLLECTION_MIN_LEVELS, this.levels.length);
  }

  private createCollectionLevel(index: number): LevelData {
    const existing = this.levels[index];
    const stage = index + 1;
    const level = existing ?? generateEndlessLevel(
      getEndlessStageSettings(stage),
      730001 + stage * 1009,
    );
    return {
      ...level,
      levelId: stage,
      backgroundResourcePath: collectionArtworkResourcePath(index),
    };
  }

  private async startCollectionLevel(index: number): Promise<void> {
    const total = this.collectionLevelCount();
    const completed = Math.min(this.collectionCompletedCount, total);
    if (index < 0 || index >= total || index > completed) return;
    this.currentCollectionIndex = index;
    this.playContext = 'collection';
    this.mode = 'normal';
    this.lives = 3;
    this.renderLives();
    await this.showPlayScreen();
    this.setCurrentBoard(this.createCollectionLevel(index));
  }

  private completeCollectionLevel(): void {
    const total = this.collectionLevelCount();
    this.collectionCompletedCount = Math.min(
      total,
      Math.max(this.collectionCompletedCount, this.currentCollectionIndex + 1),
    );
    saveCollectionCompletedCount(this.collectionCompletedCount);
    this.renderCollectionEntryProgress();
  }

  private renderCollectionEntryProgress(): void {
    const total = this.collectionLevelCount();
    const completed = Math.min(this.collectionCompletedCount, total);
    this.collectionModeCount.textContent = `${completed} / ${total}`;
  }

  private renderCollectionMap(): void {
    const total = this.collectionLevelCount();
    const completed = Math.min(this.collectionCompletedCount, total);
    this.collectionCompletedCount = completed;
    this.collectionRouteProgress.textContent = `${completed} / ${total}`;
    this.renderCollectionEntryProgress();
    const rows = total <= 3 ? 1 : 1 + Math.ceil((total - 3) / 2);
    this.collectionRoute.style.setProperty('--collection-route-rows', String(rows));

    const nodes = Array.from({ length: total }, (_, index) => {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'collection-level-node';
      node.dataset.collectionIndex = String(index);
      const isCompleted = index < completed;
      const isCurrent = index === completed && completed < total;
      const isLocked = index > completed;
      node.classList.toggle('is-completed', isCompleted);
      node.classList.toggle('is-current', isCurrent);
      node.classList.toggle('is-locked', isLocked);
      node.disabled = isLocked;

      let row: number;
      let column: number;
      if (index < 3) {
        row = 1;
        column = index + 1;
      } else {
        row = 2 + Math.floor((index - 3) / 2);
        const positionInRow = (index - 3) % 2;
        column = row % 2 === 0
          ? (positionInRow === 0 ? 3 : 1)
          : (positionInRow === 0 ? 1 : 3);
      }
      node.style.gridRow = String(row);
      node.style.gridColumn = String(column);

      const bubble = document.createElement('span');
      bubble.className = 'collection-level-node__bubble';
      if (isCompleted) {
        const image = document.createElement('img');
        image.src = collectionArtworkUrl(index);
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        const number = document.createElement('b');
        number.className = 'collection-level-node__number';
        number.textContent = String(index + 1);
        bubble.append(image, number);
      } else {
        bubble.textContent = String(index + 1);
      }
      const state = document.createElement('small');
      state.textContent = isCompleted ? '已收集' : isCurrent ? '当前关卡' : '未解锁';
      node.setAttribute('aria-label', `收集关卡 ${index + 1}，${state.textContent}`);
      node.append(bubble, state);
      if (!isLocked) node.addEventListener('click', () => void this.startCollectionLevel(index));
      return node;
    });

    this.collectionRoute.replaceChildren(this.collectionRouteLines, ...nodes);
    requestAnimationFrame(() => this.renderCollectionPath());
  }

  private renderCollectionPath(): void {
    if (this.collectionScreen.hidden) return;
    const routeBounds = this.collectionRoute.getBoundingClientRect();
    const nodes = Array.from(this.collectionRoute.querySelectorAll<HTMLElement>('.collection-level-node'));
    if (routeBounds.width <= 0 || routeBounds.height <= 0 || nodes.length === 0) return;
    const points = nodes.map((node) => {
      const bounds = node.getBoundingClientRect();
      return {
        x: bounds.left - routeBounds.left + bounds.width * 0.5,
        y: bounds.top - routeBounds.top + bounds.height * 0.5 - 10,
      };
    });
    this.collectionRouteLines.setAttribute('viewBox', `0 0 ${routeBounds.width} ${routeBounds.height}`);
    this.collectionRouteBase.setAttribute('d', roundedRoutePath(points));
    const availableCount = Math.min(points.length, this.collectionCompletedCount + 1);
    this.collectionRouteComplete.setAttribute('d', roundedRoutePath(points.slice(0, availableCount)));
  }

  private openBeadMode(): void {
    this.playContext = 'bead';
    this.renderBeadScreen();
    this.showScreen('bead');
  }

  private openBeadGallery(): void {
    if (this.beadRewardAnimating) return;
    this.renderBeadGallery();
    this.showBeadGalleryList();
    this.beadGalleryDialog.showModal();
  }

  private showBeadGalleryList(): void {
    this.beadGalleryDetail.hidden = true;
    this.beadGalleryListView.hidden = false;
    this.beadGalleryListView.scrollTop = 0;
  }

  private showBeadGalleryDetail(pattern: BeadPatternData): void {
    this.beadGalleryDetailName.textContent = pattern.name;
    this.beadGalleryDetailSize.textContent = `${pattern.width} × ${pattern.height} · 已完成`;
    this.beadGalleryDetailImage.src = `./bead-patterns/${pattern.id}.svg`;
    this.beadGalleryDetailImage.alt = `${pattern.name}完整拼豆图案`;
    this.beadGalleryListView.hidden = true;
    this.beadGalleryDetail.hidden = false;
    this.beadGalleryDetail.scrollTop = 0;
  }

  private renderBeadGallery(): void {
    const completedPatterns = this.beadPatterns.filter((pattern) => this.completedBeadPatternIds.has(pattern.id));
    this.beadGalleryCount.textContent = String(completedPatterns.length);
    this.beadGalleryTotal.textContent = `${completedPatterns.length} / ${this.beadPatterns.length}`;
    this.beadGalleryEmpty.hidden = completedPatterns.length > 0;
    this.beadGalleryGrid.hidden = completedPatterns.length === 0;

    const items = completedPatterns.map((pattern) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'bead-gallery-item';
      item.setAttribute('role', 'listitem');
      item.setAttribute('aria-label', `查看${pattern.name}，${pattern.width}乘${pattern.height}`);

      const art = document.createElement('span');
      art.className = 'bead-gallery-item-art';
      const image = document.createElement('img');
      image.src = `./bead-patterns/${pattern.id}.svg`;
      image.alt = '';
      image.loading = 'lazy';
      art.append(image);

      const copy = document.createElement('span');
      copy.className = 'bead-gallery-item-copy';
      const name = document.createElement('strong');
      name.textContent = pattern.name;
      const size = document.createElement('small');
      size.textContent = `${pattern.width} × ${pattern.height}`;
      copy.append(name, size);
      item.append(art, copy);
      item.addEventListener('click', () => this.showBeadGalleryDetail(pattern));
      return item;
    });
    this.beadGalleryGrid.replaceChildren(...items);
  }

  private closeBeadMode(): void {
    if (this.beadRewardAnimating) return;
    this.playContext = 'normal';
    this.showScreen('lobby');
  }

  private createBeadFlightCluster(reward: readonly BeadPixel[]): BeadFlightCluster {
    const layer = document.createElement('div');
    layer.className = 'bead-flight-layer';
    layer.setAttribute('aria-hidden', 'true');
    const centerX = this.appShell.clientWidth * 0.5;
    const centerY = this.appShell.clientHeight * 0.5;
    const gems = reward.map((bead, index) => {
      const pose = beadClusterPose(index, reward.length);
      const gem = document.createElement('i');
      gem.className = 'bead-flight-gem';
      gem.style.setProperty('--bead-color', bead.color);
      gem.style.left = `${centerX + pose.x}px`;
      gem.style.top = `${centerY + pose.y}px`;
      gem.style.transform = `translate(-50%, -50%) rotate(${pose.rotation}deg) scale(${pose.scale})`;
      layer.append(gem);
      return gem;
    });
    this.appShell.append(layer);
    return { layer, gems };
  }

  private async animateBeadFlightCluster(
    cluster: BeadFlightCluster,
    reward: readonly BeadPixel[],
    pattern: BeadPatternData,
    previousCollected: number,
  ): Promise<void> {
    const targetCells = reward.map((_, index) => this.beadBoard.querySelector<HTMLElement>(
      `[data-bead-order="${previousCollected + index}"]`,
    ));
    const focusCell = targetCells[Math.floor(targetCells.length * 0.5)];
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (focusCell) {
      focusCell.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
      if (!reducedMotion) await waitFor(360);
    }

    const timing = beadRewardTiming(reward.length, reducedMotion);
    const appRect = this.appShell.getBoundingClientRect();
    const totalBeads = orderedBeads(pattern).length;
    let landed = 0;

    const flights = cluster.gems.map(async (gem, index) => {
      const target = targetCells[index];
      if (!target) {
        gem.remove();
        return;
      }
      const pose = beadClusterPose(index, reward.length);
      const startX = Number.parseFloat(gem.style.left);
      const startY = Number.parseFloat(gem.style.top);
      const targetRect = target.getBoundingClientRect();
      const targetX = targetRect.left - appRect.left + targetRect.width * 0.5;
      const targetY = targetRect.top - appRect.top + targetRect.height * 0.5;
      const deltaX = targetX - startX;
      const deltaY = targetY - startY;
      const landingScale = Math.max(0.24, Math.min(0.78, targetRect.width / 26));
      const flightDistance = Math.hypot(deltaX, deltaY);
      const curveDirection = index % 2 === 0 ? -1 : 1;
      const curveOffset = curveDirection * Math.min(38, 18 + flightDistance * 0.04);
      const transform = (x: number, y: number, rotation: number, scale: number): string => (
        `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${rotation}deg) scale(${scale})`
      );
      const flightKeyframe = (progress: number): Keyframe => {
        const curve = curveOffset * 4 * progress * (1 - progress);
        const scale = pose.scale + (landingScale - pose.scale) * progress;
        return {
          transform: transform(
            deltaX * progress + curve,
            deltaY * progress,
            pose.rotation * (1 - progress),
            scale,
          ),
          offset: progress,
        };
      };
      const animation = gem.animate([
        flightKeyframe(0),
        flightKeyframe(0.25),
        flightKeyframe(0.5),
        flightKeyframe(0.75),
        flightKeyframe(1),
      ], {
        duration: timing.flightDuration,
        delay: index * timing.stagger,
        easing: 'cubic-bezier(.2,.72,.2,1)',
        fill: 'forwards',
      });

      try {
        await animation.finished;
      } catch {
        // A canceled animation still settles its bead into the saved position.
      }
      target.classList.add('is-filled');
      gem.remove();
      landed += 1;
      const displayedCollected = Math.min(totalBeads, previousCollected + landed);
      const percent = totalBeads === 0 ? 100 : Math.round(displayedCollected / totalBeads * 100);
      this.beadProgressText.textContent = `${displayedCollected} / ${totalBeads}`;
      this.beadProgressFill.style.width = `${percent}%`;
      this.beadProgressFill.parentElement?.setAttribute('aria-valuenow', String(percent));
      this.beadStatus.textContent = `拼豆归位 ${landed} / ${reward.length}`;
    });

    await Promise.all(flights);
    targetCells.forEach((cell) => cell?.classList.add('is-filled'));
  }

  private syncBeadCellSize(pattern: BeadPatternData | undefined = this.beadPattern): void {
    if (!pattern || this.beadBoard.clientWidth <= 0 || this.beadBoard.clientHeight <= 0) return;
    const styles = window.getComputedStyle(this.beadBoard);
    const numberValue = (value: string): number => Number.parseFloat(value) || 0;
    const contentWidth = this.beadBoard.clientWidth
      - numberValue(styles.paddingLeft)
      - numberValue(styles.paddingRight);
    const contentHeight = this.beadBoard.clientHeight
      - numberValue(styles.paddingTop)
      - numberValue(styles.paddingBottom);
    const columnGap = numberValue(styles.columnGap);
    const rowGap = numberValue(styles.rowGap);
    const columnTrack = (contentWidth - columnGap * Math.max(0, pattern.width - 1)) / pattern.width;
    const rowTrack = (contentHeight - rowGap * Math.max(0, pattern.height - 1)) / pattern.height;
    const dotSize = Math.max(1, Math.min(columnTrack, rowTrack) * 0.94);
    this.beadBoard.style.setProperty('--bead-dot-size', `${dotSize.toFixed(3)}px`);
  }

  private renderBeadScreen(_animateFrom?: number, message?: string, displayCollected?: number): void {
    if (!this.beadPattern || !this.beadProgress) {
      this.beadStartButton.disabled = true;
      this.beadStatus.textContent = '拼豆图纸读取失败。';
      return;
    }

    const pattern = this.beadPattern;
    const beads = orderedBeads(pattern);
    const collected = Math.min(beads.length, displayCollected ?? this.beadProgress.collected);
    const beadOrder = new Map(beads.map((bead, index) => [`${bead.x},${bead.y}`, index]));
    const cells: HTMLElement[] = [];

    for (let y = 0; y < pattern.height; y += 1) {
      for (let x = 0; x < pattern.width; x += 1) {
        const key = `${x},${y}`;
        const color = pattern.pixels[key];
        const cell = document.createElement('span');
        cell.className = 'bead-pattern-cell';
        if (color) {
          const order = beadOrder.get(key) ?? -1;
          cell.dataset.beadOrder = String(order);
          cell.classList.add('is-target');
          cell.style.setProperty('--bead-color', color);
          cell.title = `(${x}, ${y}) ${color}`;
          if (order < collected) cell.classList.add('is-filled');
        }
        cells.push(cell);
      }
    }

    const percent = beads.length === 0 ? 100 : Math.round(collected / beads.length * 100);
    const remaining = beads.length - collected;
    const levelSize = this.levels.length > 0 ? this.createNormalLevel().solutionPath.length : 0;
    const nextReward = Math.min(remaining, levelSize);
    this.beadBoard.style.gridTemplateColumns = `repeat(${pattern.width}, 1fr)`;
    this.beadBoard.style.gridTemplateRows = `repeat(${pattern.height}, 1fr)`;
    this.beadBoard.style.aspectRatio = `${pattern.width} / ${pattern.height}`;
    this.beadBoard.replaceChildren(...cells);
    this.syncBeadCellSize(pattern);
    requestAnimationFrame(() => {
      if (this.beadPattern?.id === pattern.id) this.syncBeadCellSize(pattern);
    });
    this.beadBoard.setAttribute('aria-label', `${pattern.width}乘${pattern.height}${pattern.name}拼豆图纸，已完成${percent}%`);
    this.beadPatternName.textContent = pattern.name;
    this.beadProgressText.textContent = `${collected} / ${beads.length}`;
    this.beadProgressFill.style.width = `${percent}%`;
    const progressbar = this.beadProgressFill.parentElement;
    progressbar?.setAttribute('aria-valuenow', String(percent));
    this.beadStatus.textContent = message ?? (remaining > 0 ? `还差 ${remaining} 颗拼豆完成图案` : '图案完成！所有拼豆都已归位。');
    this.beadStartButton.disabled = remaining === 0;
    this.beadStartButton.textContent = remaining === 0
      ? '图案已完成'
      : `进入关卡 · 可获得 ${nextReward} 颗`;
    this.beadGalleryCount.textContent = String(this.completedBeadPatternIds.size);
  }

}

const app = new NumberConnectApp();
void app.initialize().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  query<HTMLElement>('#lobby-title').textContent = '加载失败';
  query<HTMLElement>('#lobby-title').title = message;
  console.error(error);
});
