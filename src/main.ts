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
  loadEditorLevelCollection,
  loadBeadLevels,
  loadLevelCollection,
  loadMode3Levels,
  loadSettings,
  saveLevelCollection,
  saveSettings,
} from './game/storage';
import {
  BoardShape,
  cellKey,
  isInputMode,
  isMainGameplay,
  isMainGameplayDifficulty,
  isTouchPreviewSize,
  isUiTheme,
  usesClickInput,
  type BoardNeighborhoodPreview,
  type BoardHoldScore,
  type BoardSessionInput,
  type Cell,
  type EndlessStageSettings,
  type GameMode,
  type GameSettings,
  type InputMode,
  type LevelData,
  type MainGameplay,
  type MainGameplayDifficulty,
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
  beadJarLaunchInterval,
  loadBeadJarQueue,
  loadBeadPatterns,
  loadBeadSequence,
  loadCompletedBeadPatternIds,
  markBeadPatternCompleted,
  nextBeadsAcrossPatterns,
  orderedBeads,
  saveBeadJarQueue,
  saveBeadProgress,
  type BeadJarItem,
  type BeadPatternData,
  type BeadProgress,
} from './gameplay/beads';
import {
  PLAY_BEAD_SHOWCASE_PATTERNS,
  loadPlayBeadShowcaseProgress,
  nextPlayBeadShowcasePattern,
  playBeadShowcaseColorsForBoard,
  renderPlayBeadShowcase,
  savePlayBeadShowcaseProgress,
  shouldUsePlayBeadShowcase,
  type PlayBeadShowcasePattern,
} from './gameplay/beads/playBeadShowcase';
import {
  collectionArtworkName,
  collectionArtworkResourcePath,
  collectionArtworkUrl,
} from './gameplay/collection/collectionArtwork';
import { generateEndlessLevel } from './gameplay/endless/generateEndlessLevel';
import {
  PLAY_PUZZLE_PATTERNS,
  DEFAULT_PLAY_PUZZLE_ROTATION,
  advancePlayPuzzleProgress,
  loadPlayPuzzleProgress,
  loadPlayPuzzleRotation,
  nextPlayPuzzlePattern,
  playPuzzleTextureKey,
  puzzlePieceCount,
  renderPlayPuzzleShowcase,
  renderPlayPuzzleFinale,
  savePlayPuzzleProgress,
  savePlayPuzzleRotation,
  type PlayPuzzlePattern,
  type PlayPuzzleProgress,
  type PlayPuzzleRotation,
} from './gameplay/puzzle/playPuzzleShowcase';
import {
  createMode3HiddenCells,
  createMode4HiddenCells,
  loadDynamicDifficultyState,
  loadMode4DynamicDifficultyState,
  recordDynamicDifficultyGame,
  saveDynamicDifficultyState,
  saveMode4DynamicDifficultyState,
  type DynamicDifficultyDecision,
  type DynamicDifficultyGameResult,
} from './gameplay/mode3';
import {
  createMode5StageHiddenCells,
  loadMode5DynamicDifficultyState,
  loadMode5Workbook,
  mode5LevelCount,
  mode5LevelProgressForId,
  mode5LevelStartIndex,
  recordMode5DynamicDifficultyGame,
  saveMode5DynamicDifficultyState,
  type Mode5CampaignLevel,
} from './gameplay/mode5';

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
const BEAD_FLIGHT_DURATION_MS = 500;
const BEAD_RAPID_DEFAULT_INTERVAL_MS = 100;
const COLLECTION_MIN_LEVELS = 7;
const COLLECTION_PROGRESS_KEY = 'number-connect.collection-route.v1';
const DAILY_COMPLETION_KEY = 'number-connect.daily-completed.v1';
const ENDLESS_RUN_KEY = 'number-connect.endless-run.v1';
const NORMAL_LIFE_LIMIT = 3;

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

type ResultContext = 'normal' | 'collection' | 'daily' | 'endless-stage' | 'life-depleted' | 'editor-playtest';
type PlayContext = 'normal' | 'collection' | 'daily' | 'editor-playtest' | 'bead';
type AdaptiveMainGameplay = Extract<MainGameplay, 'mode3' | 'mode4' | 'mode5'>;

const isAdaptiveMainGameplay = (gameplay: MainGameplay): gameplay is AdaptiveMainGameplay => (
  gameplay === 'mode3' || gameplay === 'mode4' || gameplay === 'mode5'
);

const adaptiveGameplayName = (gameplay: AdaptiveMainGameplay): string => {
  if (gameplay === 'mode5') return '玩法5';
  return gameplay === 'mode4' ? '玩法4' : '玩法3';
};

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
  private readonly playBeadShowcaseArt = query<HTMLElement>('#play-bead-showcase-art');
  private readonly playPuzzleShowcaseArt = query<HTMLElement>('#play-puzzle-showcase-art');
  private readonly playPuzzleRotationHandle = query<HTMLElement>('#play-puzzle-rotation-handle');
  private readonly playPuzzleProgressBar = query<HTMLElement>('#play-puzzle-progress');
  private readonly playPuzzleProgressFill = query<HTMLElement>('#play-puzzle-progress-fill');
  private readonly playPuzzleFinale = query<HTMLElement>('#play-puzzle-finale');
  private readonly playPuzzleFinaleArt = query<HTMLElement>('#play-puzzle-finale-art');
  private readonly playPuzzleFinaleButton = query<HTMLButtonElement>('#play-puzzle-finale-button');
  private readonly playLevelButton = query<HTMLButtonElement>('#play-level-button');
  private readonly levelLabel = query<HTMLElement>('#play-level-label');
  private readonly holdScoreFormula = query<HTMLElement>('#hold-score-formula');
  private readonly holdScoreTotal = query<HTMLElement>('#hold-score-total');
  private readonly holdScoreChoice = query<HTMLElement>('#hold-score-choice');
  private readonly holdScoreDistance = query<HTMLElement>('#hold-score-distance');
  private readonly holdScoreBranch = query<HTMLElement>('#hold-score-branch');
  private readonly holdScoreBadge = query<HTMLElement>('#hold-score-badge');
  private readonly holdScoreDigits = query<HTMLElement>('#hold-score-digits');
  private readonly holdScoreExtra = query<HTMLElement>('#hold-score-extra');
  private readonly holdScoreFeasible = query<HTMLElement>('#hold-score-feasible');
  private readonly livesLabel = query<HTMLElement>('#play-lives');
  private readonly powerUpStatus = query<HTMLElement>('#power-up-status');
  private readonly undoStepButton = query<HTMLButtonElement>('#undo-step-button');
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
  private readonly mainGameplayControl = query<HTMLElement>('#settings-main-gameplay');
  private readonly mainGameplayDifficultyRow = query<HTMLElement>('#settings-main-difficulty-row');
  private readonly mainGameplayDifficultyControl = query<HTMLSelectElement>('#settings-main-difficulty');
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
  private readonly settingsRestartButton = query<HTMLButtonElement>('#settings-restart-button');
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
  private readonly beadPlacementOverlay = query<HTMLElement>('#bead-placement-overlay');
  private readonly beadJarButton = query<HTMLButtonElement>('#bead-jar-button');
  private readonly beadJarContents = query<HTMLElement>('#bead-jar-contents');
  private readonly beadJarCount = query<HTMLElement>('#bead-jar-count');
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
  private beadLevels: LevelData[] = [];
  private mode3Levels: LevelData[] = [];
  private mode5Levels: LevelData[] = [];
  private mode5Campaign: Mode5CampaignLevel[] = [];
  private levels: LevelData[] = [];
  private editorLevels: LevelData[] = [];
  private settings: GameSettings = { ...loadSettings(), mainGameplay: 'puzzle' };
  private activeMainGameplay: MainGameplay = this.settings.mainGameplay;
  private mode: GameMode = 'normal';
  private stage = initialEndlessRunState.stage;
  private lives = 3;
  private editorPlaytestErrorCount = 0;
  private mode3DifficultyState = loadDynamicDifficultyState();
  private mode4DifficultyState = loadMode4DynamicDifficultyState();
  private mode5DifficultyState = loadMode5DynamicDifficultyState();
  private currentAdaptiveDifficulty = this.mode3DifficultyState.currentDifficulty;
  private currentAdaptiveUsesDynamicDifficulty = true;
  private currentAdaptiveAttemptErrors = 0;
  private currentAdaptiveAttemptRecorded = true;
  private currentAdaptiveAttemptEligible = false;
  private currentAdaptiveLifeDepleted = false;
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
  private currentBeadReward: BeadJarItem[] = [];
  private currentBeadLevelIndex = 0;
  private currentPlayBeadReward: PlayBeadShowcasePattern['pixels'] = [];
  private playBeadShowcasePattern = PLAY_BEAD_SHOWCASE_PATTERNS[0];
  private playBeadShowcaseCollected = 0;
  private playPuzzleProgress: PlayPuzzleProgress = loadPlayPuzzleProgress();
  private playPuzzlePattern: PlayPuzzlePattern = PLAY_PUZZLE_PATTERNS.find(
    (pattern) => pattern.id === this.playPuzzleProgress.patternId,
  ) ?? PLAY_PUZZLE_PATTERNS[0];
  private playPuzzleRotation: PlayPuzzleRotation = loadPlayPuzzleRotation();
  private playPuzzleRotationDrag?: {
    pointerId: number;
    axis: keyof PlayPuzzleRotation;
    clientX: number;
    clientY: number;
    startValue: number;
  };
  private playPuzzleFinaleBusy = false;
  private playPuzzleCornerPressTimer?: number;
  private playPuzzleProgressGlowTimer?: number;
  private lastPlayPuzzleProgressCompleted?: number;
  private readonly playPuzzlePieceFloatTimers = new Set<number>();
  private beadJar: BeadJarItem[] = [];
  private beadRewardAnimating = false;
  private beadJarInFlight = 0;
  private beadJarLaunchIntervalMs = BEAD_RAPID_DEFAULT_INTERVAL_MS;
  private readonly completedBeadFlights = new Set<number>();
  private beadPatternFinishing = false;
  private beadJarPressHeld = false;
  private beadJarLongPressTriggered = false;
  private beadJarPressTimer?: number;
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
    this.applyPlayPuzzleRotation();
    startLobbyAmbientNetwork();
    this.boardScene.registerArtworkTextures(PLAY_PUZZLE_PATTERNS.map((pattern) => ({
      key: playPuzzleTextureKey(pattern),
      url: pattern.imageUrl,
    })));
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
      getLevels: () => this.editorLevels,
      getNextLevelId: () => getNextLevelId(this.editorLevels),
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
    const [mode5Workbook, beadLevels, mode3Levels, beadPatterns] = await Promise.all([
      loadMode5Workbook(),
      loadBeadLevels(),
      loadMode3Levels(),
      loadBeadPatterns(),
      this.boardScene.whenReady(),
    ]);
    const beadSequence = loadBeadSequence(beadPatterns);
    this.builtInLevels = mode5Workbook.levels;
    this.beadLevels = beadLevels;
    this.mode3Levels = mode3Levels;
    this.mode5Levels = mode5Workbook.levels;
    this.mode5Campaign = mode5Workbook.campaign;
    this.beadPatterns = beadPatterns;
    this.beadPattern = beadSequence.pattern;
    this.beadProgress = beadSequence.progress;
    this.beadJar = loadBeadJarQueue(beadPatterns, beadSequence.progress);
    this.completedBeadPatternIds = new Set(loadCompletedBeadPatternIds(beadPatterns));
    const showcaseProgress = loadPlayBeadShowcaseProgress();
    this.playBeadShowcasePattern = PLAY_BEAD_SHOWCASE_PATTERNS.find(
      (pattern) => pattern.id === showcaseProgress.patternId,
    ) ?? PLAY_BEAD_SHOWCASE_PATTERNS[0];
    this.playBeadShowcaseCollected = showcaseProgress.collected;
    this.normalizePlayPuzzleLevel();
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
    // The Phaser canvas exists beneath the DOM screens from startup onward.
    // Keep its input disabled until an actual gameplay screen is entered.
    this.boardScene.setPaused(this.currentScreen !== 'play');
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
    this.beadJarButton.addEventListener('pointerdown', (event) => this.handleBeadJarPointerDown(event));
    this.beadJarButton.addEventListener('pointerup', (event) => this.handleBeadJarPointerUp(event));
    this.beadJarButton.addEventListener('pointercancel', () => this.cancelBeadJarPress());
    this.beadJarButton.addEventListener('lostpointercapture', () => this.cancelBeadJarPress());
    this.beadJarButton.addEventListener('click', (event) => {
      if (event.detail === 0) void this.placeNextBeadFromJar();
    });
    this.beadJarButton.addEventListener('contextmenu', (event) => event.preventDefault());
    this.beadGalleryButton.addEventListener('click', () => this.openFavorites('beads'));
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
    query('#default-gallery-button').addEventListener('click', () => this.openFavorites());
    query('#default-editor-button').addEventListener('click', () => this.openEditor());
    query('#default-lobby-settings-button').addEventListener('click', () => this.openSettings('lobby'));
    query('#daily-back-button').addEventListener('click', () => this.backToLobby());
    query('#favorites-back-button').addEventListener('click', () => this.backToLobby());
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
    this.undoStepButton.addEventListener('click', () => this.undoLastConnectionStep());
    this.watercolorBrushButton.addEventListener('click', () => void this.useWatercolorBrush());
    this.paintBucketButton.addEventListener('click', () => this.togglePaintBucket());
    this.bindSingleTouchInput();
    this.bindTouchPreviewDrag();
    this.bindTouchPreviewViewportDrag();
    this.bindPlayPuzzleRotationHandle();
    this.playPuzzleFinaleButton.addEventListener('click', () => void this.completePlayPuzzleFinale());
    this.restartButton.addEventListener('click', () => this.handleResultPrimary());
    this.nextButton.addEventListener('click', () => this.handleResultSecondary());
    this.resultLobbyButton.addEventListener('click', () => this.leavePlayScreen());
  }

  private applyPlayPuzzleRotation(): void {
    const showcase = this.playPuzzleShowcaseArt.closest<HTMLElement>('.play-puzzle-showcase');
    if (!showcase) return;
    showcase.style.setProperty('--puzzle-rotate-x', `${this.playPuzzleRotation.x}deg`);
    showcase.style.setProperty('--puzzle-rotate-y', `${this.playPuzzleRotation.y}deg`);
    showcase.style.setProperty('--puzzle-rotate-z', `${this.playPuzzleRotation.z}deg`);
    this.playPuzzleRotationHandle.querySelectorAll<HTMLButtonElement>('[data-puzzle-axis]').forEach((button) => {
      const axis = button.dataset.puzzleAxis as keyof PlayPuzzleRotation;
      button.setAttribute('aria-valuetext', `${axis.toUpperCase()} 轴 ${Math.round(this.playPuzzleRotation[axis])} 度`);
    });
  }

  private bindPlayPuzzleRotationHandle(): void {
    const limits: Record<keyof PlayPuzzleRotation, [number, number]> = {
      x: [-50, 50],
      y: [-65, 65],
      z: [-15, 15],
    };
    const clampAxis = (axis: keyof PlayPuzzleRotation, value: number): number => (
      Math.max(limits[axis][0], Math.min(limits[axis][1], value))
    );

    this.playPuzzleRotationHandle.querySelectorAll<HTMLButtonElement>('[data-puzzle-axis]').forEach((handle) => {
      const axis = handle.dataset.puzzleAxis as keyof PlayPuzzleRotation;
      const finishDrag = (event: PointerEvent): void => {
        if (this.playPuzzleRotationDrag?.pointerId !== event.pointerId) return;
        this.playPuzzleRotationDrag = undefined;
        handle.classList.remove('is-dragging');
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        savePlayPuzzleRotation(this.playPuzzleRotation);
      };

      handle.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.playPuzzleRotationDrag = {
          pointerId: event.pointerId,
          axis,
          clientX: event.clientX,
          clientY: event.clientY,
          startValue: this.playPuzzleRotation[axis],
        };
        handle.setPointerCapture(event.pointerId);
        handle.classList.add('is-dragging');
      });
      handle.addEventListener('pointermove', (event) => {
        const drag = this.playPuzzleRotationDrag;
        if (!drag || drag.pointerId !== event.pointerId || drag.axis !== axis) return;
        event.preventDefault();
        event.stopPropagation();
        const deltaX = event.clientX - drag.clientX;
        const deltaY = event.clientY - drag.clientY;
        const delta = axis === 'x' ? deltaX : axis === 'y' ? -deltaY : (deltaX - deltaY) * 0.5;
        this.playPuzzleRotation[axis] = clampAxis(axis, drag.startValue + delta * 0.45);
        this.applyPlayPuzzleRotation();
      });
      handle.addEventListener('pointerup', finishDrag);
      handle.addEventListener('pointercancel', finishDrag);
      handle.addEventListener('lostpointercapture', () => {
        if (this.playPuzzleRotationDrag?.axis !== axis) return;
        this.playPuzzleRotationDrag = undefined;
        handle.classList.remove('is-dragging');
        savePlayPuzzleRotation(this.playPuzzleRotation);
      });
      handle.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.playPuzzleRotation[axis] = DEFAULT_PLAY_PUZZLE_ROTATION[axis];
        this.applyPlayPuzzleRotation();
        savePlayPuzzleRotation(this.playPuzzleRotation);
      });
      handle.addEventListener('keydown', (event) => {
        const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -1
          : event.key === 'ArrowRight' || event.key === 'ArrowUp'
            ? 1
            : 0;
        if (direction === 0) return;
        event.preventDefault();
        this.playPuzzleRotation[axis] = clampAxis(
          axis,
          this.playPuzzleRotation[axis] + direction * (event.shiftKey ? 5 : 2),
        );
        this.applyPlayPuzzleRotation();
        savePlayPuzzleRotation(this.playPuzzleRotation);
      });
    });
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

  private renderHoldScore(score: BoardHoldScore | null): void {
    const visible = this.settings.showDifficultyScore && score !== null && this.currentScreen === 'play';
    this.holdScoreFormula.classList.toggle('is-inactive', !visible);
    this.holdScoreFormula.setAttribute('aria-hidden', String(!visible));
    if (!score) return;
    this.holdScoreTotal.textContent = String(score.total);
    this.holdScoreChoice.textContent = String(score.choiceScore);
    this.holdScoreDistance.textContent = String(score.nextNumberDistance);
    this.holdScoreBranch.textContent = String(score.reasoningBranchScore);
    this.holdScoreBadge.textContent = String(score.badgeScore);
    this.holdScoreDigits.textContent = String(score.totalDigitScore);
    this.holdScoreExtra.textContent = String(score.extraScore);
    this.holdScoreFeasible.textContent = String(score.feasibleChoiceCount);
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

  private selectedMainGameplay(): MainGameplay {
    const value = this.mainGameplayControl.querySelector<HTMLInputElement>(
      'input[name="main-gameplay"]:checked',
    )?.value;
    return isMainGameplay(value) ? value : 'beads';
  }

  private setMainGameplayControl(gameplay: MainGameplay): void {
    this.mainGameplayControl.querySelectorAll<HTMLInputElement>('input[name="main-gameplay"]').forEach((input) => {
      input.checked = input.value === gameplay;
    });
  }

  private selectedMainGameplayDifficulty(): MainGameplayDifficulty {
    const value = this.mainGameplayDifficultyControl.value;
    if (value === 'dynamic') return 'dynamic';
    const difficulty = Number(value);
    return isMainGameplayDifficulty(difficulty) ? difficulty : 'dynamic';
  }

  private setMainGameplayDifficultyControl(difficulty: MainGameplayDifficulty): void {
    this.mainGameplayDifficultyControl.value = String(difficulty);
  }

  private mainGameplayLevels(gameplay: MainGameplay = this.settings.mainGameplay): LevelData[] {
    if (gameplay === 'mode5') return this.mode5Levels;
    return gameplay === 'mode3' || gameplay === 'mode4' ? this.mode3Levels : this.levels;
  }

  private mainGameplayLevelId(gameplay: MainGameplay = this.settings.mainGameplay): number {
    if (gameplay === 'beads') return this.settings.beadMainLevelId;
    if (gameplay === 'puzzle') return this.settings.puzzleMainLevelId;
    if (gameplay === 'mode3') return this.settings.mode3MainLevelId;
    if (gameplay === 'mode4') return this.settings.mode4MainLevelId;
    return this.settings.mode5MainLevelId;
  }

  private setMainGameplayLevelId(levelId: number, gameplay: MainGameplay): void {
    if (gameplay === 'beads') this.settings.beadMainLevelId = levelId;
    else if (gameplay === 'puzzle') this.settings.puzzleMainLevelId = levelId;
    else if (gameplay === 'mode3') this.settings.mode3MainLevelId = levelId;
    else if (gameplay === 'mode4') this.settings.mode4MainLevelId = levelId;
    else this.settings.mode5MainLevelId = levelId;
  }

  private mode5LevelProgress(levelId = this.settings.mode5MainLevelId) {
    return mode5LevelProgressForId(this.mode5Campaign, levelId);
  }

  private playPuzzlePatternForLevel(levelId = this.settings.puzzleMainLevelId): PlayPuzzlePattern {
    const index = Math.max(0, Math.min(PLAY_PUZZLE_PATTERNS.length - 1, Math.floor(levelId) - 1));
    return PLAY_PUZZLE_PATTERNS[index] ?? PLAY_PUZZLE_PATTERNS[0];
  }

  private normalizePlayPuzzleLevel(): void {
    if (this.playPuzzleProgress.revealed >= puzzlePieceCount(this.playPuzzlePattern)) {
      this.playPuzzlePattern = nextPlayPuzzlePattern(this.playPuzzlePattern);
      this.playPuzzleProgress = { patternId: this.playPuzzlePattern.id, revealed: 0 };
      savePlayPuzzleProgress(this.playPuzzleProgress);
    }
    const patternIndex = PLAY_PUZZLE_PATTERNS.findIndex(
      (pattern) => pattern.id === this.playPuzzlePattern.id,
    );
    const levelId = Math.max(0, patternIndex) + 1;
    if (this.settings.puzzleMainLevelId !== levelId) {
      this.settings.puzzleMainLevelId = levelId;
      saveSettings(this.settings);
    }
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
    query('#settings-clear-data-button').addEventListener('click', () => this.clearAllLocalData());
    query('#settings-quick-complete-row').addEventListener('click', () => {
      if (this.settingsContext !== 'play') return;
      this.settingsDialog.close();
      this.boardScene.setPaused(false);
      if (this.isAdaptiveGameplaySession()) this.currentAdaptiveAttemptEligible = false;
      this.boardScene.quickComplete();
    });
    this.settingsRestartButton.addEventListener('click', () => this.restartFromSettings());
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
    this.editorLevels = loadEditorLevelCollection();
    this.levels = loadLevelCollection(this.builtInLevels);
    if (!this.levels.some((level) => level.levelId === this.settings.beadMainLevelId)) {
      this.settings.beadMainLevelId = this.levels[0]?.levelId ?? 1;
    }
    if (!this.mode3Levels.some((level) => level.levelId === this.settings.mode3MainLevelId)) {
      this.settings.mode3MainLevelId = this.mode3Levels[0]?.levelId ?? 1;
    }
    if (!this.mode3Levels.some((level) => level.levelId === this.settings.mode4MainLevelId)) {
      this.settings.mode4MainLevelId = this.mode3Levels[0]?.levelId ?? 1;
    }
    if (!this.mode5Levels.some((level) => level.levelId === this.settings.mode5MainLevelId)) {
      this.settings.mode5MainLevelId = this.mode5Levels[0]?.levelId ?? 1;
    }
    if (
      !Number.isInteger(this.settings.puzzleMainLevelId)
      || this.settings.puzzleMainLevelId < 1
      || this.settings.puzzleMainLevelId > PLAY_PUZZLE_PATTERNS.length
    ) this.settings.puzzleMainLevelId = 1;
  }

  private showScreen(name: ScreenName): void {
    const previousScreen = this.currentScreen;
    this.cancelPrimaryActionTransition();
    if (name !== 'play') this.boardScene.setPaused(true);
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
      if (this.mainGameplayLevels().length === 0) {
        this.primaryActionButton.disabled = true;
        this.primaryActionLabel.textContent = '暂无关卡';
        this.primaryActionButton.setAttribute('aria-label', '暂无可用关卡');
        return;
      }
      const levelId = this.mainGameplayLevelId();
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
    if (this.activeMainGameplay === 'puzzle') {
      const pattern = PLAY_PUZZLE_PATTERNS[levelId - 1];
      if (!pattern) return;
      const changed = this.settings.puzzleMainLevelId !== levelId;
      this.settings.shape = BoardShape.Level;
      this.settings.puzzleMainLevelId = levelId;
      if (changed) {
        this.playPuzzlePattern = pattern;
        this.playPuzzleProgress = { patternId: pattern.id, revealed: 0 };
        savePlayPuzzleProgress(this.playPuzzleProgress);
      }
      saveSettings(this.settings);
      this.renderDefaultLobbyLevelNumber();
      if (changed) this.setCurrentBoard(this.createNormalLevel());
      this.levelPickerDialog.close();
      return;
    }

    const level = this.mainGameplayLevels(this.activeMainGameplay)
      .find((candidate) => candidate.levelId === levelId);
    if (!level) return;
    const changed = this.currentLevel?.levelId !== levelId;
    if (changed && this.isAdaptiveGameplaySession() && this.currentAdaptiveLifeDepleted) {
      this.recordAdaptiveAttempt('life-depleted');
    }
    this.settings.shape = BoardShape.Level;
    this.setMainGameplayLevelId(levelId, this.activeMainGameplay);
    saveSettings(this.settings);
    this.renderDefaultLobbyLevelNumber();
    if (changed) this.setCurrentBoard(level);
    this.levelPickerDialog.close();
  }

  private setSolutionReveal(revealed: boolean): void {
    if (revealed && this.activePowerUp === 'paint-bucket') this.cancelPowerUpTargeting();
    if (revealed && this.isAdaptiveGameplaySession()) this.currentAdaptiveAttemptEligible = false;
    this.solutionRevealed = revealed;
    this.solutionToggle.checked = revealed;
    this.boardScene.setSolutionReveal(revealed);
    if (revealed) this.setPowerUpMessage();
    this.renderPowerUps();
  }

  private async startNormalMode(): Promise<void> {
    if (this.mainGameplayLevels().length === 0) return;
    this.activeMainGameplay = this.settings.mainGameplay;
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
    if (!this.beadPattern || !this.beadProgress || this.beadLevels.length === 0) return;
    if (this.beadJar.length > 0) {
      this.renderBeadScreen(undefined, '请先把玻璃瓶中的拼豆放入图纸。');
      return;
    }
    const level = this.createBeadLevel();
    const reward = nextBeadsAcrossPatterns(
      this.beadPatterns,
      this.beadPattern,
      this.beadProgress,
      level.solutionPath.length,
    );
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
    this.editorPlaytestErrorCount = 0;
    this.renderLives();
    await this.showPlayScreen();
    this.setCurrentBoard(level);
  }

  private createNormalLevel(): LevelData {
    if (this.activeMainGameplay === 'puzzle') {
      const patternIndex = Math.max(0, Math.min(
        PLAY_PUZZLE_PATTERNS.length - 1,
        this.settings.puzzleMainLevelId - 1,
      ));
      const stageIndex = Math.max(0, Math.min(
        puzzlePieceCount(this.playPuzzlePattern) - 1,
        this.playPuzzleProgress.revealed,
      ));
      // The workbook defines the stage order, while an editor level with the
      // same id replaces that formation (including its configured hidden cells).
      const puzzleBoards = this.levels.filter(
        (level) => level.activeCells.length === level.rows * level.columns,
      );
      const boardIndex = puzzleBoards.length > 0
        ? (patternIndex * puzzlePieceCount(this.playPuzzlePattern) + stageIndex) % puzzleBoards.length
        : -1;
      const stageLevel = puzzleBoards[boardIndex];
      if (!stageLevel) throw new Error('没有可用的拼图阶段。');
      return stageLevel;
    }

    const selectedLevelId = this.mainGameplayLevelId(this.activeMainGameplay);
    const levels = this.mainGameplayLevels(this.activeMainGameplay);
    const selected = levels.find((level) => level.levelId === selectedLevelId) ?? levels[0];
    if (!selected) throw new Error('没有可用的关卡。');
    return selected;
  }

  private createBeadLevel(): LevelData {
    const level = this.beadLevels[this.currentBeadLevelIndex % this.beadLevels.length];
    if (!level) throw new Error('没有可用的拼豆关卡。');
    return level;
  }

  private createEndlessLevel(stage: number, profile: EndlessStageSettings): LevelData {
    return generateEndlessLevel(profile, this.endlessSeed + stage * 1000003);
  }

  private activeAdaptiveGameplay(): AdaptiveMainGameplay | undefined {
    if (this.playContext !== 'normal' || this.mode !== 'normal') return undefined;
    return isAdaptiveMainGameplay(this.activeMainGameplay)
      ? this.activeMainGameplay
      : undefined;
  }

  private isAdaptiveGameplaySession(): boolean {
    return this.activeAdaptiveGameplay() !== undefined;
  }

  private adaptiveDifficultyFor(gameplay: AdaptiveMainGameplay): number {
    if (this.settings.mainGameplayDifficulty !== 'dynamic') {
      return this.settings.mainGameplayDifficulty;
    }
    if (gameplay === 'mode5') return this.mode5DifficultyState.currentDifficulty;
    return gameplay === 'mode4'
      ? this.mode4DifficultyState.currentDifficulty
      : this.mode3DifficultyState.currentDifficulty;
  }

  private makeSession(level: LevelData, profile?: EndlessStageSettings): BoardSessionInput {
    const hiddenPercent = profile?.hiddenPercent ?? this.settings.hiddenPercent;
    const maxHiddenRun = profile?.maxHiddenRun ?? this.settings.maxHiddenRun;
    const maxVisibleRun = profile?.maxVisibleRun ?? this.settings.maxVisibleRun;
    const usesPuzzleStage = this.playContext === 'normal'
      && this.mode === 'normal'
      && this.activeMainGameplay === 'puzzle';
    const adaptiveGameplay = this.activeAdaptiveGameplay();
    const puzzleStage = Math.min(
      puzzlePieceCount(this.playPuzzlePattern),
      this.playPuzzleProgress.revealed + 1,
    );
    const seed = (
      this.mode === 'endless'
        ? this.endlessSeed + this.stage * 1000003
        : usesPuzzleStage
          ? this.settings.puzzleMainLevelId * 1000003 + puzzleStage * 9176 + level.levelId
          : level.levelId
    ) | 0;
    const eventContext = {
      mode: this.mode,
      levelId: usesPuzzleStage ? this.settings.puzzleMainLevelId : level.levelId,
      stage: this.mode === 'endless' ? this.stage : usesPuzzleStage ? puzzleStage : undefined,
    };
    const usesPlayShowcase = this.activeMainGameplay === 'beads'
      && shouldUsePlayBeadShowcase(this.playContext, this.mode);
    return {
      level,
      hiddenCells: adaptiveGameplay === 'mode3'
        ? createMode3HiddenCells(level, this.currentAdaptiveDifficulty)
        : adaptiveGameplay === 'mode4'
          ? createMode4HiddenCells(level, this.currentAdaptiveDifficulty)
          : adaptiveGameplay === 'mode5'
            ? createMode5StageHiddenCells(
                level,
                this.currentAdaptiveDifficulty,
                this.mode5LevelProgress(level.levelId).level === 1,
              )
        : level.hiddenCells === undefined
          ? selectHiddenCells(level.solutionPath, hiddenPercent, maxHiddenRun, maxVisibleRun, seed)
          : new Set(level.hiddenCells.map(cellKey)),
      artwork: usesPuzzleStage
        ? {
            textureKey: playPuzzleTextureKey(this.playPuzzlePattern),
            sourceColumns: this.playPuzzlePattern.columns,
            sourceRows: this.playPuzzlePattern.rows,
            sourceIndex: this.playPuzzleProgress.revealed,
          }
        : undefined,
      completionGemColors: this.playContext === 'bead'
        ? this.currentBeadReward.map((bead) => bead.color)
        : usesPlayShowcase
          ? playBeadShowcaseColorsForBoard(
            this.currentPlayBeadReward,
            level.solutionPath.length,
          )
          : undefined,
      completionGemDestination: usesPlayShowcase ? 'showcase' : 'jar',
      showNextNumber: this.settings.showNextNumber,
      soundEnabled: this.settings.soundEnabled,
      inputMode: this.settings.inputMode,
      touchPreviewRingDepth: this.settings.touchPreviewSize === 'large' ? 2 : 1,
      boardZoomEnabled: this.isTouchPreviewZoomMode(),
      mode: this.mode,
      onProgress: (current, total) => {
        this.currentProgress = current;
        this.currentTotal = total;
        this.renderPowerUps();
        if (this.playContext !== 'editor-playtest') {
          this.events.emit('level.progressed', { ...eventContext, current, total });
        }
      },
      onWrong: (message, shouldLoseLife) => {
        if (this.playContext !== 'editor-playtest') {
          this.events.emit('level.wrong-move', { ...eventContext, current: this.currentProgress, message });
        }
        if (shouldLoseLife) this.handleWrong();
      },
      onComplete: () => {
        if (this.playContext !== 'editor-playtest') {
          this.events.emit('level.completed', { ...eventContext, total: level.solutionPath.length });
        }
        void this.handleComplete();
      },
      onNeighborhoodPreview: (preview) => this.handleNeighborhoodPreview(preview),
      onHoldScore: (score) => this.renderHoldScore(score),
    };
  }

  private setCurrentBoard(level: LevelData, profile?: EndlessStageSettings): void {
    this.currentLevel = level;
    const adaptiveGameplay = this.activeAdaptiveGameplay();
    if (adaptiveGameplay) {
      this.currentAdaptiveUsesDynamicDifficulty = this.settings.mainGameplayDifficulty === 'dynamic';
      this.currentAdaptiveDifficulty = this.adaptiveDifficultyFor(adaptiveGameplay);
      this.currentAdaptiveAttemptErrors = 0;
      this.currentAdaptiveAttemptRecorded = false;
      this.currentAdaptiveAttemptEligible = this.currentAdaptiveUsesDynamicDifficulty;
      this.currentAdaptiveLifeDepleted = false;
    } else {
      this.currentAdaptiveUsesDynamicDifficulty = false;
      this.currentAdaptiveAttemptRecorded = true;
      this.currentAdaptiveAttemptEligible = false;
      this.currentAdaptiveLifeDepleted = false;
    }
    this.resetPowerUps();
    this.currentProgress = 0;
    this.currentTotal = level.solutionPath.length;
    this.updateGameHeading(level);
    this.prepareMainGameplayShowcase(level);
    this.boardScene.setBoard(this.makeSession(level, profile));
    this.renderPowerUps();
    if (this.playContext !== 'editor-playtest') {
      const usesPuzzleStage = this.playContext === 'normal'
        && this.mode === 'normal'
        && this.activeMainGameplay === 'puzzle';
      this.events.emit('level.started', {
        mode: this.mode,
        levelId: usesPuzzleStage ? this.settings.puzzleMainLevelId : level.levelId,
        stage: this.mode === 'endless'
          ? this.stage
          : usesPuzzleStage
            ? Math.min(puzzlePieceCount(this.playPuzzlePattern), this.playPuzzleProgress.revealed + 1)
            : undefined,
        total: level.solutionPath.length,
      });
    }
  }

  private prepareMainGameplayShowcase(level: LevelData): void {
    const isEditorPlaytest = this.playContext === 'editor-playtest';
    const supportsMainShowcase = shouldUsePlayBeadShowcase(this.playContext, this.mode);
    const usesBeadShowcase = supportsMainShowcase && this.activeMainGameplay === 'beads';
    const usesPuzzleShowcase = supportsMainShowcase && this.activeMainGameplay === 'puzzle';
    const usesMainShowcase = usesBeadShowcase || usesPuzzleShowcase;
    const showcaseSpacer = this.playBeadShowcaseArt.closest<HTMLElement>('.play-top-spacer');
    const beadShowcase = this.playBeadShowcaseArt.closest<HTMLElement>('.play-bead-showcase');
    const puzzleShowcase = this.playPuzzleShowcaseArt.closest<HTMLElement>('.play-puzzle-showcase');
    this.playScreen.classList.toggle('is-editor-playtest', isEditorPlaytest);
    this.playScreen.classList.toggle('is-play-showcase-hidden', !usesMainShowcase);
    this.playScreen.classList.toggle('is-puzzle-main-gameplay', usesPuzzleShowcase);
    if (showcaseSpacer) showcaseSpacer.hidden = !usesMainShowcase;
    if (beadShowcase) beadShowcase.hidden = !usesBeadShowcase;
    if (puzzleShowcase) puzzleShowcase.hidden = !usesPuzzleShowcase;
    this.playPuzzleRotationHandle.hidden = true;
    this.playPuzzleProgressBar.hidden = !usesPuzzleShowcase;
    this.currentPlayBeadReward = [];
    if (usesBeadShowcase) this.preparePlayBeadShowcase(level);
    if (usesPuzzleShowcase) this.preparePlayPuzzleShowcase();
  }

  private preparePlayBeadShowcase(level: LevelData): void {
    if (this.playBeadShowcaseCollected >= this.playBeadShowcasePattern.pixels.length) {
      this.playBeadShowcasePattern = nextPlayBeadShowcasePattern(this.playBeadShowcasePattern);
      this.playBeadShowcaseCollected = 0;
      savePlayBeadShowcaseProgress({
        patternId: this.playBeadShowcasePattern.id,
        collected: 0,
      });
    }
    renderPlayBeadShowcase(
      this.playBeadShowcaseArt,
      this.playBeadShowcasePattern,
      this.playBeadShowcaseCollected,
    );
    this.currentPlayBeadReward = this.playBeadShowcasePattern.pixels.slice(
      this.playBeadShowcaseCollected,
      this.playBeadShowcaseCollected + level.solutionPath.length,
    );
  }

  private preparePlayPuzzleShowcase(): void {
    const expectedPattern = this.playPuzzlePatternForLevel();
    if (this.playPuzzleProgress.patternId !== expectedPattern.id) {
      this.playPuzzlePattern = expectedPattern;
      this.playPuzzleProgress = { patternId: expectedPattern.id, revealed: 0 };
      savePlayPuzzleProgress(this.playPuzzleProgress);
    } else {
      this.playPuzzlePattern = expectedPattern;
    }
    renderPlayPuzzleShowcase(
      this.playPuzzleShowcaseArt,
      this.playPuzzlePattern,
      this.playPuzzleProgress.revealed,
    );
    this.renderPlayPuzzleProgress();
  }

  private renderPlayPuzzleProgress(): void {
    const total = puzzlePieceCount(this.playPuzzlePattern);
    const completed = Math.min(total, this.playPuzzleProgress.revealed);
    const progressGrew = this.lastPlayPuzzleProgressCompleted !== undefined
      && completed > this.lastPlayPuzzleProgressCompleted;
    this.lastPlayPuzzleProgressCompleted = completed;
    this.playPuzzleProgressBar.setAttribute('aria-valuemax', String(total));
    this.playPuzzleProgressBar.setAttribute('aria-valuenow', String(completed));
    this.playPuzzleProgressFill.style.width = `${completed / Math.max(1, total) * 100}%`;
    if (progressGrew) {
      if (this.playPuzzleProgressGlowTimer !== undefined) {
        window.clearTimeout(this.playPuzzleProgressGlowTimer);
      }
      this.playPuzzleProgressBar.classList.remove('is-growing');
      void this.playPuzzleProgressBar.offsetWidth;
      this.playPuzzleProgressBar.classList.add('is-growing');
      this.playPuzzleProgressGlowTimer = window.setTimeout(() => {
        this.playPuzzleProgressBar.classList.remove('is-growing');
        this.playPuzzleProgressGlowTimer = undefined;
      }, 520);
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
    if (this.activeMainGameplay === 'puzzle') {
      const totalStages = puzzlePieceCount(this.playPuzzlePattern);
      const currentStage = Math.min(totalStages, this.playPuzzleProgress.revealed + 1);
      this.levelLabel.textContent = `Level ${this.settings.puzzleMainLevelId}-${currentStage}`;
      return;
    }
    if (isAdaptiveMainGameplay(this.activeMainGameplay)) {
      const gameplayName = adaptiveGameplayName(this.activeMainGameplay);
      const difficultyLabel = this.currentAdaptiveUsesDynamicDifficulty
        ? `${this.currentAdaptiveDifficulty}（动态）`
        : String(this.currentAdaptiveDifficulty);
      if (this.activeMainGameplay === 'mode5' && !level.custom) {
        const progress = this.mode5LevelProgress(level.levelId);
        this.levelLabel.textContent = `${gameplayName} · 难度 ${difficultyLabel} · 关卡 ${progress.level} · 阶段 ${progress.stage}/${progress.totalStages}`;
      } else {
        this.levelLabel.textContent = `${gameplayName} · 难度 ${difficultyLabel} · ${level.custom ? '自制关卡' : '关卡'} ${level.levelId}`;
      }
      return;
    }
    this.levelLabel.textContent = `拼豆 · ${level.custom ? '自制关卡' : '关卡'} ${level.levelId}`;
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
    const undoAvailable = !this.solutionRevealed && this.boardScene.canUndoStep();

    this.undoStepButton.disabled = !undoAvailable || animationBusy;
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
    this.undoStepButton.setAttribute(
      'aria-label',
      undoAvailable ? '撤回道具，撤回上一步连接' : '撤回道具，当前没有可撤回的连接',
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
    } else if (!message && concealedCount === 0 && !undoAvailable) {
      message = '当前没有可用的道具目标。';
    } else if (!message) {
      message = '道具可重复使用';
    }
    this.powerUpStatus.textContent = message;
    this.powerUpStatus.classList.toggle('is-active', tone === 'active');
    this.powerUpStatus.classList.toggle('is-success', tone === 'success');
  }

  private undoLastConnectionStep(): void {
    if (this.activePowerUp === 'paint-bucket') this.cancelPowerUpTargeting();
    if (!this.boardScene.undoLastStep()) {
      this.setPowerUpMessage('当前没有可撤回的连接。');
      this.renderPowerUps();
      return;
    }
    this.setPowerUpMessage('已撤回一步。', 'success');
    this.renderPowerUps();
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

  private renderLives(animation?: { lost?: boolean; gainedFrom?: number }): void {
    if (this.playContext === 'editor-playtest') {
      this.livesLabel.hidden = false;
      this.livesLabel.textContent = `错误 × ${this.editorPlaytestErrorCount}`;
      this.livesLabel.setAttribute('aria-label', `错误次数 ${this.editorPlaytestErrorCount}`);
      return;
    }
    if (this.mode === 'endless' && this.endlessSessionActive) {
      this.endlessLives = this.lives;
      this.recordEndlessProgress();
    }
    this.livesLabel.hidden = false;
    const lives = Math.max(0, Math.floor(this.lives));
    if (lives > 3) {
      this.livesLabel.textContent = formatLives(lives);
    } else {
      const heartSlots = Array.from({ length: 3 }, (_, index) => {
        const slot = document.createElement('span');
        slot.className = 'life-heart-slot';
        const isGainedHeart = animation?.gainedFrom !== undefined
          && index >= Math.max(0, animation.gainedFrom)
          && index < lives;
        const hasFilledBase = index < lives && !isGainedHeart;
        slot.classList.add(hasFilledBase ? 'life-heart-slot--filled' : 'life-heart-slot--empty');
        slot.textContent = '';

        if (animation?.lost && index === lives) {
          slot.classList.add('life-heart-slot--losing');
          const lostHeart = document.createElement('span');
          lostHeart.className = 'life-heart life-heart--lost';
          lostHeart.setAttribute('aria-hidden', 'true');
          const leftHalf = document.createElement('span');
          leftHalf.className = 'life-heart-piece life-heart-piece--left';
          leftHalf.textContent = '♥';
          const rightHalf = document.createElement('span');
          rightHalf.className = 'life-heart-piece life-heart-piece--right';
          rightHalf.textContent = '♥';
          lostHeart.append(leftHalf, rightHalf);
          slot.append(lostHeart);
        }
        if (isGainedHeart) {
          const gainedHeart = document.createElement('span');
          gainedHeart.className = 'life-heart life-heart--gained';
          gainedHeart.setAttribute('aria-hidden', 'true');
          gainedHeart.style.setProperty('--heart-delay', `${(index - animation.gainedFrom!) * 110}ms`);
          gainedHeart.textContent = '♥';
          slot.append(gainedHeart);

          const particles = document.createElement('span');
          particles.className = 'life-heart-particles';
          particles.setAttribute('aria-hidden', 'true');
          particles.style.setProperty('--heart-delay', `${(index - animation.gainedFrom!) * 110}ms`);
          for (let particleIndex = 0; particleIndex < 8; particleIndex += 1) {
            const particle = document.createElement('i');
            particle.style.setProperty('--particle-angle', `${particleIndex * 45}deg`);
            particle.style.setProperty('--particle-distance', `${10 + (particleIndex % 2) * 3}px`);
            particles.append(particle);
          }
          slot.append(particles);
        }
        return slot;
      });
      this.livesLabel.replaceChildren(...heartSlots);
    }
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
    this.endlessCurrentLives.textContent = formatLives(endlessLives);
    this.endlessCurrentLives.setAttribute('aria-label', `当前生命 ${endlessLives}`);
    this.endlessBestStage.textContent = String(this.endlessHighScore);
    const label = this.endlessStartButton.querySelector<HTMLElement>('strong');
    const canResume = this.endlessSessionActive && this.endlessLives > 0;
    if (label) label.textContent = canResume ? `继续第 ${this.stage} 阶段` : '开始游戏';
    this.renderPrimaryAction();
  }

  private handleWrong(): void {
    if (this.playContext === 'editor-playtest') {
      this.editorPlaytestErrorCount += 1;
      this.renderLives();
      return;
    }
    if (this.lives <= 0) return;
    if (this.isAdaptiveGameplaySession() && !this.currentAdaptiveAttemptRecorded) {
      this.currentAdaptiveAttemptErrors += 1;
    }
    this.lives -= 1;
    this.renderLives({ lost: true });
    if (this.lives === 0) this.handleLifeDepleted();
  }

  private gainNormalLife(): void {
    const previousLives = this.lives;
    this.lives = Math.min(NORMAL_LIFE_LIMIT, this.lives + 1);
    if (this.lives > previousLives) this.renderLives({ gainedFrom: previousLives });
  }

  private handleLifeDepleted(): void {
    if (this.isAdaptiveGameplaySession()) this.currentAdaptiveLifeDepleted = true;
    this.cancelPowerUpTargeting();
    this.renderPowerUps();
    this.boardScene.setPaused(true);
    this.resultContext = 'life-depleted';
    this.resultTitle.textContent = '生命已耗尽';
    const progress = `当前数字进度 ${this.currentProgress} / ${this.currentTotal}`;
    this.resultMessage.textContent = this.mode === 'endless' ? `阶段 ${this.stage} · ${progress}` : progress;
    this.resultReward.hidden = true;
    this.restartButton.textContent = '重新开始';
    this.nextButton.textContent = '观看视频复活并恢复 3♥';
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
    this.resultMessage.textContent = `当前编辑器关卡可以完整通关，本次错误 ${this.editorPlaytestErrorCount} 次。`;
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

  private recordAdaptiveAttempt(
    result: DynamicDifficultyGameResult,
  ): DynamicDifficultyDecision | undefined {
    const gameplay = this.activeAdaptiveGameplay();
    if (
      !gameplay
      || this.currentAdaptiveAttemptRecorded
      || !this.currentLevel
    ) return undefined;

    this.currentAdaptiveAttemptRecorded = true;
    if (!this.currentAdaptiveUsesDynamicDifficulty || !this.currentAdaptiveAttemptEligible) {
      return undefined;
    }

    const currentState = gameplay === 'mode5'
      ? this.mode5DifficultyState
      : gameplay === 'mode4'
        ? this.mode4DifficultyState
        : this.mode3DifficultyState;
    const record = {
      errors: this.currentAdaptiveAttemptErrors,
      result,
      levelId: this.currentLevel.levelId,
      finishedAtUtc: new Date().toISOString(),
    };
    const decision = gameplay === 'mode5'
      ? recordMode5DynamicDifficultyGame(currentState, record)
      : recordDynamicDifficultyGame(currentState, record);
    if (gameplay === 'mode5') {
      this.mode5DifficultyState = decision.state;
      saveMode5DynamicDifficultyState(this.mode5DifficultyState);
    } else if (gameplay === 'mode4') {
      this.mode4DifficultyState = decision.state;
      saveMode4DynamicDifficultyState(this.mode4DifficultyState);
    } else {
      this.mode3DifficultyState = decision.state;
      saveDynamicDifficultyState(this.mode3DifficultyState);
    }
    return decision;
  }

  private showAdaptiveResult(decision: DynamicDifficultyDecision | undefined): void {
    this.showNormalResult();
    const gameplayName = isAdaptiveMainGameplay(this.activeMainGameplay)
      ? adaptiveGameplayName(this.activeMainGameplay)
      : '玩法';
    this.resultTitle.textContent = `${gameplayName}完成！`;
    const attempt = `本局错误 ${this.currentAdaptiveAttemptErrors} 次。`;
    if (!this.currentAdaptiveUsesDynamicDifficulty) {
      this.resultMessage.textContent = `${attempt} 当前使用固定难度 ${this.currentAdaptiveDifficulty}，本局不计入动态难度。`;
      return;
    }
    if (!decision) {
      this.resultMessage.textContent = `${attempt} 本局使用过答案或快速完成，不计入动态难度。`;
      return;
    }
    if (decision.delta !== 0) {
      const direction = decision.delta > 0 ? '提升' : '降低';
      this.resultMessage.textContent = `${attempt} 动态难度由 ${decision.previousDifficulty} ${direction}到 ${decision.currentDifficulty}，下一关生效。`;
      return;
    }
    if (decision.reason === 'warm-up') {
      this.resultMessage.textContent = `${attempt} 动态难度采样 ${decision.state.recentGames.length}/5，当前维持 ${decision.currentDifficulty}。`;
      return;
    }
    if (decision.reason === 'cooldown') {
      this.resultMessage.textContent = `${attempt} 调整冷却期继续采样，难度维持 ${decision.currentDifficulty}。`;
      return;
    }
    this.resultMessage.textContent = `${attempt} 最近5局计分错误 ${decision.windowErrors} 次，难度维持 ${decision.currentDifficulty}。`;
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
    } else if (this.resultContext === 'life-depleted') {
      this.restartAfterFailure();
    } else if (this.resultContext === 'editor-playtest') {
      this.editorPlaytestErrorCount = 0;
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

  private async showPlayBeadCompletion(commitProgress = true): Promise<boolean> {
    const level = this.currentLevel;
    if (!level || this.currentPlayBeadReward.length === 0) {
      await this.boardScene.showCompletion();
      return false;
    }
    const sources = level.solutionPath
      .map((cell) => this.boardScene.cellClientPosition(cell));
    await this.boardScene.showCompletion();
    await this.flyBoardBeadsToShowcase(sources);
    if (!commitProgress) return false;
    this.playBeadShowcaseCollected = Math.min(
      this.playBeadShowcasePattern.pixels.length,
      this.playBeadShowcaseCollected + this.currentPlayBeadReward.length,
    );
    savePlayBeadShowcaseProgress({
      patternId: this.playBeadShowcasePattern.id,
      collected: this.playBeadShowcaseCollected,
    });
    return this.playBeadShowcaseCollected >= this.playBeadShowcasePattern.pixels.length;
  }

  private async showPlayPuzzleCompletion(): Promise<boolean> {
    const revealedPieceIndex = this.playPuzzleProgress.revealed;
    await this.boardScene.showCompletion();
    if (
      this.playContext !== 'normal'
      || this.mode !== 'normal'
      || this.activeMainGameplay !== 'puzzle'
    ) return false;

    await this.flyBoardPuzzlePieceToShowcase(
      this.boardScene.artworkClientBounds(),
      revealedPieceIndex,
    );

    this.playPuzzleProgress = advancePlayPuzzleProgress(
      this.playPuzzlePattern,
      this.playPuzzleProgress,
    );
    savePlayPuzzleProgress(this.playPuzzleProgress);
    this.gainNormalLife();
    renderPlayPuzzleShowcase(
      this.playPuzzleShowcaseArt,
      this.playPuzzlePattern,
      this.playPuzzleProgress.revealed,
    );
    this.renderPlayPuzzleProgress();
    const revealedPiece = this.playPuzzleShowcaseArt.querySelector<HTMLElement>(
      `[data-puzzle-piece="${this.playPuzzleProgress.revealed - 1}"]`,
    );
    const puzzleShowcase = this.playPuzzleShowcaseArt.closest<HTMLElement>('.play-puzzle-showcase');
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      revealedPiece?.classList.add('is-newly-revealed');
      puzzleShowcase?.classList.add('is-piece-landed');
      await waitFor(620);
      revealedPiece?.classList.remove('is-newly-revealed');
      puzzleShowcase?.classList.remove('is-piece-landed');
    }
    return this.playPuzzleProgress.revealed >= puzzlePieceCount(this.playPuzzlePattern);
  }

  private async flyBoardPuzzlePieceToShowcase(
    source: { left: number; top: number; width: number; height: number } | undefined,
    pieceIndex: number,
  ): Promise<void> {
    const target = this.playPuzzleShowcaseArt.querySelector<HTMLElement>(
      `[data-puzzle-piece="${pieceIndex}"]`,
    );
    if (!source || !target || source.width <= 0 || source.height <= 0) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const layer = document.createElement('div');
    layer.className = 'play-puzzle-piece-flight-layer';
    layer.setAttribute('aria-hidden', 'true');
    const flight = document.createElement('i');
    flight.className = 'play-puzzle-piece-flight';
    const pieceColumn = pieceIndex % this.playPuzzlePattern.columns;
    const pieceRow = Math.floor(pieceIndex / this.playPuzzlePattern.columns);
    flight.style.backgroundImage = `url("${this.playPuzzlePattern.imageUrl}")`;
    flight.style.backgroundSize = (
      `${this.playPuzzlePattern.columns * 100}% ${this.playPuzzlePattern.rows * 100}%`
    );
    flight.style.backgroundPosition = (
      `${pieceColumn * 100 / Math.max(1, this.playPuzzlePattern.columns - 1)}% `
      + `${pieceRow * 100 / Math.max(1, this.playPuzzlePattern.rows - 1)}%`
    );
    layer.append(flight);
    this.appShell.append(layer);

    const appRect = this.appShell.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const scale = this.uiVisualScale();
    const startWidth = source.width / scale;
    const startHeight = source.height / scale;
    const startX = (source.left - appRect.left + source.width * 0.5) / scale;
    const startY = (source.top - appRect.top + source.height * 0.5) / scale;
    const targetX = (targetRect.left - appRect.left + targetRect.width * 0.5) / scale;
    const targetY = (targetRect.top - appRect.top + targetRect.height * 0.5) / scale;
    const deltaX = targetX - startX;
    const deltaY = targetY - startY;
    const landingScale = Math.max(0.06, Math.min(
      0.9,
      targetRect.width / source.width,
      targetRect.height / source.height,
    ));
    const middleScale = 1 + (landingScale - 1) * 0.5;
    const desiredArcLift = Math.max(84, Math.min(180, Math.hypot(deltaX, deltaY) * 0.3));
    const midpointBaseY = startY + deltaY * 0.5;
    const visibleArcLift = midpointBaseY - startHeight * middleScale * 0.5 - 12;
    const arcLift = Math.max(58, Math.min(desiredArcLift, visibleArcLift));
    const flightTransform = (
      progress: number,
      lift: number,
      rotation: number,
    ): string => (
      `translate(calc(-50% + ${deltaX * progress}px), `
      + `calc(-50% + ${deltaY * progress - arcLift * lift}px)) `
      + `rotate(${rotation}deg) scale(${1 + (landingScale - 1) * progress})`
    );
    flight.style.left = `${startX}px`;
    flight.style.top = `${startY}px`;
    flight.style.width = `${startWidth}px`;
    flight.style.height = `${startHeight}px`;
    this.boardScene.setArtworkCompletionVisible(false);

    try {
      if (reducedMotion) return;
      const animation = flight.animate([
        {
          opacity: 1,
          transform: flightTransform(0, 0, 0),
        },
        {
          opacity: 1,
          transform: flightTransform(0.25, 0.75, -3),
          offset: 0.25,
        },
        {
          opacity: 1,
          transform: flightTransform(0.5, 1, -5),
          offset: 0.5,
        },
        {
          opacity: 1,
          transform: flightTransform(0.75, 0.75, -2),
          offset: 0.75,
        },
        {
          opacity: 1,
          transform: flightTransform(1, 0, this.playPuzzleRotation.z),
        },
      ], {
        duration: 560,
        easing: 'cubic-bezier(.24,.7,.2,1)',
        fill: 'both',
      });
      try {
        await animation.finished;
      } catch {
        // A canceled flight still commits the completed piece to the top board.
      }
    } finally {
      layer.remove();
    }
  }

  private async showPlayPuzzleFinale(): Promise<void> {
    if (this.playPuzzleFinaleBusy) return;
    this.playPuzzleFinaleBusy = true;
    this.resetPlayPuzzleCornerPress();
    this.stopPlayPuzzlePieceFloats();
    this.boardScene.setPaused(true);
    renderPlayPuzzleFinale(this.playPuzzleFinaleArt, this.playPuzzlePattern);
    this.playPuzzleFinale.classList.remove('is-visible', 'is-floating', 'is-assembling', 'is-assembled', 'is-leaving');
    this.playPuzzleFinaleButton.hidden = true;
    this.playPuzzleFinale.hidden = false;
    await nextFrame();
    this.playPuzzleFinale.classList.add('is-visible');

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reducedMotion) await waitFor(180);
    this.playPuzzleFinale.classList.add('is-floating');
    if (!reducedMotion) {
      await nextFrame();
      this.startPlayPuzzlePieceFloats();
      await this.waitForPlayPuzzlePieceGlows();
      this.stopPlayPuzzlePieceFloats(true);
    }
    this.playPuzzleFinale.classList.add('is-assembling');
    if (reducedMotion) {
      await waitFor(40);
    } else {
      await nextFrame();
      await this.waitForPlayPuzzlePieceAssembly();
    }
    if (this.playPuzzleFinale.hidden) return;
    this.playPuzzleFinale.classList.add('is-assembled');
    this.playPuzzleFinaleButton.hidden = false;
    await nextFrame();
    if (!reducedMotion) {
      this.startPlayPuzzleCornerPresses();
    }
    this.playPuzzleFinaleButton.focus();
  }

  private startPlayPuzzleCornerPresses(): void {
    this.stopPlayPuzzleCornerPresses();

    const pressNextCorner = (): void => {
      if (this.playPuzzleFinale.hidden || !this.playPuzzleFinale.classList.contains('is-assembled')) {
        this.playPuzzleCornerPressTimer = undefined;
        return;
      }

      const durationMs = 2000 + Math.round(Math.random() * 2000);
      this.movePlayPuzzleCornerPress(durationMs);
      this.playPuzzleCornerPressTimer = window.setTimeout(pressNextCorner, durationMs);
    };

    pressNextCorner();
  }

  private stopPlayPuzzleCornerPresses(): void {
    if (this.playPuzzleCornerPressTimer === undefined) return;
    window.clearTimeout(this.playPuzzleCornerPressTimer);
    this.playPuzzleCornerPressTimer = undefined;
  }

  private resetPlayPuzzleCornerPress(): void {
    this.stopPlayPuzzleCornerPresses();
    delete this.playPuzzleFinaleArt.dataset.pressCorner;
    this.playPuzzleFinaleArt.style.setProperty('--complete-press-duration', '0ms');
    this.playPuzzleFinaleArt.style.setProperty('--complete-press-origin', '50% 50%');
    this.playPuzzleFinaleArt.style.setProperty('--complete-press-x', '0deg');
    this.playPuzzleFinaleArt.style.setProperty('--complete-press-y', '0deg');
    this.playPuzzleFinaleArt.style.setProperty('--complete-press-z', '0deg');
    this.playPuzzleFinaleArt.style.setProperty('--complete-float-y', '0px');
    this.playPuzzleFinaleArt.style.setProperty('--complete-float-z', '0px');
  }

  private movePlayPuzzleCornerPress(durationMs: number): void {
    const corners = [
      { id: 'top-left', origin: '100% 100%', x: 1.2, y: -1.4, z: -.08 },
      { id: 'top-right', origin: '0% 100%', x: 1.2, y: 1.4, z: .08 },
      { id: 'bottom-left', origin: '100% 0%', x: -1.2, y: -1.4, z: .08 },
      { id: 'bottom-right', origin: '0% 0%', x: -1.2, y: 1.4, z: -.08 },
    ] as const;
    const previousCorner = this.playPuzzleFinaleArt.dataset.pressCorner;
    const candidates = corners.filter((corner) => corner.id !== previousCorner);
    const corner = candidates[Math.floor(Math.random() * candidates.length)] ?? corners[0];
    const strength = .82 + Math.random() * .24;
    const angle = (value: number): string => `${(value * strength).toFixed(2)}deg`;

    this.playPuzzleFinaleArt.dataset.pressCorner = corner.id;
    this.playPuzzleFinaleArt.style.setProperty('--complete-press-duration', `${durationMs}ms`);
    this.playPuzzleFinaleArt.style.setProperty('--complete-press-origin', corner.origin);
    this.playPuzzleFinaleArt.style.setProperty('--complete-press-x', angle(corner.x));
    this.playPuzzleFinaleArt.style.setProperty('--complete-press-y', angle(corner.y));
    this.playPuzzleFinaleArt.style.setProperty('--complete-press-z', angle(corner.z));
    this.playPuzzleFinaleArt.style.setProperty('--complete-float-y', `${(-1.2 + Math.random() * 2).toFixed(1)}px`);
    this.playPuzzleFinaleArt.style.setProperty('--complete-float-z', `${(-.5 + Math.random() * 2).toFixed(1)}px`);
  }

  private async waitForPlayPuzzlePieceGlows(): Promise<void> {
    const glowAnimations = Array.from(
      this.playPuzzleFinaleArt.querySelectorAll<HTMLElement>('.play-puzzle-finale__piece-face'),
    ).flatMap((face) => face.getAnimations().filter(
      (animation): animation is CSSAnimation => (
        animation instanceof CSSAnimation
        && animation.animationName === 'play-puzzle-piece-glow-burst'
      ),
    ));
    await Promise.all(glowAnimations.map((animation) => animation.finished.catch(() => undefined)));
  }

  private async waitForPlayPuzzlePieceAssembly(): Promise<void> {
    const assemblyAnimations = Array.from(
      this.playPuzzleFinaleArt.querySelectorAll<HTMLElement>('.play-puzzle-finale__piece'),
    ).flatMap((piece) => piece.getAnimations().filter(
      (animation): animation is CSSAnimation => (
        animation instanceof CSSAnimation
        && animation.animationName === 'play-puzzle-piece-assemble'
      ),
    ));
    await Promise.all(assemblyAnimations.map((animation) => animation.finished.catch(() => undefined)));
  }

  private startPlayPuzzlePieceFloats(): void {
    this.stopPlayPuzzlePieceFloats();
    const pieces = this.playPuzzleFinaleArt.querySelectorAll<HTMLElement>('.play-puzzle-finale__piece');

    pieces.forEach((piece) => {
      let timerId: number | undefined;
      const pressNextCorner = (): void => {
        if (timerId !== undefined) this.playPuzzlePieceFloatTimers.delete(timerId);
        if (
          this.playPuzzleFinale.hidden
          || !this.playPuzzleFinale.classList.contains('is-floating')
          || this.playPuzzleFinale.classList.contains('is-assembling')
        ) return;

        const durationMs = 2000 + Math.round(Math.random() * 2000);
        this.movePlayPuzzlePieceFloat(piece, durationMs);
        timerId = window.setTimeout(pressNextCorner, durationMs);
        this.playPuzzlePieceFloatTimers.add(timerId);
      };

      pressNextCorner();
    });
  }

  private stopPlayPuzzlePieceFloats(reset = false): void {
    this.playPuzzlePieceFloatTimers.forEach((timerId) => window.clearTimeout(timerId));
    this.playPuzzlePieceFloatTimers.clear();
    if (!reset) return;

    this.playPuzzleFinaleArt.querySelectorAll<HTMLElement>('.play-puzzle-finale__piece').forEach((piece) => {
      delete piece.dataset.pressCorner;
      piece.style.setProperty('--piece-press-duration', '700ms');
      piece.style.setProperty('--piece-press-origin', '50% 50%');
      piece.style.setProperty('--piece-press-x', '0deg');
      piece.style.setProperty('--piece-press-y', '0deg');
      piece.style.setProperty('--piece-press-z', '0deg');
      piece.style.setProperty('--piece-float-y', '0px');
      piece.style.setProperty('--piece-float-z', '0px');
    });
  }

  private movePlayPuzzlePieceFloat(piece: HTMLElement, durationMs: number): void {
    const corners = [
      { id: 'top-left', origin: '100% 100%', x: 1.2, y: -1.4, z: -.08 },
      { id: 'top-right', origin: '0% 100%', x: 1.2, y: 1.4, z: .08 },
      { id: 'bottom-left', origin: '100% 0%', x: -1.2, y: -1.4, z: .08 },
      { id: 'bottom-right', origin: '0% 0%', x: -1.2, y: 1.4, z: -.08 },
    ] as const;
    const candidates = corners.filter((corner) => corner.id !== piece.dataset.pressCorner);
    const corner = candidates[Math.floor(Math.random() * candidates.length)] ?? corners[0];
    const strength = .82 + Math.random() * .24;
    const angle = (value: number): string => `${(value * strength).toFixed(2)}deg`;

    piece.dataset.pressCorner = corner.id;
    piece.style.setProperty('--piece-press-duration', `${durationMs}ms`);
    piece.style.setProperty('--piece-press-origin', corner.origin);
    piece.style.setProperty('--piece-press-x', angle(corner.x));
    piece.style.setProperty('--piece-press-y', angle(corner.y));
    piece.style.setProperty('--piece-press-z', angle(corner.z));
    piece.style.setProperty('--piece-float-y', `${(-1.2 + Math.random() * 2).toFixed(1)}px`);
    piece.style.setProperty('--piece-float-z', `${(-.5 + Math.random() * 2).toFixed(1)}px`);
  }

  private async completePlayPuzzleFinale(): Promise<void> {
    if (this.playPuzzleFinaleButton.hidden) return;
    this.stopPlayPuzzleCornerPresses();
    this.stopPlayPuzzlePieceFloats();
    this.playPuzzleFinaleButton.disabled = true;
    this.playPuzzleFinale.classList.add('is-leaving');
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) await waitFor(220);
    this.playPuzzleFinale.hidden = true;
    this.playPuzzleFinale.classList.remove('is-visible', 'is-floating', 'is-assembling', 'is-assembled', 'is-leaving');
    this.playPuzzleFinaleButton.hidden = true;
    this.playPuzzleFinaleButton.disabled = false;
    this.playPuzzleFinaleBusy = false;
    this.boardScene.setPaused(false);
    this.nextLevel();
  }

  private async flyBoardBeadsToShowcase(
    sources: Array<{ x: number; y: number } | undefined>,
  ): Promise<void> {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const layer = document.createElement('div');
    layer.className = 'bead-flight-layer play-showcase-flight-layer';
    layer.setAttribute('aria-hidden', 'true');
    this.appShell.append(layer);
    const appRect = this.appShell.getBoundingClientRect();
    const scale = this.uiVisualScale();
    const stagger = reducedMotion
      ? 0
      : Math.max(10, Math.min(26, Math.round(960 / Math.max(1, sources.length))));

    const flights = sources.map(async (source, index) => {
      const targetOffset = Math.min(
        this.currentPlayBeadReward.length - 1,
        Math.floor(index * this.currentPlayBeadReward.length / Math.max(1, sources.length)),
      );
      const bead = this.currentPlayBeadReward[targetOffset];
      const target = this.playBeadShowcaseArt.querySelector<HTMLElement>(
        `[data-bead-order="${this.playBeadShowcaseCollected + targetOffset}"]`,
      );
      if (!source || !target || !bead) return;
      const targetRect = target.getBoundingClientRect();
      const startX = (source.x - appRect.left) / scale;
      const startY = (source.y - appRect.top) / scale;
      const targetX = (targetRect.left - appRect.left + targetRect.width * 0.5) / scale;
      const targetY = (targetRect.top - appRect.top + targetRect.height * 0.5) / scale;
      const deltaX = targetX - startX;
      const deltaY = targetY - startY;
      const landingScale = Math.max(0.18, Math.min(0.62, targetRect.width / scale / 26));
      const gem = document.createElement('i');
      gem.className = 'bead-flight-gem play-showcase-flight-gem';
      gem.style.left = `${startX}px`;
      gem.style.top = `${startY}px`;
      gem.style.setProperty('--bead-color', bead.color);
      layer.append(gem);

      if (!reducedMotion) {
        const animation = gem.animate([
          {
            opacity: 0,
            transform: 'translate(-50%, -50%) rotate(-8deg) scale(.9)',
          },
          {
            opacity: 1,
            transform: 'translate(-50%, -50%) rotate(-8deg) scale(1)',
            offset: 0.08,
          },
          {
            opacity: 1,
            transform: `translate(calc(-50% + ${deltaX * 0.5}px), calc(-50% + ${deltaY * 0.5 - 42}px)) rotate(14deg) scale(.82)`,
            offset: 0.5,
          },
          {
            opacity: 1,
            transform: `translate(calc(-50% + ${deltaX}px), calc(-50% + ${deltaY}px)) rotate(0deg) scale(${landingScale})`,
          },
        ], {
          delay: index * stagger,
          duration: 560,
          easing: 'cubic-bezier(.2,.72,.2,1)',
          fill: 'both',
        });
        try {
          await animation.finished;
        } catch {
          // A canceled flight still settles the bead into its target position.
        }
      }

      target.classList.add('is-filled');
      const nextTargetOffset = index + 1 < sources.length
        ? Math.floor((index + 1) * this.currentPlayBeadReward.length / sources.length)
        : this.currentPlayBeadReward.length;
      if (nextTargetOffset > targetOffset) this.emitBeadPlacementSparkles(target);
      gem.remove();
    });

    try {
      await Promise.all(flights);
      this.playBeadShowcaseArt.parentElement?.classList.add('is-complete');
      if (!reducedMotion) await waitFor(220);
    } finally {
      layer.remove();
    }
  }

  private async handleComplete(): Promise<void> {
    if (this.playContext === 'bead') {
      await this.boardScene.showCompletion();
      if (this.playContext !== 'bead' || !this.beadPattern || !this.beadProgress) return;

      const reward = [...this.currentBeadReward];
      const rewardCount = reward.length;
      this.beadJar = [...this.beadJar, ...reward];
      saveBeadJarQueue(this.beadJar);
      this.currentBeadReward = [];
      this.selectNextBeadLevel();
      this.showScreen('bead');
      this.renderBeadScreen(
        undefined,
        `本关获得 ${rewardCount} 颗拼豆，已收进玻璃瓶。`,
      );
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
      await this.boardScene.showCompletion();
      const previousLives = this.lives;
      this.lives += 1;
      this.renderLives({ gainedFrom: previousLives });
      this.showEndlessStageResult();
      return;
    }

    if (this.playContext === 'collection') {
      await this.boardScene.showCompletion({ revealImage: true });
      this.completeCollectionLevel();
      this.showCollectionResult();
    } else if (this.isAdaptiveGameplaySession()) {
      const completedMode5Progress = this.activeMainGameplay === 'mode5' && this.currentLevel
        ? this.mode5LevelProgress(this.currentLevel.levelId)
        : undefined;
      await this.boardScene.showCompletion();
      const decision = this.recordAdaptiveAttempt('completed');
      if (completedMode5Progress && !completedMode5Progress.isFinalStage) {
        this.nextLevel();
      } else {
        this.showAdaptiveResult(decision);
      }
    } else if (this.activeMainGameplay === 'puzzle') {
      const patternComplete = await this.showPlayPuzzleCompletion();
      if (!patternComplete) {
        this.nextPuzzleStage();
        return;
      }
      await this.showPlayPuzzleFinale();
    } else {
      const patternComplete = await this.showPlayBeadCompletion();
      if (!patternComplete) {
        this.nextLevel();
        return;
      }
      this.showNormalResult();
    }
  }

  private async advanceEndlessStage(watchedVideo: boolean): Promise<void> {
    if (this.resultActionBusy || this.resultContext !== 'endless-stage') return;
    this.resultActionBusy = true;
    this.setResultActionsDisabled(true);

    if (watchedVideo) {
      const previousLives = this.lives;
      this.lives += 1;
      this.renderLives({ gainedFrom: previousLives });
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
    this.prepareMainGameplayShowcase(next);
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
    if (this.isAdaptiveGameplaySession()) this.recordAdaptiveAttempt('life-depleted');
    this.lives = 3;
    this.renderLives();
    this.restartCurrent();
  }

  private restartFromSettings(): void {
    if (this.settingsContext !== 'play') return;
    this.settingsDialog.close();
    this.setSolutionReveal(false);
    if (this.isAdaptiveGameplaySession() && this.currentAdaptiveLifeDepleted) {
      this.recordAdaptiveAttempt('life-depleted');
    }
    if (this.playContext === 'editor-playtest') {
      this.editorPlaytestErrorCount = 0;
    } else if (this.mode !== 'endless') {
      this.lives = 3;
    }
    this.renderLives();
    this.restartCurrent();
  }

  private continueAfterFailureVideo(): void {
    const previousLives = this.lives;
    this.lives = 3;
    this.renderLives({ gainedFrom: previousLives });
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
    this.boardScene.setPaused(false);
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

  private nextPuzzleStage(): void {
    this.resultOverlay.hidden = true;
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
    const levels = this.mainGameplayLevels(this.activeMainGameplay);
    if (levels.length === 0) return;
    if (this.activeMainGameplay === 'puzzle') {
      const nextLevelId = this.settings.puzzleMainLevelId % PLAY_PUZZLE_PATTERNS.length + 1;
      const nextPattern = this.playPuzzlePatternForLevel(nextLevelId);
      this.settings.puzzleMainLevelId = nextLevelId;
      this.playPuzzlePattern = nextPattern;
      this.playPuzzleProgress = { patternId: nextPattern.id, revealed: 0 };
      savePlayPuzzleProgress(this.playPuzzleProgress);
      saveSettings(this.settings);
      this.renderDefaultLobbyLevelNumber();
      return;
    }
    const currentId = this.currentLevel?.levelId ?? this.mainGameplayLevelId(this.activeMainGameplay);
    const index = levels.findIndex((level) => level.levelId === currentId);
    const nextIndex = (Math.max(0, index) + 1) % levels.length;
    this.setMainGameplayLevelId(levels[nextIndex].levelId, this.activeMainGameplay);
    saveSettings(this.settings);
    this.renderDefaultLobbyLevelNumber();
  }

  private selectNextBeadLevel(): void {
    if (this.beadLevels.length === 0) return;
    this.currentBeadLevelIndex = (this.currentBeadLevelIndex + 1) % this.beadLevels.length;
  }

  private backToLobby(): void {
    this.playContext = 'normal';
    this.resultOverlay.hidden = true;
    this.cancelPowerUpTargeting();
    this.boardScene.setPaused(true);
    this.showScreen('lobby');
  }

  private leavePlayScreen(): void {
    if (this.isAdaptiveGameplaySession() && this.currentAdaptiveLifeDepleted) {
      this.recordAdaptiveAttempt('life-depleted');
    }
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
    query<HTMLElement>('#settings-quick-complete-row').hidden = context !== 'play';
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

  private clearAllLocalData(): void {
    const confirmed = window.confirm(
      '确定清除全部本地数据吗？\\n\\n关卡进度、拼豆收藏、设置、自制关卡和统计数据都将被永久删除。',
    );
    if (!confirmed) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.location.reload();
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
    this.setMainGameplayControl(this.settings.mainGameplay);
    this.setMainGameplayDifficultyControl(this.settings.mainGameplayDifficulty);
    this.setInputModeControl(this.settings.inputMode);
    query<HTMLInputElement>('#settings-next').checked = this.settings.showNextNumber;
    query<HTMLInputElement>('#settings-difficulty-score').checked = this.settings.showDifficultyScore;
    query<HTMLInputElement>('#settings-sound').checked = this.settings.soundEnabled;
    this.setUiThemeControl(this.settings.uiTheme);
    this.solutionToggle.checked = this.solutionRevealed;
    this.setTouchPreviewSizeControl(this.settings.touchPreviewSize);
    query<HTMLInputElement>('#settings-touch-preview-follow').checked = this.settings.touchPreviewFollowsPointer;
    this.refreshSettingsControls();
  }

  private refreshLevelOptions(): void {
    const gameplay = this.playContext === 'normal' && this.mode === 'normal'
      ? this.activeMainGameplay
      : this.settings.mainGameplay;
    const levelOptions = gameplay === 'puzzle'
      ? PLAY_PUZZLE_PATTERNS.map((pattern, index) => ({
        levelId: index + 1,
        displayId: index + 1,
        label: pattern.name,
        selected: index + 1 === this.mainGameplayLevelId(gameplay),
      }))
      : gameplay === 'mode5'
        ? Array.from({ length: mode5LevelCount(this.mode5Campaign) }, (_, index) => index + 1).flatMap((level) => {
          const stageLevel = this.mode5Levels[mode5LevelStartIndex(this.mode5Campaign, level)];
          if (!stageLevel) return [];
          const progress = this.mode5LevelProgress(stageLevel.levelId);
          return [{
            levelId: stageLevel.levelId,
            displayId: level,
            label: `玩法5关卡 · ${progress.totalStages}个阶段`,
            selected: this.mode5LevelProgress().level === level,
          }];
        })
      : this.mainGameplayLevels(gameplay).map((level) => ({
          levelId: level.levelId,
          displayId: level.levelId,
          label: gameplay === 'mode3'
            ? '玩法3关卡'
            : gameplay === 'mode4'
              ? '玩法4关卡'
              : level.custom ? '自制关卡' : '关卡',
          selected: level.levelId === this.mainGameplayLevelId(gameplay),
        }));
    const options = levelOptions.map((level) => {
      const option = document.createElement('button');
      const selected = level.selected;
      option.type = 'button';
      option.className = 'level-picker-option';
      option.dataset.levelId = String(level.levelId);
      option.setAttribute('role', 'listitem');
      option.classList.toggle('is-selected', selected);
      if (selected) option.setAttribute('aria-current', 'true');
      option.innerHTML = `<strong>${level.displayId}</strong><small>${level.label}</small>`;
      option.addEventListener('click', () => this.selectLevelFromPicker(level.levelId));
      return option;
    });
    if (options.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'level-picker-empty';
      empty.textContent = '暂无关卡';
      this.levelPickerGrid.replaceChildren(empty);
    } else {
      this.levelPickerGrid.replaceChildren(...options);
    }
    this.renderDefaultLobbyLevelNumber();
  }

  private renderDefaultLobbyLevelNumber(): void {
    const hasLevels = this.mainGameplayLevels().length > 0;
    query<HTMLElement>('#default-level-number').textContent = hasLevels
      ? String(this.settings.mainGameplay === 'mode5'
        ? this.mode5LevelProgress().level
        : this.mainGameplayLevelId())
      : '—';
    query<HTMLButtonElement>('#default-start-button').disabled = !hasLevels;
    query<HTMLButtonElement>('#start-button').disabled = !hasLevels;
    this.renderPrimaryAction();
  }

  private refreshSettingsControls(): void {
    const previewSize = this.selectedTouchPreviewSize();
    const mainGameplay = this.selectedMainGameplay();
    const supportsDifficulty = isAdaptiveMainGameplay(mainGameplay);
    this.mainGameplayDifficultyControl.disabled = !supportsDifficulty;
    this.mainGameplayDifficultyRow.classList.toggle('is-disabled', !supportsDifficulty);
    this.mainGameplayDifficultyRow.setAttribute('aria-disabled', String(!supportsDifficulty));
    query<HTMLInputElement>('#settings-touch-preview-follow').disabled = (
      previewSize === 'off' || previewSize === 'zoom'
    );
    query<HTMLInputElement>('#settings-next').disabled = usesClickInput(this.selectedInputMode());
  }

  private applySettingsChange(): void {
    const previousMainGameplay = this.settings.mainGameplay;
    const previousMainGameplayDifficulty = this.settings.mainGameplayDifficulty;
    const nextMainGameplay = this.selectedMainGameplay();
    const nextMainGameplayDifficulty = this.selectedMainGameplayDifficulty();
    const mainGameplayChanged = previousMainGameplay !== nextMainGameplay;
    const mainGameplayDifficultyChanged = (
      previousMainGameplayDifficulty !== nextMainGameplayDifficulty
    );
    const isNormalPlay = this.settingsContext === 'play'
      && this.playContext === 'normal'
      && this.mode === 'normal';
    const shouldRegenerateBoard = isNormalPlay && (
      mainGameplayChanged
      || (
        mainGameplayDifficultyChanged
        && isAdaptiveMainGameplay(this.activeMainGameplay)
      )
    );

    if (
      shouldRegenerateBoard
      && this.isAdaptiveGameplaySession()
      && this.currentAdaptiveLifeDepleted
    ) {
      this.recordAdaptiveAttempt('life-depleted');
    }

    this.settings.mainGameplay = nextMainGameplay;
    this.settings.mainGameplayDifficulty = nextMainGameplayDifficulty;
    this.settings.inputMode = this.selectedInputMode();
    this.settings.showNextNumber = query<HTMLInputElement>('#settings-next').checked;
    this.settings.showDifficultyScore = query<HTMLInputElement>('#settings-difficulty-score').checked;
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
    if (!this.settings.showDifficultyScore) this.renderHoldScore(null);
    this.boardScene.setRuntimePreferences({
      showNextNumber: this.settings.showNextNumber,
      soundEnabled: this.settings.soundEnabled,
      inputMode: this.settings.inputMode,
      touchPreviewRingDepth: this.settings.touchPreviewSize === 'large' ? 2 : 1,
      boardZoomEnabled: this.isTouchPreviewZoomMode(),
    });

    if (shouldRegenerateBoard) {
      this.activeMainGameplay = this.settings.mainGameplay;
      this.resultOverlay.hidden = true;
      this.lives = 3;
      this.renderLives();
      this.setCurrentBoard(this.createNormalLevel());
    }

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

  private openFavorites(tab: 'album' | 'beads' = 'album'): void {
    this.favoritesTab = tab;
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
    if (this.beadJar.length > 0) requestAnimationFrame(() => this.beadJarButton.focus());
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
    this.cancelBeadJarPress();
    this.playContext = 'normal';
    this.showScreen('lobby');
  }

  private handleBeadJarPointerDown(event: PointerEvent): void {
    if (this.beadJar.length === 0 || this.beadRewardAnimating) return;
    event.preventDefault();
    this.cancelBeadJarPress();
    this.beadJarPressHeld = true;
    this.beadJarLongPressTriggered = false;
    this.beadJarButton.classList.add('is-pressing');
    this.beadJarButton.setPointerCapture(event.pointerId);
    this.beadJarPressTimer = window.setTimeout(() => {
      this.beadJarPressTimer = undefined;
      if (!this.beadJarPressHeld) return;
      this.beadJarLongPressTriggered = true;
      this.beadJarLaunchIntervalMs = beadJarLaunchInterval(
        this.beadJar.slice(this.beadJarInFlight),
      );
      this.beadJarButton.classList.add('is-long-pressing');
      void this.drainBeadJarWhileHeld();
    }, 340);
  }

  private handleBeadJarPointerUp(event: PointerEvent): void {
    if (!this.beadJarPressHeld) return;
    event.preventDefault();
    const wasLongPress = this.beadJarLongPressTriggered;
    this.beadJarPressHeld = false;
    this.beadJarLaunchIntervalMs = BEAD_RAPID_DEFAULT_INTERVAL_MS;
    this.beadJarButton.classList.remove('is-pressing', 'is-long-pressing');
    if (this.beadJarPressTimer !== undefined) {
      window.clearTimeout(this.beadJarPressTimer);
      this.beadJarPressTimer = undefined;
    }
    if (this.beadJarButton.hasPointerCapture(event.pointerId)) {
      this.beadJarButton.releasePointerCapture(event.pointerId);
    }
    if (!wasLongPress) void this.placeNextBeadFromJar();
  }

  private cancelBeadJarPress(): void {
    this.beadJarPressHeld = false;
    this.beadJarLongPressTriggered = false;
    this.beadJarLaunchIntervalMs = BEAD_RAPID_DEFAULT_INTERVAL_MS;
    this.beadJarButton.classList.remove('is-pressing', 'is-long-pressing');
    if (this.beadJarPressTimer !== undefined) {
      window.clearTimeout(this.beadJarPressTimer);
      this.beadJarPressTimer = undefined;
    }
  }

  private async drainBeadJarWhileHeld(): Promise<void> {
    while (this.beadJarPressHeld && this.beadJar.length - this.beadJarInFlight > 0) {
      const nextBead = this.beadJar[this.beadJarInFlight];
      if (
        this.beadPatternFinishing
        || !nextBead
        || nextBead.patternId !== this.beadPattern?.id
      ) break;
      void this.placeNextBeadFromJar();
      await waitFor(this.beadJarLaunchIntervalMs);
    }
  }

  private async placeNextBeadFromJar(): Promise<boolean> {
    const rapidPlacement = this.beadJarLongPressTriggered && this.beadJarPressHeld;
    if (
      (this.beadRewardAnimating && !rapidPlacement)
      || this.beadJar.length - this.beadJarInFlight <= 0
      || !this.beadPattern
      || !this.beadProgress
      || this.beadPatternFinishing
    ) return false;
    const flightOrder = this.beadProgress.collected + this.beadJarInFlight;
    const bead = this.beadJar[this.beadJarInFlight];
    if (!bead || bead.patternId !== this.beadPattern.id) return false;
    const target = this.beadBoard.querySelector<HTMLElement>(
      `[data-bead-order="${flightOrder}"]`,
    );
    if (!target) return false;
    this.beadJarInFlight += 1;
    this.beadRewardAnimating = true;
    this.renderBeadJar();

    const layer = document.createElement('div');
    layer.className = 'bead-flight-layer';
    layer.setAttribute('aria-hidden', 'true');
    const gem = document.createElement('i');
    gem.className = 'bead-flight-gem';
    gem.style.setProperty('--bead-color', bead.color);
    const appRect = this.appShell.getBoundingClientRect();
    const jarImage = this.beadJarButton.querySelector<HTMLImageElement>('img');
    const jarRect = (jarImage ?? this.beadJarButton).getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const scale = this.uiVisualScale();
    const startX = (jarRect.left - appRect.left + jarRect.width * 0.5) / scale;
    const startY = (jarRect.top - appRect.top + jarRect.height * 0.66) / scale;
    const targetX = (targetRect.left - appRect.left + targetRect.width * 0.5) / scale;
    const targetY = (targetRect.top - appRect.top + targetRect.height * 0.5) / scale;
    const deltaX = targetX - startX;
    const deltaY = targetY - startY;
    const landingScale = Math.max(0.24, Math.min(0.78, targetRect.width / scale / 26));
    gem.style.left = `${startX}px`;
    gem.style.top = `${startY}px`;
    gem.style.transform = `translate(-50%, -50%) rotate(-12deg) scale(${landingScale})`;
    layer.append(gem);
    this.appShell.append(layer);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      const animation = gem.animate([
        {
          transform: `translate(-50%, -50%) rotate(-12deg) scale(${landingScale})`,
          offset: 0,
        },
        {
          transform: `translate(calc(-50% + ${deltaX * 0.48}px), calc(-50% + ${deltaY * 0.48 - 48}px)) rotate(16deg) scale(${landingScale})`,
          offset: 0.48,
        },
        {
          transform: `translate(calc(-50% + ${deltaX}px), calc(-50% + ${deltaY}px)) rotate(0deg) scale(${landingScale})`,
          offset: 1,
        },
      ], {
        duration: reducedMotion ? 1 : BEAD_FLIGHT_DURATION_MS,
        easing: 'cubic-bezier(.2,.72,.2,1)',
        fill: 'forwards',
      });
      try {
        await animation.finished;
      } catch {
        // A canceled animation still settles its bead into the saved position.
      }
      target.classList.add('is-filled');
      this.emitBeadPlacementSparkles(target);
      this.completedBeadFlights.add(flightOrder);
    } finally {
      layer.remove();
    }

    await this.flushCompletedBeadFlights();
    return true;
  }

  private emitBeadPlacementSparkles(target: HTMLElement): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const appRect = this.appShell.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const scale = this.uiVisualScale();
    const burst = document.createElement('span');
    burst.className = 'bead-placement-burst';
    burst.setAttribute('aria-hidden', 'true');
    burst.style.left = `${(targetRect.left - appRect.left + targetRect.width * 0.5) / scale}px`;
    burst.style.top = `${(targetRect.top - appRect.top + targetRect.height * 0.5) / scale}px`;
    this.appShell.append(burst);

    const particleCount = 1 + Math.floor(Math.random() * 3);
    const animations: Animation[] = [];
    for (let index = 0; index < particleCount; index += 1) {
      const particle = document.createElement('i');
      particle.className = 'bead-placement-spark';
      particle.style.setProperty('--sparkle-size', `${5 + Math.random() * 4}px`);
      burst.append(particle);

      const angle = Math.random() * Math.PI * 2;
      const distance = 13 + Math.random() * 15;
      const offsetX = Math.cos(angle) * distance;
      const offsetY = Math.sin(angle) * distance - 5;
      const rotation = 28 + Math.random() * 54;
      animations.push(particle.animate([
        {
          opacity: 0,
          transform: 'translate(-50%, -50%) scale(.25) rotate(0deg)',
          offset: 0,
        },
        {
          opacity: 1,
          transform: `translate(calc(-50% + ${offsetX * 0.22}px), calc(-50% + ${offsetY * 0.22}px)) scale(1) rotate(${rotation * 0.24}deg)`,
          offset: 0.42,
        },
        {
          opacity: 0,
          transform: `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px)) scale(.45) rotate(${rotation}deg)`,
          offset: 1,
        },
      ], {
        duration: 700 + Math.random() * 250,
        easing: 'cubic-bezier(.35,0,.25,1)',
        fill: 'forwards',
      }));
    }

    void Promise.allSettled(animations.map((animation) => animation.finished))
      .then(() => burst.remove());
  }

  private async flushCompletedBeadFlights(): Promise<void> {
    if (!this.beadPattern || !this.beadProgress) return;
    let changed = false;
    while (this.completedBeadFlights.has(this.beadProgress.collected)) {
      this.completedBeadFlights.delete(this.beadProgress.collected);
      this.beadProgress = advanceBeadProgress(this.beadPattern, this.beadProgress, 1);
      this.beadJar.shift();
      this.beadJarInFlight = Math.max(0, this.beadJarInFlight - 1);
      changed = true;
    }
    this.beadRewardAnimating = this.beadJarInFlight > 0;
    if (!changed) return;
    saveBeadProgress(this.beadProgress);
    saveBeadJarQueue(this.beadJar);

    const completed = this.beadProgress.collected >= orderedBeads(this.beadPattern).length;
    if (completed && !this.beadPatternFinishing) {
      this.beadPatternFinishing = true;
      try {
        if (this.beadJar.length > 0) {
          await this.continueBeadJarIntoNextPattern(this.beadPattern);
        } else {
          await this.finishBeadPatternFromJar(this.beadPattern);
        }
      } finally {
        this.beadPatternFinishing = false;
        if (this.beadJarPressHeld && this.beadJarLongPressTriggered && this.beadJar.length > 0) {
          void this.drainBeadJarWhileHeld();
        }
      }
      return;
    }
    this.updateBeadPlacementUi(
      this.beadJar.length > 0
        ? `再放 ${this.beadJar.length} 颗，瓶子就空了。`
        : '瓶中的拼豆已全部归位。',
    );
  }

  private async finishBeadPatternFromJar(completedPattern: BeadPatternData): Promise<void> {
    if (!this.beadProgress) return;
    this.completedBeadPatternIds = new Set(markBeadPatternCompleted(
      this.beadPatterns,
      completedPattern.id,
    ));
    this.renderBeadScreen(undefined, `${completedPattern.name}完成！`);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) await waitFor(620);
    if (this.beadPattern?.id !== completedPattern.id || this.beadJar.length > 0) return;
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

  private async continueBeadJarIntoNextPattern(completedPattern: BeadPatternData): Promise<void> {
    if (!this.beadProgress) return;
    this.completedBeadPatternIds = new Set(markBeadPatternCompleted(
      this.beadPatterns,
      completedPattern.id,
    ));
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reducedMotion) {
      const outgoing = this.beadBoard.animate([
        { opacity: 1, transform: 'translate3d(0,0,0)' },
        { opacity: 0, transform: 'translate3d(-112%,0,0)' },
      ], {
        duration: 260,
        easing: 'cubic-bezier(.4,0,.8,.25)',
        fill: 'forwards',
      });
      try {
        await outgoing.finished;
      } catch {
        // A canceled transition still advances to the queued pattern.
      } finally {
        outgoing.cancel();
      }
    }

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
      `${completedPattern.name}已完成，继续拼${nextSequence.pattern.name}。`,
    );

    if (!reducedMotion) {
      try {
        await this.beadBoard.animate([
          { opacity: 0, transform: 'translate3d(112%,0,0)' },
          { opacity: 1, transform: 'translate3d(0,0,0)' },
        ], {
          duration: 300,
          easing: 'cubic-bezier(.22,1,.36,1)',
        }).finished;
      } catch {
        // The new pattern remains active if the entrance animation is canceled.
      }
    }
  }

  private renderBeadJar(): void {
    const count = Math.max(0, this.beadJar.length - this.beadJarInFlight);
    const placementRequired = this.beadJar.length > 0;
    this.beadScreen.classList.toggle('is-bead-placement-required', placementRequired);
    this.beadScreen.setAttribute('aria-busy', String(placementRequired));
    this.beadPlacementOverlay.hidden = !placementRequired;
    this.beadJarButton.hidden = !placementRequired;
    this.beadBackButton.disabled = placementRequired;
    this.beadGalleryButton.disabled = placementRequired;
    this.beadJarCount.textContent = String(count);
    this.beadJarButton.disabled = count === 0;
    this.beadJarButton.setAttribute(
      'aria-label',
      count === 0
        ? '拼豆瓶是空的'
        : `拼豆瓶中有${count}颗，点击放置一颗，长按连续放置`,
    );
    const hint = this.beadJarButton.querySelector('small');
    if (hint) hint.textContent = count === 0
      ? '通关获得的拼豆会收集在这里'
      : '点击放 1 颗 · 长按连续放置';

    const preview = this.beadJar.slice(this.beadJarInFlight, this.beadJarInFlight + 20);
    const gems = preview.map((bead, index) => {
      const gem = document.createElement('i');
      const row = Math.floor(index / 5);
      const column = index % 5;
      gem.className = 'bead-jar-gem';
      gem.style.setProperty('--bead-color', bead.color);
      gem.style.left = `${column * 10 + (row % 2) * 3}px`;
      gem.style.top = `${27 - row * 7 + (column % 2) * 2}px`;
      gem.style.transform = `rotate(${(index * 37) % 42 - 21}deg) scale(${0.72 + index % 3 * 0.08})`;
      return gem;
    });
    this.beadJarContents.replaceChildren(...gems);
  }

  private updateBeadPlacementUi(message: string): void {
    if (!this.beadPattern || !this.beadProgress) return;
    const total = orderedBeads(this.beadPattern).length;
    const collected = Math.min(total, this.beadProgress.collected);
    const percent = total === 0 ? 100 : Math.round(collected / total * 100);
    this.beadProgressText.textContent = `${collected} / ${total}`;
    this.beadProgressFill.style.width = `${percent}%`;
    this.beadProgressFill.parentElement?.setAttribute('aria-valuenow', String(percent));
    this.beadBoard.setAttribute(
      'aria-label',
      `${this.beadPattern.width}乘${this.beadPattern.height}${this.beadPattern.name}拼豆图纸，已完成${percent}%`,
    );
    this.beadStatus.textContent = message;
    const hasLevels = this.levels.length > 0;
    this.beadStartButton.disabled = !hasLevels || this.beadJar.length > 0 || collected >= total;
    this.beadStartButton.textContent = !hasLevels
      ? '暂无关卡'
      : this.beadJar.length > 0
        ? `先放完瓶中的 ${this.beadJar.length} 颗`
        : collected >= total
          ? '图案已完成'
          : `进入关卡 · 可获得 ${Math.min(total - collected, this.createNormalLevel().solutionPath.length)} 颗`;
    this.renderBeadJar();
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
    const dotSize = Math.max(1, Math.min(columnTrack, rowTrack));
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
    const waitingInJar = Math.min(
      remaining,
      this.beadJar.filter((bead) => bead.patternId === pattern.id).length,
    );
    const availableToEarn = Math.max(0, remaining - waitingInJar);
    const levelSize = this.beadLevels.length > 0 ? this.createBeadLevel().solutionPath.length : 0;
    const nextReward = Math.min(availableToEarn, levelSize);
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
    this.beadStatus.textContent = message ?? (
      waitingInJar > 0
        ? `瓶中还有 ${waitingInJar} 颗，点击玻璃瓶放入图纸。`
        : remaining > 0
          ? `还差 ${remaining} 颗拼豆完成图案`
          : '图案完成！所有拼豆都已归位。'
    );
    this.beadStartButton.disabled = this.beadLevels.length === 0 || remaining === 0 || waitingInJar > 0;
    this.beadStartButton.textContent = this.beadLevels.length === 0
      ? '暂无关卡'
      : remaining === 0
        ? '图案已完成'
        : waitingInJar > 0
          ? `先放完瓶中的 ${waitingInJar} 颗`
          : `进入关卡 · 可获得 ${nextReward} 颗`;
    this.renderBeadJar();
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
