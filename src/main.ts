import Phaser from 'phaser';
import './styles.css';
import type { GameEventMap } from './app/GameEvents';
import { ScreenRouter, type ScreenName } from './app/ScreenRouter';
import { query } from './app/dom';
import { EventBus } from './core/events/EventBus';
import { BoardScene } from './game/BoardScene';
import { getEndlessStageSettings } from './game/difficulty';
import { selectHiddenCells } from './game/hidden';
import { formatLives } from './game/lives';
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
  type BoardSessionInput,
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
import { LevelEditorController } from './gameplay/editor';
import {
  advanceBeadProgress,
  loadBeadPattern,
  loadBeadProgress,
  nextBeads,
  orderedBeads,
  saveBeadProgress,
  type BeadPatternData,
  type BeadPixel,
  type BeadProgress,
} from './gameplay/beads';
import { generateEndlessLevel } from './gameplay/endless/generateEndlessLevel';

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
type ResultContext = 'normal' | 'endless-stage' | 'life-depleted' | 'editor-playtest' | 'editor-playtest-failed';
type PlayContext = 'normal' | 'editor-playtest' | 'bead';

class NumberConnectApp {
  private readonly screenRouter = new ScreenRouter();
  private readonly events = new EventBus<GameEventMap>();
  private readonly gameHost = query<HTMLElement>('#game-host');
  private readonly playBackButton = query<HTMLButtonElement>('#back-button');
  private readonly levelLabel = query<HTMLElement>('#play-level-label');
  private readonly modeLabel = query<HTMLElement>('#play-mode-label');
  private readonly statusLabel = query<HTMLElement>('#play-status');
  private readonly livesLabel = query<HTMLElement>('#play-lives');
  private readonly solutionToggle = query<HTMLButtonElement>('#solution-toggle');
  private readonly solutionToggleLabel = query<HTMLElement>('#solution-toggle-label');
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
  private readonly beadPatternName = query<HTMLElement>('#bead-pattern-name');
  private readonly beadProgressText = query<HTMLElement>('#bead-progress-text');
  private readonly beadProgressFill = query<HTMLElement>('#bead-progress-fill');
  private readonly beadStatus = query<HTMLElement>('#bead-screen-status');
  private readonly beadStartButton = query<HTMLButtonElement>('#bead-start-button');

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
  private beadPattern?: BeadPatternData;
  private beadProgress?: BeadProgress;
  private currentBeadReward: BeadPixel[] = [];

  private readonly boardScene = new BoardScene();
  private readonly game: Phaser.Game;
  private readonly editor: LevelEditorController;

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
  }

  public async initialize(): Promise<void> {
    const boardReady = new Promise<void>((resolve) => {
      this.game.events.once('board-ready', () => resolve());
    });
    const [builtInLevels, beadPattern] = await Promise.all([loadBuiltInLevels(), loadBeadPattern(), boardReady]);
    this.builtInLevels = builtInLevels;
    this.beadPattern = beadPattern;
    this.beadProgress = loadBeadProgress(beadPattern);
    this.refreshLevels();
    this.bindLobby();
    this.bindPlayControls();
    this.bindSettings();
    this.editor.bind();
    this.refreshLevelOptions();
    this.renderVideoStats();
    this.renderBeadScreen();
  }

  private bindLobby(): void {
    query('#start-button').addEventListener('click', () => void this.startNormalMode());
    query('#endless-button').addEventListener('click', () => void this.startEndlessMode());
    query('#bead-mode-button').addEventListener('click', () => this.openBeadMode());
    query('#bead-back-button').addEventListener('click', () => this.closeBeadMode());
    this.beadStartButton.addEventListener('click', () => void this.startBeadLevel());
    query('#editor-button').addEventListener('click', () => this.openEditor());
    query('#lobby-settings-button').addEventListener('click', () => this.openSettings('lobby'));
  }

  private bindPlayControls(): void {
    this.playBackButton.addEventListener('click', () => this.leavePlayScreen());
    query('#play-settings-button').addEventListener('click', () => this.openSettings('play'));
    this.solutionToggle.addEventListener('click', () => this.setSolutionReveal(!this.solutionRevealed));
    this.restartButton.addEventListener('click', () => this.handleResultPrimary());
    this.nextButton.addEventListener('click', () => this.handleResultSecondary());
    this.resultLobbyButton.addEventListener('click', () => this.leavePlayScreen());
  }

  private bindSettings(): void {
    query('#settings-apply-button').addEventListener('click', () => void this.applySettings());
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
    this.resultOverlay.hidden = true;
    this.resultActionBusy = false;
    this.setResultActionsDisabled(false);
    const backLabel = this.playContext === 'editor-playtest'
      ? '返回关卡编辑器'
      : this.playContext === 'bead'
        ? '返回拼豆图纸'
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
    this.solutionToggle.setAttribute('aria-pressed', String(revealed));
    this.solutionToggle.setAttribute('aria-label', revealed ? '隐藏完整答案' : '显示隐藏数字和完整连线');
    this.solutionToggleLabel.textContent = revealed ? '隐藏答案' : '显示答案';
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
      mode: this.mode,
      onProgress: (current, total) => {
        this.currentProgress = current;
        this.currentTotal = total;
        this.setStatus(`${current} / ${total}`);
        if (this.playContext !== 'editor-playtest') {
          this.events.emit('level.progressed', { ...eventContext, current, total });
        }
      },
      onWrong: (message) => {
        if (this.playContext !== 'editor-playtest') {
          this.events.emit('level.wrong-move', { ...eventContext, current: this.currentProgress, message });
        }
        this.handleWrong(message);
      },
      onComplete: () => {
        if (this.playContext !== 'editor-playtest') {
          this.events.emit('level.completed', { ...eventContext, total: level.solutionPath.length });
        }
        void this.handleComplete();
      },
    };
  }

  private setCurrentBoard(level: LevelData, profile?: EndlessStageSettings): void {
    this.currentLevel = level;
    this.currentProgress = 0;
    this.currentTotal = level.solutionPath.length;
    this.updateGameHeading(level);
    this.setStatus(this.playContext === 'editor-playtest'
      ? '编辑器试玩 · 可从任意显示数字开始'
      : this.playContext === 'bead'
        ? `完成连线后翻开 ${this.currentBeadReward.length} 颗拼豆`
      : this.mode === 'endless'
        ? `阶段 ${this.stage} · 可从任意显示数字开始`
        : '可从任意显示数字开始，按连续顺序连接。');
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
    if (this.playContext === 'bead') {
      this.modeLabel.textContent = 'PIXEL BEADS';
      this.levelLabel.textContent = `拼豆关卡 · 关卡 ${level.levelId}`;
      return;
    }
    if (this.playContext === 'editor-playtest') {
      this.modeLabel.textContent = 'EDITOR PLAYTEST';
      this.levelLabel.textContent = `试玩关卡 · ${level.columns} × ${level.rows}`;
      return;
    }
    if (this.mode === 'endless') {
      this.modeLabel.textContent = 'ENDLESS MODE';
      this.levelLabel.textContent = `无尽 · 阶段 ${this.stage}`;
      return;
    }
    this.modeLabel.textContent = level.custom ? 'CUSTOM LEVEL' : 'LEVEL MODE';
    this.levelLabel.textContent = `${level.custom ? '自制关卡' : '关卡'} ${level.levelId}`;
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
    if (this.playContext === 'editor-playtest') {
      this.setStatus('编辑器试玩 · 生命值耗尽', true);
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
    this.resultLobbyButton.textContent = this.playContext === 'bead' ? '返回拼豆图纸' : '放弃';
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
    } else if (this.resultContext === 'normal') {
      this.nextLevel();
    }
  }

  private async handleComplete(): Promise<void> {
    if (this.playContext === 'bead') {
      this.setStatus(`关卡完成 · 获得 ${this.currentBeadReward.length} 颗拼豆`);
      await this.boardScene.showCompletion();
      if (this.playContext !== 'bead' || !this.beadPattern || !this.beadProgress) return;

      const previousCollected = this.beadProgress.collected;
      const rewardCount = this.currentBeadReward.length;
      this.beadProgress = advanceBeadProgress(this.beadPattern, this.beadProgress, rewardCount);
      saveBeadProgress(this.beadProgress);
      this.currentBeadReward = [];
      this.selectNextNormalLevel();
      this.showScreen('bead');
      this.renderBeadScreen(previousCollected, `本关获得 ${rewardCount} 颗拼豆，已放入图纸。`);
      return;
    }
    if (this.playContext === 'editor-playtest') {
      this.setStatus('编辑器试玩完成');
      await this.boardScene.showCompletion();
      if (this.playContext === 'editor-playtest') this.showEditorPlaytestResult();
      return;
    }
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
      this.events.emit('video.rewarded', { placement: 'endless-stage-complete', stage: this.stage });
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
      this.setStatus(`阶段 ${this.stage} · 可从任意显示数字开始`);
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
    this.setStatus('生命 +1 · 继续连接相邻的连续数字');
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
        : '返回大厅';
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
    query<HTMLSelectElement>('#settings-level').value = String(this.settings.selectedLevelId);
    query<HTMLInputElement>('#settings-next').checked = this.settings.showNextNumber;
    query<HTMLInputElement>('#settings-sound').checked = this.settings.soundEnabled;
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
      && (this.mode === 'endless' || this.playContext === 'editor-playtest' || this.playContext === 'bead');
    query<HTMLSelectElement>('#settings-level').disabled = levelLocked;
  }

  private async applySettings(): Promise<void> {
    this.settings.shape = BoardShape.Level;
    this.settings.selectedLevelId = Number(query<HTMLSelectElement>('#settings-level').value) || this.settings.selectedLevelId;
    this.settings.showNextNumber = query<HTMLInputElement>('#settings-next').checked;
    this.settings.soundEnabled = query<HTMLInputElement>('#settings-sound').checked;
    saveSettings(this.settings);
    this.settingsDialog.close();

    if (this.settingsContext === 'play') {
      if (this.mode === 'endless') {
        const profile = getEndlessStageSettings(this.stage);
        this.setCurrentBoard(this.createEndlessLevel(this.stage, profile), profile);
      } else if ((this.playContext === 'editor-playtest' || this.playContext === 'bead') && this.currentLevel) {
        this.setCurrentBoard(this.currentLevel);
      } else {
        this.setCurrentBoard(this.createNormalLevel());
      }
      await nextFrame();
    }
  }

  private openEditor(): void {
    this.playContext = 'normal';
    this.showScreen('editor');
    this.editor.open();
  }

  private openBeadMode(): void {
    this.playContext = 'bead';
    this.renderBeadScreen();
    this.showScreen('bead');
  }

  private closeBeadMode(): void {
    this.playContext = 'normal';
    this.showScreen('lobby');
  }

  private renderBeadScreen(animateFrom?: number, message?: string): void {
    if (!this.beadPattern || !this.beadProgress) {
      this.beadStartButton.disabled = true;
      this.beadStatus.textContent = '拼豆图纸读取失败。';
      return;
    }

    const pattern = this.beadPattern;
    const beads = orderedBeads(pattern);
    const collected = Math.min(beads.length, this.beadProgress.collected);
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
          cell.classList.add('is-target');
          cell.style.setProperty('--bead-color', color);
          cell.title = `(${x}, ${y}) ${color}`;
          if (order < collected) cell.classList.add('is-filled');
          if (animateFrom !== undefined && order >= animateFrom && order < collected) {
            cell.classList.add('is-new');
            cell.style.setProperty('--bead-delay', `${Math.min(620, (order - animateFrom) * 18)}ms`);
          }
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
    this.beadBoard.replaceChildren(...cells);
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
  }

}

const app = new NumberConnectApp();
void app.initialize().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  query<HTMLElement>('#lobby-title').textContent = '加载失败';
  query<HTMLElement>('#lobby-title').title = message;
  console.error(error);
});
