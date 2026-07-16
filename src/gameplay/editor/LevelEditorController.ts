import './editor.css';
import { BoardShape, type LevelData } from '../../game/types';
import { EditorSplitPaneController } from './EditorSplitPaneController';
import { calculateSquareGridLayout } from './editorGridLayout';
import {
  recognizeImageHiddenLayout,
  recognizeImageLevel,
  type ImageRecognitionMode,
  type ImageRecognitionProgress,
} from './ImageLevelRecognizer';
import { calculateEditorLevelMetrics } from './levelMetrics';
import { LevelEditorModel } from './LevelEditorModel';
import { mountLevelEditorView } from './LevelEditorView';
import { simulateLevelPlay, type SimulatedPlayResult } from './simulateLevelPlay';
import {
  EDITOR_ALGORITHMS,
  editorAlgorithmLabel,
  renderEditorAlgorithmParameters,
  type EditorAlgorithmId,
} from './algorithms';
import type { EditorCell, EditorShape, ManualEditMode } from './types';

interface LevelEditorControllerOptions {
  getLevels: () => LevelData[];
  getNextLevelId: () => number;
  onLevelsChange: (levels: LevelData[]) => void;
  onPlaytest: (level: LevelData) => void;
  onBack: () => void;
}

interface SimulationCellEvent {
  stepIndex: number;
  from: EditorCell;
  to: EditorCell;
  isError: boolean;
  completesStep: boolean;
}

interface SimulationErrorAttempt {
  from: EditorCell;
  to: EditorCell;
}

interface SimulationOverlayPoint {
  key: string;
  x: number;
  y: number;
  size: number;
}

const SIMULATION_STEP_INTERVAL_MS = 500;

export class LevelEditorController {
  private readonly model = new LevelEditorModel();
  private painting = false;
  private paintValue = true;
  private lastManualPathHitKey?: string;
  private bound = false;
  private selectedLevelId?: number;
  private readonly splitPane: EditorSplitPaneController;
  private readonly workspaceResizeObserver: ResizeObserver;
  private pathRevealCount?: number;
  private pathAnimationTimer?: number;
  private pathAnimationRun = 0;
  private isPathAnimating = false;
  private imageRecognitionRun = 0;
  private isImageRecognizing = false;
  private imageRecognitionMode: ImageRecognitionMode = 'complete-level';
  private recognitionAmbiguousCellKeys = new Set<string>();
  private recognitionAmbiguousPathSignature?: string;
  private simulationResult?: SimulatedPlayResult;
  private simulationSignature?: string;
  private simulationVisibleStepCount = 0;
  private simulationAnimationTimer?: number;
  private simulationAnimationRun = 0;
  private isSimulationAnimating = false;
  private simulationCellEvents: SimulationCellEvent[] = [];
  private simulationCellEventIndex = 0;
  private simulationSuccessfulCells: EditorCell[] = [];
  private simulationErrorAttempts: SimulationErrorAttempt[] = [];

  public constructor(
    private readonly host: HTMLElement,
    private readonly options: LevelEditorControllerOptions,
  ) {
    mountLevelEditorView(this.host);
    this.splitPane = new EditorSplitPaneController(
      this.query<HTMLElement>('.editor-layout'),
      this.query<HTMLElement>('#editor-resizer'),
    );
    this.workspaceResizeObserver = new ResizeObserver(() => {
      this.layoutGrid();
      this.renderPathLines();
      this.renderSimulationOverlay();
    });
  }

  public bind(): void {
    if (this.bound) return;
    this.bound = true;
    this.splitPane.bind();
    this.workspaceResizeObserver.observe(this.query<HTMLElement>('.editor-workspace'));
    this.query('#editor-back-button').addEventListener('click', () => {
      this.cancelPathAnimation();
      this.cancelImageRecognition();
      this.cancelSimulationAnimation();
      this.options.onBack();
    });
    this.query<HTMLSelectElement>('#editor-shape').addEventListener('change', (event) => {
      this.model.setShape((event.target as HTMLSelectElement).value as EditorShape);
      this.render();
    });
    this.query<HTMLSelectElement>('#editor-algorithm').addEventListener('change', (event) => {
      const id = (event.target as HTMLSelectElement).value as EditorAlgorithmId;
      this.model.setAlgorithm(id);
      this.render();
      this.setStatus(`已切换为${editorAlgorithmLabel(id)}，请重新生成路径。`);
    });
    this.query<HTMLSelectElement>('#editor-manual-mode').addEventListener('change', (event) => {
      const mode = (event.target as HTMLSelectElement).value as ManualEditMode;
      this.model.setManualEditMode(mode);
      this.render();
      const message = mode === 'path'
        ? '手动路径：按顺序绘制相邻格子，已经过的格子不能重复。'
        : mode === 'hidden'
          ? '手动隐藏：点击路径中的数字切换隐藏状态。'
          : '手动编辑已关闭。';
      this.setStatus(message);
    });
    this.query('#editor-size-minus').addEventListener('click', () => {
      this.model.changeSize(-1);
      this.render();
    });
    this.query('#editor-size-plus').addEventListener('click', () => {
      this.model.changeSize(1);
      this.render();
    });
    this.query('#editor-width-minus').addEventListener('click', () => {
      this.model.changeSize(-1, 'columns');
      this.render();
    });
    this.query('#editor-width-plus').addEventListener('click', () => {
      this.model.changeSize(1, 'columns');
      this.render();
    });
    this.query('#editor-height-minus').addEventListener('click', () => {
      this.model.changeSize(-1, 'rows');
      this.render();
    });
    this.query('#editor-height-plus').addEventListener('click', () => {
      this.model.changeSize(1, 'rows');
      this.render();
    });
    this.query('#editor-clear-button').addEventListener('click', () => {
      this.model.clear();
      this.render();
      this.setStatus('棋盘已清空。');
    });
    this.query('#editor-fill-button').addEventListener('click', () => {
      this.model.fill();
      this.render();
      this.setStatus('棋盘已填满，请生成路径。');
    });
    this.query('#editor-image-level-button').addEventListener('click', () => void this.readImageFromClipboard('complete-level'));
    this.query('#editor-image-hidden-button').addEventListener('click', () => void this.readImageFromClipboard('hidden-layout'));
    this.query('#editor-image-formation-button').addEventListener('click', () => void this.readImageFromClipboard('initial-formation'));
    this.query('#editor-undo-delete-button').addEventListener('click', () => this.undoLastDeletion());
    this.query('#editor-generate-path-button').addEventListener('click', () => this.generatePath());
    this.query('#editor-simulate-button').addEventListener('click', () => this.simulatePlay());
    this.query('#editor-playtest-button').addEventListener('click', () => this.playtest());
    this.query('#editor-save-button').addEventListener('click', () => this.save());
    this.query('#editor-level-add').addEventListener('click', () => this.save());
    this.query('#editor-level-import').addEventListener('click', () => this.query<HTMLInputElement>('#editor-level-file').click());
    this.query('#editor-level-export').addEventListener('click', () => this.exportLevels());
    this.query<HTMLInputElement>('#editor-level-file').addEventListener('change', (event) => void this.importLevels(event));
    window.addEventListener('pointerup', () => {
      this.painting = false;
      this.lastManualPathHitKey = undefined;
    });
    window.addEventListener('pointercancel', () => {
      this.painting = false;
      this.lastManualPathHitKey = undefined;
    });
    window.addEventListener('keydown', (event) => {
      if (this.host.hidden || (!event.ctrlKey && !event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 'z') return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return;
      if (!this.model.canUndoDeletion) return;
      event.preventDefault();
      this.undoLastDeletion();
    });
    window.addEventListener('paste', (event) => {
      if (this.host.hidden || this.isImageRecognizing) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return;
      const imageItem = [...(event.clipboardData?.items ?? [])]
        .find((item) => item.kind === 'file' && item.type.startsWith('image/'));
      const image = imageItem?.getAsFile();
      if (!image) return;
      event.preventDefault();
      void this.recognizeClipboardImage(image, this.imageRecognitionMode);
    });
  }

  public open(): void {
    this.cancelPathAnimation();
    this.clearRecognitionAmbiguity();
    this.clearSimulationResult();
    this.selectedLevelId = undefined;
    this.model.reset();
    this.render();
    this.setStatus('在左侧棋盘拖动绘制形状，然后选择算法生成路径。');
  }

  public resumeFromPlaytest(): void {
    this.cancelPathAnimation();
    this.render();
    this.setStatus('已返回编辑器，可继续调整当前关卡。');
  }

  private render(): void {
    const { rows, columns } = this.model.size();
    if (
      this.recognitionAmbiguousPathSignature !== undefined
      && this.recognitionAmbiguousPathSignature !== this.currentPathSignature()
    ) {
      this.clearRecognitionAmbiguity();
    }
    if (
      this.simulationSignature !== undefined
      && this.simulationSignature !== this.currentSimulationSignature()
    ) {
      this.clearSimulationResult();
    }
    const grid = this.query<HTMLElement>('#editor-grid');
    grid.style.setProperty('--cols', String(columns));
    grid.style.setProperty('--rows', String(rows));
    const hexRightPadding = (1 / 3) / (columns + 1 / 3) * 100;
    const hexBottomPadding = 0.5 / (rows + 0.5) * 100;
    grid.style.setProperty('--hex-right-padding', `${hexRightPadding}%`);
    grid.style.setProperty('--hex-bottom-padding', `${hexBottomPadding}%`);
    grid.style.aspectRatio = this.model.shape === 'hex'
      ? String((columns + 1 / 3) / (1.1547005 * (rows + 0.5)))
      : '';
    grid.dataset.shape = this.model.shape;
    grid.dataset.manualMode = this.model.manualEditMode;
    grid.setAttribute('aria-busy', String(this.isPathAnimating || this.isSimulationAnimating));
    this.host.classList.toggle('is-path-animating', this.isPathAnimating);
    this.host.classList.toggle('is-image-recognizing', this.isImageRecognizing);
    this.host.classList.toggle('is-simulation-animating', this.isSimulationAnimating);
    const order = this.model.pathOrder();
    const visiblePathLength = this.pathRevealCount ?? this.model.solutionPath.length;
    const cells: HTMLButtonElement[] = [];

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const key = `${column},${row}`;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'editor-cell';
        button.dataset.cellKey = key;
        if (!this.model.isAvailableCell(column, row)) {
          button.classList.add('is-unavailable');
          button.disabled = true;
          button.tabIndex = -1;
          button.setAttribute('aria-hidden', 'true');
        }
        if (column % 2 === 1) button.classList.add('is-column-odd');
        button.setAttribute('aria-label', `第 ${row + 1} 行，第 ${column + 1} 列`);
        const value = order.get(key);
        const pathVisible = value !== undefined && value <= visiblePathLength;
        if (this.model.activeCells.has(key)) button.classList.add('is-active');
        if (pathVisible && this.model.hiddenCellKeys.has(key)) button.classList.add('is-manual-hidden');
        if (pathVisible) {
          button.classList.add('is-path');
          button.title = this.model.manualEditMode === 'hidden'
            ? '右键取消该格子的隐藏状态'
            : '右键删除此格子之后的路径和格子';
          if (value === 1) button.classList.add('is-start');
          if (value === this.model.solutionPath.length && !this.isPathAnimating) button.classList.add('is-end');
          button.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            this.painting = false;
            this.handlePathContextAction(key);
          });
        }
        if (this.recognitionAmbiguousCellKeys.has(key)) {
          button.classList.add('is-recognition-ambiguous');
          button.setAttribute('aria-label', `${button.getAttribute('aria-label')}，OCR 结果待核对`);
          button.title = `${button.title ? `${button.title}；` : ''}OCR 结果待核对`;
        }
        button.addEventListener('pointerdown', (event) => {
          if (!this.model.isAvailableCell(column, row)) return;
          event.preventDefault();
          if (this.model.manualEditMode === 'off') {
            this.painting = true;
            this.paintValue = this.model.shouldPaintCell(key);
            this.paintCell(key);
          } else if (this.model.manualEditMode === 'path') {
            if (!this.isWithinManualPathHitArea(event, button)) return;
            this.painting = true;
            this.lastManualPathHitKey = key;
            this.editManualCell(key);
          } else {
            this.painting = false;
            this.editManualCell(key);
          }
        });
        button.addEventListener('pointerenter', (event) => {
          if (!this.model.isAvailableCell(column, row) || !this.painting || (event.buttons <= 0 && event.pointerType !== 'touch')) return;
          if (this.model.manualEditMode === 'off') this.paintCell(key);
        });
        button.addEventListener('pointermove', (event) => {
          if (this.model.manualEditMode !== 'path' || !this.painting) return;
          const pointerPressed = event.buttons > 0 || event.pressure > 0 || event.pointerType === 'touch';
          if (!pointerPressed || this.lastManualPathHitKey === key || !this.isWithinManualPathHitArea(event, button)) return;
          this.lastManualPathHitKey = key;
          this.editManualCell(key);
        });
        cells.push(button);
      }
    }
    grid.replaceChildren(...cells);
    this.layoutGrid();
    this.renderPathLines();

    const shapeSelect = this.query<HTMLSelectElement>('#editor-shape');
    shapeSelect.value = this.model.shape;
    shapeSelect.disabled = this.isPathAnimating;
    const manualModeSelect = this.query<HTMLSelectElement>('#editor-manual-mode');
    manualModeSelect.value = this.model.manualEditMode;
    manualModeSelect.disabled = this.isPathAnimating;
    this.renderAlgorithmControls();
    const fillButton = this.query<HTMLButtonElement>('#editor-fill-button');
    fillButton.hidden = false;
    fillButton.disabled = this.isPathAnimating;
    this.query<HTMLButtonElement>('#editor-clear-button').disabled = this.isPathAnimating;
    this.query<HTMLButtonElement>('#editor-generate-path-button').disabled = this.model.manualEditMode !== 'off' || this.isPathAnimating;
    this.query<HTMLButtonElement>('#editor-undo-delete-button').disabled = !this.model.canUndoDeletion || this.isPathAnimating;
    const sizeLimits = this.model.sizeLimits();
    const isRectangle = this.model.shape === 'rectangle';
    this.query<HTMLElement>('#editor-uniform-size').hidden = isRectangle;
    this.query<HTMLElement>('#editor-rectangle-size').hidden = !isRectangle;
    this.query('#editor-size-value').textContent = `${columns} × ${rows}`;
    this.query('#editor-width-value').textContent = String(columns);
    this.query('#editor-height-value').textContent = String(rows);
    this.query<HTMLButtonElement>('#editor-size-minus').disabled = this.isPathAnimating || rows <= sizeLimits.min;
    this.query<HTMLButtonElement>('#editor-size-plus').disabled = this.isPathAnimating || rows >= sizeLimits.max;
    this.query<HTMLButtonElement>('#editor-width-minus').disabled = this.isPathAnimating || columns <= sizeLimits.min;
    this.query<HTMLButtonElement>('#editor-width-plus').disabled = this.isPathAnimating || columns >= sizeLimits.max;
    this.query<HTMLButtonElement>('#editor-height-minus').disabled = this.isPathAnimating || rows <= sizeLimits.min;
    this.query<HTMLButtonElement>('#editor-height-plus').disabled = this.isPathAnimating || rows >= sizeLimits.max;
    const imageLevelButton = this.query<HTMLButtonElement>('#editor-image-level-button');
    const imageHiddenButton = this.query<HTMLButtonElement>('#editor-image-hidden-button');
    const imageFormationButton = this.query<HTMLButtonElement>('#editor-image-formation-button');
    [imageLevelButton, imageHiddenButton, imageFormationButton].forEach((button) => {
      button.disabled = this.isPathAnimating || this.isImageRecognizing;
      button.classList.remove('is-loading');
    });
    imageHiddenButton.disabled ||= !this.model.hasGeneratedPath;
    imageLevelButton.textContent = '识别完整关卡';
    imageHiddenButton.textContent = '识别隐藏';
    imageFormationButton.textContent = '识别初始阵型';
    if (this.isImageRecognizing) {
      const activeButton = this.imageRecognitionMode === 'initial-formation'
        ? imageFormationButton
        : this.imageRecognitionMode === 'hidden-layout'
          ? imageHiddenButton
          : imageLevelButton;
      activeButton.classList.add('is-loading');
      activeButton.textContent = '识别中…';
    }
    const nextId = this.options.getNextLevelId();
    this.query('#editor-save-id').textContent = `下次保存：${nextId}`;
    this.query<HTMLElement>('#editor-preview').style.backgroundImage = `url('./level-backgrounds/${this.model.previewName(nextId)}.png')`;
    this.query<HTMLButtonElement>('#editor-save-button').disabled = !this.model.hasGeneratedPath || this.isPathAnimating;
    this.query<HTMLButtonElement>('#editor-playtest-button').disabled = !this.model.hasGeneratedPath || this.isPathAnimating;
    this.query<HTMLButtonElement>('#editor-level-add').disabled = !this.model.hasGeneratedPath || this.isPathAnimating;
    this.renderLevelMetrics(rows, columns);
    this.renderSimulationPanel();
    this.renderLevelList();
  }

  private renderLevelMetrics(rows: number, columns: number): void {
    const metrics = calculateEditorLevelMetrics({
      path: this.model.solutionPath,
      hiddenCellKeys: this.model.hiddenCellKeys,
      shape: this.model.shape,
    });
    const hiddenPercent = Math.round(metrics.hiddenRatio * 1000) / 10;
    const hiddenTotal = this.model.solutionPath.length || this.model.activeCells.size;
    this.query('#editor-info-size').textContent = `${columns} × ${rows}`;
    this.query('#editor-info-right-turns').textContent = String(metrics.rightAngleTurns);
    this.query('#editor-info-acute-turns').textContent = String(metrics.acuteAngleTurns);
    this.query('#editor-info-obtuse-turns').textContent = String(metrics.obtuseAngleTurns);
    this.query('#editor-info-straight').textContent = String(metrics.straightContinuations);
    this.query('#editor-info-crossings').textContent = String(metrics.pathCrossings);
    this.query('#editor-info-hidden-ratio').textContent = `${hiddenPercent}% · ${metrics.hiddenCount}/${hiddenTotal}`;
    this.query('#editor-info-hidden-run').textContent = String(metrics.longestHiddenRun);
    this.query('#editor-info-visible-run').textContent = String(metrics.longestVisibleRun);
  }

  private simulatePlay(): void {
    if (this.isSimulationAnimating) {
      this.cancelSimulationAnimation();
      this.renderSimulationPanel();
      this.setStatus(`模拟已停止：已移动 ${this.simulationCellEventIndex}/${this.simulationCellEvents.length} 格，完成 ${this.simulationVisibleStepCount}/${this.simulationResult?.totalSteps ?? 0} 步。`);
      return;
    }
    if (!this.model.hasGeneratedPath) {
      this.setStatus('请先生成覆盖全部格子的路径。', true);
      return;
    }
    this.cancelSimulationAnimation();
    this.simulationResult = simulateLevelPlay({
      path: this.model.solutionPath,
      hiddenCellKeys: this.model.hiddenCellKeys,
      shape: this.model.shape,
    });
    this.simulationSignature = this.currentSimulationSignature();
    this.simulationVisibleStepCount = 0;
    this.simulationCellEvents = this.createSimulationCellEvents(this.simulationResult);
    this.simulationCellEventIndex = 0;
    this.simulationErrorAttempts = [];
    const startingCell = this.simulationResult.steps[0]?.attemptedCells[0];
    this.simulationSuccessfulCells = startingCell ? [{ ...startingCell }] : [];
    this.isSimulationAnimating = this.simulationCellEvents.length > 0;
    if (!this.isSimulationAnimating) this.simulationVisibleStepCount = this.simulationResult.totalSteps;
    this.host.classList.toggle('is-simulation-animating', this.isSimulationAnimating);
    this.renderSimulationPanel();
    if (!this.isSimulationAnimating) {
      this.setStatus('模拟完成：当前关卡没有可播放的步骤。');
      return;
    }
    const run = ++this.simulationAnimationRun;
    this.setStatus(`模拟开始：每 ${SIMULATION_STEP_INTERVAL_MS / 1000} 秒前进一格，共 ${this.simulationCellEvents.length} 次移动。`);
    this.scheduleNextSimulationStep(run);
  }

  private createSimulationCellEvents(result: SimulatedPlayResult): SimulationCellEvent[] {
    return result.steps.flatMap((step, stepIndex) => step.attemptedCells.slice(1).map((to, offset) => {
      const cellIndex = offset + 1;
      const completesStep = cellIndex === step.attemptedCells.length - 1;
      return {
        stepIndex,
        from: { ...step.attemptedCells[cellIndex - 1] },
        to: { ...to },
        isError: completesStep && step.outcome === 'error',
        completesStep,
      };
    }));
  }

  private scheduleNextSimulationStep(run: number): void {
    this.simulationAnimationTimer = window.setTimeout(() => {
      this.simulationAnimationTimer = undefined;
      this.advanceSimulationAnimation(run);
    }, SIMULATION_STEP_INTERVAL_MS);
  }

  private advanceSimulationAnimation(run: number): void {
    if (run !== this.simulationAnimationRun || !this.isSimulationAnimating || !this.simulationResult) return;
    const event = this.simulationCellEvents[this.simulationCellEventIndex];
    if (!event) return;
    if (event.isError) {
      this.simulationErrorAttempts.push({ from: { ...event.from }, to: { ...event.to } });
    } else {
      const lastCell = this.simulationSuccessfulCells[this.simulationSuccessfulCells.length - 1];
      if (!lastCell || `${lastCell.x},${lastCell.y}` !== `${event.from.x},${event.from.y}`) {
        this.simulationSuccessfulCells.push({ ...event.from });
      }
      this.simulationSuccessfulCells.push({ ...event.to });
    }
    this.simulationCellEventIndex += 1;
    if (event.completesStep) this.simulationVisibleStepCount = event.stepIndex + 1;
    const total = this.simulationResult.totalSteps;
    const finished = this.simulationCellEventIndex >= this.simulationCellEvents.length;
    if (finished) {
      this.isSimulationAnimating = false;
      this.host.classList.remove('is-simulation-animating');
    }
    this.renderSimulationPanel();
    if (finished) {
      this.setStatus(`模拟完成：共 ${total} 步，错误 ${this.simulationResult.errorCount} 次。`);
      return;
    }
    if (event.isError) {
      this.setStatus(`正在模拟第 ${event.stepIndex + 1}/${total} 步：猜错一格，已标红并排除该选项。`);
    } else if (event.completesStep) {
      this.setStatus(`已完成第 ${event.stepIndex + 1}/${total} 步，继续下一步。`);
    } else {
      this.setStatus(`正在模拟第 ${event.stepIndex + 1}/${total} 步：前进到第 ${this.simulationSuccessfulCells.length} 个格子。`);
    }
    this.scheduleNextSimulationStep(run);
  }

  private renderSimulationPanel(): void {
    const button = this.query<HTMLButtonElement>('#editor-simulate-button');
    const summary = this.query<HTMLElement>('#editor-simulation-summary');
    const results = this.query<HTMLElement>('#editor-simulation-results');
    button.disabled = !this.model.hasGeneratedPath || this.isPathAnimating || this.isImageRecognizing;
    button.textContent = this.isSimulationAnimating
      ? '停止模拟'
      : this.simulationResult ? '重新模拟' : '开始模拟';
    button.classList.toggle('is-running', this.isSimulationAnimating);

    if (!this.simulationResult) {
      summary.hidden = true;
      const empty = document.createElement('p');
      empty.className = 'editor-simulation-empty';
      empty.textContent = this.model.hasGeneratedPath
        ? '点击开始模拟，查看一次随机玩家体验。'
        : '生成完整路径后，即可模拟一次玩家体验。';
      results.replaceChildren(empty);
      this.renderSimulationOverlay();
      return;
    }

    summary.hidden = false;
    const visibleSteps = this.simulationResult.steps.slice(0, this.simulationVisibleStepCount);
    const visibleErrors = visibleSteps.filter((step) => step.outcome === 'error').length;
    this.query('#editor-simulation-total-steps').textContent = this.simulationVisibleStepCount === this.simulationResult.totalSteps
      ? String(this.simulationResult.totalSteps)
      : `${this.simulationVisibleStepCount}/${this.simulationResult.totalSteps}`;
    this.query('#editor-simulation-error-count').textContent = String(visibleErrors);
    const cards = visibleSteps.map((step, index) => {
      const card = document.createElement('article');
      card.className = `editor-simulation-step${step.outcome === 'error' ? ' is-error' : ''}${index === visibleSteps.length - 1 ? ' is-current' : ''}`;

      const header = document.createElement('div');
      header.className = 'editor-simulation-step__header';
      const title = document.createElement('b');
      title.textContent = `第 ${step.stepNumber} 步`;
      const status = document.createElement('span');
      status.className = 'editor-simulation-step__status';
      status.textContent = step.outcome === 'error' ? '猜错' : '完成';
      header.append(title, status);

      const range = document.createElement('div');
      range.className = 'editor-simulation-step__range';
      range.textContent = step.outcome === 'error'
        ? `从数字 ${step.startNumber} 出发 · 停在 ${step.endNumber}`
        : `从数字 ${step.startNumber} 连接到 ${step.endNumber}`;

      const metrics = document.createElement('dl');
      const appendMetric = (label: string, value: number, tooltip?: string): void => {
        const item = document.createElement('div');
        if (tooltip) item.title = tooltip;
        const term = document.createElement('dt');
        term.textContent = label;
        const description = document.createElement('dd');
        description.textContent = String(value);
        item.append(term, description);
        metrics.append(item);
      };
      appendMetric('长度', step.length, '本步连出的线段数；猜错时包含最后一段错误尝试。');
      appendMetric('拐弯', step.turnCount);
      appendMetric('填空', step.filledHiddenCount, '本步正确填入的隐藏数字数量。');
      appendMetric('分叉', step.forkCount, '本步遇到两个或更多未知候选空位的次数。');
      card.append(header, range, metrics);
      return card;
    });
    if (cards.length === 0) {
      const pending = document.createElement('p');
      pending.className = 'editor-simulation-empty is-running';
      pending.textContent = '已定位起点…0.5 秒后前进第 1 格。';
      results.replaceChildren(pending);
    } else {
      results.replaceChildren(...cards);
      window.requestAnimationFrame(() => {
        results.scrollTo({
          top: results.scrollHeight,
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        });
      });
    }
    this.renderSimulationOverlay();
  }

  private renderSimulationOverlay(): void {
    const svg = this.query<SVGSVGElement>('#editor-simulation-overlay');
    svg.replaceChildren();
    const hasOverlay = this.simulationResult !== undefined && this.simulationSuccessfulCells.length > 0;
    this.host.classList.toggle('has-simulation-overlay', hasOverlay);
    if (!hasOverlay) return;

    const workspace = this.query<HTMLElement>('.editor-workspace');
    const workspaceBounds = workspace.getBoundingClientRect();
    if (workspaceBounds.width <= 0 || workspaceBounds.height <= 0) return;
    const cellsByKey = new Map(
      [...this.host.querySelectorAll<HTMLButtonElement>('.editor-cell[data-cell-key]')]
        .map((cell) => [cell.dataset.cellKey!, cell] as const),
    );
    const pointFor = (cell: EditorCell): SimulationOverlayPoint | null => {
      const key = `${cell.x},${cell.y}`;
      const button = cellsByKey.get(key);
      if (!button) return null;
      const bounds = button.getBoundingClientRect();
      return {
        key,
        x: bounds.left + bounds.width * 0.5 - workspaceBounds.left,
        y: bounds.top + bounds.height * 0.5 - workspaceBounds.top,
        size: Math.min(bounds.width, bounds.height),
      };
    };
    const successfulPoints = this.simulationSuccessfulCells
      .map(pointFor)
      .filter((point): point is SimulationOverlayPoint => point !== null);
    if (successfulPoints.length === 0) return;

    svg.setAttribute('viewBox', `0 0 ${workspaceBounds.width} ${workspaceBounds.height}`);
    const createSvgElement = <K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] => (
      document.createElementNS('http://www.w3.org/2000/svg', tag)
    );
    const appendNumberNode = (
      point: SimulationOverlayPoint,
      value: number,
      nodeClassName: string,
      labelClassName: string,
    ): void => {
      const digitCount = String(value).length;
      const fontSize = Math.max(8, Math.min(28, point.size * (digitCount >= 3 ? 0.3 : digitCount === 2 ? 0.38 : 0.46)));
      // Keep every number circle the same size; only the font scales for wider labels.
      const radius = Math.max(11, Math.min(24, point.size * 0.4));
      const node = createSvgElement('circle');
      node.setAttribute('cx', String(point.x));
      node.setAttribute('cy', String(point.y));
      node.setAttribute('r', String(radius));
      node.setAttribute('class', `editor-simulation-node${nodeClassName}`);
      const label = createSvgElement('text');
      label.setAttribute('x', String(point.x));
      label.setAttribute('y', String(point.y));
      label.setAttribute('font-size', String(fontSize));
      label.setAttribute('class', `editor-simulation-number${labelClassName}`);
      label.textContent = String(value);
      svg.append(node, label);
    };
    const appendPolyline = (className: string): void => {
      const line = createSvgElement('polyline');
      line.setAttribute('class', className);
      line.setAttribute('points', successfulPoints.map((point) => `${point.x},${point.y}`).join(' '));
      svg.append(line);
    };
    if (successfulPoints.length >= 2) {
      appendPolyline('editor-simulation-line editor-simulation-line--shadow');
      appendPolyline('editor-simulation-line editor-simulation-line--main');
    }

    this.simulationErrorAttempts.forEach((attempt) => {
      const from = pointFor(attempt.from);
      const to = pointFor(attempt.to);
      if (!from || !to) return;
      const appendErrorLine = (className: string): void => {
        const line = createSvgElement('line');
        line.setAttribute('class', className);
        line.setAttribute('x1', String(from.x));
        line.setAttribute('y1', String(from.y));
        line.setAttribute('x2', String(to.x));
        line.setAttribute('y2', String(to.y));
        svg.append(line);
      };
      appendErrorLine('editor-simulation-line editor-simulation-line--error-shadow');
      appendErrorLine('editor-simulation-line editor-simulation-line--error');
    });

    const simulationFinished = !this.isSimulationAnimating
      && this.simulationCellEventIndex >= this.simulationCellEvents.length;
    const successfulKeys = new Set(successfulPoints.map((point) => point.key));
    this.model.solutionPath.forEach((cell, index) => {
      const key = `${cell.x},${cell.y}`;
      if (this.model.hiddenCellKeys.has(key) || successfulKeys.has(key)) return;
      const point = pointFor(cell);
      if (!point) return;
      appendNumberNode(point, index + 1, ' is-clue', ' is-clue');
    });
    successfulPoints.forEach((point, index) => {
      const hidden = this.model.hiddenCellKeys.has(point.key);
      appendNumberNode(
        point,
        index + 1,
        `${index === 0 ? ' is-start' : ''}${index === successfulPoints.length - 1 ? ' is-current' : ''}${simulationFinished && index === successfulPoints.length - 1 ? ' is-end' : ''}${hidden ? ' is-hidden' : ''}`,
        `${index === 0 ? ' is-start' : ''}${hidden ? ' is-hidden' : ''}`,
      );
    });

    this.simulationErrorAttempts.forEach((attempt) => {
      const point = pointFor(attempt.to);
      if (!point) return;
      const targetKey = `${attempt.to.x},${attempt.to.y}`;
      const targetNowConnected = this.simulationSuccessfulCells.some((cell) => `${cell.x},${cell.y}` === targetKey);
      const radius = targetNowConnected
        ? Math.max(7, Math.min(12, point.size * 0.2))
        : Math.max(12, Math.min(24, point.size * 0.38));
      const markerX = point.x + (targetNowConnected ? point.size * 0.27 : 0);
      const markerY = point.y - (targetNowConnected ? point.size * 0.27 : 0);
      const node = createSvgElement('circle');
      node.setAttribute('cx', String(markerX));
      node.setAttribute('cy', String(markerY));
      node.setAttribute('r', String(radius));
      node.setAttribute('class', 'editor-simulation-error-node');
      const label = createSvgElement('text');
      label.setAttribute('x', String(markerX));
      label.setAttribute('y', String(markerY));
      label.setAttribute('font-size', String(radius * 1.25));
      label.setAttribute('class', 'editor-simulation-error-number');
      label.textContent = '×';
      svg.append(node, label);
    });
  }

  private cancelSimulationAnimation(): void {
    this.simulationAnimationRun += 1;
    if (this.simulationAnimationTimer !== undefined) window.clearTimeout(this.simulationAnimationTimer);
    this.simulationAnimationTimer = undefined;
    this.isSimulationAnimating = false;
    this.host.classList.remove('is-simulation-animating');
  }

  private clearSimulationResult(): void {
    this.cancelSimulationAnimation();
    this.simulationResult = undefined;
    this.simulationSignature = undefined;
    this.simulationVisibleStepCount = 0;
    this.simulationCellEvents = [];
    this.simulationCellEventIndex = 0;
    this.simulationSuccessfulCells = [];
    this.simulationErrorAttempts = [];
    this.renderSimulationOverlay();
  }

  private currentSimulationSignature(): string {
    const hidden = [...this.model.hiddenCellKeys].sort().join('|');
    return `${this.model.shape}:${this.currentPathSignature()}:${hidden}`;
  }

  private async readImageFromClipboard(mode: ImageRecognitionMode): Promise<void> {
    this.imageRecognitionMode = mode;
    if (mode === 'hidden-layout' && !this.model.hasGeneratedPath) {
      this.setStatus('请先识别完整关卡，再识别隐藏。', true);
      return;
    }
    if (!navigator.clipboard?.read) {
      this.setStatus('当前浏览器不支持主动读取剪贴板，请直接按 Ctrl+V 粘贴图片。', true);
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith('image/'));
        if (!imageType) continue;
        await this.recognizeClipboardImage(await item.getType(imageType), mode);
        return;
      }
      this.setStatus('剪贴板中没有图片，请先复制一张关卡截图。', true);
    } catch (error) {
      const message = error instanceof DOMException && error.name === 'NotAllowedError'
        ? '没有剪贴板读取权限，请在编辑器中直接按 Ctrl+V 粘贴图片。'
        : '无法读取剪贴板，请复制图片后重试或直接按 Ctrl+V。';
      this.setStatus(message, true);
    }
  }

  private async recognizeClipboardImage(image: Blob, mode: ImageRecognitionMode): Promise<void> {
    if (this.isImageRecognizing) return;
    if (mode === 'hidden-layout' && !this.model.hasGeneratedPath) {
      this.setStatus('请先识别完整关卡，再识别隐藏。', true);
      return;
    }
    this.imageRecognitionMode = mode;
    const run = ++this.imageRecognitionRun;
    this.cancelPathAnimation();
    this.clearSimulationResult();
    if (mode !== 'hidden-layout') this.clearRecognitionAmbiguity();
    this.isImageRecognizing = true;
    this.render();
    this.setStatus('正在准备图片识别，首次使用需要加载 OCR 模型。');
    try {
      const onProgress = (progress: ImageRecognitionProgress): void => {
        if (run !== this.imageRecognitionRun) return;
        this.setStatus(this.imageRecognitionProgressMessage(progress));
      };
      let error: string | null;
      let message: string;
      let ambiguousCells: EditorCell[] = [];
      if (mode === 'hidden-layout') {
        const result = await recognizeImageHiddenLayout(image, onProgress);
        if (run !== this.imageRecognitionRun || this.host.hidden) return;
        error = this.model.applyRecognizedHiddenCells(result.rows, result.columns, result.hiddenCells);
        message = `隐藏识别完成：${result.columns}×${result.rows}，显示 ${result.visibleCount} 格，隐藏 ${result.hiddenCells.length} 格；已保留当前完整路径。请检查后试玩或添加到列表。`;
      } else {
        const result = await recognizeImageLevel(image, mode, onProgress);
        if (run !== this.imageRecognitionRun || this.host.hidden) return;
        error = this.model.applyRecognizedPath(
          result.rows,
          result.columns,
          result.solutionPath,
          mode === 'initial-formation' ? result.hiddenCells : undefined,
        );
        ambiguousCells = result.ambiguousCells;
        if (mode === 'initial-formation') {
          message = `初始阵型识别完成：${result.columns}×${result.rows}，显示 ${result.visibleCount} 格，隐藏 ${result.hiddenCells.length} 格，已补全一条可用路径。请检查后试玩或添加到列表。`;
        } else if (result.ambiguousCells.length > 0) {
          message = `完整关卡已导入：${result.columns}×${result.rows}，已自动复核 ${result.retriedCellCount} 个可疑格；仍有 ${result.ambiguousCells.length} 个格子存在多种可能，已用橙色标记，请重点核对。`;
        } else {
          const retryMessage = result.retriedCellCount > 0
            ? `已自动复核 ${result.retriedCellCount} 个可疑格并排除歧义。`
            : '';
          message = `完整关卡识别完成：${result.columns}×${result.rows}，直接识别 ${result.recognizedCount} 格，路径约束补全 ${result.inferredCount} 格。${retryMessage}请继续识别隐藏，或检查后试玩。`;
        }
      }
      if (error) throw new Error(error);
      if (mode !== 'hidden-layout') this.setRecognitionAmbiguity(ambiguousCells);
      this.selectedLevelId = undefined;
      this.isImageRecognizing = false;
      this.render();
      this.setStatus(message, false, ambiguousCells.length > 0);
    } catch (error) {
      if (run !== this.imageRecognitionRun) return;
      this.isImageRecognizing = false;
      this.render();
      const message = error instanceof Error && error.message
        ? error.message
        : mode === 'hidden-layout'
          ? '隐藏识别失败，请换用更清晰且完整的初始阵型截图。'
          : '图片识别失败，请换用更清晰的完整棋盘截图。';
      this.setStatus(message, true);
    }
  }

  private imageRecognitionProgressMessage(progress: ImageRecognitionProgress): string {
    if (progress.phase === 'loading') return `正在加载 OCR 模型… ${progress.completed}%`;
    if (progress.phase === 'locating') {
      return progress.rows !== undefined && progress.columns !== undefined
        ? `已识别棋盘尺寸：${progress.columns}×${progress.rows}，准备读取格子内容…`
        : '正在先识别棋盘尺寸…';
    }
    if (this.imageRecognitionMode === 'hidden-layout') {
      if (progress.phase === 'reading') return '正在识别图片中的显示格和空位…';
      return '正在将隐藏格应用到当前路径…';
    }
    if (progress.phase === 'retrying') {
      return `检测到候选路径接近，正在复核可疑格… ${progress.completed}/${progress.total}`;
    }
    if (progress.phase === 'reading') return `正在逐格读取数字… ${progress.completed}/${progress.total}`;
    return '正在按数字连续性校验并补全路径…';
  }

  private cancelImageRecognition(): void {
    this.imageRecognitionRun += 1;
    this.isImageRecognizing = false;
    this.host.classList.remove('is-image-recognizing');
  }

  private paintCell(key: string): void {
    this.model.paintCell(key, this.paintValue);
    this.render();
  }

  private editManualCell(key: string): void {
    const error = this.model.manualEditMode === 'path'
      ? this.model.appendManualPathCell(key)
      : this.model.toggleManualHiddenCell(key);
    this.render();
    if (error) {
      this.setStatus(error, true);
      return;
    }
    if (this.model.manualEditMode === 'path') {
      this.setStatus(`手动路径：已绘制 ${this.model.solutionPath.length}/${this.model.activeCells.size} 格。`);
    } else {
      const hidden = this.model.hiddenCellKeys.has(key);
      this.setStatus(hidden ? '该格子已设为隐藏。' : '该格子已恢复显示。');
    }
  }

  private isWithinManualPathHitArea(event: PointerEvent, button: HTMLButtonElement): boolean {
    const bounds = button.getBoundingClientRect();
    const centerX = bounds.left + bounds.width * 0.5;
    const centerY = bounds.top + bounds.height * 0.5;
    const radius = Math.min(bounds.width, bounds.height) * 0.32;
    return (event.clientX - centerX) ** 2 + (event.clientY - centerY) ** 2 <= radius ** 2;
  }

  private truncatePathAfter(key: string): void {
    const removedCount = this.model.truncatePathAfter(key);
    if (removedCount === null) return;
    this.render();
    if (removedCount === 0) {
      this.setStatus('该格子已经是路径终点，后面没有可删除的路径。');
      return;
    }
    this.setStatus(`已删除该位置之后的 ${removedCount} 段路径及对应格子，可从当前末端继续手动绘制。`);
  }

  private handlePathContextAction(key: string): void {
    if (this.model.manualEditMode !== 'hidden') {
      this.truncatePathAfter(key);
      return;
    }
    const removed = this.model.removeManualHiddenCell(key);
    this.render();
    this.setStatus(removed ? '已取消该格子的隐藏状态。' : '该格子当前不是隐藏格子。', !removed);
  }

  private undoLastDeletion(): void {
    const restoredCount = this.model.undoLastDeletion();
    if (restoredCount <= 0) return;
    this.render();
    this.setStatus(`已撤销删除，恢复 ${restoredCount} 段路径及对应格子。`);
  }

  private generatePath(): void {
    this.cancelPathAnimation();
    if (!this.model.generatePath()) {
      this.render();
      this.setStatus('当前算法无法生成覆盖全部格子的路径，请调整棋盘或更换算法。', true);
      return;
    }
    const hiddenSummary = this.model.algorithmSelection.id === 'algorithm-2'
      ? `，隐藏 ${this.model.hiddenCellKeys.size}/${this.model.targetHiddenCount ?? this.model.hiddenCellKeys.size} 格，纯运气分叉 0`
      : '';
    this.animateGeneratedPath(`第 ${this.model.pathGenerationCount} 次路径生成成功：共 ${this.model.solutionPath.length} 个格子${hiddenSummary}。`);
  }

  private animateGeneratedPath(completionMessage: string): void {
    const total = this.model.solutionPath.length;
    if (total === 0) {
      this.render();
      return;
    }

    const run = ++this.pathAnimationRun;
    this.isPathAnimating = true;
    this.pathRevealCount = 0;
    this.render();
    this.setStatus(`路径已计算完成，开始逐格展示，共 ${total} 格。`);

    const revealNext = (): void => {
      if (run !== this.pathAnimationRun) return;
      const nextCount = Math.min(total, (this.pathRevealCount ?? 0) + 1);
      this.pathRevealCount = nextCount;
      const cell = this.model.solutionPath[nextCount - 1];
      const button = this.host.querySelector<HTMLButtonElement>(`.editor-cell[data-cell-key="${cell.x},${cell.y}"]`);
      this.host.querySelector('.editor-cell.is-generating-head')?.classList.remove('is-generating-head');
      if (button) {
        button.classList.add('is-path', 'is-generating-head');
        if (nextCount === 1) button.classList.add('is-start');
        if (this.model.hiddenCellKeys.has(`${cell.x},${cell.y}`)) button.classList.add('is-manual-hidden');
      }
      this.renderPathLines();
      this.setStatus(nextCount === 1
        ? `起点：第 ${cell.y + 1} 行，第 ${cell.x + 1} 列；正在生成 ${nextCount}/${total}`
        : `正在生成 ${nextCount}/${total}：第 ${cell.y + 1} 行，第 ${cell.x + 1} 列`);

      if (nextCount < total) {
        this.pathAnimationTimer = window.setTimeout(revealNext, 80);
        return;
      }
      this.pathAnimationTimer = window.setTimeout(() => {
        if (run !== this.pathAnimationRun) return;
        this.isPathAnimating = false;
        this.pathRevealCount = undefined;
        this.pathAnimationTimer = undefined;
        this.render();
        this.setStatus(completionMessage);
      }, 180);
    };

    this.pathAnimationTimer = window.setTimeout(revealNext, 120);
  }

  private cancelPathAnimation(): void {
    this.pathAnimationRun += 1;
    if (this.pathAnimationTimer !== undefined) window.clearTimeout(this.pathAnimationTimer);
    this.pathAnimationTimer = undefined;
    this.pathRevealCount = undefined;
    this.isPathAnimating = false;
    this.host.classList.remove('is-path-animating');
  }

  private playtest(): void {
    const level = this.model.createLevel(this.options.getNextLevelId());
    if (!level) {
      this.setStatus('请先生成覆盖全部格子的路径。', true);
      return;
    }
    this.cancelSimulationAnimation();
    this.setStatus('正在进入试玩，退出后将返回当前编辑状态。');
    this.options.onPlaytest(level);
  }

  private save(): void {
    const level = this.model.createLevel(this.options.getNextLevelId());
    if (!level) {
      this.setStatus('请先生成路径。', true);
      return;
    }
    const levels = [...this.options.getLevels(), level].sort((left, right) => left.levelId - right.levelId);
    this.selectedLevelId = level.levelId;
    this.options.onLevelsChange(levels);
    this.render();
    this.setStatus(`关卡 ${level.levelId} 已添加到列表。`);
  }

  private renderLevelList(): void {
    const levels = this.options.getLevels();
    const list = this.query<HTMLElement>('#editor-level-list');
    this.query('#editor-level-count').textContent = `${levels.length} 关`;
    if (levels.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'editor-level-empty';
      empty.textContent = '暂无关卡。为当前棋盘生成路径后可添加到列表。';
      list.replaceChildren(empty);
      return;
    }

    const items = levels.map((level) => {
      const item = document.createElement('div');
      item.className = 'editor-level-item';
      item.classList.toggle('is-selected', level.levelId === this.selectedLevelId);
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.setAttribute('aria-label', `应用关卡 ${level.levelId}`);

      const info = document.createElement('div');
      info.className = 'editor-level-item__info';
      const title = document.createElement('b');
      title.textContent = `#${level.levelId}`;
      const meta = document.createElement('span');
      const hiddenCount = level.hiddenCells?.length ?? 0;
      const pathLabel = level.pathSource === 'manual' ? '手动路径' : editorAlgorithmLabel(level.algorithm?.id);
      meta.textContent = `${this.shapeLabel(level.boardShape)} · ${pathLabel} · ${level.columns}×${level.rows} · ${level.activeCells.length} 格${hiddenCount > 0 ? ` · 隐藏 ${hiddenCount}` : ''}`;
      info.append(title, meta);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'editor-level-delete';
      remove.textContent = '删除';
      remove.setAttribute('aria-label', `删除关卡 ${level.levelId}`);
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        this.deleteLevel(level.levelId);
      });

      const apply = () => this.applyLevel(level);
      item.addEventListener('click', apply);
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          apply();
        }
      });
      item.addEventListener('mouseenter', (event) => this.showLevelPreview(level, event.clientX, event.clientY));
      item.addEventListener('mousemove', (event) => this.moveLevelPreview(event.clientX, event.clientY));
      item.addEventListener('mouseleave', () => this.hideLevelPreview());
      item.append(info, remove);
      return item;
    });
    list.replaceChildren(...items);
  }

  private applyLevel(level: LevelData): void {
    this.hideLevelPreview();
    this.selectedLevelId = level.levelId;
    this.model.applyLevel(level);
    this.render();
    this.setStatus(`已应用关卡 ${level.levelId} 到棋盘。`);
  }

  private deleteLevel(levelId: number): void {
    if (!window.confirm(`确定删除关卡 ${levelId} 吗？`)) return;
    const levels = this.options.getLevels()
      .filter((level) => level.levelId !== levelId)
      .map((level, index) => ({ ...level, levelId: index + 1 }));
    if (this.selectedLevelId === levelId) this.selectedLevelId = undefined;
    else if (this.selectedLevelId && this.selectedLevelId > levelId) this.selectedLevelId -= 1;
    this.options.onLevelsChange(levels);
    this.render();
    this.setStatus(`关卡 ${levelId} 已删除，后续编号已顺延。`);
  }

  private showLevelPreview(level: LevelData, clientX: number, clientY: number): void {
    const preview = this.query<HTMLElement>('#editor-level-preview');
    const header = document.createElement('div');
    header.className = 'editor-level-preview__header';
    header.textContent = `#${level.levelId} · ${level.columns}×${level.rows}`;
    const grid = document.createElement('div');
    grid.className = 'editor-level-preview__grid';
    grid.style.setProperty('--preview-cols', String(level.columns));
    grid.style.setProperty('--preview-rows', String(level.rows));
    const active = new Set(level.activeCells.map((cell) => `${cell.x},${cell.y}`));
    const hidden = new Set(level.hiddenCells?.map((cell) => `${cell.x},${cell.y}`) ?? []);
    const order = new Map(level.solutionPath.map((cell, index) => [`${cell.x},${cell.y}`, index + 1]));
    const cells = Array.from({ length: level.rows * level.columns }, (_, index) => {
      const x = index % level.columns;
      const y = Math.floor(index / level.columns);
      const cell = document.createElement('span');
      const key = `${x},${y}`;
      if (active.has(key)) cell.classList.add('is-active');
      if (hidden.has(key)) cell.classList.add('is-hidden');
      const value = order.get(key);
      if (value) cell.textContent = String(value);
      return cell;
    });
    grid.append(...cells);
    preview.replaceChildren(header, grid);
    preview.hidden = false;
    this.moveLevelPreview(clientX, clientY);
  }

  private moveLevelPreview(clientX: number, clientY: number): void {
    const preview = this.query<HTMLElement>('#editor-level-preview');
    if (preview.hidden) return;
    const width = preview.offsetWidth || 240;
    const height = preview.offsetHeight || 240;
    preview.style.left = `${Math.min(clientX + 14, window.innerWidth - width - 10)}px`;
    preview.style.top = `${Math.min(clientY + 14, window.innerHeight - height - 10)}px`;
  }

  private hideLevelPreview(): void {
    this.query<HTMLElement>('#editor-level-preview').hidden = true;
  }

  private async importLevels(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const source = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { levels?: unknown }).levels)
          ? (parsed as { levels: unknown[] }).levels
          : null;
      if (!source) throw new Error('JSON 根节点必须是关卡数组。');
      const levels = source.filter((entry): entry is LevelData => (
        Boolean(entry)
        && typeof entry === 'object'
        && Array.isArray((entry as LevelData).activeCells)
        && Array.isArray((entry as LevelData).solutionPath)
      )).map((level, index) => ({ ...level, levelId: index + 1 }));
      if (levels.length === 0) throw new Error('文件中没有有效关卡。');
      this.selectedLevelId = undefined;
      this.options.onLevelsChange(levels);
      this.render();
      this.setStatus(`已读取 ${levels.length} 个关卡。`);
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : '读取 JSON 失败。', true);
    }
  }

  private exportLevels(): void {
    const levels = this.options.getLevels();
    if (levels.length === 0) {
      this.setStatus('列表为空，暂无可导出的关卡。', true);
      return;
    }
    const blob = new Blob([JSON.stringify(levels, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'levels.json';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    this.setStatus(`已导出 ${levels.length} 个关卡。`);
  }

  private shapeLabel(shape: BoardShape): string {
    if (shape === BoardShape.Diamond) return '菱形';
    if (shape === BoardShape.Rectangle) return '长方形';
    if (shape === BoardShape.Hex) return '蜂窝';
    return '正方形';
  }

  private renderPathLines(): void {
    const svg = this.query<SVGSVGElement>('#editor-path-lines');
    svg.replaceChildren();
    const visiblePath = this.model.solutionPath.slice(
      0,
      this.pathRevealCount ?? this.model.solutionPath.length,
    );
    if (visiblePath.length < 1) return;

    const workspace = this.query<HTMLElement>('.editor-workspace');
    const workspaceBounds = workspace.getBoundingClientRect();
    const buttons = new Map(
      [...this.host.querySelectorAll<HTMLButtonElement>('.editor-cell[data-cell-key]')]
        .map((button) => [button.dataset.cellKey!, button] as const),
    );
    const points = visiblePath.map((cell) => {
      const button = buttons.get(`${cell.x},${cell.y}`);
      if (!button) return null;
      const bounds = button.getBoundingClientRect();
      return {
        key: `${cell.x},${cell.y}`,
        x: bounds.left + bounds.width * 0.5 - workspaceBounds.left,
        y: bounds.top + bounds.height * 0.5 - workspaceBounds.top,
        size: Math.min(bounds.width, bounds.height),
      };
    });
    if (points.some((point) => point === null)) return;

    svg.setAttribute('viewBox', `0 0 ${workspaceBounds.width} ${workspaceBounds.height}`);
    const pointText = points.map((point) => `${point!.x},${point!.y}`).join(' ');
    const createPolyline = (className: string): SVGPolylineElement => {
      const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      polyline.setAttribute('class', className);
      polyline.setAttribute('points', pointText);
      return polyline;
    };
    if (points.length >= 2) {
      svg.append(
        createPolyline('editor-path-line editor-path-line--shadow'),
        createPolyline('editor-path-line editor-path-line--main'),
      );
    }
    points.forEach((point, index) => {
      const value = index + 1;
      const digitCount = String(value).length;
      const fontScale = digitCount >= 3 ? 0.34 : digitCount === 2 ? 0.46 : 0.56;
      const fontSize = Math.max(7, Math.min(36, point!.size * fontScale));
      const labelRadius = digitCount * fontSize * 0.3 + 3;
      const nodeRadius = Math.max(fontSize * 0.68, Math.min(point!.size * 0.46, labelRadius));
      const node = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      node.setAttribute('cx', String(point!.x));
      node.setAttribute('cy', String(point!.y));
      node.setAttribute('r', String(nodeRadius));
      const isCurrent = this.isPathAnimating && index === points.length - 1;
      const isFinalEnd = !this.isPathAnimating && index === this.model.solutionPath.length - 1;
      node.setAttribute('class', `editor-path-node${index === 0 ? ' is-start' : ''}${isFinalEnd ? ' is-end' : ''}${isCurrent ? ' is-current' : ''}${this.model.hiddenCellKeys.has(point!.key) ? ' is-hidden' : ''}`);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', String(point!.x));
      label.setAttribute('y', String(point!.y));
      label.setAttribute('class', `editor-path-number${index === 0 ? ' is-start' : ''}${isFinalEnd ? ' is-end' : ''}${isCurrent ? ' is-current' : ''}${this.model.hiddenCellKeys.has(point!.key) ? ' is-hidden' : ''}`);
      label.style.fontSize = `${fontSize}px`;
      label.textContent = String(value);
      svg.append(node, label);
    });
  }

  private layoutGrid(): void {
    const grid = this.query<HTMLElement>('#editor-grid');
    if (this.model.shape === 'hex') {
      grid.style.removeProperty('width');
      grid.style.removeProperty('height');
      return;
    }

    const workspace = this.query<HTMLElement>('.editor-workspace');
    const workspaceStyle = getComputedStyle(workspace);
    const gridStyle = getComputedStyle(grid);
    const availableWidth = workspace.clientWidth
      - Number.parseFloat(workspaceStyle.paddingLeft)
      - Number.parseFloat(workspaceStyle.paddingRight);
    const availableHeight = workspace.clientHeight
      - Number.parseFloat(workspaceStyle.paddingTop)
      - Number.parseFloat(workspaceStyle.paddingBottom);
    if (availableWidth <= 0 || availableHeight <= 0) return;

    const { rows, columns } = this.model.size();
    const maxWidth = Number.parseFloat(gridStyle.maxWidth);
    const maxHeight = Number.parseFloat(gridStyle.maxHeight);
    const layout = calculateSquareGridLayout({
      rows,
      columns,
      availableWidth,
      availableHeight,
      columnGap: Number.parseFloat(gridStyle.columnGap) || 0,
      rowGap: Number.parseFloat(gridStyle.rowGap) || 0,
      maxWidth: Number.isFinite(maxWidth) ? maxWidth : availableWidth,
      maxHeight: Number.isFinite(maxHeight) ? maxHeight : availableHeight,
    });
    grid.style.width = `${layout.width}px`;
    grid.style.height = `${layout.height}px`;
  }

  private renderAlgorithmControls(): void {
    const select = this.query<HTMLSelectElement>('#editor-algorithm');
    const options = EDITOR_ALGORITHMS.map((algorithm) => {
      const option = document.createElement('option');
      option.value = algorithm.id;
      option.textContent = algorithm.label;
      return option;
    });
    select.replaceChildren(...options);
    select.value = this.model.algorithmSelection.id;
    select.disabled = this.isPathAnimating;
    const parameterHost = this.query<HTMLElement>('#editor-algorithm-parameters');
    parameterHost.dataset.algorithm = this.model.algorithmSelection.id;
    renderEditorAlgorithmParameters(parameterHost, this.model.algorithmSelection, this.model.shape, (selection) => {
      this.model.setAlgorithmSelection(selection);
      this.render();
    });
    parameterHost.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
      input.disabled = input.disabled || this.isPathAnimating;
    });
  }

  private currentPathSignature(): string {
    return this.model.solutionPath.map((cell) => `${cell.x},${cell.y}`).join('|');
  }

  private clearRecognitionAmbiguity(): void {
    this.recognitionAmbiguousCellKeys.clear();
    this.recognitionAmbiguousPathSignature = undefined;
  }

  private setRecognitionAmbiguity(cells: ReadonlyArray<EditorCell>): void {
    this.recognitionAmbiguousCellKeys = new Set(cells.map((cell) => `${cell.x},${cell.y}`));
    this.recognitionAmbiguousPathSignature = cells.length > 0 ? this.currentPathSignature() : undefined;
  }

  private setStatus(message: string, error = false, warning = false): void {
    const status = this.query<HTMLElement>('#editor-status');
    status.textContent = message;
    status.classList.toggle('is-error', error);
    status.classList.toggle('is-warning', !error && warning);
  }

  private query<T extends Element>(selector: string): T {
    const element = this.host.querySelector<T>(selector);
    if (!element) throw new Error(`Missing level editor element: ${selector}`);
    return element;
  }
}
