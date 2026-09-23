import { ManualPlaytestStatistics } from './manualPlaytestStatistics';
import { METRIC_COLUMNS, type ConfigurationMetrics } from './configurationBatchMetrics';
import type { SimulationFrame } from './occlusionSimulation';
import { ConnectionProgress } from '../../game/connectionProgress';
import { PathCompletionSolver } from '../../game/pathCompletionSolver';
import { findPathCompletionInWorker } from '../../game/pathCompletionWorker';
import { findSwappableHiddenPairs } from '../../game/hiddenSwap';
import { areNeighborCells } from '../../game/topology';
import { cellKey, type LevelData } from '../../game/types';
import { ThumbHand } from './ThumbHand';
import { OcclusionSimulationPanel, type OcclusionReplay } from './OcclusionSimulationPanel';
import { choosePerceivedMove, nextDisplayedIndex, DEFAULT_WEIGHT_CONFIG, type WeightConfig, type HandMode, type NeighborhoodWeight } from './occlusionSimulation';
import { HandOcclusionSampler, type OcclusionGeometry } from './handOcclusion';
import { persistPlaytestControl, savePlaytestPreference } from './playtestPreferences';
import type { OcclusionRun } from './occlusionSimulation';

const NS = 'http://www.w3.org/2000/svg';
const svgElement = <K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string> = {}) => {
  const element = document.createElementNS(NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
};

/** A temporary play session: never writes to the library or player progress. */
export class ArrangementPlaytest {
  private connection!: ConnectionProgress;
  private errors = 0;
  private manualStatistics: ManualPlaytestStatistics;
  private releasedSinceMove = true;
  private readonly completionDialog = document.createElement('dialog');
  private busy = false;
  private disposed = false;
  private pointer?: number;
  private lastHit?: number;
  private message = '从 1 开始，点击或拖动相邻数字球连线。';
  private readonly board = svgElement('svg', {
    class: 'arranger-preview-board arranger-playtest-board',
    role: 'group', 'aria-label': '试玩棋盘',
  });
  private readonly lines = svgElement('g', { class: 'arranger-playtest-lines' });
  private readonly nodes: SVGGElement[] = [];
  private readonly status = document.createElement('p');
  private readonly undo = document.createElement('button');
  private readonly restart = document.createElement('button');
  private weights: WeightConfig = { ...DEFAULT_WEIGHT_CONFIG };
  private readonly fingerLayer = document.createElement('div');
  private readonly finger = document.createElement('img');
  private readonly choiceOverlay = document.createElement('div');
  private readonly choiceToggle = document.createElement('input');
  private readonly cursorMarker = document.createElement('div');
  private readonly fingerToggle = document.createElement('select');
  private readonly handSide = document.createElement('select');
  private readonly showHand = document.createElement('input');
  private readonly fingerSize = document.createElement('input');
  private readonly listeners = new AbortController();
  private readonly thumbHand = new ThumbHand();
  private simulationPanel?: OcclusionSimulationPanel;
  private simulationRunning = false;
  private replay?: OcclusionReplay;
  private readonly rejectedPositions = new Set<number>();
  private weightCursor?: { x: number; y: number };
  private samplingWeights = false;

  constructor(host: HTMLElement, private readonly level: LevelData, onSimulationResult?: (run: OcclusionRun) => void,
    private readonly onManualResult?: (metrics: ConfigurationMetrics) => void,
    private readonly displayLevelId = String(level.levelId)) {
    this.manualStatistics = new ManualPlaytestStatistics(level);
    this.completionDialog.className = 'arranger-batch-dialog arranger-manual-result';
    this.completionDialog.setAttribute('aria-label', '手动试玩完成统计');
    this.board.setAttribute('viewBox', `0 0 ${level.columns} ${level.rows}`);
    this.reset();
    const wrapper = document.createElement('div');
    wrapper.className = 'arranger-playtest';
    const actions = document.createElement('div');
    actions.className = 'arranger-playtest-controls';
    this.status.className = 'arranger-playtest-status';
    this.status.setAttribute('role', 'status');
    this.undo.type = this.restart.type = 'button';
    this.undo.textContent = '撤销一步';
    this.restart.textContent = '重新试玩';
    this.undo.addEventListener('click', () => {
      if (this.busy) return;
      this.connection.undoLastStep();
      this.manualStatistics.undo(this.connection.progress);
      this.releasedSinceMove = true;
      this.rejectedPositions.clear();
      this.message = '已撤销，可继续连线。';
      this.paint();
    });
    this.restart.addEventListener('click', () => {
      if (this.busy) return;
      this.reset();
      this.paint();
    });
    const fingerLabel = document.createElement('label');
    fingerLabel.className = 'arranger-playtest-finger-toggle';
    for (const [value, text] of [['thumb', '拇指'], ['index', '食指']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      this.fingerToggle.append(option);
    }
    this.fingerToggle.setAttribute('aria-label', '手指类型');
    persistPlaytestControl('hand.type', this.fingerToggle);
    this.board.classList.add('has-finger');
    fingerLabel.append(document.createTextNode('手指'), this.fingerToggle);
    const sizeLabel = document.createElement('label');
    sizeLabel.className = 'arranger-playtest-finger-size';
    this.fingerSize.type = 'range';
    this.fingerSize.min = '0.5'; this.fingerSize.max = '1'; this.fingerSize.step = '0.01'; this.fingerSize.value = '0.8';
    this.fingerSize.setAttribute('aria-label', '手指大小');
    persistPlaytestControl('hand.size', this.fingerSize);
    const sizeValue = document.createElement('output'); sizeValue.textContent = `${this.fingerSize.valueAsNumber.toFixed(2)}×`;
    this.thumbHand.setSize(this.fingerSize.valueAsNumber);
    this.finger.style.width = `${720 * this.fingerSize.valueAsNumber}px`;
    this.updateIndexTransform();
    sizeLabel.append(document.createTextNode('大小'), this.fingerSize, sizeValue);
    this.fingerSize.addEventListener('input', () => {
      const cursor = this.weightCursor;
      const size = this.fingerSize.valueAsNumber;
      sizeValue.textContent = `${size.toFixed(2)}×`;
      this.finger.style.width = `${720 * size}px`;
      this.updateIndexTransform();
      this.thumbHand.setSize(size);
      this.simulationPanel?.invalidate();
      if (cursor) this.moveFinger({ clientX: cursor.x, clientY: cursor.y, pointerType: 'mouse' });
    });
    this.finger.className = 'arranger-playtest-finger';
    this.finger.src = `${import.meta.env.BASE_URL}ui/tutorial-finger.png`;
    this.finger.alt = '';
    this.finger.draggable = false;
    this.finger.hidden = true;
    this.finger.setAttribute('aria-hidden', 'true');
    this.fingerLayer.className = 'arranger-playtest-finger-layer';
    this.fingerLayer.append(this.finger);
    document.body.append(this.fingerLayer);
    this.cursorMarker.className = 'arranger-playtest-cursor-marker';
    this.cursorMarker.hidden = true;
    this.cursorMarker.setAttribute('aria-hidden', 'true');
    document.body.append(this.cursorMarker);
    this.choiceOverlay.className = 'arranger-fingertip-grid';
    this.choiceOverlay.hidden = true;
    this.choiceOverlay.setAttribute('aria-label', '指尖九宫格');
    document.body.append(this.choiceOverlay);
    this.choiceToggle.type = 'checkbox'; this.choiceToggle.checked = true;
    persistPlaytestControl('hand.grid', this.choiceToggle);
    const choiceLabel = document.createElement('label');
    choiceLabel.append(this.choiceToggle, document.createTextNode('指尖九宫格'));
    this.choiceToggle.addEventListener('change', () => {
      this.choiceOverlay.hidden = !this.choiceToggle.checked || (!this.replay?.neighborhood && this.cursorMarker.hidden);
    });
    this.fingerToggle.addEventListener('change', () => {
      const cursor = this.currentFingerPosition();
      this.simulationPanel?.invalidate();
      const thumb = this.fingerToggle.value === 'thumb';
      this.board.classList.toggle('has-finger', this.fingerToggle.value !== 'off');
      this.finger.classList.toggle('is-thumb', thumb);
      this.finger.src = `${import.meta.env.BASE_URL}ui/${thumb ? 'tutorial-thumb.png' : 'tutorial-finger.png'}`;
      this.choiceOverlay.hidden = true;
      this.finger.hidden = true;
      this.cursorMarker.hidden = true;
      this.thumbHand.hide();
      if (cursor) this.moveFinger({ clientX: cursor.x, clientY: cursor.y, pointerType: 'mouse' });
    });
    const hideCursor = () => { this.weightCursor = undefined; this.choiceOverlay.hidden = true; this.finger.hidden = this.cursorMarker.hidden = true; this.thumbHand.hide(); };
    window.addEventListener('blur', () => {
      // A simulated pose belongs to the paused/running frame, not mouse focus.
      if (!this.replay && !this.simulationRunning) hideCursor();
    }, { signal: this.listeners.signal });
    window.addEventListener('resize', hideCursor, { signal: this.listeners.signal });
    window.addEventListener('resize', () => this.simulationPanel?.invalidate(), { signal: this.listeners.signal });
    window.addEventListener('scroll', (event) => {
      // Scrolling controls or the library does not move the board or its hand.
      const target = event.target;
      if (target instanceof Element && !target.contains(this.board)) return;
      this.simulationPanel?.invalidate();
      hideCursor();
    }, { capture: true, signal: this.listeners.signal });
    actions.append(this.undo, this.restart);
    const sidebar = document.createElement('aside');
    sidebar.className = 'arranger-playtest-sidebar';
    sidebar.setAttribute('aria-label', '手指模拟设置');
    const sideLabel = document.createElement('label');
    sideLabel.className = 'arranger-playtest-finger-toggle';
    this.handSide.setAttribute('aria-label', '左右手');
    for (const [value, text] of [['right', '右手'], ['left', '左手']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; this.handSide.append(option);
    }
    persistPlaytestControl('hand.side', this.handSide);
    this.thumbHand.setLeftHand(this.handSide.value === 'left'); this.updateIndexTransform();
    sideLabel.append(document.createTextNode('左右手'), this.handSide);
    this.handSide.addEventListener('change', () => {
      const cursor = this.currentFingerPosition();
      this.thumbHand.setLeftHand(this.handSide.value === 'left'); this.updateIndexTransform();
      this.simulationPanel?.invalidate();
      if (cursor) this.moveFinger({ clientX: cursor.x, clientY: cursor.y, pointerType: 'mouse' });
    });
    const showLabel = document.createElement('label');
    this.showHand.type = 'checkbox'; this.showHand.checked = true;
    persistPlaytestControl('hand.visible', this.showHand);
    this.showHand.setAttribute('aria-label', '显示手指');
    showLabel.append(this.showHand, document.createTextNode('显示手指'));
    this.showHand.addEventListener('change', () => this.refreshHandImage());
    sidebar.append(fingerLabel, sideLabel, showLabel, sizeLabel, choiceLabel);
    const weightSettings = document.createElement('details');
    weightSettings.className = 'arranger-weight-settings';
    const weightSummary = document.createElement('summary'); weightSummary.textContent = '权重配置';
    weightSettings.append(weightSummary);
    const weightInputs: HTMLInputElement[] = [];
    const refreshWeights = () => {
      const cursor = this.currentFingerPosition();
      this.simulationPanel?.invalidate();
      if (cursor) this.moveFinger({ clientX: cursor.x, clientY: cursor.y, pointerType: 'mouse' });
    };
    const fields: Array<[keyof WeightConfig, string]> = [
      ['nextNumber', '下一数字加分'], ['hiddenNumber', '隐藏数字加分'], ['occludedMultiplier', '遮挡≥50%倍率'],
      ['sameDirection', '同方向加分'], ['closerTarget', '靠近目标加分'],
    ];
    fields.forEach(([key, title]) => {
      const label = document.createElement('label'); label.textContent = title;
      const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.step = 'any';
      if (key === 'occludedMultiplier') input.max = '1';
      input.value = String(this.weights[key]); input.setAttribute('aria-label', title);
      persistPlaytestControl(`weight.${key}`, input);
      this.weights[key] = input.valueAsNumber;
      input.addEventListener('change', () => {
        if (!input.checkValidity() || !Number.isFinite(input.valueAsNumber)) {
          input.reportValidity(); input.value = String(this.weights[key]); return;
        }
        this.weights = { ...this.weights, [key]: input.valueAsNumber }; refreshWeights();
      });
      label.append(input); weightSettings.append(label); weightInputs.push(input);
    });
    const resetWeights = document.createElement('button'); resetWeights.type = 'button'; resetWeights.textContent = '恢复默认权重';
    resetWeights.addEventListener('click', () => {
      this.weights = { ...DEFAULT_WEIGHT_CONFIG };
      fields.forEach(([key], i) => {
        weightInputs[i].value = String(this.weights[key]);
        savePlaytestPreference(`weight.${key}`, weightInputs[i].value);
      }); refreshWeights();
    });
    weightSettings.append(resetWeights); sidebar.append(weightSettings);
    this.board.append(this.lines);
    level.solutionPath.forEach((cell, index) => {
      const group = svgElement('g', { class: 'arranger-preview-cell', role: 'button', tabindex: '0' });
      group.append(svgElement('circle', { cx: String(cell.x + .5), cy: String(cell.y + .5), r: '.38' }));
      group.append(svgElement('text', { x: String(cell.x + .5), y: String(cell.y + .51) }));
      group.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        void this.choose(index);
      });
      this.nodes.push(group);
      this.board.append(group);
    });
    this.board.addEventListener('pointerdown', (event) => {
      this.moveFinger(event);
      if (event.button !== 0 || this.pointer !== undefined) return;
      event.preventDefault();
      this.pointer = event.pointerId;
      this.updateContactLabel();
      this.lastHit = undefined;
      this.board.setPointerCapture(event.pointerId);
      this.hit(event, false);
    });
    this.board.addEventListener('pointermove', (event) => {
      this.moveFinger(event);
      if (event.pointerId === this.pointer) this.hit(event, true);
    });
    this.board.addEventListener('pointerenter', (event) => this.moveFinger(event));
    // Keep the last pose visible while the pointer operates the side controls.
    const release = (event: PointerEvent) => {
      if (event.pointerId !== this.pointer) return;
      this.pointer = undefined;
      this.releasedSinceMove = true;
      this.updateContactLabel();
      this.lastHit = undefined;
    };
    this.board.addEventListener('pointerup', release);
    this.board.addEventListener('pointercancel', release);
    this.board.addEventListener('pointercancel', hideCursor);
    this.board.addEventListener('lostpointercapture', release);
    this.simulationPanel = new OcclusionSimulationPanel(level, {
      getMode: () => this.fingerToggle.value as HandMode,
      getGeometry: () => this.simulationGeometry(),
      getWeights: () => ({ ...this.weights }),
      onResult: onSimulationResult,
      lock: (locked) => {
        this.simulationRunning = locked;
        this.fingerToggle.disabled = locked;
        this.fingerSize.disabled = locked;
        this.handSide.disabled = locked;
        weightInputs.forEach((input) => { input.disabled = locked; }); resetWeights.disabled = locked;
        if (locked) hideCursor();
        this.paint();
      },
      replay: (frame) => {
        this.replay = frame;
        this.paint();
        hideCursor();
        if (frame) {
          this.updateHandClip();
          const geometry = this.simulationGeometry();
          const cursor = geometry.centers[frame.current];
          if (frame.neighborhood) this.showChoiceOverlay(cursor.x, cursor.y, frame.neighborhood, frame.attempted);
          if (frame.mode === 'thumb' && this.showHand.checked) this.thumbHand.move(cursor.x, cursor.y, geometry.board);
          else if (frame.mode === 'index') {
            this.finger.classList.remove('is-thumb');
            this.finger.src = `${import.meta.env.BASE_URL}ui/tutorial-finger.png`;
            this.finger.style.left = `${cursor.x}px`; this.finger.style.top = `${cursor.y}px`; this.finger.hidden = !this.showHand.checked;
          }
          if (frame.mode !== 'off') {
            this.cursorMarker.style.left = `${cursor.x}px`; this.cursorMarker.style.top = `${cursor.y}px`; this.cursorMarker.hidden = false;
          }
        }
      },
    });
    sidebar.append(this.simulationPanel.element);
    const stage = document.createElement('div');
    stage.className = 'arranger-playtest-stage';
    stage.append(this.board, this.status, actions);
    wrapper.append(sidebar, stage);
    host.replaceChildren(wrapper, this.completionDialog);
    this.paint();
  }

  public dispose(): void {
    this.disposed = true;
    this.completionDialog.close(); this.completionDialog.remove();
    this.weightCursor = undefined;
    this.listeners.abort();
    this.simulationPanel?.dispose();
    this.fingerLayer.remove();
    this.thumbHand.dispose();
    this.cursorMarker.remove();
    this.choiceOverlay.remove();
    if (this.pointer !== undefined && this.board.hasPointerCapture(this.pointer)) {
      this.board.releasePointerCapture(this.pointer);
    }
  }

  private boardClipBounds(): DOMRect {
    const matrix = this.board.getScreenCTM();
    if (!matrix) return this.board.getBoundingClientRect();
    const topLeft = new DOMPoint(0, 0).matrixTransform(matrix);
    const bottomRight = new DOMPoint(this.level.columns, this.level.rows).matrixTransform(matrix);
    return new DOMRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
  }

  private updateHandClip(): void {
    const bounds = this.boardClipBounds();
    this.thumbHand.setClipBounds(bounds);
    this.fingerLayer.style.clipPath = this.handSide.value === 'left'
      ? `inset(${bounds.top}px ${window.innerWidth - bounds.right}px ${window.innerHeight - bounds.bottom}px ${bounds.left}px)` : 'none';
  }

  private currentFingerPosition(): { x: number; y: number } | undefined {
    return this.replay ? this.simulationGeometry().centers[this.replay.current] : this.weightCursor;
  }

  private updateIndexTransform(): void {
    const left = this.handSide.value === 'left';
    this.finger.style.transform = `translate(${left ? '-95.5%' : '-4.5%'}, calc(-0.6% - ${20 * this.fingerSize.valueAsNumber}px))${left ? ' scaleX(-1)' : ''}`;
  }

  private refreshHandImage(): void {
    this.updateHandClip();
    const cursor = this.currentFingerPosition();
    const mode = this.replay?.mode ?? this.fingerToggle.value;
    this.finger.hidden = true; this.thumbHand.hide();
    if (!cursor || !this.showHand.checked || mode === 'off' || this.disposed) return;
    if (mode === 'thumb') this.thumbHand.move(cursor.x, cursor.y, this.board.getBoundingClientRect());
    else {
      this.finger.style.left = `${cursor.x}px`; this.finger.style.top = `${cursor.y}px`;
      this.finger.hidden = false;
    }
  }

  private moveFinger(event: Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerType'>): void {
    if (this.replay || this.simulationRunning || this.completionDialog.open) return;
    const bounds = this.board.getBoundingClientRect();
    const inside = event.clientX >= bounds.left && event.clientX <= bounds.right
      && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    if (!inside) return;
    this.updateHandClip();
    const hidden = this.disposed || this.fingerToggle.value === 'off' || event.pointerType === 'touch';
    const thumb = this.fingerToggle.value === 'thumb';
    this.finger.hidden = hidden || thumb || !this.showHand.checked;
    this.cursorMarker.hidden = hidden;
    if (hidden || !thumb || !this.showHand.checked) this.thumbHand.hide();
    this.choiceOverlay.hidden = hidden;
    if (hidden) return;
    this.weightCursor = { x: event.clientX, y: event.clientY };
    this.choiceOverlay.style.left = `${event.clientX}px`;
    this.choiceOverlay.style.top = `${event.clientY}px`;
    void this.updatePointerWeights();
    if (thumb && this.showHand.checked) this.thumbHand.move(event.clientX, event.clientY, bounds);
    this.finger.style.left = `${event.clientX}px`;
    this.finger.style.top = `${event.clientY}px`;
    this.cursorMarker.style.left = `${event.clientX}px`;
    this.cursorMarker.style.top = `${event.clientY}px`;
  }

  private showChoiceOverlay(x: number, y: number, weights?: NeighborhoodWeight[], attempted?: number): void {
    const matrix = this.board.getScreenCTM();
    const pitch = matrix ? Math.hypot(matrix.a, matrix.b) : 60;
    this.choiceOverlay.style.left = `${x}px`;
    this.choiceOverlay.style.top = `${y}px`;
    this.choiceOverlay.style.width = `${pitch * 3}px`;
    this.choiceOverlay.style.height = `${pitch * 3}px`;
    this.choiceOverlay.hidden = !this.choiceToggle.checked;
    this.choiceOverlay.replaceChildren(...Array.from({ length: 9 }, (_, i) => {
      const item = document.createElement('div');
      const cell = weights?.[i];
      const dx = i % 3 - 1, dy = Math.floor(i / 3) - 1;
      item.className = `arranger-fingertip-cell${cell && cell.index !== undefined && cell.index === attempted ? ' is-chosen' : ''}${i === 4 ? ' is-center' : ''}${cell?.rejected ? ' is-error' : ''}`;
      item.style.setProperty('--probability', String(cell?.probability ?? 0));
      const label = document.createElement('span');
      label.textContent = i === 4 ? this.contactLabel() : cell ? cell.weight > 0 ? String(Number(cell.weight.toFixed(2))) : ''
        : `${dy < 0 ? '上' : dy > 0 ? '下' : ''}${dx < 0 ? '左' : dx > 0 ? '右' : ''}`;
      if (cell) item.title = `权重 ${Number(cell.weight.toFixed(2))}：${cell.reason}`;
      if (label.textContent) item.append(label);
      return item;
    }));
  }

  private contactLabel(): string {
    const pressed = this.replay
      ? this.replay.mode !== 'off' && !this.replay.observation?.observed
      : this.pointer !== undefined;
    return pressed ? '按住' : '松开';
  }

  private updateContactLabel(): void {
    const label = this.choiceOverlay.querySelector('.is-center span');
    if (label) label.textContent = this.contactLabel();
  }

  private async updatePointerWeights(): Promise<void> {
    if (this.samplingWeights || !this.weightCursor || this.replay || this.simulationRunning || this.disposed || this.completionDialog.open) return;
    this.samplingWeights = true;
    const cursor = this.weightCursor;
    const geometry = this.simulationGeometry();
    const sampler = new HandOcclusionSampler(geometry);
    try {
      const occlusion = await sampler.observeAt(this.fingerToggle.value as HandMode, cursor);
      if (this.disposed || this.replay || this.simulationRunning || this.completionDialog.open || this.weightCursor !== cursor) return;
      const pitch = geometry.radius / .38;
      const cells = geometry.centers.map((point) => ({ x: Math.round((point.x - cursor.x) / pitch), y: Math.round((point.y - cursor.y) / pitch) }));
      const known = new Map<number, number>();
      const hidden = new Set<number>();
      const visited = new Set<number>();
      this.level.solutionPath.forEach((_, index) => {
        if (!this.connection.isVisible(index)) hidden.add(index);
        else if (!occlusion[index].numberBlocked || this.connection.isNodeConnected(index)) known.set(index, this.connection.displayNumber(index));
        if (this.connection.isNodeConnected(index)) visited.add(index);
      });
      const edges = this.connection.connectedNodePairs();
      const last = edges.at(-1);
      const current = this.connection.activeIndex;
      const previous = last && current !== undefined && last.includes(current) ? last.find((index) => index !== current) : undefined;
      const previousDirection = previous !== undefined && current !== undefined ? {
        dx: this.level.solutionPath[current].x - this.level.solutionPath[previous].x,
        dy: this.level.solutionPath[current].y - this.level.solutionPath[previous].y,
      } : undefined;
      const choice = choosePerceivedMove({ weights: this.weights, cells, center: { x: 0, y: 0 }, shape: this.level.boardShape,
        distanceCells: geometry.centers.map((point) => ({ x: (point.x - cursor.x) / pitch, y: (point.y - cursor.y) / pitch })),
        current: current ?? 0, nextNumber: current === undefined ? 1 : this.connection.displayNumber(current) + 1,
        known, hiddenIndices: hidden, visited, rejected: this.rejectedPositions, occlusion, previousDirection, random: () => 0,
        nextDisplayed: nextDisplayedIndex(this.level.solutionPath.map((_, index) =>
          this.connection.isVisible(index) ? this.connection.displayNumber(index) : null),
        current === undefined ? 1 : this.connection.displayNumber(current) + 1) });
      this.showChoiceOverlay(cursor.x, cursor.y, choice.neighborhood);
    } catch {
      if (this.weightCursor === cursor) this.choiceOverlay.hidden = true;
    } finally {
      sampler.dispose(); this.samplingWeights = false;
      if (this.weightCursor && this.weightCursor !== cursor && !this.disposed) void this.updatePointerWeights();
    }
  }

  private reset(): void {
    this.manualStatistics.reset();
    this.releasedSinceMove = true;
    this.completionDialog.close();
    this.rejectedPositions.clear();
    const hidden = new Set((this.level.hiddenCells ?? []).map(cellKey));
    const visible = this.level.solutionPath.flatMap((cell, index) =>
      !hidden.has(cellKey(cell)) || index === 0 || index === this.level.solutionPath.length - 1 ? [index] : []);
    this.connection = new ConnectionProgress(this.level.solutionPath.length, visible,
      findSwappableHiddenPairs(this.level.solutionPath, hidden, this.level.boardShape),
      new PathCompletionSolver(this.level.solutionPath, this.level.boardShape));
    this.errors = 0;
    this.message = '从 1 开始，点击或拖动相邻数字球连线。';
  }

  private hit(event: PointerEvent, dragging: boolean): void {
    if (this.busy) return;
    const matrix = this.board.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const index = this.level.solutionPath.findIndex((cell) => Math.hypot(point.x - cell.x - .5, point.y - cell.y - .5) <= .42);
    if (index < 0 || index === this.lastHit) return;
    this.lastHit = index;
    void this.choose(index, dragging);
  }

  private async choose(index: number, dragging = false): Promise<void> {
    if (this.disposed || this.busy || this.simulationRunning || this.replay || this.connection.complete) return;
    const current = this.connection.activeIndex;
    if (current !== undefined) {
      if (current === index || this.connection.isNodeConnected(index)) return;
      if (!areNeighborCells(this.level.solutionPath[current], this.level.solutionPath[index], this.level.boardShape)) return;
      // Passing over visible, out-of-order cells while dragging is not a mistake.
      if (dragging && this.connection.isVisible(index)
        && this.connection.displayNumber(index) !== this.connection.displayNumber(current) + 1) return;
    }
    this.busy = true;
    this.message = '正在判断连线…';
    this.paint();
    try {
      const before = current === undefined ? undefined : await this.captureManualFrame(current, index);
      if (this.disposed) return;
      const action = current === undefined ? this.connection.begin(index) : await this.connection.extendAsync(index,
        (request) => findPathCompletionInWorker(this.level.solutionPath, this.level.boardShape, request));
      if (this.disposed) return;
      if (action.type === 'wrong') {
        this.errors++;
        this.rejectedPositions.add(index);
        this.message = current === undefined ? '请从数字 1 开始。' : '连线错误，请换一个相邻数字球。';
      } else {
        if (this.connection.activeIndex !== current) this.rejectedPositions.clear();
        this.message = this.connection.complete ? '试玩通关！' : '继续点击或拖动相邻数字球。';
      }
      if (before && (action.type === 'advanced' || action.type === 'wrong')) {
        this.manualStatistics.add({ ...before, outcome: action.type === 'wrong' ? 'error' : 'connected',
          after: { labels: this.manualLabels(), edges: this.connection.connectedNodePairs(), errors: this.errors,
            progress: this.connection.progress, complete: this.connection.complete } });
      }
      if (action.type === 'started') this.releasedSinceMove = false;
      if (this.connection.complete) this.showManualCompletion();
    } catch {
      this.message = '连线验证失败，请重试。';
      this.lastHit = undefined;
    } finally {
      this.busy = false;
      if (!this.disposed) this.paint();
      if (this.weightCursor) {
        this.weightCursor = { ...this.weightCursor };
        void this.updatePointerWeights();
      }
    }
  }

  private manualLabels(): Array<number | null> {
    return this.level.solutionPath.map((_, index) => this.connection.isVisible(index) ? this.connection.displayNumber(index) : null);
  }

  private async captureManualFrame(current: number, attempted: number): Promise<Omit<SimulationFrame, 'outcome' | 'after'>> {
    const labels = this.manualLabels(), edges = this.connection.connectedNodePairs();
    const progress = this.connection.progress, errors = this.errors;
    const observed = this.releasedSinceMove || this.pointer === undefined;
    this.releasedSinceMove = false;
    const nextNumber = this.connection.displayNumber(current) + 1;
    const correctNext = this.connection.completionSnapshot().solutionOrder[nextNumber - 1];
    // Use the same current-cell pose as automatic runs, with the live hand type,
    // size and side. Hiding the hand image does not disable its occlusion.
    const sampler = new HandOcclusionSampler(this.simulationGeometry());
    try {
      const occlusion = await sampler.observe(this.fingerToggle.value as HandMode, current);
      const hasUnblockedCandidate = this.level.solutionPath.some((cell, index) => index !== current
        && !this.connection.isNodeConnected(index) && !this.rejectedPositions.has(index)
        && areNeighborCells(this.level.solutionPath[current], cell, this.level.boardShape)
        && !occlusion[index].numberBlocked && (labels[index] === null || labels[index] === nextNumber));
      return { step: edges.length + errors + 1, current, correctNext, attempted, labels, edges, occlusion,
        progress, errors, candidates: [], neighborhood: [], knownNumbers: [], reason: '手动试玩',
        observation: { observed, forced: observed && !hasUnblockedCandidate, probability: observed ? 1 : 0 } };
    } finally { sampler.dispose(); }
  }

  private showManualCompletion(): void {
    const metrics = this.manualStatistics.finish(this.errors);
    this.onManualResult?.(metrics);
    const title = document.createElement('h3'); title.textContent = '手动试玩完成统计';
    const info = document.createElement('p'); info.textContent = `关卡 ${this.displayLevelId} · 已通关 · 本次手动操作统计`;
    const help = document.createElement('p');
    help.textContent = '使用自动跑关的统计口径，记录本轮实际操作；卡点为松手观察时已无未遮挡可选位置的局面。撤销的路径不计入局面和连接统计，错误次数保留。';
    const values = document.createElement('dl'); values.className = 'arranger-manual-metrics';
    METRIC_COLUMNS.forEach(([key, label]) => {
      const name = document.createElement('dt'); name.textContent = label;
      const value = document.createElement('dd'); value.textContent = String(metrics[key]);
      values.append(name, value);
    });
    const actions = document.createElement('div'); actions.className = 'arranger-group-actions';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '关闭';
    close.addEventListener('click', () => this.completionDialog.close());
    const replay = document.createElement('button'); replay.type = 'button'; replay.textContent = '重新试玩';
    replay.addEventListener('click', () => { this.reset(); this.paint(); });
    actions.append(close, replay);
    this.completionDialog.replaceChildren(title, info, help, values, actions);
    if (this.pointer !== undefined && this.board.hasPointerCapture(this.pointer)) this.board.releasePointerCapture(this.pointer);
    this.pointer = undefined;
    this.weightCursor = undefined; this.finger.hidden = this.cursorMarker.hidden = this.choiceOverlay.hidden = true;
    this.thumbHand.hide();
    this.completionDialog.showModal();
  }

  private paint(): void {
    const edges = this.replay?.edges ?? this.connection.connectedNodePairs();
    const connected = new Set(edges.flatMap(([a, b]) => [a, b]));
    this.lines.replaceChildren(...edges.map(([from, to]) => {
      const a = this.level.solutionPath[from];
      const b = this.level.solutionPath[to];
      return svgElement('line', { x1: String(a.x + .5), y1: String(a.y + .5), x2: String(b.x + .5), y2: String(b.y + .5) });
    }));
    this.nodes.forEach((node, index) => {
      const value = this.replay ? this.replay.labels[index] : this.connection.isVisible(index) ? this.connection.displayNumber(index) : null;
      const visible = value !== null;
      const label = visible ? String(value) : '?';
      node.classList.toggle('is-hidden', !visible);
      node.classList.toggle('is-start', index === 0);
      node.classList.toggle('is-end', index === this.nodes.length - 1);
      node.classList.toggle('is-connected', connected.has(index));
      node.classList.toggle('is-current', index === (this.replay?.current ?? this.connection.activeIndex));
      node.classList.toggle('is-occluded', this.replay?.occlusion[index].numberBlocked ?? false);
      node.classList.toggle('is-attempted', index === this.replay?.attempted);
      node.querySelector('text')!.textContent = label;
      const cell = this.level.solutionPath[index];
      node.setAttribute('aria-label', `第 ${cell.y + 1} 行第 ${cell.x + 1} 列，${visible ? `数字 ${label}` : '隐藏数字'}`);
    });
    this.status.textContent = this.replay ? `模拟回放 · 进度 ${this.replay.progress}/${this.nodes.length} · 错误 ${this.replay.errors} 次`
      : `${this.message} 进度 ${this.connection.progress}/${this.nodes.length} · 错误 ${this.errors} 次`;
    this.undo.disabled = this.busy || this.simulationRunning || !!this.replay || !this.connection.canUndoStep;
    this.restart.disabled = this.busy || this.simulationRunning || !!this.replay;
  }

  prepareBatchCalculation(): DOMRect {
    this.simulationPanel?.invalidate();
    return this.board.getBoundingClientRect();
  }

  private simulationGeometry(): OcclusionGeometry {
    const matrix = this.board.getScreenCTM();
    if (!matrix) throw new Error('棋盘尚未显示，无法采样遮挡。');
    return {
      centers: this.level.solutionPath.map((cell) => {
        const point = new DOMPoint(cell.x + .5, cell.y + .5).matrixTransform(matrix);
        return { x: point.x, y: point.y };
      }),
      radius: .38 * Math.hypot(matrix.a, matrix.b), board: this.board.getBoundingClientRect(),
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      handSize: this.fingerSize.valueAsNumber, leftHand: this.handSide.value === 'left', clipBoard: this.boardClipBounds(),
    };
  }
}
