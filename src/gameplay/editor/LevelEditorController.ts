import './editor.css';
import { BoardShape, type LevelData } from '../../game/types';
import { EditorSplitPaneController } from './EditorSplitPaneController';
import { LevelEditorModel } from './LevelEditorModel';
import { mountLevelEditorView } from './LevelEditorView';
import {
  EDITOR_ALGORITHMS,
  editorAlgorithmLabel,
  renderEditorAlgorithmParameters,
  type EditorAlgorithmId,
} from './algorithms';
import type { EditorShape, ManualEditMode } from './types';

interface LevelEditorControllerOptions {
  getLevels: () => LevelData[];
  getNextLevelId: () => number;
  onLevelsChange: (levels: LevelData[]) => void;
  onBack: () => void;
}

export class LevelEditorController {
  private readonly model = new LevelEditorModel();
  private painting = false;
  private paintValue = true;
  private lastManualPathHitKey?: string;
  private bound = false;
  private selectedLevelId?: number;
  private readonly splitPane: EditorSplitPaneController;
  private readonly pathResizeObserver: ResizeObserver;

  public constructor(
    private readonly host: HTMLElement,
    private readonly options: LevelEditorControllerOptions,
  ) {
    mountLevelEditorView(this.host);
    this.splitPane = new EditorSplitPaneController(
      this.query<HTMLElement>('.editor-layout'),
      this.query<HTMLElement>('#editor-resizer'),
    );
    this.pathResizeObserver = new ResizeObserver(() => this.renderPathLines());
  }

  public bind(): void {
    if (this.bound) return;
    this.bound = true;
    this.splitPane.bind();
    this.pathResizeObserver.observe(this.query<HTMLElement>('.editor-workspace'));
    this.query('#editor-back-button').addEventListener('click', this.options.onBack);
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
    this.query('#editor-undo-delete-button').addEventListener('click', () => this.undoLastDeletion());
    this.query('#editor-generate-path-button').addEventListener('click', () => this.generatePath());
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
  }

  public open(): void {
    this.selectedLevelId = undefined;
    this.model.reset();
    this.render();
    this.setStatus('在左侧棋盘拖动绘制形状，然后选择算法生成路径。');
  }

  private render(): void {
    const { rows, columns } = this.model.size();
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
    const order = this.model.pathOrder();
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
        if (this.model.activeCells.has(key)) button.classList.add('is-active');
        if (this.model.hiddenCellKeys.has(key)) button.classList.add('is-manual-hidden');
        if (value) {
          button.classList.add('is-path');
          button.title = this.model.manualEditMode === 'hidden'
            ? '右键取消该格子的隐藏状态'
            : '右键删除此格子之后的路径和格子';
          if (value === 1) button.classList.add('is-start');
          if (value === this.model.solutionPath.length) button.classList.add('is-end');
          button.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            this.painting = false;
            this.handlePathContextAction(key);
          });
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
    this.renderPathLines();

    this.query<HTMLSelectElement>('#editor-shape').value = this.model.shape;
    this.query<HTMLSelectElement>('#editor-manual-mode').value = this.model.manualEditMode;
    this.renderAlgorithmControls();
    this.query<HTMLButtonElement>('#editor-fill-button').hidden = this.model.algorithmSelection.id !== 'algorithm-1';
    this.query<HTMLButtonElement>('#editor-generate-path-button').disabled = this.model.manualEditMode !== 'off';
    this.query<HTMLButtonElement>('#editor-undo-delete-button').disabled = !this.model.canUndoDeletion;
    this.query<HTMLButtonElement>('#editor-size-minus').disabled = false;
    this.query<HTMLButtonElement>('#editor-size-plus').disabled = false;
    this.query('#editor-size-value').textContent = `${columns} × ${rows}`;
    const nextId = this.options.getNextLevelId();
    this.query('#editor-save-id').textContent = `下次保存：${nextId}`;
    this.query<HTMLElement>('#editor-preview').style.backgroundImage = `url('./level-backgrounds/${this.model.previewName(nextId)}.png')`;
    this.query<HTMLButtonElement>('#editor-save-button').disabled = !this.model.hasGeneratedPath;
    this.query<HTMLButtonElement>('#editor-level-add').disabled = !this.model.hasGeneratedPath;
    this.renderLevelList();
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
    if (!this.model.generatePath()) {
      this.render();
      this.setStatus('当前算法无法生成覆盖全部格子的路径，请调整棋盘或更换算法。', true);
      return;
    }
    this.render();
    this.setStatus(`第 ${this.model.pathGenerationCount} 次路径生成成功：共 ${this.model.solutionPath.length} 个格子。`);
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
    if (this.model.solutionPath.length < 1) return;

    const workspace = this.query<HTMLElement>('.editor-workspace');
    const workspaceBounds = workspace.getBoundingClientRect();
    const buttons = new Map(
      [...this.host.querySelectorAll<HTMLButtonElement>('.editor-cell[data-cell-key]')]
        .map((button) => [button.dataset.cellKey!, button] as const),
    );
    const points = this.model.solutionPath.map((cell) => {
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
      const fontSize = Math.max(18, Math.min(36, point!.size * 0.56));
      const nodeRadius = Math.max(fontSize * 0.72, String(value).length * fontSize * 0.32 + 5);
      const node = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      node.setAttribute('cx', String(point!.x));
      node.setAttribute('cy', String(point!.y));
      node.setAttribute('r', String(nodeRadius));
      node.setAttribute('class', `editor-path-node${index === 0 ? ' is-start' : ''}${index === points.length - 1 ? ' is-end' : ''}${this.model.hiddenCellKeys.has(point!.key) ? ' is-hidden' : ''}`);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', String(point!.x));
      label.setAttribute('y', String(point!.y));
      label.setAttribute('class', `editor-path-number${index === 0 ? ' is-start' : ''}${index === points.length - 1 ? ' is-end' : ''}${this.model.hiddenCellKeys.has(point!.key) ? ' is-hidden' : ''}`);
      label.style.fontSize = `${fontSize}px`;
      label.textContent = String(value);
      svg.append(node, label);
    });
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
    const parameterHost = this.query<HTMLElement>('#editor-algorithm-parameters');
    parameterHost.dataset.algorithm = this.model.algorithmSelection.id;
    renderEditorAlgorithmParameters(parameterHost, this.model.algorithmSelection, this.model.shape, (selection) => {
      this.model.setAlgorithmSelection(selection);
      this.render();
    });
  }

  private setStatus(message: string, error = false): void {
    const status = this.query<HTMLElement>('#editor-status');
    status.textContent = message;
    status.classList.toggle('is-error', error);
  }

  private query<T extends Element>(selector: string): T {
    const element = this.host.querySelector<T>(selector);
    if (!element) throw new Error(`Missing level editor element: ${selector}`);
    return element;
  }
}
