import Phaser from 'phaser';
import './styles.css';
import type { GameEventMap } from './app/GameEvents';
import { startLobbyAmbientNetwork } from './app/LobbyAmbientNetwork';
import { ScreenRouter, type ScreenName } from './app/ScreenRouter';
import { query } from './app/dom';
import { EventBus } from './core/events/EventBus';
import { BoardScene } from './game/BoardScene';
import {
  dailyChallengeSeed,
  dailyChallengeStage,
  daysInMonth,
  formatDailyDateKey,
  isDailyDateKey,
  mondayFirstOffset,
  parseDailyDateKey,
} from './game/dailyChallenge';
import { getEndlessStageSettings } from './game/difficulty';
import { selectHiddenCells } from './game/hidden';
import { formatLives } from './game/lives';
import { levelBallColorCss } from './game/levelTheme';
import {
  chooseWatercolorReveal,
  paintBucketRevealCells,
  type PowerUpId,
} from './game/powerUps';
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
  isInputMode,
  isTouchPreviewSize,
  isUiTheme,
  usesClickInput,
  type BoardNeighborhoodPreview,
  type BoardSessionInput,
  type Cell,
  type EndlessStageSettings,
  type GameMode,
  type GameSettings,
  type InputMode,
  type LevelData,
  type TouchPreviewSize,
  type UiTheme,
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
  collectionArtworkName,
  collectionArtworkResourcePath,
  collectionArtworkUrl,
} from './gameplay/collection/collectionArtwork';
import { generateEndlessLevel } from './gameplay/endless/generateEndlessLevel';

const UI_DESIGN_WIDTH = 750;
const UI_DESIGN_HEIGHT = 1334;
const UI_LOGICAL_WIDTH = 430;
const UI_LOGICAL_TO_DESIGN_SCALE = UI_DESIGN_WIDTH / UI_LOGICAL_WIDTH;

const syncFixedUiScale = (): void => {
  const designFitScale = Math.min(
    window.innerWidth / UI_DESIGN_WIDTH,
    window.innerHeight / UI_DESIGN_HEIGHT,
  );
  document.documentElement.style.setProperty(
    '--ui-scale',
    String(Math.max(0.01, designFitScale * UI_LOGICAL_TO_DESIGN_SCALE)),
  );
};

syncFixedUiScale();
window.addEventListener('resize', syncFixedUiScale);

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const waitFor = (duration: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, duration));
const TOUCH_PREVIEW_ENTER_DURATION_MS = 240;
const TOUCH_PREVIEW_EXIT_DURATION_MS = 170;
const PRIMARY_ACTION_TRANSITION_DURATION_MS = 320;
const POWER_UP_FLIGHT_DURATION_MS = 420;
const POWER_UP_RETURN_DURATION_MS = 360;
const COLLECTION_MIN_LEVELS = 7;
const COLLECTION_PROGRESS_KEY = 'number-connect.collection-route.v1';
const DAILY_COMPLETION_KEY = 'number-connect.daily-completed.v1';
const ENDLESS_RUN_KEY = 'number-connect.endless-run.v1';

const applyUiTheme = (theme: UiTheme): void => {
  document.documentElement.dataset.theme = theme;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
    'content',
    theme === 'default' ? '#fff4e3' : '#111823',
  );
};

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

const loadCompletedDailyChallenges = (): Set<string> => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(DAILY_COMPLETION_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(stored) ? stored.filter(isDailyDateKey) : []);
  } catch {
    return new Set();
  }
};

const saveCompletedDailyChallenges = (dates: ReadonlySet<string>): void => {
  try {
    window.localStorage.setItem(DAILY_COMPLETION_KEY, JSON.stringify([...dates].sort()));
  } catch {
    // Daily completion remains available for the current session when storage is unavailable.
  }
};

interface EndlessRunState {
  active: boolean;
  stage: number;
  lives: number;
  seed: number;
  bestStage: number;
}

const defaultEndlessRunState = (): EndlessRunState => ({
  active: false,
  stage: 1,
  lives: 3,
  seed: 1,
  bestStage: 1,
});

const loadEndlessRunState = (): EndlessRunState => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(ENDLESS_RUN_KEY) ?? '{}') as Partial<EndlessRunState>;
    const stage = Number.isFinite(Number(stored.stage)) ? Math.max(1, Math.floor(Number(stored.stage))) : 1;
    const lives = Number.isFinite(Number(stored.lives)) ? Math.max(0, Math.floor(Number(stored.lives))) : 3;
    const seed = Number.isFinite(Number(stored.seed)) ? Math.max(1, Math.floor(Number(stored.seed))) : 1;
    const bestStage = Number.isFinite(Number(stored.bestStage))
      ? Math.max(stage, Math.floor(Number(stored.bestStage)))
      : stage;
    return { active: stored.active === true, stage, lives, seed, bestStage };
  } catch {
    return defaultEndlessRunState();
  }
};

const saveEndlessRunState = (state: EndlessRunState): void => {
  try {
    window.localStorage.setItem(ENDLESS_RUN_KEY, JSON.stringify(state));
  } catch {
    // Endless progress remains available for the current session when storage is unavailable.
  }
};

const initialEndlessRunState = loadEndlessRunState();

const COLLECTION_ARTWORK_LABELS: Record<string, string> = {
  apple: '苹果乐园',
  banana: '香蕉派对',
  orange: '橙子星球',
  grapes: '葡萄庄园',
  basket: '丰收画篮',
  pineapple: '菠萝海岸',
};

const collectionArtworkLabel = (index: number): string =>
  COLLECTION_ARTWORK_LABELS[collectionArtworkName(index)] ?? `画册 ${index + 1}`;

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

type ResultContext = 'normal' | 'collection' | 'daily' | 'endless-stage' | 'life-depleted' | 'editor-playtest' | 'editor-playtest-failed';
type PlayContext = 'normal' | 'collection' | 'daily' | 'editor-playtest' | 'bead';

interface BeadFlightCluster {
  layer: HTMLElement;
  gems: HTMLElement[];
}

interface ClientPoint {
  x: number;
  y: number;
}

const powerUpTransform = (
  point: ClientPoint,
  anchor: ClientPoint,
  rotation: number,
  scale: number,
): string => `translate3d(${point.x - anchor.x}px, ${point.y - anchor.y}px, 0) rotate(${rotation}deg) scale(${scale})`;

const powerUpFlightKeyframes = (
  start: ClientPoint,
  end: ClientPoint,
  anchor: ClientPoint,
  startRotation: number,
  endRotation: number,
  startScale: number,
  endScale: number,
): Keyframe[] => {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const direction = end.x >= start.x ? 1 : -1;
  const control = {
    x: (start.x + end.x) * 0.5 + direction * Math.min(46, 14 + distance * 0.05),
    y: Math.min(start.y, end.y) - Math.min(112, 34 + distance * 0.13),
  };
  return [0, 0.22, 0.48, 0.74, 1].map((progress) => {
    const inverse = 1 - progress;
    const point = {
      x: inverse * inverse * start.x + 2 * inverse * progress * control.x + progress * progress * end.x,
      y: inverse * inverse * start.y + 2 * inverse * progress * control.y + progress * progress * end.y,
    };
    return {
      offset: progress,
      transform: powerUpTransform(
        point,
        anchor,
        startRotation + (endRotation - startRotation) * progress,
        startScale + (endScale - startScale) * progress,
      ),
    };
  });
};

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
  private readonly primaryActionButton = query<HTMLButtonElement>('#primary-action-button');
  private readonly primaryActionLabel = query<HTMLElement>('#primary-action-label');
  private readonly events = new EventBus<GameEventMap>();
  private readonly playScreen = query<HTMLElement>('#play-screen');
  private readonly gameHost = query<HTMLElement>('#game-host');
  private readonly playLevelButton = query<HTMLButtonElement>('#play-level-button');
  private readonly levelLabel = query<HTMLElement>('#play-level-label');
  private readonly progressLabel = query<HTMLElement>('#play-progress');
  private readonly livesLabel = query<HTMLElement>('#play-lives');
  private readonly powerUpStatus = query<HTMLElement>('#power-up-status');
  private readonly watercolorBrushButton = query<HTMLButtonElement>('#watercolor-brush-button');
  private readonly paintBucketButton = query<HTMLButtonElement>('#paint-bucket-button');
  private readonly solutionToggle = query<HTMLInputElement>('#solution-toggle');
  private readonly touchPreview = query<HTMLElement>('#touch-preview');
  private readonly touchPreviewSurface = query<HTMLElement>('#touch-preview-surface');
  private readonly touchPreviewBoard = query<HTMLElement>('#touch-preview-board');
  private readonly touchPreviewCells = query<HTMLElement>('#touch-preview-cells');
  private readonly touchPreviewPathLines = query<SVGGElement>('#touch-preview-path-lines');
  private readonly touchPreviewPointerLine = query<SVGLineElement>('#touch-preview-pointer-line');
  private readonly touchPreviewViewport = query<HTMLElement>('#touch-preview-viewport');
  private readonly touchPreviewSizeControl = query<HTMLElement>('#touch-preview-size');
  private readonly inputModeControl = query<HTMLElement>('#settings-input-mode');
  private readonly uiThemeControl = query<HTMLElement>('#settings-theme');
  private readonly resultOverlay = query<HTMLElement>('#result-overlay');
  private readonly resultTitle = query<HTMLElement>('#result-title');
  private readonly resultMessage = query<HTMLElement>('#result-message');
  private readonly resultReward = query<HTMLElement>('#result-reward');
  private readonly resultActions = query<HTMLElement>('#result-actions');
  private readonly restartButton = query<HTMLButtonElement>('#restart-button');
  private readonly nextButton = query<HTMLButtonElement>('#next-button');
  private readonly resultLobbyButton = query<HTMLButtonElement>('#result-lobby-button');
  private readonly levelPickerDialog = query<HTMLDialogElement>('#level-picker-dialog');
  private readonly levelPickerGrid = query<HTMLElement>('#level-picker-grid');
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
  private readonly collectionScreen = query<HTMLElement>('#collection-screen');
  private readonly collectionRoute = query<HTMLElement>('#collection-route');
  private readonly collectionRouteLines = query<SVGSVGElement>('#collection-route-lines');
  private readonly collectionRouteBase = query<SVGPathElement>('#collection-route-base');
  private readonly collectionRouteComplete = query<SVGPathElement>('#collection-route-complete');
  private readonly collectionRouteProgress = query<HTMLElement>('#collection-route-progress');
  private readonly dailyScreen = query<HTMLElement>('#daily-screen');
  private readonly dailyCalendarGrid = query<HTMLElement>('#daily-calendar-grid');
  private readonly dailyMonthLabel = query<HTMLElement>('#daily-month-label');
  private readonly dailyCompleteCount = query<HTMLElement>('#daily-complete-count');
  private readonly dailyMonthTotal = query<HTMLElement>('#daily-month-total');
  private readonly dailyProgressTrack = query<HTMLElement>('#daily-progress-track');
  private readonly dailyProgressFill = query<HTMLElement>('#daily-progress-fill');
  private readonly dailyPlayButton = query<HTMLButtonElement>('#daily-play-button');
  private readonly dailyNextMonthButton = query<HTMLButtonElement>('#daily-next-month');
  private readonly endlessCurrentStage = query<HTMLElement>('#endless-current-stage');
  private readonly endlessCurrentLives = query<HTMLElement>('#endless-current-lives');
  private readonly endlessBestStage = query<HTMLElement>('#endless-best-stage');
  private readonly endlessStartButton = query<HTMLButtonElement>('#endless-start-button');
  private readonly favoritesAlbumTab = query<HTMLButtonElement>('#favorites-album-tab');
  private readonly favoritesBeadTab = query<HTMLButtonElement>('#favorites-bead-tab');
  private readonly favoritesAlbumPanel = query<HTMLElement>('#favorites-album-panel');
  private readonly favoritesBeadPanel = query<HTMLElement>('#favorites-bead-panel');
  private readonly favoritesAlbumGrid = query<HTMLElement>('#favorites-album-grid');
  private readonly favoritesBeadGrid = query<HTMLElement>('#favorites-bead-grid');
  private readonly favoritesSummaryTitle = query<HTMLElement>('#favorites-summary-title');
  private readonly favoritesSummaryCount = query<HTMLElement>('#favorites-summary-count');
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
  private stage = initialEndlessRunState.stage;
  private lives = 3;
  private endlessSeed = initialEndlessRunState.seed;
  private endlessSessionActive = initialEndlessRunState.active;
  private endlessLives = initialEndlessRunState.lives;
  private endlessHighScore = initialEndlessRunState.bestStage;
  private currentScreen: ScreenName = 'lobby';
  private primaryActionTransition?: Animation;
  private primaryActionTransitionToken = 0;
  private currentLevel?: LevelData;
  private currentProgress = 0;
  private currentTotal = 0;
  private settingsContext: 'lobby' | 'play' = 'lobby';
  private resultContext: ResultContext = 'normal';
  private resultActionBusy = false;
  private solutionRevealed = false;
  private activePowerUp?: PowerUpId;
  private animatingPowerUp?: PowerUpId;
  private powerUpMessage?: string;
  private powerUpMessageTone: 'neutral' | 'active' | 'success' = 'neutral';
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
  private dailyCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12);
  private dailyChallengeDateKey = formatDailyDateKey(new Date());
  private completedDailyChallenges = loadCompletedDailyChallenges();
  private dailyChallengeProfile?: EndlessStageSettings;
  private favoritesTab: 'album' | 'beads' = 'album';
  private activeNeighborhoodPreview: BoardNeighborhoodPreview | null = null;
  private manualTouchPreviewPosition?: { left: number; top: number };
  private touchPreviewDrag?: { pointerId: number; offsetX: number; offsetY: number };
  private touchPreviewViewportDrag?: { pointerId: number; offsetX: number; offsetY: number };
  private touchPreviewViewportGeometry?: {
    contentLeft: number;
    contentTop: number;
    contentWidth: number;
    contentHeight: number;
    frameWidth: number;
    frameHeight: number;
  };
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
    applyUiTheme(this.settings.uiTheme);
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
    this.renderDailyCalendar();
    this.renderEndlessHub();
    this.renderFavoritesScreen();
    this.renderTouchPreviewState();
    this.renderInputMode();
  }

  private uiVisualScale(): number {
    if (this.appShell.classList.contains('is-editor-fullscreen')) return 1;
    const logicalWidth = this.appShell.offsetWidth;
    const visualWidth = this.appShell.getBoundingClientRect().width;
    return logicalWidth > 0 && visualWidth > 0 ? visualWidth / logicalWidth : 1;
  }

  private bindLobby(): void {
    this.primaryActionButton.addEventListener('click', () => {
      if (this.currentScreen === 'lobby') void this.startNormalMode();
      else if (this.currentScreen === 'daily') void this.startDailyChallenge(this.dailyChallengeDateKey);
      else if (this.currentScreen === 'endless') void this.startEndlessMode();
    });
    query('#start-button').addEventListener('click', () => void this.startNormalMode());
    query('#endless-button').addEventListener('click', () => this.openEndlessHub());
    query('#bead-mode-button').addEventListener('click', () => this.openBeadMode());
    query('#daily-challenge-entry-button').addEventListener('click', () => this.openDailyChallenge());
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
    query('#challenge-button').addEventListener('click', () => this.openDailyChallenge());
    query('#night-editor-button').addEventListener('click', () => this.openEditor());
    query('#lobby-settings-button').addEventListener('click', () => this.openSettings('lobby'));
    query('#default-start-button').addEventListener('click', () => void this.startNormalMode());
    query('#default-bead-mode-button').addEventListener('click', () => this.openBeadMode());
    query('#default-daily-challenge-button').addEventListener('click', () => this.openDailyChallenge());
    query('#default-editor-button').addEventListener('click', () => this.openEditor());
    query('#default-lobby-settings-button').addEventListener('click', () => this.openSettings('lobby'));
    query('#tab-lobby-button').addEventListener('click', () => this.backToLobby());
    query('#tab-challenge-button').addEventListener('click', () => this.openDailyChallenge());
    query('#tab-endless-button').addEventListener('click', () => this.openEndlessHub());
    query('#tab-favorites-button').addEventListener('click', () => this.openFavorites());
    query('#daily-previous-month').addEventListener('click', () => this.shiftDailyCalendarMonth(-1));
    this.dailyNextMonthButton.addEventListener('click', () => this.shiftDailyCalendarMonth(1));
    query('#daily-today-button').addEventListener('click', () => {
      const today = new Date();
      this.dailyCalendarMonth = new Date(today.getFullYear(), today.getMonth(), 1, 12);
      this.dailyChallengeDateKey = formatDailyDateKey(today);
      this.renderDailyCalendar();
    });
    query('#daily-settings-button').addEventListener('click', () => this.openSettings('lobby'));
    this.dailyPlayButton.addEventListener('click', () => void this.startDailyChallenge(this.dailyChallengeDateKey));
    query('#endless-settings-button').addEventListener('click', () => this.openSettings('lobby'));
    this.endlessStartButton.addEventListener('click', () => void this.startEndlessMode());
    this.favoritesAlbumTab.addEventListener('click', () => this.setFavoritesTab('album'));
    this.favoritesBeadTab.addEventListener('click', () => this.setFavoritesTab('beads'));
  }

  private bindPlayControls(): void {
    this.playLevelButton.addEventListener('click', () => this.openLevelPicker());
    this.levelPickerDialog.addEventListener('close', () => {
      if (!this.playScreen.hidden) {
        this.boardScene.setPaused(false);
        this.renderPowerUps();
      }
    });
    query('#play-settings-button').addEventListener('click', () => this.openSettings('play'));
    this.watercolorBrushButton.addEventListener('click', () => void this.useWatercolorBrush());
    this.paintBucketButton.addEventListener('click', () => this.togglePaintBucket());
    this.bindSingleTouchInput();
    this.bindTouchPreviewDrag();
    this.bindTouchPreviewViewportDrag();
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
        || this.isTouchPreviewZoomMode()
        || !this.activeNeighborhoodPreview
        || this.settings.touchPreviewFollowsPointer
        || this.touchPreviewHiding
        || this.touchPreview.hidden
        || event.button !== 0
      ) return;
      event.preventDefault();
      event.stopPropagation();
      const bounds = this.touchPreview.getBoundingClientRect();
      const scale = this.uiVisualScale();
      this.touchPreviewDrag = {
        pointerId: event.pointerId,
        offsetX: (event.clientX - bounds.left) / scale,
        offsetY: (event.clientY - bounds.top) / scale,
      };
      this.touchPreview.classList.add('is-dragging');
      this.touchPreview.setPointerCapture(event.pointerId);
    });
    this.touchPreview.addEventListener('pointermove', (event) => {
      if (this.touchPreviewDrag?.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const playBounds = this.playScreen.getBoundingClientRect();
      const scale = this.uiVisualScale();
      this.placeTouchPreview(
        (event.clientX - playBounds.left) / scale - this.touchPreviewDrag.offsetX,
        (event.clientY - playBounds.top) / scale - this.touchPreviewDrag.offsetY,
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

  private bindTouchPreviewViewportDrag(): void {
    this.touchPreviewViewport.addEventListener('pointerdown', (event) => {
      if (
        !this.isTouchPreviewZoomMode()
        || this.touchPreviewViewport.hidden
        || !this.touchPreviewViewportGeometry
        || event.button !== 0
      ) return;
      event.preventDefault();
      event.stopPropagation();
      const boardBounds = this.touchPreviewBoard.getBoundingClientRect();
      const frameBounds = this.touchPreviewViewport.getBoundingClientRect();
      this.touchPreviewViewportDrag = {
        pointerId: event.pointerId,
        offsetX: (event.clientX - frameBounds.left) / Math.max(1, boardBounds.width),
        offsetY: (event.clientY - frameBounds.top) / Math.max(1, boardBounds.height),
      };
      this.touchPreviewViewport.classList.add('is-dragging');
      this.touchPreviewViewport.setPointerCapture(event.pointerId);
    });
    this.touchPreviewViewport.addEventListener('pointermove', (event) => {
      if (this.touchPreviewViewportDrag?.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      this.moveBoardViewportFromPreview(event.clientX, event.clientY);
    });
    const finishViewportDrag = (event: PointerEvent): void => {
      if (this.touchPreviewViewportDrag?.pointerId !== event.pointerId) return;
      this.touchPreviewViewportDrag = undefined;
      this.touchPreviewViewport.classList.remove('is-dragging');
      if (this.touchPreviewViewport.hasPointerCapture(event.pointerId)) {
        this.touchPreviewViewport.releasePointerCapture(event.pointerId);
      }
    };
    this.touchPreviewViewport.addEventListener('pointerup', finishViewportDrag);
    this.touchPreviewViewport.addEventListener('pointercancel', finishViewportDrag);
    this.touchPreviewViewport.addEventListener('lostpointercapture', finishViewportDrag);
  }

  private moveBoardViewportFromPreview(clientX: number, clientY: number): void {
    const drag = this.touchPreviewViewportDrag;
    const geometry = this.touchPreviewViewportGeometry;
    if (!drag || !geometry) return;
    const boardBounds = this.touchPreviewBoard.getBoundingClientRect();
    const pointerX = (clientX - boardBounds.left) / Math.max(1, boardBounds.width);
    const pointerY = (clientY - boardBounds.top) / Math.max(1, boardBounds.height);
    const frameLeft = pointerX - drag.offsetX;
    const frameTop = pointerY - drag.offsetY;
    const horizontalTravel = Math.max(0, geometry.contentWidth - geometry.frameWidth);
    const verticalTravel = Math.max(0, geometry.contentHeight - geometry.frameHeight);
    const scrollX = horizontalTravel <= 0
      ? 0.5
      : (frameLeft - geometry.contentLeft) / horizontalTravel;
    const scrollY = verticalTravel <= 0
      ? 0.5
      : (frameTop - geometry.contentTop) / verticalTravel;
    this.boardScene.setBoardViewportPosition(scrollX, scrollY);
  }

  private handleNeighborhoodPreview(preview: BoardNeighborhoodPreview | null): void {
    const previousPreview = this.activeNeighborhoodPreview;
    const zoomMode = this.isTouchPreviewZoomMode();
    const focusIndex = preview?.cells.find((cell) => cell.center)?.index;
    const activePreview = zoomMode ? preview : focusIndex === undefined ? null : preview;
    this.activeNeighborhoodPreview = activePreview;
    if (!this.isTouchPreviewEnabled() || !activePreview || this.currentScreen !== 'play') {
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
    if (zoomMode) {
      this.cancelTouchPreviewVisibilityAnimation();
      this.touchPreviewHiding = false;
      this.applyTouchPreviewVisibility(1, 1);
      this.repositionTouchPreview();
      return;
    }
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
    const zoomMode = previewSize === 'zoom';
    const followsPointer = enabled && !zoomMode && this.settings.touchPreviewFollowsPointer;
    this.touchPreview.dataset.size = previewSize;
    if (!enabled || !followsPointer) this.cancelTouchPreviewPositionAnimation();
    this.touchPreview.classList.toggle('is-following', followsPointer);
    this.touchPreview.classList.toggle('is-zoom-mode', zoomMode);
    this.touchPreview.setAttribute(
      'aria-label',
      zoomMode
        ? '完整关卡缩略图，可拖动红色视口框移动放大棋盘'
        : followsPointer
        ? '正在跟随触摸位置的关卡小窗'
        : '关卡小窗，可按住任意位置拖动',
    );
    if (!enabled || this.currentScreen !== 'play') {
      const previousPreview = this.activeNeighborhoodPreview;
      if (!enabled) this.activeNeighborhoodPreview = null;
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
    if (zoomMode) {
      this.cancelTouchPreviewVisibilityAnimation();
      this.touchPreviewHiding = false;
      this.applyTouchPreviewVisibility(1, 1);
      this.repositionTouchPreview();
      return;
    }
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
    const viewportDrag = this.touchPreviewViewportDrag;
    this.touchPreviewViewportDrag = undefined;
    this.touchPreviewViewport.classList.remove('is-dragging');
    if (viewportDrag && this.touchPreviewViewport.hasPointerCapture(viewportDrag.pointerId)) {
      this.touchPreviewViewport.releasePointerCapture(viewportDrag.pointerId);
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
    const scale = this.uiVisualScale();
    this.touchPreviewSurface.style.transformOrigin = (
      `${(clientX - bounds.left) / scale}px ${(clientY - bounds.top) / scale}px`
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
    const zoomMode = this.isTouchPreviewZoomMode();
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
      this.touchPreviewViewport.hidden = true;
      this.touchPreviewViewportGeometry = undefined;
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
    const boardSize = Math.max(
      1,
      Math.min(
        this.touchPreviewBoard.clientWidth || 144,
        this.touchPreviewBoard.clientHeight || this.touchPreviewBoard.clientWidth || 144,
      ),
    );
    const defaultGridUnitSize = (boardSize * 0.84) / Math.max(1, maxOffset * 2);
    const cellDiameterToStep = preview.viewport?.cellDiameterToStep ?? 0.62;
    const zoomContentWidth = (
      Math.max(...preview.cells.map((cell) => cell.offsetX))
      - Math.min(...preview.cells.map((cell) => cell.offsetX))
      + cellDiameterToStep
    );
    const zoomContentHeight = (
      Math.max(...preview.cells.map((cell) => cell.offsetY))
      - Math.min(...preview.cells.map((cell) => cell.offsetY))
      + cellDiameterToStep
    );
    const gridUnitSize = zoomMode
      ? (boardSize * 0.84) / Math.max(cellDiameterToStep, zoomContentWidth, zoomContentHeight)
      : defaultGridUnitSize;
    const offsetPercent = (offset: number): number => (
      50 + (offset * gridUnitSize / boardSize) * 100
    );
    const contentScale = this.settings.touchPreviewSize === 'large' ? 0.6 : 1;
    const targetGridUnitSize = boardSize * 0.31 * contentScale;
    const cameraScale = zoomMode
      ? 1
      : Math.max(0.25, Math.min(12, targetGridUnitSize / gridUnitSize));
    const targetCellSize = boardSize * 0.2 * contentScale;
    const cellSize = zoomMode
      ? gridUnitSize * cellDiameterToStep
      : targetCellSize / cameraScale;
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
      const fontScale = zoomMode
        ? preview.viewport?.numberFontToCellDiameter ?? 0.6
        : text.length >= 3 ? 0.37 : text.length === 2 ? 0.48 : 0.6;
      const fontSize = `${
        (zoomMode
          ? Math.max(1.7, cellSize * fontScale)
          : Math.max(3.5 / cameraScale, cellSize * fontScale)
        ).toFixed(2)
      }px`;
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
    if (zoomMode) {
      this.touchPreviewBoard.style.setProperty('--preview-camera-x', '0px');
      this.touchPreviewBoard.style.setProperty('--preview-camera-y', '0px');
      this.touchPreviewBoard.style.setProperty('--preview-camera-scale', '1');
    } else if (focusPosition) {
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

    this.renderTouchPreviewViewport(preview, positions, cellSize, boardSize);
    this.touchPreviewBoard.setAttribute(
      'aria-label',
      zoomMode
        ? '完整关卡缩略图，红框表示当前放大区域'
        : center === undefined
        ? `按住棋盘数字查看当前格周围${this.settings.touchPreviewSize === 'large' ? '两圈' : '一圈'}`
        : `完整关卡网格，当前格${center.value === null ? '为隐藏数字' : `数字为 ${center.value}`}`,
    );
  }

  private renderTouchPreviewViewport(
    preview: BoardNeighborhoodPreview,
    positions: ReadonlyMap<number, { x: number; y: number }>,
    cellSize: number,
    boardSize: number,
  ): void {
    if (!this.isTouchPreviewZoomMode() || !preview.viewport || positions.size === 0) {
      this.touchPreviewViewport.hidden = true;
      this.touchPreviewViewportGeometry = undefined;
      return;
    }

    const positionValues = [...positions.values()];
    const cellRadius = (cellSize / Math.max(1, boardSize)) * 0.5;
    const contentLeft = Math.max(0.01, Math.min(...positionValues.map(({ x }) => x / 100)) - cellRadius);
    const contentTop = Math.max(0.01, Math.min(...positionValues.map(({ y }) => y / 100)) - cellRadius);
    const contentRight = Math.min(0.99, Math.max(...positionValues.map(({ x }) => x / 100)) + cellRadius);
    const contentBottom = Math.min(0.99, Math.max(...positionValues.map(({ y }) => y / 100)) + cellRadius);
    const contentWidth = Math.max(0.01, contentRight - contentLeft);
    const contentHeight = Math.max(0.01, contentBottom - contentTop);
    const frameWidth = contentWidth * preview.viewport.viewportWidthRatio;
    const frameHeight = contentHeight * preview.viewport.viewportHeightRatio;
    const frameLeft = contentLeft + (contentWidth - frameWidth) * preview.viewport.scrollX;
    const frameTop = contentTop + (contentHeight - frameHeight) * preview.viewport.scrollY;

    this.touchPreviewViewportGeometry = {
      contentLeft,
      contentTop,
      contentWidth,
      contentHeight,
      frameWidth,
      frameHeight,
    };
    this.touchPreviewViewport.style.left = `${(frameLeft * 100).toFixed(3)}%`;
    this.touchPreviewViewport.style.top = `${(frameTop * 100).toFixed(3)}%`;
    this.touchPreviewViewport.style.width = `${(frameWidth * 100).toFixed(3)}%`;
    this.touchPreviewViewport.style.height = `${(frameHeight * 100).toFixed(3)}%`;
    this.touchPreviewViewport.hidden = false;
  }

  private repositionTouchPreview(): void {
    if (!this.isTouchPreviewEnabled() || this.touchPreview.hidden || this.touchPreviewDrag) return;
    if (this.isTouchPreviewZoomMode()) {
      this.placeTouchPreview(10, 10, false);
      return;
    }
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
    const scale = this.uiVisualScale();
    this.placeTouchPreview(
      (hostBounds.right - playBounds.left) / scale - this.touchPreview.offsetWidth - 10,
      (hostBounds.top - playBounds.top) / scale + 10,
      true,
    );
  }

  private placeTouchPreviewAbove(clientX: number, clientY: number, smooth = true): void {
    const playBounds = this.playScreen.getBoundingClientRect();
    const scale = this.uiVisualScale();
    this.placeTouchPreview(
      (clientX - playBounds.left) / scale - this.touchPreview.offsetWidth * 0.5,
      (clientY - playBounds.top) / scale - this.touchPreview.offsetHeight - 24,
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
    const scale = this.uiVisualScale();
    const margin = 8;
    const maxLeft = Math.max(margin, this.playScreen.clientWidth - this.touchPreview.offsetWidth - margin);
    const maxTop = Math.max(margin, this.playScreen.clientHeight - this.touchPreview.offsetHeight - margin);
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
          left: (bounds.left - playBounds.left) / scale,
          top: (bounds.top - playBounds.top) / scale,
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

  private isTouchPreviewZoomMode(): boolean {
    return this.settings.touchPreviewSize === 'zoom';
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

  private selectedInputMode(): InputMode {
    const value = this.inputModeControl.querySelector<HTMLInputElement>(
      'input[name="input-mode"]:checked',
    )?.value;
    return isInputMode(value) ? value : 'drag';
  }

  private setInputModeControl(mode: InputMode): void {
    this.inputModeControl.querySelectorAll<HTMLInputElement>('input[name="input-mode"]').forEach((input) => {
      input.checked = input.value === mode;
    });
  }

  private renderInputMode(): void {
    this.playScreen.classList.toggle('is-click-input', usesClickInput(this.settings.inputMode));
  }

  private selectedUiTheme(): UiTheme {
    const value = this.uiThemeControl.querySelector<HTMLInputElement>(
      'input[name="ui-theme"]:checked',
    )?.value;
    return isUiTheme(value) ? value : 'default';
  }

  private setUiThemeControl(theme: UiTheme): void {
    this.uiThemeControl.querySelectorAll<HTMLInputElement>('input[name="ui-theme"]').forEach((input) => {
      input.checked = input.value === theme;
    });
  }

  private bindSettings(): void {
    this.settingsDialog.addEventListener('change', () => this.applySettingsChange());
    query('#video-stats-button').addEventListener('click', () => this.openVideoStats());
    query('#video-stats-reset').addEventListener('click', () => this.resetVideoStats());
    query('#settings-lobby-button').addEventListener('click', () => {
      this.settingsDialog.close();
      if (this.settingsContext === 'play') this.leavePlayScreen();
      else this.backToLobby();
    });
    this.settingsDialog.addEventListener('close', () => {
      if (this.settingsContext === 'play') {
        this.boardScene.setPaused(false);
        this.renderPowerUps();
      }
    });
  }

  private refreshLevels(): void {
    this.levels = loadLevelCollection(this.builtInLevels);
    if (!this.levels.some((level) => level.levelId === this.settings.selectedLevelId)) {
      this.settings.selectedLevelId = this.levels[0]?.levelId ?? 1;
    }
  }

  private showScreen(name: ScreenName): void {
    const previousScreen = this.currentScreen;
    this.cancelPrimaryActionTransition();
    this.currentScreen = name;
    this.screenRouter.show(name);
    this.transitionPrimaryAction(previousScreen, name);
  }

  private hasPrimaryAction(screen: ScreenName): boolean {
    return screen === 'lobby' || screen === 'daily' || screen === 'endless';
  }

  private transitionPrimaryAction(previousScreen: ScreenName, nextScreen: ScreenName): void {
    const previousHasAction = this.hasPrimaryAction(previousScreen);
    const nextHasAction = this.hasPrimaryAction(nextScreen);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (previousHasAction && nextHasAction) {
      this.renderPrimaryAction();
      return;
    }

    if (previousHasAction && nextScreen === 'favorites') {
      this.renderPrimaryActionFor(previousScreen);
      this.primaryActionButton.disabled = true;
      if (reduceMotion) {
        this.primaryActionButton.hidden = true;
        return;
      }
      this.animatePrimaryAction([
        { transform: 'translate3d(0, 0, 0)' },
        { transform: `translate3d(-${this.appShell.clientWidth || UI_LOGICAL_WIDTH}px, 0, 0)` },
      ], true);
      return;
    }

    if (previousScreen === 'favorites' && nextHasAction) {
      this.renderPrimaryActionFor(nextScreen);
      if (reduceMotion) return;
      this.animatePrimaryAction([
        { transform: `translate3d(-${this.appShell.clientWidth || UI_LOGICAL_WIDTH}px, 0, 0)` },
        { transform: 'translate3d(0, 0, 0)' },
      ], false);
      return;
    }

    this.renderPrimaryAction();
  }

  private animatePrimaryAction(keyframes: Keyframe[], hideOnComplete: boolean): void {
    const animation = this.primaryActionButton.animate(keyframes, {
      duration: PRIMARY_ACTION_TRANSITION_DURATION_MS,
      easing: 'cubic-bezier(.22, 1, .36, 1)',
      fill: 'both',
    });
    const transitionToken = ++this.primaryActionTransitionToken;
    this.primaryActionTransition = animation;
    void animation.finished.then(() => {
      if (transitionToken !== this.primaryActionTransitionToken) return;
      this.primaryActionTransition = undefined;
      if (hideOnComplete) this.primaryActionButton.hidden = true;
      animation.cancel();
    }).catch(() => undefined);
  }

  private cancelPrimaryActionTransition(): void {
    this.primaryActionTransitionToken += 1;
    this.primaryActionTransition?.cancel();
    this.primaryActionTransition = undefined;
  }

  private renderPrimaryAction(): void {
    if (!this.hasPrimaryAction(this.currentScreen)) {
      this.primaryActionButton.hidden = true;
      this.primaryActionButton.disabled = true;
      return;
    }
    this.renderPrimaryActionFor(this.currentScreen);
  }

  private renderPrimaryActionFor(screen: ScreenName): void {
    if (!this.hasPrimaryAction(screen)) return;
    this.primaryActionButton.hidden = false;
    this.primaryActionButton.disabled = false;

    if (screen === 'lobby') {
      this.primaryActionButton.dataset.actionTheme = 'lobby';
      const levelId = this.settings.selectedLevelId;
      this.primaryActionLabel.textContent = `第 ${levelId} 关`;
      this.primaryActionButton.setAttribute('aria-label', `开始第 ${levelId} 关`);
      return;
    }

    if (screen === 'daily') {
      this.primaryActionButton.dataset.actionTheme = 'challenge';
      this.primaryActionLabel.textContent = this.dailyPlayButton.textContent?.trim() || '开始挑战';
      this.primaryActionButton.setAttribute('aria-label', this.dailyPlayButton.getAttribute('aria-label') || '开始每日挑战');
      return;
    }

    this.primaryActionButton.dataset.actionTheme = 'endless';
    this.primaryActionLabel.textContent = this.endlessStartButton.textContent?.trim() || '开始游戏';
    this.primaryActionButton.setAttribute('aria-label', '开始无尽模式');
  }

  private async showPlayScreen(): Promise<void> {
    this.boardScene.setPaused(false);
    this.setSolutionReveal(false);
    this.showScreen('play');
    this.renderTouchPreviewState();
    this.resultOverlay.hidden = true;
    this.resultActionBusy = false;
    this.setResultActionsDisabled(false);
    await nextFrame();
    this.game.scale.resize(Math.max(320, this.gameHost.clientWidth), Math.max(420, this.gameHost.clientHeight));
    await nextFrame();
    this.game.scale.resize(Math.max(320, this.gameHost.clientWidth), Math.max(420, this.gameHost.clientHeight));
  }

  private openLevelPicker(): void {
    if (this.playLevelButton.disabled || this.levelPickerDialog.open) return;
    this.refreshLevelOptions();
    if (this.activePowerUp === 'paint-bucket') {
      this.cancelPowerUpTargeting();
      this.setPowerUpMessage('已取消油漆桶选择。');
      this.renderPowerUps();
    }
    this.boardScene.setPaused(true);
    this.levelPickerDialog.showModal();
  }

  private selectLevelFromPicker(levelId: number): void {
    const level = this.levels.find((candidate) => candidate.levelId === levelId);
    if (!level) return;
    const changed = this.currentLevel?.levelId !== levelId;
    this.settings.shape = BoardShape.Level;
    this.settings.selectedLevelId = levelId;
    saveSettings(this.settings);
    this.renderDefaultLobbyLevelNumber();
    if (changed) this.setCurrentBoard(level);
    this.levelPickerDialog.close();
  }

  private setSolutionReveal(revealed: boolean): void {
    if (revealed && this.activePowerUp === 'paint-bucket') this.cancelPowerUpTargeting();
    this.solutionRevealed = revealed;
    this.solutionToggle.checked = revealed;
    this.boardScene.setSolutionReveal(revealed);
    if (revealed) this.setPowerUpMessage();
    this.renderPowerUps();
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
    const canResume = this.endlessSessionActive && this.endlessLives > 0;
    if (!canResume) {
      this.endlessSessionActive = true;
      this.stage = 1;
      this.endlessLives = 3;
      this.endlessSeed = Date.now() & 0x7fffffff;
    }
    this.playContext = 'normal';
    this.mode = 'endless';
    this.lives = this.endlessLives;
    this.renderLives();
    await this.showPlayScreen();
    const profile = getEndlessStageSettings(this.stage);
    const level = this.createEndlessLevel(this.stage, profile);
    this.setCurrentBoard(level, profile);
  }

  private async startDailyChallenge(dateKey: string): Promise<void> {
    if (!parseDailyDateKey(dateKey) || dateKey > formatDailyDateKey(new Date())) return;
    this.dailyChallengeDateKey = dateKey;
    const profile = getEndlessStageSettings(dailyChallengeStage(dateKey));
    this.dailyChallengeProfile = profile;
    this.playContext = 'daily';
    this.mode = 'normal';
    this.lives = 3;
    this.renderLives();
    await this.showPlayScreen();
    const generated = generateEndlessLevel(profile, dailyChallengeSeed(dateKey));
    this.setCurrentBoard({
      ...generated,
      levelId: Number(dateKey.replaceAll('-', '')),
    }, profile);
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
      inputMode: this.settings.inputMode,
      touchPreviewRingDepth: this.settings.touchPreviewSize === 'large' ? 2 : 1,
      boardZoomEnabled: this.isTouchPreviewZoomMode(),
      mode: this.mode,
      onProgress: (current, total) => {
        this.currentProgress = current;
        this.currentTotal = total;
        this.renderProgress();
        this.renderPowerUps();
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
    this.resetPowerUps();
    this.currentProgress = 0;
    this.currentTotal = level.solutionPath.length;
    this.updateGameHeading(level);
    this.renderProgress();
    this.boardScene.setBoard(this.makeSession(level, profile));
    this.renderPowerUps();
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
    const canSelectLevel = this.playContext === 'normal' && this.mode === 'normal';
    this.playLevelButton.disabled = !canSelectLevel;
    this.playLevelButton.title = canSelectLevel ? '选择关卡' : '';

    if (this.playContext === 'daily') {
      const date = parseDailyDateKey(this.dailyChallengeDateKey);
      this.levelLabel.textContent = date
        ? `每日挑战 · ${date.getMonth() + 1}月${date.getDate()}日`
        : '每日挑战';
      return;
    }
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

  private setPowerUpMessage(
    message?: string,
    tone: 'neutral' | 'active' | 'success' = 'neutral',
  ): void {
    this.powerUpMessage = message;
    this.powerUpMessageTone = message ? tone : 'neutral';
  }

  private resetPowerUps(): void {
    this.cancelPowerUpTargeting();
    this.setPowerUpMessage();
  }

  private cancelPowerUpTargeting(): void {
    this.activePowerUp = undefined;
    this.boardScene.setCellSelectionHandler(undefined);
    this.playScreen.classList.remove('is-paint-targeting');
    this.paintBucketButton.classList.remove('is-active');
    this.paintBucketButton.setAttribute('aria-pressed', 'false');
  }

  private renderPowerUps(): void {
    const concealedCount = this.boardScene.concealedCellKeys().size;
    const noRevealTargets = !this.currentLevel || this.solutionRevealed || concealedCount === 0;
    const bucketActive = this.activePowerUp === 'paint-bucket';
    const animationBusy = this.animatingPowerUp !== undefined;

    this.watercolorBrushButton.disabled = noRevealTargets || animationBusy;
    this.paintBucketButton.disabled = noRevealTargets || animationBusy;
    this.paintBucketButton.classList.toggle('is-active', bucketActive);
    this.paintBucketButton.setAttribute('aria-pressed', String(bucketActive));
    this.watercolorBrushButton.setAttribute(
      'aria-label',
      this.animatingPowerUp === 'watercolor-brush'
        ? '水彩笔，正在显示随机空位'
        : '水彩笔，随机显示一个空位，可重复使用',
    );
    this.paintBucketButton.setAttribute(
      'aria-label',
      this.animatingPowerUp === 'paint-bucket'
        ? '油漆桶，正在显示选中位置的 3×3 范围空位'
        : `油漆桶，选择中心位置并显示 3×3 范围空位，可重复使用${bucketActive ? '，正在选择中心位置' : ''}`,
    );
    this.playScreen.classList.toggle('is-paint-targeting', bucketActive);
    this.playScreen.classList.toggle('is-power-up-animating', animationBusy);
    this.playScreen.setAttribute('aria-busy', String(animationBusy));

    let message = this.powerUpMessage;
    let tone = this.powerUpMessageTone;
    if (bucketActive) {
      message ??= '请选择一个中心格，再显示其 3×3 范围内的空位。';
      tone = 'active';
    } else if (!message && this.solutionRevealed) {
      message = '答案显示时，道具暂不可用。';
    } else if (!message && concealedCount === 0) {
      message = '当前没有需要显示的空位。';
    } else if (!message) {
      message = '道具可重复使用';
    }
    this.powerUpStatus.textContent = message;
    this.powerUpStatus.classList.toggle('is-active', tone === 'active');
    this.powerUpStatus.classList.toggle('is-success', tone === 'success');
  }

  private async animatePowerUpUse<T>(
    id: PowerUpId,
    button: HTMLButtonElement,
    target: ClientPoint | undefined,
    applyEffect: () => T,
  ): Promise<T> {
    let effectApplied = false;
    let effectResult: T;
    const applyEffectOnce = (): T => {
      if (!effectApplied) {
        effectApplied = true;
        effectResult = applyEffect();
      }
      return effectResult!;
    };

    this.animatingPowerUp = id;
    button.classList.add('is-animating');
    this.renderPowerUps();

    let layer: HTMLElement | undefined;
    try {
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const sourceImage = button.querySelector<HTMLImageElement>('.power-up-icon img');
      const sourceBounds = sourceImage?.getBoundingClientRect();
      if (
        reducedMotion
        || !target
        || !sourceImage
        || !sourceBounds
        || sourceBounds.width <= 0
        || sourceBounds.height <= 0
      ) {
        await nextFrame();
        return applyEffectOnce();
      }

      layer = document.createElement('div');
      layer.className = 'power-up-flight-layer';
      layer.setAttribute('aria-hidden', 'true');

      const tool = document.createElement('img');
      tool.className = `power-up-flight-tool power-up-flight-tool--${id}`;
      tool.src = sourceImage.currentSrc || sourceImage.src;
      tool.alt = '';
      tool.draggable = false;
      tool.style.width = `${sourceBounds.width}px`;
      tool.style.height = `${sourceBounds.height}px`;

      const anchor = id === 'watercolor-brush'
        ? { x: sourceBounds.width * 0.19, y: sourceBounds.height * 0.82 }
        : { x: sourceBounds.width * 0.5, y: sourceBounds.height * 0.56 };
      const start = {
        x: sourceBounds.left + anchor.x,
        y: sourceBounds.top + anchor.y,
      };
      const arrival = id === 'paint-bucket'
        ? { x: target.x, y: target.y - sourceBounds.height * 0.16 }
        : target;
      tool.style.transformOrigin = `${anchor.x}px ${anchor.y}px`;
      tool.style.transform = powerUpTransform(start, anchor, 0, 1);
      layer.append(tool);
      document.body.append(layer);

      const outward = tool.animate(
        powerUpFlightKeyframes(start, arrival, anchor, 0, 0, 1, 1.08),
        {
          duration: POWER_UP_FLIGHT_DURATION_MS,
          easing: 'cubic-bezier(.2,.76,.22,1)',
          fill: 'forwards',
        },
      );
      await outward.finished;

      if (id === 'watercolor-brush') {
        const brushMotion = tool.animate([
          { offset: 0, transform: powerUpTransform(arrival, anchor, 0, 1.08) },
          { offset: 0.2, transform: powerUpTransform({ x: arrival.x - 5, y: arrival.y }, anchor, -10, 1.11) },
          { offset: 0.42, transform: powerUpTransform({ x: arrival.x + 6, y: arrival.y }, anchor, 11, 1.11) },
          { offset: 0.64, transform: powerUpTransform({ x: arrival.x - 5, y: arrival.y }, anchor, -9, 1.1) },
          { offset: 0.84, transform: powerUpTransform({ x: arrival.x + 4, y: arrival.y }, anchor, 7, 1.09) },
          { offset: 1, transform: powerUpTransform(arrival, anchor, 0, 1.08) },
        ], {
          duration: 520,
          easing: 'ease-in-out',
          fill: 'forwards',
        });
        await waitFor(275);
        applyEffectOnce();
        await brushMotion.finished;
      } else {
        const bucketMotion = tool.animate([
          { offset: 0, transform: powerUpTransform(arrival, anchor, 0, 1.08) },
          { offset: 0.2, transform: powerUpTransform({ x: arrival.x + 2, y: arrival.y - 2 }, anchor, 10, 1.09) },
          { offset: 0.52, transform: powerUpTransform({ x: arrival.x - 3, y: arrival.y - 5 }, anchor, -54, 1.11) },
          { offset: 0.74, transform: powerUpTransform({ x: arrival.x - 4, y: arrival.y - 4 }, anchor, -62, 1.11) },
          { offset: 1, transform: powerUpTransform({ x: arrival.x - 3, y: arrival.y - 3 }, anchor, -56, 1.1) },
        ], {
          duration: 560,
          easing: 'cubic-bezier(.34,.02,.24,1)',
          fill: 'forwards',
        });
        await waitFor(330);
        const drop = document.createElement('i');
        drop.className = 'power-up-pour-drop';
        drop.style.left = `${target.x}px`;
        drop.style.top = `${target.y}px`;
        layer.append(drop);
        const dropMotion = drop.animate([
          { offset: 0, opacity: 0, transform: 'translate(-50%, -28px) scale(.28)' },
          { offset: 0.2, opacity: 1, transform: 'translate(-50%, -18px) scale(.55)' },
          { offset: 0.62, opacity: 0.9, transform: 'translate(-50%, -2px) scale(.9)' },
          { offset: 1, opacity: 0, transform: 'translate(-50%, 4px) scale(1.35)' },
        ], {
          duration: 430,
          easing: 'cubic-bezier(.2,.72,.25,1)',
          fill: 'forwards',
        });
        applyEffectOnce();
        await bucketMotion.finished;
        const uprightMotion = tool.animate([
          { transform: powerUpTransform({ x: arrival.x - 3, y: arrival.y - 3 }, anchor, -56, 1.1) },
          { transform: powerUpTransform(arrival, anchor, 8, 1.08) },
          { transform: powerUpTransform(arrival, anchor, 0, 1.08) },
        ], {
          duration: 190,
          easing: 'cubic-bezier(.3,.8,.35,1.18)',
          fill: 'forwards',
        });
        await Promise.all([uprightMotion.finished, dropMotion.finished]);
      }

      const returnBounds = sourceImage.getBoundingClientRect();
      const returnPoint = returnBounds.width > 0 && returnBounds.height > 0
        ? { x: returnBounds.left + anchor.x, y: returnBounds.top + anchor.y }
        : start;
      const returning = tool.animate(
        powerUpFlightKeyframes(arrival, returnPoint, anchor, 0, 0, 1.08, 1),
        {
          duration: POWER_UP_RETURN_DURATION_MS,
          easing: 'cubic-bezier(.38,.02,.24,1)',
          fill: 'forwards',
        },
      );
      await returning.finished;
      return applyEffectOnce();
    } catch {
      return applyEffectOnce();
    } finally {
      layer?.remove();
      button.classList.remove('is-animating');
      if (this.animatingPowerUp === id) this.animatingPowerUp = undefined;
      this.renderPowerUps();
    }
  }

  private async useWatercolorBrush(): Promise<void> {
    if (this.animatingPowerUp) return;
    this.cancelPowerUpTargeting();
    if (!this.currentLevel || this.solutionRevealed) {
      this.setPowerUpMessage('当前无法使用水彩笔。');
      this.renderPowerUps();
      return;
    }
    if (!this.boardScene.canUsePowerUp()) {
      this.setPowerUpMessage('棋盘正在准备，请稍后再试。');
      this.renderPowerUps();
      return;
    }

    const cell = chooseWatercolorReveal(
      this.currentLevel.solutionPath,
      this.boardScene.concealedCellKeys(),
    );
    if (!cell) {
      this.setPowerUpMessage('当前没有需要显示的空位。');
      this.renderPowerUps();
      return;
    }
    this.setPowerUpMessage('水彩笔正在前往随机空位。', 'active');
    const revealed = await this.animatePowerUpUse(
      'watercolor-brush',
      this.watercolorBrushButton,
      this.boardScene.cellClientPosition(cell),
      () => this.boardScene.revealCells([cell]),
    );
    if (revealed.length === 0) {
      this.setPowerUpMessage('这次没有显示空位，请再试一次。');
      this.renderPowerUps();
      return;
    }

    this.setPowerUpMessage('水彩笔随机显示了 1 个空位。', 'success');
    this.renderPowerUps();
  }

  private togglePaintBucket(): void {
    if (this.animatingPowerUp) return;
    if (this.activePowerUp === 'paint-bucket') {
      this.cancelPowerUpTargeting();
      this.setPowerUpMessage('已取消油漆桶选择。');
      this.renderPowerUps();
      return;
    }
    if (!this.currentLevel || this.solutionRevealed || this.boardScene.concealedCellKeys().size === 0) {
      this.setPowerUpMessage('当前没有需要显示的空位。');
      this.renderPowerUps();
      return;
    }

    this.activePowerUp = 'paint-bucket';
    const armed = this.boardScene.setCellSelectionHandler((center) => void this.applyPaintBucket(center));
    if (!armed) {
      this.activePowerUp = undefined;
      this.setPowerUpMessage('棋盘正在准备，请稍后再试。');
      this.renderPowerUps();
      return;
    }
    this.setPowerUpMessage('请选择一个中心格，再显示其 3×3 范围内的空位。', 'active');
    this.renderPowerUps();
  }

  private async applyPaintBucket(center: Cell): Promise<void> {
    if (
      this.animatingPowerUp
      || this.activePowerUp !== 'paint-bucket'
      || !this.currentLevel
    ) return;

    const cells = paintBucketRevealCells(
      this.currentLevel.solutionPath,
      this.boardScene.concealedCellKeys(),
      center,
    );
    if (cells.length === 0) {
      this.setPowerUpMessage('这个 3×3 范围没有空位，请换一个中心格。', 'active');
      this.renderPowerUps();
      return;
    }

    const target = this.boardScene.cellClientPosition(center);
    this.cancelPowerUpTargeting();
    this.setPowerUpMessage('油漆桶正在前往选中的位置。', 'active');
    const revealed = await this.animatePowerUpUse(
      'paint-bucket',
      this.paintBucketButton,
      target,
      () => this.boardScene.revealCells(cells),
    );
    if (revealed.length === 0) {
      this.setPowerUpMessage('这次没有显示空位，请重新选择油漆桶。');
      this.renderPowerUps();
      return;
    }
    this.setPowerUpMessage(`油漆桶显示了 ${revealed.length} 个空位。`, 'success');
    this.renderPowerUps();
  }

  private renderLives(): void {
    if (this.mode === 'endless' && this.endlessSessionActive) {
      this.endlessLives = this.lives;
      this.recordEndlessProgress();
    }
    this.livesLabel.hidden = false;
    this.livesLabel.textContent = formatLives(this.lives);
    this.livesLabel.setAttribute('aria-label', `生命值 ${this.lives}`);
  }

  private recordEndlessProgress(): void {
    if (this.endlessSessionActive) this.endlessHighScore = Math.max(this.endlessHighScore, this.stage);
    saveEndlessRunState({
      active: this.endlessSessionActive,
      stage: this.stage,
      lives: this.endlessLives,
      seed: this.endlessSeed,
      bestStage: this.endlessHighScore,
    });
    this.renderEndlessHub();
  }

  private renderEndlessHub(): void {
    this.endlessCurrentStage.textContent = String(this.stage);
    const endlessLives = Math.max(0, Math.floor(this.endlessLives));
    this.endlessCurrentLives.textContent = endlessLives > 3
      ? `♥ × ${endlessLives}`
      : endlessLives > 0
        ? '♥'.repeat(endlessLives)
        : '♥ × 0';
    this.endlessCurrentLives.setAttribute('aria-label', `当前生命 ${endlessLives}`);
    this.endlessBestStage.textContent = String(this.endlessHighScore);
    const label = this.endlessStartButton.querySelector<HTMLElement>('strong');
    const canResume = this.endlessSessionActive && this.endlessLives > 0;
    if (label) label.textContent = canResume ? `继续第 ${this.stage} 阶段` : '开始游戏';
    this.renderPrimaryAction();
  }

  private handleWrong(): void {
    if (this.lives <= 0) return;
    this.lives -= 1;
    this.renderLives();
    if (this.lives === 0) this.handleLifeDepleted();
  }

  private handleLifeDepleted(): void {
    this.cancelPowerUpTargeting();
    this.renderPowerUps();
    this.boardScene.setPaused(true);
    if (this.playContext === 'editor-playtest') {
      this.resultContext = 'editor-playtest-failed';
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
    this.resultTitle.textContent = '生命已耗尽';
    const progress = `当前数字进度 ${this.currentProgress} / ${this.currentTotal}`;
    this.resultMessage.textContent = this.mode === 'endless' ? `阶段 ${this.stage} · ${progress}` : progress;
    this.resultReward.hidden = true;
    this.restartButton.textContent = '重新开始';
    this.nextButton.textContent = '观看视频获取 1♥';
    this.nextButton.hidden = false;
    this.resultLobbyButton.textContent = this.mode === 'endless'
      ? '返回无尽模式'
      : this.playContext === 'bead'
        ? '返回拼豆图纸'
        : this.playContext === 'collection'
          ? '返回收集路线'
          : this.playContext === 'daily'
            ? '返回每日挑战'
            : '放弃';
    this.resultActions.classList.remove('is-single');
    this.setResultActionsDisabled(false);
    this.resultOverlay.hidden = false;
  }

  private showEditorPlaytestResult(): void {
    this.resultContext = 'editor-playtest';
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

  private showDailyChallengeResult(): void {
    const date = parseDailyDateKey(this.dailyChallengeDateKey);
    this.resultContext = 'daily';
    this.resultTitle.textContent = '今日打卡完成！';
    this.resultMessage.textContent = date
      ? `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日已点亮。`
      : '这一天的挑战已经点亮。';
    this.resultReward.hidden = true;
    this.restartButton.textContent = '再挑战一次';
    this.nextButton.hidden = true;
    this.resultLobbyButton.textContent = '返回每日挑战';
    this.resultActions.classList.add('is-single');
    this.setResultActionsDisabled(false);
    this.resultOverlay.hidden = false;
  }

  private showEndlessStageResult(): void {
    this.resultContext = 'endless-stage';
    this.resultTitle.textContent = `阶段 ${this.stage}`;
    this.resultMessage.textContent = '已完成';
    this.resultReward.textContent = '♥ +1';
    this.resultReward.hidden = false;
    this.restartButton.textContent = '下一阶段';
    this.nextButton.textContent = '观看视频 · 额外 +1♥';
    this.nextButton.hidden = false;
    this.resultLobbyButton.textContent = '返回无尽模式';
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
    if (this.playContext === 'daily') {
      await this.boardScene.showCompletion();
      if (this.playContext !== 'daily') return;
      this.completedDailyChallenges.add(this.dailyChallengeDateKey);
      saveCompletedDailyChallenges(this.completedDailyChallenges);
      this.renderDailyCalendar();
      this.showDailyChallengeResult();
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
    this.recordEndlessProgress();
    const profile = getEndlessStageSettings(this.stage);
    const next = this.createEndlessLevel(this.stage, profile);
    this.currentLevel = next;
    this.currentProgress = 0;
    this.currentTotal = next.solutionPath.length;
    this.updateGameHeading(next);
    this.renderProgress();
    this.resetPowerUps();
    this.setPowerUpMessage('正在准备下一关。');
    this.renderPowerUps();

    try {
      await this.boardScene.transitionTo(this.makeSession(next, profile));
    } finally {
      this.setPowerUpMessage();
      this.renderPowerUps();
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
      this.setCurrentBoard(
        this.currentLevel,
        this.playContext === 'daily' ? this.dailyChallengeProfile : undefined,
      );
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
    this.renderDefaultLobbyLevelNumber();
  }

  private backToLobby(): void {
    this.playContext = 'normal';
    this.resultOverlay.hidden = true;
    this.cancelPowerUpTargeting();
    this.boardScene.setPaused(true);
    this.showScreen('lobby');
  }

  private leavePlayScreen(): void {
    this.resultOverlay.hidden = true;
    this.cancelPowerUpTargeting();
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
    if (this.playContext === 'daily') {
      this.showScreen('daily');
      this.renderDailyCalendar();
      return;
    }
    if (this.mode === 'endless') {
      this.showScreen('endless');
      this.renderEndlessHub();
      return;
    }
    this.backToLobby();
  }

  private openSettings(context: 'lobby' | 'play'): void {
    this.settingsContext = context;
    if (context === 'play') {
      if (this.activePowerUp === 'paint-bucket') {
        this.cancelPowerUpTargeting();
        this.setPowerUpMessage('已取消油漆桶选择。');
        this.renderPowerUps();
      }
      this.boardScene.setPaused(true);
    }
    this.populateSettingsForm();
    this.renderVideoStats();
    const leaveButton = query<HTMLButtonElement>('#settings-lobby-button');
    leaveButton.hidden = context === 'lobby';
    query<HTMLElement>('#settings-actions').hidden = context === 'lobby';
    leaveButton.textContent = this.mode === 'endless'
      ? '返回无尽模式'
      : this.playContext === 'editor-playtest'
        ? '返回编辑器'
        : this.playContext === 'bead'
          ? '返回拼豆图纸'
          : this.playContext === 'collection'
            ? '返回收集路线'
            : this.playContext === 'daily'
              ? '返回每日挑战'
              : '返回大厅';
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
    this.setInputModeControl(this.settings.inputMode);
    query<HTMLInputElement>('#settings-next').checked = this.settings.showNextNumber;
    query<HTMLInputElement>('#settings-sound').checked = this.settings.soundEnabled;
    this.setUiThemeControl(this.settings.uiTheme);
    this.solutionToggle.checked = this.solutionRevealed;
    this.setTouchPreviewSizeControl(this.settings.touchPreviewSize);
    query<HTMLInputElement>('#settings-touch-preview-follow').checked = this.settings.touchPreviewFollowsPointer;
    this.refreshSettingsControls();
  }

  private refreshLevelOptions(): void {
    const options = this.levels.map((level) => {
      const option = document.createElement('button');
      const selected = level.levelId === this.settings.selectedLevelId;
      option.type = 'button';
      option.className = 'level-picker-option';
      option.dataset.levelId = String(level.levelId);
      option.setAttribute('role', 'listitem');
      option.classList.toggle('is-selected', selected);
      if (selected) option.setAttribute('aria-current', 'true');
      option.innerHTML = `<strong>${level.levelId}</strong><small>${level.custom ? '自制关卡' : '关卡'}</small>`;
      option.addEventListener('click', () => this.selectLevelFromPicker(level.levelId));
      return option;
    });
    this.levelPickerGrid.replaceChildren(...options);
    this.renderDefaultLobbyLevelNumber();
  }

  private renderDefaultLobbyLevelNumber(): void {
    query<HTMLElement>('#default-level-number').textContent = String(this.settings.selectedLevelId);
    this.renderPrimaryAction();
  }

  private refreshSettingsControls(): void {
    const previewSize = this.selectedTouchPreviewSize();
    query<HTMLInputElement>('#settings-touch-preview-follow').disabled = (
      previewSize === 'off' || previewSize === 'zoom'
    );
    query<HTMLInputElement>('#settings-next').disabled = usesClickInput(this.selectedInputMode());
  }

  private applySettingsChange(): void {
    this.settings.inputMode = this.selectedInputMode();
    this.settings.showNextNumber = query<HTMLInputElement>('#settings-next').checked;
    this.settings.soundEnabled = query<HTMLInputElement>('#settings-sound').checked;
    this.settings.uiTheme = this.selectedUiTheme();
    this.settings.touchPreviewSize = this.selectedTouchPreviewSize();
    this.settings.touchPreviewFollowsPointer = query<HTMLInputElement>('#settings-touch-preview-follow').checked;
    applyUiTheme(this.settings.uiTheme);
    saveSettings(this.settings);
    this.renderDefaultLobbyLevelNumber();
    this.refreshSettingsControls();
    this.renderTouchPreviewState();
    this.renderInputMode();
    this.boardScene.setRuntimePreferences({
      showNextNumber: this.settings.showNextNumber,
      soundEnabled: this.settings.soundEnabled,
      inputMode: this.settings.inputMode,
      touchPreviewRingDepth: this.settings.touchPreviewSize === 'large' ? 2 : 1,
      boardZoomEnabled: this.isTouchPreviewZoomMode(),
    });

    if (this.settingsContext === 'play') {
      this.setSolutionReveal(this.solutionToggle.checked);
    }
  }

  private openEditor(): void {
    this.playContext = 'normal';
    this.showScreen('editor');
    this.editor.open();
  }

  private openDailyChallenge(): void {
    const today = new Date();
    this.playContext = 'normal';
    this.dailyCalendarMonth = new Date(today.getFullYear(), today.getMonth(), 1, 12);
    this.dailyChallengeDateKey = formatDailyDateKey(today);
    this.showScreen('daily');
    this.renderDailyCalendar();
    this.dailyScreen.querySelector<HTMLElement>('.daily-screen-stage')?.scrollTo({ top: 0 });
  }

  private shiftDailyCalendarMonth(offset: number): void {
    const candidate = new Date(
      this.dailyCalendarMonth.getFullYear(),
      this.dailyCalendarMonth.getMonth() + offset,
      1,
      12,
    );
    const today = new Date();
    const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1, 12);
    if (candidate.getTime() > currentMonth.getTime()) return;
    this.dailyCalendarMonth = candidate;
    const isCurrentMonth = candidate.getTime() === currentMonth.getTime();
    const selectedDay = isCurrentMonth ? today.getDate() : daysInMonth(candidate.getFullYear(), candidate.getMonth());
    this.dailyChallengeDateKey = formatDailyDateKey(new Date(candidate.getFullYear(), candidate.getMonth(), selectedDay, 12));
    this.renderDailyCalendar();
  }

  private renderDailyCalendar(): void {
    const year = this.dailyCalendarMonth.getFullYear();
    const month = this.dailyCalendarMonth.getMonth();
    const today = new Date();
    const todayKey = formatDailyDateKey(today);
    const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1, 12);
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
    const completedThisMonth = [...this.completedDailyChallenges].filter((key) => key.startsWith(monthPrefix)).length;
    const monthDayCount = daysInMonth(year, month);
    const completedCount = this.dailyCompleteCount.querySelector<HTMLElement>('b');
    if (completedCount) completedCount.textContent = String(completedThisMonth);
    this.dailyCompleteCount.setAttribute('aria-label', `本月已完成 ${completedThisMonth} 天`);
    this.dailyMonthTotal.textContent = String(monthDayCount);
    this.dailyProgressFill.style.width = `${(completedThisMonth / monthDayCount) * 100}%`;
    this.dailyProgressTrack.setAttribute('aria-valuemax', String(monthDayCount));
    this.dailyProgressTrack.setAttribute('aria-valuenow', String(completedThisMonth));

    this.dailyMonthLabel.textContent = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: 'long',
    }).format(this.dailyCalendarMonth);
    this.dailyNextMonthButton.disabled = this.dailyCalendarMonth.getTime() >= currentMonth.getTime();

    const emptyCells = Array.from({ length: mondayFirstOffset(year, month) }, () => {
      const empty = document.createElement('span');
      empty.className = 'daily-calendar-empty';
      empty.setAttribute('aria-hidden', 'true');
      return empty;
    });
    const dayCells = Array.from({ length: monthDayCount }, (_, index) => {
      const day = index + 1;
      const date = new Date(year, month, day, 12);
      const dateKey = formatDailyDateKey(date);
      const isFuture = dateKey > todayKey;
      const isToday = dateKey === todayKey;
      const isCompleted = this.completedDailyChallenges.has(dateKey);
      const isSelected = dateKey === this.dailyChallengeDateKey;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'daily-calendar-day';
      button.classList.toggle('is-future', isFuture);
      button.classList.toggle('is-today', isToday);
      button.classList.toggle('is-completed', isCompleted);
      button.classList.toggle('is-selected', isSelected);
      button.disabled = isFuture;
      button.setAttribute('role', 'gridcell');
      button.setAttribute('aria-selected', String(isSelected));
      if (isToday) button.setAttribute('aria-current', 'date');
      button.setAttribute(
        'aria-label',
        `${year}年${month + 1}月${day}日${isFuture ? '，尚未开放' : isCompleted ? '，已完成' : '，开始挑战'}`,
      );
      const number = document.createElement('span');
      number.textContent = String(day);
      button.append(number);
      if (isCompleted) {
        const check = document.createElement('i');
        check.textContent = '✓';
        check.setAttribute('aria-hidden', 'true');
        button.append(check);
      }
      if (!isFuture) button.addEventListener('click', () => {
        this.dailyChallengeDateKey = dateKey;
        this.renderDailyCalendar();
      });
      return button;
    });
    this.dailyCalendarGrid.replaceChildren(...emptyCells, ...dayCells);
    const selectedDate = parseDailyDateKey(this.dailyChallengeDateKey);
    const selectedLabel = selectedDate
      ? `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日`
      : '所选日期';
    this.dailyPlayButton.textContent = this.completedDailyChallenges.has(this.dailyChallengeDateKey) ? '再次挑战' : '开始挑战';
    this.dailyPlayButton.setAttribute('aria-label', `${selectedLabel}，${this.dailyPlayButton.textContent}`);
    this.renderPrimaryAction();
  }

  private openEndlessHub(): void {
    this.boardScene.setPaused(true);
    this.showScreen('endless');
    this.renderEndlessHub();
  }

  private openFavorites(): void {
    this.boardScene.setPaused(true);
    this.showScreen('favorites');
    this.renderFavoritesScreen();
  }

  private setFavoritesTab(tab: 'album' | 'beads'): void {
    this.favoritesTab = tab;
    this.renderFavoritesScreen();
  }

  private renderFavoritesScreen(): void {
    const albumActive = this.favoritesTab === 'album';
    this.favoritesAlbumTab.classList.toggle('is-active', albumActive);
    this.favoritesBeadTab.classList.toggle('is-active', !albumActive);
    this.favoritesAlbumTab.setAttribute('aria-selected', String(albumActive));
    this.favoritesBeadTab.setAttribute('aria-selected', String(!albumActive));
    this.favoritesAlbumPanel.hidden = !albumActive;
    this.favoritesBeadPanel.hidden = albumActive;

    const albumTotal = this.collectionLevelCount();
    const albumCompleted = Math.min(this.collectionCompletedCount, albumTotal);
    const beadCompleted = this.beadPatterns.filter((pattern) => this.completedBeadPatternIds.has(pattern.id)).length;
    const current = albumActive
      ? { completed: albumCompleted, total: albumTotal, title: '旅途画册' }
      : { completed: beadCompleted, total: this.beadPatterns.length, title: '拼豆图鉴' };
    const count = `${current.completed} / ${current.total}`;
    this.favoritesSummaryCount.textContent = count;
    this.favoritesSummaryTitle.textContent = current.title;
    this.renderFavoriteAlbumGrid(albumTotal, albumCompleted);
    this.renderFavoriteBeadGrid();
  }

  private renderFavoriteAlbumGrid(total: number, completed: number): void {
    const cards = Array.from({ length: total }, (_, index) => {
      const collected = index < completed;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'favorite-card favorite-card--album';
      card.classList.toggle('is-locked', !collected);
      card.disabled = !collected;
      card.setAttribute('role', 'listitem');
      card.setAttribute('aria-label', collected
        ? `${collectionArtworkLabel(index)}，已收集，打开收集路线`
        : `${collectionArtworkLabel(index)}，尚未解锁`);

      const art = document.createElement('span');
      art.className = 'favorite-card__art';
      const image = document.createElement('img');
      image.src = collectionArtworkUrl(index);
      image.alt = '';
      image.loading = 'lazy';
      art.append(image);
      if (!collected) {
        const lock = document.createElement('b');
        lock.className = 'favorite-card__lock';
        lock.textContent = '锁';
        art.append(lock);
      }

      const copy = document.createElement('span');
      copy.className = 'favorite-card__copy';
      const labels = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = collectionArtworkLabel(index);
      const number = document.createElement('small');
      number.textContent = `画册 ${index + 1}`;
      labels.append(name, number);
      const status = document.createElement('i');
      status.textContent = collected ? '已收集' : '未解锁';
      copy.append(labels, status);
      card.append(art, copy);
      if (collected) card.addEventListener('click', () => this.openCollectionMode());
      return card;
    });
    this.favoritesAlbumGrid.replaceChildren(...cards);
  }

  private renderFavoriteBeadGrid(): void {
    const cards = this.beadPatterns.map((pattern) => {
      const completed = this.completedBeadPatternIds.has(pattern.id);
      const current = this.beadPattern?.id === pattern.id;
      const total = orderedBeads(pattern).length;
      const collected = current ? this.beadProgress?.collected ?? 0 : 0;
      const locked = !completed && !current;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'favorite-card favorite-card--bead';
      card.classList.toggle('is-locked', locked);
      card.disabled = locked;
      card.setAttribute('role', 'listitem');
      card.setAttribute('aria-label', completed
        ? `${pattern.name}，已完成`
        : current
          ? `${pattern.name}，已收集 ${collected} / ${total} 颗拼豆`
          : `${pattern.name}，尚未解锁`);

      const art = document.createElement('span');
      art.className = 'favorite-card__art';
      const image = document.createElement('img');
      image.src = `./bead-patterns/${pattern.id}.svg`;
      image.alt = '';
      image.loading = 'lazy';
      art.append(image);
      if (locked) {
        const lock = document.createElement('b');
        lock.className = 'favorite-card__lock';
        lock.textContent = '锁';
        art.append(lock);
      }

      const copy = document.createElement('span');
      copy.className = 'favorite-card__copy';
      const labels = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = pattern.name;
      const size = document.createElement('small');
      size.textContent = completed
        ? `${pattern.width} × ${pattern.height}`
        : current
          ? `${collected} / ${total} 颗`
          : `${pattern.width} × ${pattern.height}`;
      labels.append(name, size);
      const status = document.createElement('i');
      status.textContent = completed ? '已完成' : current ? '进行中' : '未解锁';
      copy.append(labels, status);
      card.append(art, copy);
      if (completed) {
        card.addEventListener('click', () => {
          this.beadGalleryDialog.showModal();
          this.showBeadGalleryDetail(pattern);
        });
      } else if (current) {
        card.addEventListener('click', () => this.openBeadMode());
      }
      return card;
    });
    this.favoritesBeadGrid.replaceChildren(...cards);
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
  }

  private renderCollectionMap(): void {
    const total = this.collectionLevelCount();
    const completed = Math.min(this.collectionCompletedCount, total);
    this.collectionCompletedCount = completed;
    this.collectionRouteProgress.textContent = `${completed} / ${total}`;
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
    const scale = this.uiVisualScale();
    const nodes = Array.from(this.collectionRoute.querySelectorAll<HTMLElement>('.collection-level-node'));
    if (routeBounds.width <= 0 || routeBounds.height <= 0 || nodes.length === 0) return;
    const points = nodes.map((node) => {
      const bounds = node.getBoundingClientRect();
      return {
        x: (bounds.left - routeBounds.left + bounds.width * 0.5) / scale,
        y: (bounds.top - routeBounds.top + bounds.height * 0.5) / scale - 10,
      };
    });
    this.collectionRouteLines.setAttribute(
      'viewBox',
      `0 0 ${routeBounds.width / scale} ${routeBounds.height / scale}`,
    );
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
    const scale = this.uiVisualScale();
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
      const targetX = (targetRect.left - appRect.left + targetRect.width * 0.5) / scale;
      const targetY = (targetRect.top - appRect.top + targetRect.height * 0.5) / scale;
      const deltaX = targetX - startX;
      const deltaY = targetY - startY;
      const landingScale = Math.max(0.24, Math.min(0.78, targetRect.width / scale / 26));
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
        const color = pattern.data[y][x];
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
