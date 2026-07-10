import Phaser from 'phaser';
import './styles.css';
import { BoardScene } from './game/BoardScene';
import { getEndlessStageSettings } from './game/difficulty';
import { selectHiddenCells } from './game/hidden';
import { formatLives } from './game/lives';
import { findHamiltonianPath, generateProceduralLevel } from './game/pathfinding';
import {
  getNextCustomLevelId,
  loadBuiltInLevels,
  loadCustomLevels,
  loadSettings,
  saveCustomLevel,
  saveSettings,
} from './game/storage';
import {
  BoardShape,
  RECTANGLE_SIZES,
  cellKey,
  type BoardSessionInput,
  type Cell,
  type EndlessStageSettings,
  type GameMode,
  type GameSettings,
  type LevelData,
} from './game/types';
import {
  createVideoView,
  groupVideoViews,
  loadVideoViews,
  saveVideoViews,
  videoPlacementLabel,
  type VideoViewRecord,
} from './game/videoStats';

const query = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
};

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const wrap = (value: number, min: number, max: number): number => value < min ? max : value > max ? min : value;
type ResultContext = 'normal' | 'endless-stage' | 'life-depleted';

class NumberConnectApp {
  private readonly lobbyScreen = query<HTMLElement>('#lobby-screen');
  private readonly playScreen = query<HTMLElement>('#play-screen');
  private readonly editorScreen = query<HTMLElement>('#editor-screen');
  private readonly gameHost = query<HTMLElement>('#game-host');
  private readonly levelLabel = query<HTMLElement>('#play-level-label');
  private readonly modeLabel = query<HTMLElement>('#play-mode-label');
  private readonly statusLabel = query<HTMLElement>('#play-status');
  private readonly livesLabel = query<HTMLElement>('#play-lives');
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

  private builtInLevels: LevelData[] = [];
  private customLevels: LevelData[] = [];
  private levels: LevelData[] = [];
  private settings: GameSettings = loadSettings();
  private mode: GameMode = 'normal';
  private stage = 1;
  private lives = 3;
  private endlessSeed = 1;
  private proceduralSeed = 1;
  private currentLevel?: LevelData;
  private currentProgress = 0;
  private currentTotal = 0;
  private settingsContext: 'lobby' | 'play' = 'lobby';
  private resultContext: ResultContext = 'normal';
  private resultActionBusy = false;
  private videoViews: VideoViewRecord[] = loadVideoViews();

  private readonly boardScene = new BoardScene();
  private readonly game: Phaser.Game;

  private editorShape = BoardShape.Square;
  private editorSquareSize = 8;
  private editorDiamondSize = 6;
  private editorRectangleIndex = 2;
  private editorActive = new Set<string>();
  private editorPath: Cell[] = [];
  private editorPainting = false;
  private editorPaintValue = true;

  public constructor() {
    this.game = new Phaser.Game({
      type: Phaser.CANVAS,
      parent: this.gameHost,
      width: 640,
      height: 620,
      transparent: true,
      backgroundColor: 'rgba(0,0,0,0)',
      render: { antialias: true, roundPixels: false },
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [this.boardScene],
    });
  }

  public async initialize(): Promise<void> {
    const boardReady = new Promise<void>((resolve) => {
      this.game.events.once('board-ready', () => resolve());
    });
    [this.builtInLevels] = await Promise.all([loadBuiltInLevels(), boardReady]);
    this.refreshLevels();
    this.bindLobby();
    this.bindPlayControls();
    this.bindSettings();
    this.bindEditor();
    this.refreshLevelOptions();
    this.renderVideoStats();
  }

  private bindLobby(): void {
    query('#start-button').addEventListener('click', () => void this.startNormalMode());
    query('#endless-button').addEventListener('click', () => void this.startEndlessMode());
    query('#editor-button').addEventListener('click', () => this.openEditor());
    query('#lobby-settings-button').addEventListener('click', () => this.openSettings('lobby'));
  }

  private bindPlayControls(): void {
    query('#back-button').addEventListener('click', () => this.backToLobby());
    query('#play-settings-button').addEventListener('click', () => this.openSettings('play'));
    this.restartButton.addEventListener('click', () => this.handleResultPrimary());
    this.nextButton.addEventListener('click', () => this.handleResultSecondary());
    this.resultLobbyButton.addEventListener('click', () => this.backToLobby());
  }

  private bindSettings(): void {
    const shapeSelect = query<HTMLSelectElement>('#settings-shape');
    shapeSelect.addEventListener('change', () => this.refreshSettingsControls());
    for (const selector of ['#settings-size', '#settings-hidden', '#settings-hidden-run', '#settings-visible-run', '#settings-crossings']) {
      query<HTMLInputElement>(selector).addEventListener('input', () => this.refreshSettingsOutputs());
    }
    query('#settings-apply-button').addEventListener('click', () => void this.applySettings());
    query('#video-stats-button').addEventListener('click', () => this.openVideoStats());
    query('#video-stats-reset').addEventListener('click', () => this.resetVideoStats());
    query('#settings-lobby-button').addEventListener('click', () => {
      this.settingsDialog.close();
      this.backToLobby();
    });
    this.settingsDialog.addEventListener('close', () => {
      if (this.settingsContext === 'play') this.boardScene.setPaused(false);
    });
  }

  private bindEditor(): void {
    query('#editor-back-button').addEventListener('click', () => this.backToLobby());
    query<HTMLSelectElement>('#editor-shape').addEventListener('change', (event) => {
      this.editorShape = Number((event.target as HTMLSelectElement).value) as BoardShape;
      this.trimEditorCells();
      this.invalidateEditorPath();
      this.renderEditor();
    });
    query('#editor-size-minus').addEventListener('click', () => this.changeEditorSize(-1));
    query('#editor-size-plus').addEventListener('click', () => this.changeEditorSize(1));
    query('#editor-clear-button').addEventListener('click', () => {
      this.editorActive.clear();
      this.invalidateEditorPath();
      this.renderEditor();
      this.setEditorStatus('棋盘已清空。');
    });
    query('#editor-validate-button').addEventListener('click', () => this.validateEditorLevel());
    query('#editor-save-button').addEventListener('click', () => this.saveEditorLevel());
    window.addEventListener('pointerup', () => { this.editorPainting = false; });
    window.addEventListener('pointercancel', () => { this.editorPainting = false; });
  }

  private refreshLevels(): void {
    this.customLevels = loadCustomLevels();
    this.levels = [...this.builtInLevels, ...this.customLevels].sort((left, right) => left.levelId - right.levelId);
    if (!this.levels.some((level) => level.levelId === this.settings.selectedLevelId)) {
      this.settings.selectedLevelId = this.levels[0]?.levelId ?? 1;
    }
  }

  private showScreen(name: 'lobby' | 'play' | 'editor'): void {
    this.lobbyScreen.hidden = name !== 'lobby';
    this.playScreen.hidden = name !== 'play';
    this.editorScreen.hidden = name !== 'editor';
  }

  private async showPlayScreen(): Promise<void> {
    this.showScreen('play');
    this.resultOverlay.hidden = true;
    this.resultActionBusy = false;
    this.setResultActionsDisabled(false);
    await nextFrame();
    this.game.scale.resize(Math.max(320, this.gameHost.clientWidth), Math.max(420, this.gameHost.clientHeight));
    await nextFrame();
  }

  private async startNormalMode(): Promise<void> {
    this.mode = 'normal';
    this.lives = 3;
    this.renderLives();
    this.proceduralSeed = Date.now() & 0x7fffffff;
    await this.showPlayScreen();
    this.setCurrentBoard(this.createNormalLevel());
  }

  private async startEndlessMode(): Promise<void> {
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

  private createNormalLevel(): LevelData {
    if (this.settings.shape === BoardShape.Level) {
      const selected = this.levels.find((level) => level.levelId === this.settings.selectedLevelId) ?? this.levels[0];
      if (!selected) throw new Error('没有可用的图案关卡。');
      return selected;
    }

    const { rows, columns } = this.getProceduralSize();
    return generateProceduralLevel(
      rows,
      columns,
      this.proceduralSeed,
      this.settings.targetCrossings,
      this.settings.shape,
    );
  }

  private createEndlessLevel(stage: number, profile: EndlessStageSettings): LevelData {
    return generateProceduralLevel(
      profile.rows,
      profile.columns,
      this.endlessSeed + stage * 1000003,
      profile.targetCrossings,
      BoardShape.Square,
    );
  }

  private getProceduralSize(): { rows: number; columns: number } {
    if (this.settings.shape === BoardShape.Rectangle) {
      const size = RECTANGLE_SIZES[this.settings.rectangleSizeIndex];
      return { rows: size.y, columns: size.x };
    }
    const size = this.settings.shape === BoardShape.Diamond ? this.settings.diamondSize : this.settings.squareSize;
    return { rows: size, columns: size };
  }

  private makeSession(level: LevelData, profile?: EndlessStageSettings): BoardSessionInput {
    const hiddenPercent = profile?.hiddenPercent ?? this.settings.hiddenPercent;
    const maxHiddenRun = profile?.maxHiddenRun ?? this.settings.maxHiddenRun;
    const maxVisibleRun = profile?.maxVisibleRun ?? this.settings.maxVisibleRun;
    const seed = (this.mode === 'endless' ? this.endlessSeed + this.stage * 1000003 : this.proceduralSeed + level.levelId) | 0;
    return {
      level,
      hiddenCells: selectHiddenCells(level.solutionPath, hiddenPercent, maxHiddenRun, maxVisibleRun, seed),
      showNextNumber: this.settings.showNextNumber,
      soundEnabled: this.settings.soundEnabled,
      mode: this.mode,
      onProgress: (current, total) => {
        this.currentProgress = current;
        this.currentTotal = total;
        this.setStatus(`${current} / ${total}`);
      },
      onWrong: (message) => this.handleWrong(message),
      onComplete: () => void this.handleComplete(),
    };
  }

  private setCurrentBoard(level: LevelData, profile?: EndlessStageSettings): void {
    this.currentLevel = level;
    this.currentProgress = 0;
    this.currentTotal = level.solutionPath.length;
    this.updateGameHeading(level);
    this.setStatus(this.mode === 'endless' ? `阶段 ${this.stage} · 请从数字 1 开始` : '请从数字 1 开始，隐藏数字会在连接后显示。');
    this.boardScene.setBoard(this.makeSession(level, profile));
  }

  private updateGameHeading(level: LevelData): void {
    if (this.mode === 'endless') {
      this.modeLabel.textContent = 'ENDLESS MODE';
      this.levelLabel.textContent = `无尽 · 阶段 ${this.stage}`;
      return;
    }
    this.modeLabel.textContent = level.custom ? 'CUSTOM LEVEL' : this.settings.shape === BoardShape.Level ? 'PICTURE LEVEL' : 'PROCEDURAL LEVEL';
    this.levelLabel.textContent = this.settings.shape === BoardShape.Level
      ? `${level.custom ? '自制关卡' : '图案关卡'} ${level.levelId}`
      : `${this.shapeLabel(this.settings.shape)} ${level.columns} × ${level.rows}`;
  }

  private setStatus(message: string, error = false): void {
    this.statusLabel.textContent = message;
    this.statusLabel.parentElement?.classList.toggle('is-error', error);
  }

  private renderLives(): void {
    this.livesLabel.hidden = false;
    this.livesLabel.textContent = formatLives(this.lives);
    this.livesLabel.setAttribute('aria-label', `生命值 ${this.lives}`);
  }

  private handleWrong(message: string): void {
    this.setStatus(message, true);
    if (this.lives <= 0) return;
    this.lives -= 1;
    this.renderLives();
    if (this.lives === 0) this.handleLifeDepleted();
  }

  private handleLifeDepleted(): void {
    this.boardScene.setPaused(true);
    this.setStatus(this.mode === 'endless' ? `阶段 ${this.stage} · 生命值耗尽` : '生命值耗尽', true);
    this.resultContext = 'life-depleted';
    this.resultKicker.textContent = 'OUT OF HEARTS';
    this.resultTitle.textContent = '生命已耗尽';
    const progress = `当前数字进度 ${this.currentProgress} / ${this.currentTotal}`;
    this.resultMessage.textContent = this.mode === 'endless' ? `阶段 ${this.stage} · ${progress}` : progress;
    this.resultReward.hidden = true;
    this.restartButton.textContent = '重新开始';
    this.nextButton.textContent = '观看视频获取 1♥';
    this.nextButton.hidden = false;
    this.resultLobbyButton.textContent = '放弃';
    this.resultActions.classList.remove('is-single');
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
    } else if (this.resultContext === 'life-depleted') {
      this.restartAfterFailure();
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
    } else if (this.resultContext === 'normal') {
      this.nextLevel();
    }
  }

  private async handleComplete(): Promise<void> {
    if (this.mode === 'endless') {
      this.lives += 1;
      this.renderLives();
      this.setStatus(`阶段 ${this.stage} 完成 · 生命 +1`);
      this.showEndlessStageResult();
      return;
    }

    this.setStatus('关卡完成');
    await this.boardScene.showCompletion();
    this.showNormalResult();
  }

  private async advanceEndlessStage(watchedVideo: boolean): Promise<void> {
    if (this.resultActionBusy || this.resultContext !== 'endless-stage') return;
    this.resultActionBusy = true;
    this.setResultActionsDisabled(true);

    if (watchedVideo) {
      this.lives += 1;
      this.renderLives();
      this.videoViews.push(createVideoView('endless-stage-complete', this.stage));
      saveVideoViews(this.videoViews);
      this.renderVideoStats();
      this.setStatus(`阶段 ${this.stage} · 视频奖励生命 +1`);
    }

    this.resultOverlay.hidden = true;
    this.stage += 1;
    const profile = getEndlessStageSettings(this.stage);
    const next = this.createEndlessLevel(this.stage, profile);
    this.currentLevel = next;
    this.updateGameHeading(next);
    this.setStatus(`阶段 ${this.stage} · 难度提升`);

    try {
      await this.boardScene.transitionTo(this.makeSession(next, profile));
      this.setStatus(`阶段 ${this.stage} · 请从数字 1 开始`);
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
    saveVideoViews(this.videoViews);
    this.renderVideoStats();
    this.resultOverlay.hidden = true;
    this.boardScene.setPaused(false);
    this.setStatus(`生命 +1 · 继续寻找数字 ${Math.min(this.currentTotal, this.currentProgress + 1)}`);
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
    if (this.settings.shape === BoardShape.Level) {
      const index = this.levels.findIndex((level) => level.levelId === this.settings.selectedLevelId);
      const nextIndex = (Math.max(0, index) + 1) % this.levels.length;
      this.settings.selectedLevelId = this.levels[nextIndex].levelId;
      saveSettings(this.settings);
    } else {
      this.proceduralSeed += 104729;
    }
    this.setCurrentBoard(this.createNormalLevel());
  }

  private backToLobby(): void {
    this.resultOverlay.hidden = true;
    this.boardScene.setPaused(true);
    this.showScreen('lobby');
  }

  private openSettings(context: 'lobby' | 'play'): void {
    this.settingsContext = context;
    if (context === 'play') this.boardScene.setPaused(true);
    this.populateSettingsForm();
    this.renderVideoStats();
    query<HTMLElement>('#settings-lobby-button').hidden = context === 'lobby';
    query<HTMLElement>('#endless-settings-note').hidden = !(context === 'play' && this.mode === 'endless');
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
    query<HTMLSelectElement>('#settings-shape').value = String(this.settings.shape);
    query<HTMLSelectElement>('#settings-level').value = String(this.settings.selectedLevelId);
    query<HTMLInputElement>('#settings-hidden').value = String(this.settings.hiddenPercent);
    query<HTMLInputElement>('#settings-hidden-run').value = String(this.settings.maxHiddenRun);
    query<HTMLInputElement>('#settings-visible-run').value = String(this.settings.maxVisibleRun);
    query<HTMLInputElement>('#settings-crossings').value = String(this.settings.targetCrossings);
    query<HTMLInputElement>('#settings-next').checked = this.settings.showNextNumber;
    query<HTMLInputElement>('#settings-sound').checked = this.settings.soundEnabled;
    this.refreshSettingsControls();
  }

  private refreshLevelOptions(): void {
    const select = query<HTMLSelectElement>('#settings-level');
    select.replaceChildren(...this.levels.map((level) => {
      const option = document.createElement('option');
      option.value = String(level.levelId);
      option.textContent = `${level.custom ? '自制' : '图案'}关卡 ${level.levelId}`;
      return option;
    }));
    select.value = String(this.settings.selectedLevelId);
  }

  private refreshSettingsControls(): void {
    const shape = Number(query<HTMLSelectElement>('#settings-shape').value) as BoardShape;
    const endlessLocked = this.settingsContext === 'play' && this.mode === 'endless';
    query<HTMLElement>('#settings-level-row').hidden = shape !== BoardShape.Level;
    query<HTMLElement>('#settings-size-row').hidden = shape === BoardShape.Level;
    query<HTMLElement>('#settings-crossings-row').hidden = shape === BoardShape.Level;
    const controlledSelectors = ['#settings-shape', '#settings-level', '#settings-size', '#settings-hidden', '#settings-hidden-run', '#settings-visible-run', '#settings-crossings'];
    controlledSelectors.forEach((selector) => { (query(selector) as HTMLInputElement | HTMLSelectElement).disabled = endlessLocked; });

    const sizeInput = query<HTMLInputElement>('#settings-size');
    if (shape === BoardShape.Rectangle) {
      sizeInput.min = '0'; sizeInput.max = String(RECTANGLE_SIZES.length - 1); sizeInput.step = '1'; sizeInput.value = String(this.settings.rectangleSizeIndex);
    } else if (shape === BoardShape.Diamond) {
      sizeInput.min = '3'; sizeInput.max = '8'; sizeInput.step = '1'; sizeInput.value = String(this.settings.diamondSize);
    } else {
      sizeInput.min = '3'; sizeInput.max = '10'; sizeInput.step = '1'; sizeInput.value = String(this.settings.squareSize);
    }
    this.refreshSettingsOutputs();
  }

  private refreshSettingsOutputs(): void {
    const shape = Number(query<HTMLSelectElement>('#settings-shape').value) as BoardShape;
    const sizeValue = Number(query<HTMLInputElement>('#settings-size').value);
    const sizeText = shape === BoardShape.Rectangle
      ? `${RECTANGLE_SIZES[sizeValue]?.x ?? 4} × ${RECTANGLE_SIZES[sizeValue]?.y ?? 6}`
      : `${sizeValue} × ${sizeValue}`;
    query('#settings-size-output').textContent = sizeText;
    query('#settings-hidden-output').textContent = `${query<HTMLInputElement>('#settings-hidden').value}%`;
    query('#settings-hidden-run-output').textContent = query<HTMLInputElement>('#settings-hidden-run').value;
    query('#settings-visible-run-output').textContent = query<HTMLInputElement>('#settings-visible-run').value;
    query('#settings-crossings-output').textContent = query<HTMLInputElement>('#settings-crossings').value;
  }

  private async applySettings(): Promise<void> {
    const shape = Number(query<HTMLSelectElement>('#settings-shape').value) as BoardShape;
    const sizeValue = Number(query<HTMLInputElement>('#settings-size').value);
    this.settings.shape = shape;
    this.settings.selectedLevelId = Number(query<HTMLSelectElement>('#settings-level').value) || this.settings.selectedLevelId;
    if (shape === BoardShape.Rectangle) this.settings.rectangleSizeIndex = sizeValue;
    else if (shape === BoardShape.Diamond) this.settings.diamondSize = sizeValue;
    else if (shape === BoardShape.Square) this.settings.squareSize = sizeValue;
    this.settings.hiddenPercent = Number(query<HTMLInputElement>('#settings-hidden').value);
    this.settings.maxHiddenRun = Number(query<HTMLInputElement>('#settings-hidden-run').value);
    this.settings.maxVisibleRun = Number(query<HTMLInputElement>('#settings-visible-run').value);
    this.settings.targetCrossings = Number(query<HTMLInputElement>('#settings-crossings').value);
    this.settings.showNextNumber = query<HTMLInputElement>('#settings-next').checked;
    this.settings.soundEnabled = query<HTMLInputElement>('#settings-sound').checked;
    saveSettings(this.settings);
    this.settingsDialog.close();

    if (this.settingsContext === 'play') {
      if (this.mode === 'endless') {
        const profile = getEndlessStageSettings(this.stage);
        this.setCurrentBoard(this.createEndlessLevel(this.stage, profile), profile);
      } else {
        this.proceduralSeed += 1;
        this.setCurrentBoard(this.createNormalLevel());
      }
      await nextFrame();
    }
  }

  private openEditor(): void {
    this.showScreen('editor');
    this.editorActive.clear();
    this.editorPath = [];
    this.renderEditor();
    this.setEditorStatus('在网格上拖动，绘制需要一笔覆盖的形状。');
  }

  private editorSize(): { rows: number; columns: number } {
    if (this.editorShape === BoardShape.Rectangle) {
      const size = RECTANGLE_SIZES[this.editorRectangleIndex];
      return { rows: size.y, columns: size.x };
    }
    const size = this.editorShape === BoardShape.Diamond ? this.editorDiamondSize : this.editorSquareSize;
    return { rows: size, columns: size };
  }

  private changeEditorSize(direction: number): void {
    if (this.editorShape === BoardShape.Rectangle) {
      this.editorRectangleIndex = wrap(this.editorRectangleIndex + direction, 0, RECTANGLE_SIZES.length - 1);
    } else if (this.editorShape === BoardShape.Diamond) {
      this.editorDiamondSize = wrap(this.editorDiamondSize + direction, 3, 8);
    } else {
      this.editorSquareSize = wrap(this.editorSquareSize + direction, 3, 10);
    }
    this.trimEditorCells();
    this.invalidateEditorPath();
    this.renderEditor();
  }

  private trimEditorCells(): void {
    const { rows, columns } = this.editorSize();
    this.editorActive.forEach((key) => {
      const [x, y] = key.split(',').map(Number);
      if (x >= columns || y >= rows) this.editorActive.delete(key);
    });
  }

  private invalidateEditorPath(): void {
    this.editorPath = [];
    query<HTMLButtonElement>('#editor-save-button').disabled = true;
  }

  private renderEditor(): void {
    const { rows, columns } = this.editorSize();
    const grid = query<HTMLElement>('#editor-grid');
    grid.style.setProperty('--cols', String(columns));
    grid.style.setProperty('--rows', String(rows));
    grid.dataset.shape = this.editorShape === BoardShape.Diamond ? 'diamond' : 'normal';
    const order = new Map(this.editorPath.map((cell, index) => [cellKey(cell), index + 1]));
    const cells: HTMLButtonElement[] = [];

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const key = `${column},${row}`;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'editor-cell';
        button.setAttribute('aria-label', `第 ${row + 1} 行，第 ${column + 1} 列`);
        const value = order.get(key);
        if (this.editorActive.has(key)) button.classList.add('is-active');
        if (value) {
          button.classList.add('is-path');
          if (value === 1) button.classList.add('is-start');
          if (value === this.editorPath.length) button.classList.add('is-end');
          const span = document.createElement('span');
          span.textContent = String(value);
          button.append(span);
        }
        button.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          this.editorPainting = true;
          this.editorPaintValue = !this.editorActive.has(key);
          this.paintEditorCell(key);
        });
        button.addEventListener('pointerenter', (event) => {
          if (this.editorPainting && (event.buttons > 0 || event.pointerType === 'touch')) this.paintEditorCell(key);
        });
        cells.push(button);
      }
    }
    grid.replaceChildren(...cells);

    query<HTMLSelectElement>('#editor-shape').value = String(this.editorShape);
    query('#editor-size-value').textContent = `${columns} × ${rows}`;
    const nextId = getNextCustomLevelId(this.builtInLevels, this.customLevels);
    query('#editor-save-id').textContent = `下次保存：${nextId}`;
    const previewName = ['apple', 'banana', 'orange', 'grapes', 'basket', 'pineapple'][(nextId - 1) % 6];
    query<HTMLElement>('#editor-preview').style.backgroundImage = `url('./level-backgrounds/${previewName}.png')`;
  }

  private paintEditorCell(key: string): void {
    if (this.editorPaintValue) this.editorActive.add(key);
    else this.editorActive.delete(key);
    this.invalidateEditorPath();
    this.renderEditor();
  }

  private validateEditorLevel(): void {
    const { rows, columns } = this.editorSize();
    const path = findHamiltonianPath(rows, columns, this.editorActive);
    if (!path) {
      this.invalidateEditorPath();
      this.renderEditor();
      this.setEditorStatus('当前形状无法被一笔覆盖，请调整已涂色格子。', true);
      return;
    }
    this.editorPath = path;
    query<HTMLButtonElement>('#editor-save-button').disabled = false;
    this.renderEditor();
    this.setEditorStatus(`验证成功：${path.length} 个格子可一笔连接。`);
  }

  private saveEditorLevel(): void {
    if (this.editorPath.length === 0) {
      this.setEditorStatus('请先验证关卡。', true);
      return;
    }
    const { rows, columns } = this.editorSize();
    const levelId = getNextCustomLevelId(this.builtInLevels, this.customLevels);
    const backgroundNames = ['apple', 'banana', 'orange', 'grapes', 'basket', 'pineapple'];
    const activeCells = [...this.editorActive].map((key) => {
      const [x, y] = key.split(',').map(Number);
      return { x, y };
    }).sort((left, right) => left.y - right.y || left.x - right.x);
    saveCustomLevel({
      levelId,
      boardShape: this.editorShape,
      rows,
      columns,
      activeCells,
      solutionPath: this.editorPath,
      backgroundResourcePath: `LevelBackgrounds/${backgroundNames[(levelId - 1) % backgroundNames.length]}`,
      createdAtUtc: new Date().toISOString(),
      custom: true,
    });
    this.refreshLevels();
    this.refreshLevelOptions();
    this.renderEditor();
    this.setEditorStatus(`关卡 ${levelId} 已保存到浏览器。`);
  }

  private setEditorStatus(message: string, error = false): void {
    const status = query<HTMLElement>('#editor-status');
    status.textContent = message;
    status.classList.toggle('is-error', error);
  }

  private shapeLabel(shape: BoardShape): string {
    if (shape === BoardShape.Diamond) return '菱形';
    if (shape === BoardShape.Rectangle) return '长方形';
    return '正方形';
  }
}

const app = new NumberConnectApp();
void app.initialize().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  query<HTMLElement>('#lobby-title').textContent = '加载失败';
  query<HTMLElement>('.brand-lockup > p:last-child').textContent = message;
  console.error(error);
});
