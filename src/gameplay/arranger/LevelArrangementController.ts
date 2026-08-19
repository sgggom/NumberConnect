import { encodeCompactLevelData } from '../../game/levelDataFormat';
import type { LevelData } from '../../game/types';
import {
  addArrangementLevels,
  arrangementBoardFamilies,
  arrangementLevelDataJson,
  arrangementRows,
  findArrangementLevelLocation,
  parseArrangementClipboardText,
  type ArrangementBoardFamily,
  type ArrangementLevelGroup,
  type ArrangementLibraryLevel,
  readArrangementLibraryFile,
  removeArrangementLevel,
} from './levelArrangement';
import { mountLevelArrangementView } from './LevelArrangementView';
import { buildPathTrend, pathTrendColorAt } from './pathTrend';
import {
  DEFAULT_AUTO_ARRANGEMENT_FORM,
  generateAutoArrangement,
  parseDifficultyIdRange,
  parseFormationIdRange,
  type AutoArrangementOcclusionPreference,
} from './autoArrangement';
import {
  clearArrangementLibraryFile,
  loadArrangementLibraryFile,
  saveArrangementLibraryFile,
} from './arrangementLibraryCache';
import './arranger.css';

const PAGE_SIZE = 100;
const PATH_PARAMETER_HEADERS = new Set([
  '实际路径交叉数量', '直角拐弯占比', '锐角拐弯占比', '钝角拐弯占比',
  '平均路径长度（拐弯的拐点算作端点，看整个棋盘中的线段平均长度）',
  '向上移动占比', '向下移动占比', '向左移动占比', '向右移动占比',
  '向左上移动占比', '向右上移动占比', '向左下移动占比', '向右下移动占比',
  '连续向右数量', '连续向下数量', '连续向右下数量', '连续遮挡计数',
  '起点位置（分为左上/右上/左下/右下/靠中）', '终点位置',
]);
const DIFFICULTY_PARAMETER_HEADERS = new Set([
  '目标难度', '实际隐藏数', '实际隐藏占比 %', '实际最长连续显示', '实际最长连续隐藏',
  '平均总步数', '低推理平均错误数', '中推理平均错误数', '高推理平均错误数',
  '平均可连接数量', '直接连接占比 %', '平均距离下个显示数字', '平均每步难度分',
  '前期平均难度分', '中期平均难度分', '后期平均难度分',
]);

interface LibraryParameterGroup {
  title: string;
  items: Array<{ label: string; value: string }>;
}

interface LibraryParameterTarget {
  boardIndex: number;
  pathIndex?: number;
  difficultyIndex?: number;
  variantIndex?: number;
}

export interface LevelArrangementControllerOptions {
  onBack: () => void;
  onPlaytest: (level: LevelData) => void;
}

export class LevelArrangementController {
  private library: ArrangementLibraryLevel[] = [];
  private libraryById = new Map<string, ArrangementLibraryLevel>();
  private families: ArrangementBoardFamily[] = [];
  private groups: ArrangementLevelGroup[] = [{ id: 1, levelIds: [] }];
  private selectedGroupId = 1;
  private selectedLibraryLevelIds = new Set<string>();
  private selectedPoolLevelIds: string[] = [];
  private selectedPoolLevelIdSet = new Set<string>();
  private activeBoardIndex?: number;
  private activePathIndex?: number;
  private activeDifficultyIndex?: number;
  private previewLevelId?: string;
  private libraryParameterTarget?: LibraryParameterTarget;
  private page = 0;
  private cacheRestoreAttempted = false;
  private showTrend = true;
  private showConnection = false;

  public constructor(
    private readonly host: HTMLElement,
    private readonly options: LevelArrangementControllerOptions,
  ) {
    mountLevelArrangementView(host);
  }

  public bind(): void {
    this.query('#arranger-back-button').addEventListener('click', this.options.onBack);
    this.query('#arranger-open-file').addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => void this.readSelectedFile());
    this.query('#arranger-add-group').addEventListener('click', () => this.addGroup());
    this.query('#arranger-auto-layout').addEventListener('click', () => this.openAutoArrangementDialog());
    this.query('#arranger-auto-close').addEventListener('click', () => this.closeAutoArrangementDialog());
    this.query('#arranger-auto-cancel').addEventListener('click', () => this.closeAutoArrangementDialog());
    this.query('#arranger-auto-read-layout').addEventListener('click', () => void this.readArrangementFromClipboard());
    this.query('#arranger-auto-generate').addEventListener('click', () => this.generateAutomaticArrangement());
    this.query('#arranger-auto-board-count').addEventListener('input', () => this.syncAutoArrangementStages());
    this.query<HTMLDialogElement>('#arranger-auto-dialog').addEventListener('cancel', (event) => {
      event.preventDefault();
      this.closeAutoArrangementDialog();
    });
    this.query('#arranger-copy-groups').addEventListener('click', () => void this.copyGroups());
    this.query('#arranger-copy-level-data').addEventListener('click', () => void this.copyLevelData());
    this.query<HTMLInputElement>('#arranger-search').addEventListener('input', () => {
      this.page = 0;
      this.renderLibrary();
    });
    this.query('#arranger-add-selected').addEventListener('click', () => this.addSelectedFamiliesToPool());
    this.query('#arranger-page-previous').addEventListener('click', () => this.changePage(-1));
    this.query('#arranger-page-next').addEventListener('click', () => this.changePage(1));
    this.query<HTMLInputElement>('#arranger-show-trend').addEventListener('change', (event) => {
      this.showTrend = (event.currentTarget as HTMLInputElement).checked;
      this.renderPreview();
    });
    this.query<HTMLInputElement>('#arranger-show-connection').addEventListener('change', (event) => {
      this.showConnection = (event.currentTarget as HTMLInputElement).checked;
      this.renderPreview();
    });
    this.query('#arranger-playtest-button').addEventListener('click', () => {
      const entry = this.previewLevelId ? this.libraryById.get(this.previewLevelId) : undefined;
      if (entry) this.options.onPlaytest(this.cloneLevel(entry.level));
    });
    this.groupList.addEventListener('click', (event) => this.handleGroupClick(event));
    this.groupList.addEventListener('pointerover', (event) => this.handleGroupHover(event));
    this.libraryList.addEventListener('click', (event) => this.handleLibraryClick(event));
    this.libraryList.addEventListener('pointerover', (event) => this.handleLibraryHover(event));
    this.renderGroups();
  }

  public open(): void {
    this.renderGroups();
    this.renderLibrary();
    this.renderPreview();
    if (!this.cacheRestoreAttempted && this.library.length === 0) {
      this.cacheRestoreAttempted = true;
      void this.restoreCachedLibrary();
    }
  }

  private get fileInput(): HTMLInputElement { return this.query('#arranger-file-input'); }
  private get groupList(): HTMLElement { return this.query('#arranger-group-list'); }
  private get libraryList(): HTMLElement { return this.query('#arranger-library-list'); }
  private get autoStageList(): HTMLElement { return this.query('#arranger-auto-stage-list'); }

  private async readSelectedFile(): Promise<void> {
    const file = this.fileInput.files?.[0];
    if (!file) return;
    const status = this.query('#arranger-file-status');
    const openButton = this.query<HTMLButtonElement>('#arranger-open-file');
    openButton.disabled = true;
    status.textContent = `正在读取 ${file.name}…`;
    this.cacheRestoreAttempted = true;
    try {
      const result = await readArrangementLibraryFile(file);
      this.applyLibrary(result.levels, result.skippedRows, `已读取 ${file.name}`);
      await saveArrangementLibraryFile(file);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '读取跑关结果失败。';
    } finally {
      openButton.disabled = false;
      this.fileInput.value = '';
    }
  }

  private async restoreCachedLibrary(): Promise<void> {
    const status = this.query('#arranger-file-status');
    const openButton = this.query<HTMLButtonElement>('#arranger-open-file');
    openButton.disabled = true;
    status.textContent = '正在恢复上次打开的关卡库…';
    try {
      const file = await loadArrangementLibraryFile();
      if (!file) {
        status.textContent = '尚未读取关卡库';
        return;
      }
      const result = await readArrangementLibraryFile(file);
      this.applyLibrary(result.levels, result.skippedRows, `已自动恢复 ${file.name}`);
    } catch {
      status.textContent = '上次的关卡库缓存已失效，请重新读取文件。';
      await clearArrangementLibraryFile().catch(() => undefined);
    } finally {
      openButton.disabled = false;
    }
  }

  private applyLibrary(levels: ArrangementLibraryLevel[], skippedRows: number, prefix: string): void {
    this.library = levels;
    this.libraryById = new Map(levels.map((level) => [level.id, level]));
    this.families = arrangementBoardFamilies(this.library);
    this.groups = [{ id: 1, levelIds: [] }];
    this.selectedGroupId = 1;
    this.selectedLibraryLevelIds.clear();
    this.selectedPoolLevelIds = [];
    this.selectedPoolLevelIdSet.clear();
    this.activeBoardIndex = this.families.length > 0 ? 0 : undefined;
    this.activePathIndex = undefined;
    this.activeDifficultyIndex = undefined;
    this.previewLevelId = this.families[0]?.representative.id;
    this.libraryParameterTarget = this.families.length > 0 ? { boardIndex: 0 } : undefined;
    this.page = 0;
    const pathCount = this.families.reduce((total, family) => total + family.paths.length, 0);
    this.query('#arranger-file-status').textContent = `${prefix}：${this.library.length} 条关卡数据、${this.families.length} 个棋盘、${pathCount} 条路径${skippedRows ? `，跳过 ${skippedRows} 行` : ''}`;
    this.query<HTMLInputElement>('#arranger-search').disabled = false;
    this.query<HTMLButtonElement>('#arranger-auto-layout').disabled = false;
    this.renderGroups();
    this.renderLibrary();
    this.renderPreview();
  }

  private addGroup(): void {
    if (this.groups.some((group) => group.levelIds.length === 0)) return;
    const id = Math.max(0, ...this.groups.map((group) => group.id)) + 1;
    this.groups.push({ id, levelIds: [] });
    this.selectedGroupId = id;
    this.renderGroups();
    this.renderLibrary();
  }

  private openAutoArrangementDialog(): void {
    const status = this.query('#arranger-auto-status');
    status.textContent = '';
    status.classList.remove('is-error');
    this.syncAutoArrangementStages();
    const dialog = this.query<HTMLDialogElement>('#arranger-auto-dialog');
    if (!dialog.open) dialog.showModal();
  }

  private closeAutoArrangementDialog(): void {
    const dialog = this.query<HTMLDialogElement>('#arranger-auto-dialog');
    if (dialog.open) dialog.close();
  }

  private addAutoArrangementStage(
    rangeValue?: string,
    difficultyRangeValue?: string,
  ): void {
    const row = document.createElement('div');
    row.className = 'arranger-auto-stage';
    const index = this.autoStageList.children.length + 1;
    const fixedDefault = DEFAULT_AUTO_ARRANGEMENT_FORM.stages[index - 1];
    const previous = this.autoStageList.lastElementChild;
    const resolvedFormationRange = rangeValue
      ?? fixedDefault?.formationRange
      ?? previous?.querySelector<HTMLInputElement>('[data-stage-formations]')?.value
      ?? this.availableFormationRange();
    const resolvedDifficultyRange = difficultyRangeValue
      ?? fixedDefault?.difficultyRange
      ?? previous?.querySelector<HTMLInputElement>('[data-stage-difficulties]')?.value
      ?? this.availableDifficultyRange();
    row.innerHTML = `
      <b data-stage-number>阶段 ${index}</b>
      <input data-stage-formations type="text" placeholder="例如 1-20,25" aria-label="阶段 ${index} 阵型范围">
      <input data-stage-difficulties type="text" placeholder="例如 1-5,8" aria-label="阶段 ${index} 难度范围">
    `;
    row.querySelector<HTMLInputElement>('[data-stage-formations]')!.value = resolvedFormationRange;
    row.querySelector<HTMLInputElement>('[data-stage-difficulties]')!.value = resolvedDifficultyRange;
    this.autoStageList.append(row);
  }

  private syncAutoArrangementStages(): void {
    const requestedCount = Number(this.query<HTMLInputElement>('#arranger-auto-board-count').value);
    if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 20) return;
    while (this.autoStageList.children.length < requestedCount) {
      this.addAutoArrangementStage();
    }
    while (this.autoStageList.children.length > requestedCount) this.autoStageList.lastElementChild?.remove();
    [...this.autoStageList.children].forEach((child, index) => {
      const row = child as HTMLElement;
      const number = index + 1;
      const label = row.querySelector('[data-stage-number]');
      if (label) label.textContent = `阶段 ${number}`;
      row.querySelector<HTMLInputElement>('[data-stage-formations]')
        ?.setAttribute('aria-label', `阶段 ${number} 阵型范围`);
      row.querySelector<HTMLInputElement>('[data-stage-difficulties]')
        ?.setAttribute('aria-label', `阶段 ${number} 难度范围`);
    });
  }

  private availableFormationRange(): string {
    return this.families
      .map((family) => family.representative.formationId)
      .filter((id): id is number => id !== undefined)
      .sort((left, right) => left - right)
      .join(',');
  }

  private async readArrangementFromClipboard(): Promise<void> {
    const status = this.query('#arranger-auto-status');
    try {
      if (!navigator.clipboard?.readText) throw new Error('当前浏览器无法读取剪贴板文本。');
      const groups = parseArrangementClipboardText(await navigator.clipboard.readText());
      const unknownLevelIds = [...new Set(groups.flatMap((group) => group.levelIds)
        .filter((levelId) => !this.libraryById.has(levelId)))];
      if (unknownLevelIds.length > 0) {
        const preview = unknownLevelIds.slice(0, 5).join('、');
        throw new Error(`当前关卡库中找不到：${preview}${unknownLevelIds.length > 5 ? ` 等 ${unknownLevelIds.length} 条` : ''}。`);
      }
      this.groups = groups;
      this.selectedGroupId = groups[0].id;
      this.selectedLibraryLevelIds.clear();
      this.selectedPoolLevelIds = groups.flatMap((group) => group.levelIds);
      this.selectedPoolLevelIdSet = new Set(this.selectedPoolLevelIds);
      this.renderGroups();
      this.renderLibrary();
      this.query('#arranger-file-status').textContent = `已从剪贴板读取 ${groups.length} 关排布`;
      this.closeAutoArrangementDialog();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '读取剪贴板排布失败。';
      status.classList.add('is-error');
    }
  }

  private availableDifficultyRange(): string {
    return [...new Set(this.library.map((level) => level.difficultyId ?? level.difficulty)
      .filter((id): id is number => id !== undefined))]
      .sort((left, right) => left - right)
      .join(',');
  }

  private generateAutomaticArrangement(): void {
    const status = this.query('#arranger-auto-status');
    try {
      const stages = [...this.autoStageList.children].map((child) => {
        const row = child as HTMLElement;
        return {
          formationIds: parseFormationIdRange(row.querySelector<HTMLInputElement>('[data-stage-formations]')?.value ?? ''),
          difficultyIds: parseDifficultyIdRange(row.querySelector<HTMLInputElement>('[data-stage-difficulties]')?.value ?? ''),
        };
      });
      const groups = generateAutoArrangement(this.families, {
        levelCount: Number(this.query<HTMLInputElement>('#arranger-auto-level-count').value),
        boardsPerLevel: Number(this.query<HTMLInputElement>('#arranger-auto-board-count').value),
        pathRepeatInterval: Number(this.query<HTMLInputElement>('#arranger-auto-path-gap').value),
        occlusionPreference: this.query<HTMLSelectElement>('#arranger-auto-occlusion-preference').value as AutoArrangementOcclusionPreference,
        stages,
      });
      this.groups = groups;
      this.selectedGroupId = groups[0]?.id ?? 1;
      this.selectedLibraryLevelIds.clear();
      this.selectedPoolLevelIds = groups.flatMap((group) => group.levelIds);
      this.selectedPoolLevelIdSet = new Set(this.selectedPoolLevelIds);
      this.renderGroups();
      this.renderLibrary();
      this.query('#arranger-file-status').textContent = `自动排布完成：${groups.length} 关、每关 ${groups[0]?.levelIds.length ?? 0} 个棋盘`;
      this.closeAutoArrangementDialog();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '自动排布失败。';
      status.classList.add('is-error');
    }
  }

  private async copyGroups(): Promise<void> {
    if (this.groups.some((group) => group.levelIds.length === 0)) return;
    const text = [
      ['id', 'levelName'],
      ...arrangementRows(this.groups),
    ].map((row) => row.join('\t')).join('\r\n');
    try {
      await navigator.clipboard.writeText(text);
      this.query('#arranger-file-status').textContent = `已复制 ${this.groups.length} 关排布配置`;
    } catch {
      this.query('#arranger-file-status').textContent = '复制失败，请允许浏览器访问剪贴板。';
    }
  }

  private async copyLevelData(): Promise<void> {
    if (this.groups.some((group) => group.levelIds.length === 0)) return;
    const text = arrangementLevelDataJson(this.groups, this.library);
    const levelCount = Object.keys(JSON.parse(text) as Record<string, unknown>).length;
    try {
      await navigator.clipboard.writeText(text);
      this.query('#arranger-file-status').textContent = `已复制 ${levelCount} 条关卡数据（所用路径的动态难度 1～10）`;
    } catch {
      this.query('#arranger-file-status').textContent = '复制失败，请允许浏览器访问剪贴板。';
    }
  }

  private addSelectedFamiliesToPool(): void {
    const additions: string[] = [];
    [...this.selectedLibraryLevelIds]
      .map((levelId) => this.libraryById.get(levelId))
      .filter((level): level is ArrangementLibraryLevel => Boolean(level))
      .sort((left, right) => left.sourceRow - right.sourceRow)
      .forEach((level) => {
        if (this.selectedPoolLevelIdSet.has(level.id)) return;
        this.selectedPoolLevelIdSet.add(level.id);
        this.selectedPoolLevelIds.push(level.id);
        additions.push(level.id);
      });
    this.groups = addArrangementLevels(this.groups, this.selectedGroupId, additions);
    this.selectedLibraryLevelIds.clear();
    this.renderGroups();
    this.renderLibrary();
  }

  private handleGroupClick(event: Event): void {
    const target = event.target as HTMLElement;
    const remove = target.closest<HTMLElement>('[data-remove-level]');
    if (remove) {
      const groupId = Number(remove.dataset.groupId);
      const levelId = remove.dataset.removeLevel;
      if (levelId) {
        this.groups = removeArrangementLevel(this.groups, groupId, levelId);
        this.selectedPoolLevelIds = this.selectedPoolLevelIds.filter((candidate) => candidate !== levelId);
        this.selectedPoolLevelIdSet.delete(levelId);
      }
      this.renderGroups();
      this.renderLibrary();
      return;
    }
    const level = target.closest<HTMLElement>('[data-preview-level]');
    if (level?.dataset.previewLevel) {
      this.navigateToLibraryLevel(level.dataset.previewLevel);
    }
    const group = target.closest<HTMLElement>('[data-group-id]');
    if (group) {
      this.selectedGroupId = Number(group.dataset.groupId);
      this.renderGroups();
      this.renderLibrary();
    }
  }

  private navigateToLibraryLevel(levelId: string): void {
    const location = findArrangementLevelLocation(this.families, levelId);
    if (!location) return;
    const search = this.query<HTMLInputElement>('#arranger-search');
    search.value = '';
    this.page = Math.floor(location.boardIndex / PAGE_SIZE);
    this.activeBoardIndex = location.boardIndex;
    this.activePathIndex = location.pathIndex;
    this.activeDifficultyIndex = location.difficultyIndex;
    this.libraryParameterTarget = location;
    this.previewLevelId = levelId;
  }

  private handleGroupHover(event: Event): void {
    const level = (event.target as HTMLElement).closest<HTMLElement>('[data-preview-level]');
    const levelId = level?.dataset.previewLevel;
    if (!levelId || levelId === this.previewLevelId) return;
    this.previewLevelId = levelId;
    this.renderPreview();
  }

  private handleLibraryHover(event: Event): void {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-board-index]');
    if (!row) return;
    const target = this.libraryTargetFromRow(row);
    this.libraryParameterTarget = target;
    this.renderLibraryParameters();
    const { board, path, difficulty, variant } = this.resolveLibraryTarget(target);
    const levelId = (variant ?? difficulty?.representative ?? path?.representative ?? board?.representative)?.id;
    if (!levelId || levelId === this.previewLevelId) return;
    this.previewLevelId = levelId;
    this.renderPreview();
  }

  private handleLibraryClick(event: Event): void {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-board-index]');
    if (!row) return;
    const target = this.libraryTargetFromRow(row);
    this.libraryParameterTarget = target;
    const { board, path, difficulty, variant } = this.resolveLibraryTarget(target);
    const levels = variant ? [variant] : difficulty?.variants ?? (path ? this.pathLevels(path) : board ? this.boardLevels(board) : []);
    const representative = variant ?? difficulty?.representative ?? path?.representative ?? board?.representative;
    if (!representative || levels.length === 0) return;
    this.previewLevelId = representative.id;
    const clickedCheckbox = (event.target as HTMLElement).closest<HTMLInputElement>('input[type="checkbox"]');
    if (clickedCheckbox && !clickedCheckbox.disabled) {
      const available = levels.filter((level) => !this.selectedPoolLevelIdSet.has(level.id));
      const shouldSelect = !available.every((level) => this.selectedLibraryLevelIds.has(level.id));
      available.forEach((level) => shouldSelect
        ? this.selectedLibraryLevelIds.add(level.id)
        : this.selectedLibraryLevelIds.delete(level.id));
    } else if (!path) {
      this.activeBoardIndex = target.boardIndex;
      this.activePathIndex = undefined;
      this.activeDifficultyIndex = undefined;
    } else if (!difficulty) {
      this.activeBoardIndex = target.boardIndex;
      this.activePathIndex = target.pathIndex;
      this.activeDifficultyIndex = undefined;
    } else if (!variant) {
      this.activeBoardIndex = target.boardIndex;
      this.activePathIndex = target.pathIndex;
      this.activeDifficultyIndex = target.difficultyIndex;
    }
    this.renderLibrary();
    this.renderPreview();
  }

  private libraryTargetFromRow(row: HTMLElement): LibraryParameterTarget {
    return {
      boardIndex: Number(row.dataset.boardIndex),
      pathIndex: row.dataset.pathIndex === undefined ? undefined : Number(row.dataset.pathIndex),
      difficultyIndex: row.dataset.difficultyIndex === undefined ? undefined : Number(row.dataset.difficultyIndex),
      variantIndex: row.dataset.variantIndex === undefined ? undefined : Number(row.dataset.variantIndex),
    };
  }

  private resolveLibraryTarget(target: LibraryParameterTarget): {
    board?: ArrangementBoardFamily;
    path?: ArrangementBoardFamily['paths'][number];
    difficulty?: ArrangementBoardFamily['paths'][number]['difficulties'][number];
    variant?: ArrangementLibraryLevel;
  } {
    const board = this.families[target.boardIndex];
    const path = target.pathIndex === undefined ? undefined : board?.paths[target.pathIndex];
    const difficulty = target.difficultyIndex === undefined ? undefined : path?.difficulties[target.difficultyIndex];
    const variant = target.variantIndex === undefined ? undefined : difficulty?.variants[target.variantIndex];
    return { board, path, difficulty, variant };
  }

  private changePage(offset: number): void {
    const pageCount = Math.max(1, Math.ceil(this.filteredLibrary().length / PAGE_SIZE));
    this.page = Math.max(0, Math.min(pageCount - 1, this.page + offset));
    this.renderLibrary();
  }

  private filteredLibrary(): ArrangementBoardFamily[] {
    const query = this.query<HTMLInputElement>('#arranger-search').value.trim().toLowerCase();
    if (!query) return this.families;
    return this.families.filter(({ key, representative: entry, paths }) => (
      entry.id.includes(query)
      || key.toLowerCase().includes(query)
      || entry.sourceName.toLowerCase().includes(query)
      || entry.configId.toLowerCase().includes(query)
      || entry.shapeName.toLowerCase().includes(query)
      || paths.some((path) => this.pathLevels(path).some((level) => (
        level.sourceName.toLowerCase().includes(query)
        || level.configId.toLowerCase().includes(query)
      )))
    ));
  }

  private pathLevels(path: ArrangementBoardFamily['paths'][number]): ArrangementLibraryLevel[] {
    return path.difficulties.flatMap((difficulty) => difficulty.variants);
  }

  private boardLevels(board: ArrangementBoardFamily): ArrangementLibraryLevel[] {
    return board.paths.flatMap((path) => this.pathLevels(path));
  }

  private selectionState(levels: ReadonlyArray<ArrangementLibraryLevel>): { checked: boolean; partial: boolean; disabled: boolean } {
    const available = levels.filter((level) => !this.selectedPoolLevelIdSet.has(level.id));
    const selectedCount = available.filter((level) => this.selectedLibraryLevelIds.has(level.id)).length;
    return {
      checked: available.length > 0 && selectedCount === available.length,
      partial: selectedCount > 0 && selectedCount < available.length,
      disabled: available.length === 0,
    };
  }

  private renderGroups(): void {
    this.groupList.replaceChildren(...this.groups.map((group) => {
      const card = document.createElement('article');
      card.className = `arranger-group${group.id === this.selectedGroupId ? ' is-selected' : ''}`;
      card.dataset.groupId = String(group.id);
      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'arranger-group-heading';
      header.innerHTML = `<span>第 ${group.id} 关</span><b>${group.levelIds.length} 个棋盘</b>`;
      const levels = document.createElement('div');
      levels.className = 'arranger-group-levels';
      if (group.levelIds.length === 0) levels.innerHTML = '<small>从关卡库选择棋盘加入</small>';
      group.levelIds.forEach((levelId) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'arranger-group-level';
        chip.dataset.previewLevel = levelId;
        chip.innerHTML = `<span>${levelId}</span><i data-remove-level="${levelId}" data-group-id="${group.id}" title="移除">×</i>`;
        levels.append(chip);
      });
      card.append(header, levels);
      return card;
    }));
    const hasEmptyGroup = this.groups.some((group) => group.levelIds.length === 0);
    this.query<HTMLButtonElement>('#arranger-add-group').disabled = hasEmptyGroup;
    this.query<HTMLButtonElement>('#arranger-copy-groups').disabled = hasEmptyGroup;
    this.query<HTMLButtonElement>('#arranger-copy-level-data').disabled = hasEmptyGroup;
  }

  private renderLibrary(): void {
    const filtered = this.filteredLibrary();
    const pageCount = filtered.length === 0 ? 0 : Math.ceil(filtered.length / PAGE_SIZE);
    if (pageCount > 0) this.page = Math.min(this.page, pageCount - 1);
    const visible = filtered.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE);
    if (visible.length === 0) {
      this.libraryList.innerHTML = `<p class="arranger-empty-copy">${this.library.length ? '没有匹配的棋盘。' : '读取跑关结果后，这里会显示关卡库。'}</p>`;
    } else {
      const visibleBoardIndices = visible.map((board) => this.families.indexOf(board));
      if (this.activeBoardIndex === undefined || !visibleBoardIndices.includes(this.activeBoardIndex)) {
        this.activeBoardIndex = visibleBoardIndices[0];
        this.activePathIndex = undefined;
        this.activeDifficultyIndex = undefined;
        this.libraryParameterTarget = { boardIndex: this.activeBoardIndex };
      }
      const columns: HTMLElement[] = [];
      columns.push(this.createLibraryColumn('棋盘', visible.map((board, visibleIndex) => {
        const boardIndex = visibleBoardIndices[visibleIndex];
        return this.createLibraryNode({
          className: 'arranger-library-item arranger-library-item--board',
          boardIndex,
          entry: board.representative,
          state: this.selectionState(this.boardLevels(board)),
          selectable: false,
          active: boardIndex === this.activeBoardIndex,
          title: board.representative.formationId === undefined
            ? `棋盘 ${this.page * PAGE_SIZE + visibleIndex + 1}`
            : `阵型 ${board.representative.formationId}`,
          badge: `${board.paths.length} ›`,
        });
      })));

      const board = this.activeBoardIndex === undefined ? undefined : this.families[this.activeBoardIndex];
      if (board) {
        columns.push(this.createLibraryColumn('路径', board.paths.map((path, pathIndex) => this.createLibraryNode({
          className: 'arranger-library-item arranger-library-item--path',
          boardIndex: this.activeBoardIndex!,
          pathIndex,
          entry: path.representative,
          state: this.selectionState(this.pathLevels(path)),
          selectable: false,
          active: pathIndex === this.activePathIndex,
          title: `路径 ${path.representative.pathId ?? pathIndex + 1}`,
          badge: `${path.difficulties.length} ›`,
        }))));
      }

      const path = board && this.activePathIndex !== undefined ? board.paths[this.activePathIndex] : undefined;
      if (path) {
        columns.push(this.createLibraryColumn('难度', path.difficulties.map((difficulty, difficultyIndex) => this.createLibraryNode({
          className: 'arranger-library-item arranger-library-item--difficulty',
          boardIndex: this.activeBoardIndex!,
          pathIndex: this.activePathIndex!,
          difficultyIndex,
          entry: difficulty.representative,
          state: this.selectionState(difficulty.variants),
          selectable: true,
          active: difficultyIndex === this.activeDifficultyIndex,
          title: `难度 ${difficulty.representative.difficultyId ?? difficulty.difficulty ?? '—'}`,
          badge: `${difficulty.variants.length} 个结果`,
        }))));
      }
      this.libraryList.replaceChildren(...columns);
    }
    this.query('#arranger-library-count').textContent = `${filtered.length} 个棋盘`;
    this.query<HTMLButtonElement>('#arranger-add-selected').disabled = this.selectedLibraryLevelIds.size === 0;
    this.query<HTMLButtonElement>('#arranger-page-previous').disabled = this.page <= 0;
    this.query<HTMLButtonElement>('#arranger-page-next').disabled = pageCount === 0 || this.page >= pageCount - 1;
    this.query('#arranger-page-label').textContent = `${pageCount ? this.page + 1 : 0} / ${pageCount}`;
    this.renderLibraryParameters();
  }

  private createLibraryColumn(title: string, rows: HTMLElement[]): HTMLElement {
    const column = document.createElement('section');
    column.className = 'arranger-library-column';
    const heading = document.createElement('header');
    heading.textContent = title;
    const list = document.createElement('div');
    list.className = 'arranger-library-column-list';
    list.append(...rows);
    column.append(heading, list);
    return column;
  }

  private createLibraryNode(options: {
    className: string;
    boardIndex: number;
    pathIndex?: number;
    difficultyIndex?: number;
    variantIndex?: number;
    entry: ArrangementLibraryLevel;
    state: { checked: boolean; partial: boolean; disabled: boolean };
    selectable: boolean;
    active?: boolean;
    title: string;
    details?: string | string[];
    badge: string;
  }): HTMLElement {
    const row = document.createElement('div');
    row.className = `${options.className}${options.selectable && options.state.disabled ? ' is-used' : ''}${options.entry.id === this.previewLevelId ? ' is-previewing' : ''}${options.active ? ' is-active' : ''}`;
    row.dataset.boardIndex = String(options.boardIndex);
    if (options.pathIndex !== undefined) row.dataset.pathIndex = String(options.pathIndex);
    if (options.difficultyIndex !== undefined) row.dataset.difficultyIndex = String(options.difficultyIndex);
    if (options.variantIndex !== undefined) row.dataset.variantIndex = String(options.variantIndex);
    const controls = document.createElement('div');
    controls.className = 'arranger-node-controls';
    if (options.selectable) {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = options.state.checked;
      checkbox.indeterminate = options.state.partial;
      checkbox.disabled = options.state.disabled;
      controls.append(checkbox);
    }
    const copy = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = options.title;
    copy.append(name);
    if (options.details !== undefined) {
      const details = document.createElement('small');
      if (Array.isArray(options.details)) {
        details.className = 'arranger-library-metrics';
        options.details.forEach((label) => {
          const metric = document.createElement('i');
          metric.textContent = label;
          details.append(metric);
        });
      } else details.textContent = options.details;
      copy.append(details);
    }
    const badge = document.createElement('b');
    badge.textContent = options.badge;
    row.append(controls, copy, badge);
    return row;
  }

  private difficultyParameterItems(levels: ReadonlyArray<ArrangementLibraryLevel>): Array<{ label: string; value: string }> {
    const average = (read: (metrics: ArrangementLibraryLevel['difficultyMetrics']) => number | undefined): number | undefined => {
      const values = levels.map((level) => read(level.difficultyMetrics)).filter((value): value is number => value !== undefined);
      return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
    };
    const numberItem = (label: string, value: number | undefined, ratio = false): { label: string; value: string } | undefined => {
      if (value === undefined) return undefined;
      const display = ratio && Math.abs(value) <= 1 ? value * 100 : value;
      return { label, value: `${Number.isInteger(display) ? display : display.toFixed(2)}${ratio ? '%' : ''}` };
    };
    return [
      { label: '隐藏结果数', value: String(levels.length) },
      numberItem('平均隐藏数', average((metrics) => metrics.hiddenCount)),
      numberItem('平均隐藏占比', average((metrics) => metrics.hiddenRatio), true),
      numberItem('最长连续显示', average((metrics) => metrics.longestVisible)),
      numberItem('最长连续隐藏', average((metrics) => metrics.longestHidden)),
      numberItem('平均总步数', average((metrics) => metrics.averageSteps)),
      numberItem('低推理错误', average((metrics) => metrics.lowErrors)),
      numberItem('中推理错误', average((metrics) => metrics.mediumErrors)),
      numberItem('高推理错误', average((metrics) => metrics.highErrors)),
      numberItem('平均可连接数', average((metrics) => metrics.averageConnectable)),
      numberItem('直接连接占比', average((metrics) => metrics.directConnectRatio), true),
      numberItem('距下个显示数字', average((metrics) => metrics.averageDistanceToNextVisible)),
      numberItem('平均每步难度', average((metrics) => metrics.averageStepScore)),
      numberItem('前期难度', average((metrics) => metrics.earlyScore)),
      numberItem('中期难度', average((metrics) => metrics.middleScore)),
      numberItem('后期难度', average((metrics) => metrics.lateScore)),
    ].filter((item): item is { label: string; value: string } => Boolean(item));
  }

  private renderLibraryParameters(): void {
    const title = this.query('#arranger-library-parameters-title');
    const body = this.query('#arranger-library-parameters-body');
    const target = this.libraryParameterTarget;
    if (!target) {
      title.textContent = '未选择';
      body.innerHTML = '<p class="arranger-empty-copy">将鼠标移到左侧层级上查看对应参数。</p>';
      return;
    }
    const { board, path, difficulty, variant } = this.resolveLibraryTarget(target);
    if (!board) {
      this.libraryParameterTarget = undefined;
      this.renderLibraryParameters();
      return;
    }

    let heading = '棋盘参数';
    let groups: LibraryParameterGroup[] = [{
      title: '棋盘参数',
      items: [
        ...(board.representative.formationId === undefined ? [] : [
          { label: '阵型 ID', value: String(board.representative.formationId) },
        ]),
        { label: '棋盘形状', value: board.representative.shapeName || '自定义' },
        { label: '棋盘尺寸', value: `${board.representative.level.columns} × ${board.representative.level.rows}` },
        { label: '路径数量', value: String(board.paths.length) },
        { label: '关卡结果', value: String(this.boardLevels(board).length) },
      ],
    }];
    if (path) {
      heading = `路径 ${path.representative.pathId ?? target.pathIndex! + 1} 参数`;
      groups = [{
        title: '路径参数',
        items: [
          ...(path.representative.pathId === undefined ? [] : [
            { label: '路径 ID', value: String(path.representative.pathId) },
          ]),
          ...path.representative.parameters.filter(({ label }) => PATH_PARAMETER_HEADERS.has(label)),
        ],
      }];
    }
    if (difficulty) {
      heading = `难度 ${difficulty.representative.difficultyId ?? difficulty.difficulty ?? '—'} 参数`;
      groups = [
        {
          title: '路径参数',
          items: [
            ...(path!.representative.pathId === undefined ? [] : [
              { label: '路径 ID', value: String(path!.representative.pathId) },
            ]),
            ...path!.representative.parameters.filter(({ label }) => PATH_PARAMETER_HEADERS.has(label)),
          ],
        },
        {
          title: '难度参数',
          items: [
            ...(difficulty.representative.difficultyId === undefined ? [] : [
              { label: '难度 ID', value: String(difficulty.representative.difficultyId) },
            ]),
            ...this.difficultyParameterItems(difficulty.variants),
          ],
        },
      ];
    }
    if (variant) {
      heading = `隐藏结果 ${target.variantIndex! + 1} 参数`;
      const basicItems = variant.parameters.filter(({ label }) => (
        !PATH_PARAMETER_HEADERS.has(label) && !DIFFICULTY_PARAMETER_HEADERS.has(label)
      ));
      groups = [
        { title: '关卡信息', items: basicItems },
        { title: '路径参数', items: variant.parameters.filter(({ label }) => PATH_PARAMETER_HEADERS.has(label)) },
        { title: '难度参数', items: variant.parameters.filter(({ label }) => DIFFICULTY_PARAMETER_HEADERS.has(label)) },
      ];
    }
    title.textContent = heading;
    body.replaceChildren(...groups.filter(({ items }) => items.length > 0).map((group) => {
      const section = document.createElement('section');
      section.className = 'arranger-parameter-group';
      const groupTitle = document.createElement('h4');
      groupTitle.textContent = group.title;
      const grid = document.createElement('div');
      grid.className = 'arranger-parameter-grid';
      grid.append(...group.items.map(({ label, value }) => {
        const item = document.createElement('div');
        const key = document.createElement('small');
        const content = document.createElement('strong');
        key.textContent = label;
        content.textContent = value;
        content.title = value;
        item.append(key, content);
        return item;
      }));
      section.append(groupTitle, grid);
      return section;
    }));
  }

  private renderPreview(): void {
    const entry = this.previewLevelId ? this.libraryById.get(this.previewLevelId) : undefined;
    const preview = this.query('#arranger-preview');
    this.query<HTMLButtonElement>('#arranger-playtest-button').disabled = !entry;
    if (!entry) {
      this.query('#arranger-preview-title').textContent = '未选择';
      preview.innerHTML = '<p class="arranger-empty-copy">从关卡库或左侧列表选择一个棋盘。</p>';
      return;
    }
    this.query('#arranger-preview-title').textContent = entry.id;
    const data = encodeCompactLevelData(entry.level).data;
    const svgNamespace = 'http://www.w3.org/2000/svg';
    const board = document.createElementNS(svgNamespace, 'svg');
    board.classList.add('arranger-preview-board');
    board.setAttribute('viewBox', `0 0 ${entry.level.columns} ${entry.level.rows}`);
    board.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    board.setAttribute('role', 'img');
    board.setAttribute('aria-label', `${entry.level.columns} 列 ${entry.level.rows} 行棋盘及完整连接路径`);

    const trendPoints = this.showTrend ? buildPathTrend(entry.level.solutionPath.map((cell) => ({
      x: cell.x + 0.5,
      y: cell.y + 0.5,
    }))) : [];

    if (this.showTrend) {
      const definitions = document.createElementNS(svgNamespace, 'defs');
      const arrow = document.createElementNS(svgNamespace, 'marker');
      arrow.id = 'arranger-preview-trend-arrow';
      arrow.setAttribute('viewBox', '0 0 0.5 0.5');
      arrow.setAttribute('markerWidth', '0.5');
      arrow.setAttribute('markerHeight', '0.5');
      arrow.setAttribute('refX', '0.46');
      arrow.setAttribute('refY', '0.25');
      arrow.setAttribute('orient', 'auto');
      arrow.setAttribute('markerUnits', 'userSpaceOnUse');
      const arrowShape = document.createElementNS(svgNamespace, 'path');
      arrowShape.setAttribute('d', 'M 0 0 L 0.5 0.25 L 0 0.5 Z');
      arrowShape.setAttribute('fill', pathTrendColorAt(1));
      arrow.append(arrowShape);
      definitions.append(arrow);
      trendPoints.slice(1).forEach((point, index) => {
        const previous = trendPoints[index];
        const segmentCount = trendPoints.length - 1;
        const gradient = document.createElementNS(svgNamespace, 'linearGradient');
        gradient.id = `arranger-preview-trend-gradient-${index}`;
        gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
        gradient.setAttribute('x1', String(previous.x));
        gradient.setAttribute('y1', String(previous.y));
        gradient.setAttribute('x2', String(point.x));
        gradient.setAttribute('y2', String(point.y));
        const start = document.createElementNS(svgNamespace, 'stop');
        start.setAttribute('offset', '0');
        start.setAttribute('stop-color', pathTrendColorAt(index / segmentCount));
        const end = document.createElementNS(svgNamespace, 'stop');
        end.setAttribute('offset', '1');
        end.setAttribute('stop-color', pathTrendColorAt((index + 1) / segmentCount));
        gradient.append(start, end);
        definitions.append(gradient);
      });
      board.append(definitions);
    }

    const path = document.createElementNS(svgNamespace, 'polyline');
    path.classList.add('arranger-preview-path');
    path.setAttribute('points', entry.level.solutionPath
      .map((cell) => `${cell.x + 0.5},${cell.y + 0.5}`)
      .join(' '));
    if (this.showConnection) board.append(path);

    if (this.showTrend) {
      const trend = document.createElementNS(svgNamespace, 'g');
      trend.classList.add('arranger-preview-trend');
      trendPoints.slice(1).forEach((point, index) => {
        const previous = trendPoints[index];
        const segment = document.createElementNS(svgNamespace, 'line');
        segment.classList.add('arranger-preview-trend-segment');
        segment.setAttribute('x1', String(previous.x));
        segment.setAttribute('y1', String(previous.y));
        segment.setAttribute('x2', String(point.x));
        segment.setAttribute('y2', String(point.y));
        segment.setAttribute('stroke', `url(#arranger-preview-trend-gradient-${index})`);
        if (index === trendPoints.length - 2) {
          segment.setAttribute('marker-end', 'url(#arranger-preview-trend-arrow)');
        }
        trend.append(segment);
      });
      board.append(trend);
    }

    data.forEach((row, y) => row.forEach((value, x) => {
      if (value === 0) return;
      const group = document.createElementNS(svgNamespace, 'g');
      group.classList.add('arranger-preview-cell');
      if (value < 0) group.classList.add('is-hidden');
      if (Math.abs(value) === 1) group.classList.add('is-start');
      if (Math.abs(value) === entry.level.solutionPath.length) group.classList.add('is-end');
      const circle = document.createElementNS(svgNamespace, 'circle');
      circle.setAttribute('cx', String(x + 0.5));
      circle.setAttribute('cy', String(y + 0.5));
      circle.setAttribute('r', '0.38');
      const label = document.createElementNS(svgNamespace, 'text');
      label.setAttribute('x', String(x + 0.5));
      label.setAttribute('y', String(y + 0.51));
      label.textContent = value < 0 ? '?' : String(value);
      group.append(circle, label);
      board.append(group);
    }));
    preview.replaceChildren(board);
  }

  private cloneLevel(level: LevelData): LevelData {
    return {
      ...level,
      activeCells: level.activeCells.map((cell) => ({ ...cell })),
      solutionPath: level.solutionPath.map((cell) => ({ ...cell })),
      hiddenCells: level.hiddenCells?.map((cell) => ({ ...cell })),
    };
  }

  private query<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.host.querySelector<T>(selector);
    if (!element) throw new Error(`Missing arrangement tool element: ${selector}`);
    return element;
  }
}
