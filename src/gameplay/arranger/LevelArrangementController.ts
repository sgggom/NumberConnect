import { decodeCompactLevelData } from '../../game/levelDataFormat';
import type { LevelData } from '../../game/types';
import {
  addArrangementLevels,
  arrangementBoardFamilies,
  selectArrangementExportLevels,
  compareFormationIds,
  arrangementRows,
  findArrangementLevelLocation,
  parseArrangementClipboardText,
  type ArrangementBoardFamily,
  type ArrangementLevelGroup,
  type ArrangementLibraryIndex,
  removeArrangementLevel,
} from './levelArrangement';
import { mountLevelArrangementView } from './LevelArrangementView';
import { buildPathTrend, pathTrendColorAt } from './pathTrend';
import {
  DEFAULT_AUTO_ARRANGEMENT_FORM,
  generateAutoArrangementAsync,
  parseDifficultyIdRange,
  parseFormationIdRange,
  type AutoArrangementOcclusionPreference,
} from './autoArrangement';
import {
  clearArrangementLibraryFile,
  loadArrangementLibraryFile,
} from './arrangementLibraryCache';
import type { ArrangementLibraryLevel } from './levelArrangement';
import {
  DATABASE_BATCH_SIZE, deleteArrangementLibrary, importArrangementLibrary, loadActiveArrangementLibrary,
  loadArrangementIndices, loadArrangementDetails, loadArrangementDraft, saveArrangementDraft,
  type ArrangementLibraryManifest,
} from './arrangementDatabase';
import './arranger.css';
import { crossingDensity, straightRatio } from './arrangementScoring';
import { hiddenIntroductionDifficulties } from './hiddenDifficulty';
import { ArrangementPlaytest } from './ArrangementPlaytest';
import { ConfigurationBatchPanel } from './ConfigurationBatchPanel';
import { createConfigurationBatchTasks } from './configurationBatchTasks';
import { chooseConfigurationBatchScope, BATCH_CONFIGURATION_LABELS } from './ConfigurationBatchScopePanel';
import { METRIC_COLUMNS, summarizeConfigurationRun, type ConfigurationMetrics } from './configurationBatchMetrics';
import { loadBatchHistoryResults } from './configurationBatchHistory';
import { chooseExcelBatchSettings } from './ExcelBatchSettingsPanel';
import { createExcelBatchTasks } from './excelBatchTasks';

const PAGE_SIZE = 100;
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

type ArrangementMode = 'main' | 'daily' | 'bead';

interface ArrangementConfiguration {
  groups: ArrangementLevelGroup[];
  selectedGroupId: number;
}

const ARRANGEMENT_MODE_LABELS: Record<ArrangementMode, string> = {
  main: '主玩法配置',
  daily: '每日挑战配置',
  bead: '拼豆玩法配置',
};

const createEmptyArrangementConfiguration = (): ArrangementConfiguration => ({
  groups: [{ id: 1, levelIds: [] }],
  selectedGroupId: 1,
});

export interface LevelArrangementControllerOptions {
  onBack: () => void;
}

export class LevelArrangementController {
  private library: ArrangementLibraryIndex[] = [];
  private libraryById = new Map<string, ArrangementLibraryIndex>();
  private libraryParameterHeaders: string[] = [];
  private families: ArrangementBoardFamily[] = [];
  private arrangementMode: ArrangementMode = 'main';
  private arrangementConfigurations: Record<ArrangementMode, ArrangementConfiguration> = {
    main: createEmptyArrangementConfiguration(),
    daily: createEmptyArrangementConfiguration(),
    bead: createEmptyArrangementConfiguration(),
  };
  private selectedLibraryLevelIds = new Set<string>();
  private selectedPoolLevelIds: string[] = [];
  private selectedPoolLevelIdSet = new Set<string>();
  private activeBoardIndex?: number;
  private activePathIndex?: number;
  private activeDifficultyIndex?: number;
  private previewLevelId?: string;
  private lockedPreviewLevelId?: string;
  private libraryParameterTarget?: LibraryParameterTarget;
  private page = 0;
  private cacheRestoreAttempted = false;
  private showTrend = true;
  private showConnection = false;
  private libraryId?: string;
  private previewEntry?: ArrangementLibraryLevel;
  private previewHiddenDifficulties = new Map<string, number>();
  private playtestMode = false;
  private playtest?: ArrangementPlaytest;
  private playtestLevelId?: string;
  private previewRequest = 0;
  private draftSaveTimer?: ReturnType<typeof setTimeout>;
  private restoringDraft = false;
  private listPages = new Map<string, number>();
  private previewTimer?: ReturnType<typeof setTimeout>;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private exporting = false;
  private generationToken = 0;
  private batchPanel?: ConfigurationBatchPanel;
  private batchCalculating = false;
  private simulationResults = new Map<string, { metrics?: ConfigurationMetrics; status: string; source: string }>();

  public constructor(
    private readonly host: HTMLElement,
    private readonly options: LevelArrangementControllerOptions,
  ) {
    mountLevelArrangementView(host);
  }

  public bind(): void {
    this.query('#arranger-back-button').addEventListener('click', () => {
      this.batchPanel?.cancel();
      this.stopPlaytest();
      this.playtestMode = false;
      this.options.onBack();
    });
    this.query('#arranger-open-file').addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => void this.readSelectedFile());
    this.query('#arranger-add-group').addEventListener('click', () => this.addGroup());
    this.query('#arranger-config-switcher').addEventListener('click', (event) => this.switchArrangementMode(event));
    this.query('#arranger-auto-layout').addEventListener('click', () => this.openAutoArrangementDialog());
    this.query('#arranger-auto-close').addEventListener('click', () => this.closeAutoArrangementDialog());
    this.query('#arranger-auto-cancel').addEventListener('click', () => this.closeAutoArrangementDialog());
    this.query('#arranger-auto-read-layout').addEventListener('click', () => void this.readArrangementFromClipboard());
    this.query('#arranger-auto-generate').addEventListener('click', () => void this.generateAutomaticArrangement());
    this.query('#arranger-auto-board-count').addEventListener('input', () => this.syncAutoArrangementStages());
    this.query<HTMLDialogElement>('#arranger-auto-dialog').addEventListener('cancel', (event) => {
      event.preventDefault();
      this.closeAutoArrangementDialog();
    });
    this.query('#arranger-copy-groups').addEventListener('click', () => void this.copyGroups());
    this.query('#arranger-copy-level-data').addEventListener('click', () => void this.exportLevelData());
    this.query('#arranger-excel-calculate').addEventListener('click', () => this.query<HTMLInputElement>('#arranger-excel-calculate-file').click());
    this.query('#arranger-excel-calculate-file').addEventListener('change', () => void this.calculateExcel());
    this.query('#arranger-batch-calculate').addEventListener('click', () => void this.calculateCurrentConfiguration());
    this.query<HTMLInputElement>('#arranger-search').addEventListener('input', () => {
      this.page = 0;
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => this.renderLibrary(), 150);
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
      const entry = this.previewEntry?.id === this.previewLevelId ? this.previewEntry : undefined;
      if (!entry) return;
      this.playtestMode = !this.playtestMode;
      this.stopPlaytest();
      this.renderPreview();
    });
    this.groupList.addEventListener('click', (event) => this.handleGroupClick(event));
    this.groupList.addEventListener('pointerover', (event) => this.handleGroupHover(event));
    window.addEventListener('keydown', (event) => this.handleDifficultyKey(event));
    window.addEventListener('pagehide', () => this.saveDraft());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.saveDraft();
    });
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
  private get groups(): ArrangementLevelGroup[] { return this.arrangementConfigurations[this.arrangementMode].groups; }
  private set groups(groups: ArrangementLevelGroup[]) { this.arrangementConfigurations[this.arrangementMode].groups = groups; }
  private get selectedGroupId(): number { return this.arrangementConfigurations[this.arrangementMode].selectedGroupId; }
  private set selectedGroupId(selectedGroupId: number) {
    this.arrangementConfigurations[this.arrangementMode].selectedGroupId = selectedGroupId;
  }

  private async readSelectedFile(): Promise<void> {
    const file = this.fileInput.files?.[0];
    if (!file) return;
    const status = this.query('#arranger-file-status');
    const openButton = this.query<HTMLButtonElement>('#arranger-open-file');
    openButton.disabled = true;
    status.textContent = `正在读取 ${file.name}…`;
    this.cacheRestoreAttempted = true;
    try {
      const result = await importArrangementLibrary(file, (message) => {
        status.textContent = message;
      });
      await this.applyStoredLibrary(result, false);
      await clearArrangementLibraryFile().catch(() => undefined);
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
      const manifest = await loadActiveArrangementLibrary();
      if (manifest) {
        await this.applyStoredLibrary(manifest, true);
        return;
      }
      const file = await loadArrangementLibraryFile();
      if (!file) {
        status.textContent = '尚未读取关卡库';
        return;
      }
      const result = await importArrangementLibrary(file, (message) => {
        status.textContent = message;
      });
      await this.applyStoredLibrary(result, true);
      await clearArrangementLibraryFile().catch(() => undefined);
    } catch (error) {
      status.textContent = `恢复失败：${error instanceof Error ? error.message : '请重新读取文件。'}`;
    } finally {
      openButton.disabled = false;
    }
  }

  private async applyStoredLibrary(manifest: ArrangementLibraryManifest, restoreDraft: boolean): Promise<void> {
    const levels = await loadArrangementIndices(manifest.id);
    if (levels.length !== manifest.count) throw new Error('关卡库数据不完整，请重新导入。');
    const draft = restoreDraft ? await loadArrangementDraft(manifest.id) : undefined;
    this.saveDraft();
    this.restoringDraft = true;
    try {
      this.stopPlaytest();
      this.libraryId = manifest.id;
      this.previewEntry = undefined;
      this.applyLibrary(levels, manifest.parameterHeaders, manifest.skippedRows, `已${restoreDraft ? '恢复' : '导入'} ${manifest.name}`);
      if (draft) {
        this.arrangementConfigurations = draft.configurations;
        this.arrangementMode = draft.mode;
        this.syncSelectedPoolFromCurrentGroups();
        this.renderGroups();
        this.renderLibrary();
      }
    } finally { this.restoringDraft = false; }
    this.saveDraft();
  }

  private saveDraft(): void {
    clearTimeout(this.draftSaveTimer);
    if (!this.libraryId || this.restoringDraft) return;
    const id = this.libraryId;
    const draft = structuredClone({ mode: this.arrangementMode, configurations: this.arrangementConfigurations });
    void saveArrangementDraft(id, draft).catch((error) => {
      if (this.libraryId === id) this.query('#arranger-file-status').textContent = `自动保存失败，请复制配置备份：${error instanceof Error ? error.message : String(error)}`;
    });
  }

  private applyLibrary(
    levels: ArrangementLibraryIndex[],
    parameterHeaders: string[],
    skippedRows: number,
    prefix: string,
  ): void {
    this.library = levels;
    this.libraryById = new Map(levels.map((level) => [level.id, level]));
    this.libraryParameterHeaders = parameterHeaders;
    this.families = arrangementBoardFamilies(this.library);
    this.arrangementMode = 'main';
    this.arrangementConfigurations = {
      main: createEmptyArrangementConfiguration(),
      daily: createEmptyArrangementConfiguration(),
      bead: createEmptyArrangementConfiguration(),
    };
    this.selectedLibraryLevelIds.clear();
    this.selectedPoolLevelIds = [];
    this.selectedPoolLevelIdSet.clear();
    this.activeBoardIndex = this.families.length > 0 ? 0 : undefined;
    this.activePathIndex = undefined;
    this.activeDifficultyIndex = undefined;
    this.lockedPreviewLevelId = undefined;
    this.previewLevelId = this.families[0]?.representative.id;
    this.libraryParameterTarget = this.families.length > 0 ? { boardIndex: 0 } : undefined;
    this.page = 0;
    this.listPages.clear();
    const pathCount = this.families.reduce((total, family) => total + family.paths.length, 0);
    this.query('#arranger-file-status').textContent = `${prefix}：${this.library.length} 条关卡数据、${this.families.length} 个棋盘、${pathCount} 条路径${skippedRows ? `，跳过 ${skippedRows} 行` : ''}`;
    this.query<HTMLInputElement>('#arranger-search').disabled = false;
    this.query<HTMLButtonElement>('#arranger-auto-layout').disabled = false;
    this.renderGroups();
    this.renderLibrary();
    this.renderPreview();
  }

  private switchArrangementMode(event: Event): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-arrangement-mode]');
    const mode = target?.dataset.arrangementMode;
    if (mode !== 'main' && mode !== 'daily' && mode !== 'bead') return;
    this.arrangementMode = mode;
    this.selectedLibraryLevelIds.clear();
    this.syncSelectedPoolFromCurrentGroups();
    this.renderGroups();
    this.renderLibrary();
  }

  private syncSelectedPoolFromCurrentGroups(): void {
    this.selectedPoolLevelIds = this.groups.flatMap((group) => group.levelIds);
    this.selectedPoolLevelIdSet = new Set(this.selectedPoolLevelIds);
  }

  private addGroup(): void {
    if (this.groups.some((group) => group.levelIds.length === 0)) return;
    const id = this.groups.reduce((max, group) => Math.max(max, group.id), 0) + 1;
    this.groups.push({ id, levelIds: [] });
    this.selectedGroupId = id;
    this.listPages.set(`groups:${this.arrangementMode}`, Math.floor((this.groups.length - 1) / PAGE_SIZE));
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
    this.generationToken += 1;
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
      <input data-stage-formations type="text" placeholder="例如 44,[n1~n20],[n30~n40],55" aria-label="阶段 ${index} 阵型范围">
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
      .filter((id): id is number | string => id !== undefined)
      .sort(compareFormationIds)
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
      this.syncSelectedPoolFromCurrentGroups();
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

  private async generateAutomaticArrangement(): Promise<void> {
    const status = this.query('#arranger-auto-status');
    const button = this.query<HTMLButtonElement>('#arranger-auto-generate');
    const libraryId = this.libraryId;
    const mode = this.arrangementMode;
    const token = ++this.generationToken;
    button.disabled = true;
    try {
      const stages = [...this.autoStageList.children].map((child) => {
        const row = child as HTMLElement;
        return {
          formationIds: parseFormationIdRange(row.querySelector<HTMLInputElement>('[data-stage-formations]')?.value ?? ''),
          difficultyIds: parseDifficultyIdRange(row.querySelector<HTMLInputElement>('[data-stage-difficulties]')?.value ?? ''),
        };
      });
      const groups = await generateAutoArrangementAsync(this.families, {
        levelCount: Number(this.query<HTMLInputElement>('#arranger-auto-level-count').value),
        boardsPerLevel: Number(this.query<HTMLInputElement>('#arranger-auto-board-count').value),
        pathRepeatInterval: Number(this.query<HTMLInputElement>('#arranger-auto-path-gap').value),
        shapeRepeatInterval: Number(this.query<HTMLInputElement>('#arranger-auto-shape-gap').value),
        occlusionPreference: this.query<HTMLSelectElement>('#arranger-auto-occlusion-preference').value as AutoArrangementOcclusionPreference,
        straightPreference: this.query<HTMLSelectElement>('#arranger-auto-straight-preference').value as AutoArrangementOcclusionPreference,
        crossingComplexityPreference: this.query<HTMLSelectElement>('#arranger-auto-crossing-complexity-preference').value as AutoArrangementOcclusionPreference,
        laterHiddenNeighborPreference: this.query<HTMLSelectElement>('#arranger-auto-later-hidden-neighbor-preference').value as AutoArrangementOcclusionPreference,
        stages,
      }, (completed) => {
        if (token !== this.generationToken) throw new Error('排布已取消。');
        status.textContent = `正在生成第 ${completed} 关…`;
      });
      if (libraryId !== this.libraryId || mode !== this.arrangementMode) throw new Error('关卡库或配置模式已切换，请重新生成。');
      this.groups = groups;
      this.selectedGroupId = groups[0]?.id ?? 1;
      this.selectedLibraryLevelIds.clear();
      this.syncSelectedPoolFromCurrentGroups();
      this.renderGroups();
      this.renderLibrary();
      this.query('#arranger-file-status').textContent = `自动排布完成：${groups.length} 关、每关 ${groups[0]?.levelIds.length ?? 0} 个棋盘`;
      this.closeAutoArrangementDialog();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '自动排布失败。';
      status.classList.add('is-error');
    } finally { button.disabled = false; }
  }

  private async copyGroups(): Promise<void> {
    if (this.groups.some((group) => group.levelIds.length === 0)) return;
    const text = [
      ['id', 'levelName'],
      ...arrangementRows(this.groups),
    ].map((row) => row.join('\t')).join('\r\n');
    try {
      await navigator.clipboard.writeText(text);
      this.query('#arranger-file-status').textContent = `已复制${ARRANGEMENT_MODE_LABELS[this.arrangementMode]}：${this.groups.length} 关`;
    } catch {
      this.query('#arranger-file-status').textContent = '复制失败，请允许浏览器访问剪贴板。';
    }
  }

  private async calculateExcel(): Promise<void> {
    const input = this.query<HTMLInputElement>('#arranger-excel-calculate-file');
    const file = input.files?.[0]; input.value = '';
    if (!file || this.batchCalculating) return;
    this.batchCalculating = true;
    this.renderGroups();
    const status = this.query('#arranger-file-status');
    let temporaryLibrary: string | undefined;
    try {
      const manifest = await importArrangementLibrary(file, (message) => { status.textContent = message; }, false);
      temporaryLibrary = manifest.id;
      const levels = await loadArrangementIndices(manifest.id);
      if (!levels.length) throw new Error('Excel 中没有可计算的关卡，请提供关卡ID和关卡数据两列。');
      const selection = await chooseExcelBatchSettings(this.host, file.name, levels.length, manifest.skippedRows);
      if (!selection) { status.textContent = '已取消 Excel 计算。'; return; }
      const indices = new Map(levels.map((level) => [level.id, level]));
      const tasks = createExcelBatchTasks(levels, file.name);
      const board = this.playtest?.prepareBatchCalculation()
        ?? (this.query('#arranger-preview').querySelector('svg') ?? this.query('#arranger-preview')).getBoundingClientRect();
      if (!board.width || !board.height) throw new Error('棋盘预览区域不可见，请扩大窗口后重试。');
      this.batchPanel ??= new ConfigurationBatchPanel(this.host);
      await this.batchPanel.run(`Excel：${file.name}`, tasks, board, async (id) => {
        const [detail] = await loadArrangementDetails(manifest.id, [id]);
        return this.decodeLevel({ ...indices.get(id)!, ...detail });
      }, undefined, selection.repetitions, selection.settings, {
        libraryId: manifest.id, scope: `Excel：${file.name} · 全部 ${levels.length} 个版本 · 全部难度 · 原表行号见配置关号${manifest.skippedRows ? ` · 跳过${manifest.skippedRows}行无效数据` : ''}`,
      });
      status.textContent = `Excel 计算已结束：${file.name}。结果可在“计算配置”的历史记录中查看或应用。`;
    } catch (error) {
      status.textContent = `Excel 计算失败：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      if (temporaryLibrary) await deleteArrangementLibrary(temporaryLibrary).catch(() => undefined);
      this.batchCalculating = false; this.renderGroups();
    }
  }

  private async calculateCurrentConfiguration(): Promise<void> {
    if (this.batchCalculating) return;
    const libraryId = this.libraryId ?? '';
    this.batchCalculating = true;
    this.renderGroups();
    try {
      const allTasks = Object.entries(this.arrangementConfigurations).flatMap(([configuration, value]) =>
        createConfigurationBatchTasks(value.groups, this.library).map((task) => ({ ...task, configuration })));
      const selection = await chooseConfigurationBatchScope(this.host, allTasks, this.arrangementMode, async (entry) => {
        this.batchPanel ??= new ConfigurationBatchPanel(this.host);
        await this.batchPanel.showHistory(entry);
      }, async (entry) => {
        const results = await loadBatchHistoryResults(entry.id);
        if (this.libraryId !== libraryId) throw new Error('关卡库已切换，请重新打开计算配置。');
        const matched = results.filter((result) => result.metrics && this.libraryById.has(result.id));
        if (!matched.length) throw new Error('此历史没有可应用到当前关卡库的有效结果。');
        const applied = new Set<string>();
        for (const result of matched) {
          applied.add(result.id);
          this.simulationResults.set(`${libraryId}:${result.id}`, {
            metrics: result.metrics, status: result.status,
            source: `历史 ${new Date(entry.createdAt).toLocaleString()} · ${BATCH_CONFIGURATION_LABELS[result.configuration as ArrangementMode] ?? entry.name} · 第${result.groupId}关 · 棋盘${result.stage} · 难度${result.difficulty ?? 0} · ${result.repetitions ?? entry.repetitions}次平均`,
          });
        }
        this.renderLibraryParameters();
        this.query('#arranger-file-status').textContent = `已应用历史结果：${applied.size} 个关卡，列表和关卡库中的“模拟跑关结果”已更新${results.length > matched.length ? `；跳过 ${results.length - matched.length} 条无统计或未匹配结果` : ''}。`;
      });
      if (!selection?.tasks.length) return;
      const { tasks, repetitions, settings } = selection;
      const modeLabel = [...new Set(tasks.map((task) => BATCH_CONFIGURATION_LABELS[task.configuration as ArrangementMode]))].join('＋');
      if (!this.query('#arranger-preview').querySelector('svg')) {
        this.previewLevelId = tasks[0].id;
        await this.loadPreview();
      }
      const board = this.playtest?.prepareBatchCalculation()
        ?? this.query('#arranger-preview').querySelector('svg')?.getBoundingClientRect();
      if (!board || board.width <= 0 || board.height <= 0) throw new Error('请先选择一个棋盘，使预览区域可见。');
      this.batchPanel ??= new ConfigurationBatchPanel(this.host);
      await this.batchPanel.run(modeLabel, tasks, board, async (id) => {
        const index = this.libraryById.get(id);
        if (!index) throw new Error(`关卡库中找不到 ${id}`);
        const [detail] = await loadArrangementDetails(libraryId, [id]);
        if (!detail) throw new Error(`缺少 ${id} 的关卡数据`);
        return this.decodeLevel({ ...index, ...detail });
      }, (result) => {
        this.simulationResults.set(`${libraryId}:${result.id}`, {
          metrics: result.metrics, status: result.status,
          source: `${BATCH_CONFIGURATION_LABELS[result.configuration as ArrangementMode]} · 第${result.groupId}关 · 棋盘${result.stage} · 难度${result.difficulty ?? 0} · ${result.repetitions ?? 0}次平均`,
        });
        this.renderLibraryParameters();
      }, repetitions, settings, { libraryId, scope: selection.scope });
    } catch (error) {
      this.query('#arranger-file-status').textContent = `批量计算失败：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.batchCalculating = false;
      this.renderGroups();
    }
  }

  private async exportLevelData(): Promise<void> {
    if (this.exporting) return;
    const configurations = Object.values(this.arrangementConfigurations)
      .map((configuration) => configuration.groups);
    if (!configurations.some((groups) => groups.some((group) => group.levelIds.length > 0))) return;
    const libraryId = this.libraryId;
    if (!libraryId) return;
    const button = this.query<HTMLButtonElement>('#arranger-copy-level-data');
    this.exporting = true;
    button.disabled = true;
    try {
      const selected = selectArrangementExportLevels(configurations.flat(), this.library);
      const parts: BlobPart[] = ['{'];
      for (let offset = 0; offset < selected.length; offset += DATABASE_BATCH_SIZE) {
        const batch = selected.slice(offset, offset + DATABASE_BATCH_SIZE);
        const details = await loadArrangementDetails(libraryId, batch.map((level) => level.id));
        const text = batch.map((level, index) => `${JSON.stringify(level.id)}:${JSON.stringify(details[index].levelData)}`).join(',');
        parts.push(new Blob([offset ? ',' : '', text]));
        this.query('#arranger-file-status').textContent = `正在导出 ${Math.min(offset + batch.length, selected.length)} / ${selected.length} 条关卡…`;
      }
      parts.push('}');
      const blob = new Blob(parts, { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = '三模式关卡数据.json';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      this.query('#arranger-file-status').textContent = `已导出三种模式共用关卡库：${selected.length} 条关卡数据（所用路径的动态难度 1～10）`;
    } catch (error) {
      this.query('#arranger-file-status').textContent = `导出失败：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.exporting = false;
      button.disabled = !Object.values(this.arrangementConfigurations).some((config) => config.groups.some((group) => group.levelIds.length));
    }
  }

  private addSelectedFamiliesToPool(): void {
    const additions: string[] = [];
    [...this.selectedLibraryLevelIds]
      .map((levelId) => this.libraryById.get(levelId))
      .filter((level): level is ArrangementLibraryIndex => Boolean(level))
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
      this.togglePreviewLock(level.dataset.previewLevel);
      this.navigateToLibraryLevel(level.dataset.previewLevel);
      this.renderPreview();
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
    this.listPages.set(`paths:${this.families[location.boardIndex].key}`, Math.floor(location.pathIndex / PAGE_SIZE));
    this.activeDifficultyIndex = location.difficultyIndex;
    this.libraryParameterTarget = location;
    this.previewLevelId = levelId;
  }

  private togglePreviewLock(levelId: string): void {
    this.lockedPreviewLevelId = this.lockedPreviewLevelId === levelId ? undefined : levelId;
  }

  private handleDifficultyKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || !this.host.getClientRects().length || document.querySelector('dialog[open]')) return;
    const target = event.target;
    if (target instanceof Element && (target.closest('input, textarea, select, [role="textbox"]')
      || (target instanceof HTMLElement && target.isContentEditable))) return;
    const current = this.lockedPreviewLevelId ?? this.previewLevelId;
    const location = current && findArrangementLevelLocation(this.families, current);
    if (!location) return;
    event.preventDefault();
    const path = this.families[location.boardIndex].paths[location.pathIndex];
    const difficulty = path.difficulties[location.difficultyIndex + (event.key === 'ArrowUp' ? -1 : 1)];
    if (!difficulty) return;
    this.lockedPreviewLevelId = difficulty.representative.id;
    this.navigateToLibraryLevel(difficulty.representative.id);
    this.renderLibrary();
    this.renderPreview();
  }

  private renderPreviewLock(): void {
    for (const row of this.queryAll<HTMLElement>('[data-preview-level], [data-library-level]')) {
      const locked = (row.dataset.previewLevel ?? row.dataset.libraryLevel) === this.lockedPreviewLevelId;
      row.classList.toggle('is-preview-locked', locked);
      row.title = locked ? '已锁定预览，再次点击取消锁定' : '点击锁定此关卡预览';
      if (row instanceof HTMLButtonElement) row.setAttribute('aria-pressed', String(locked));
    }
    this.query('#arranger-preview-lock-status').textContent = this.lockedPreviewLevelId ? '已锁定 · ↑↓切换难度 · 再点取消' : '悬停预览 · 点击锁定 · ↑↓切换难度';
  }

  private handleGroupHover(event: Event): void {
    if (this.playtestMode || this.lockedPreviewLevelId) return;
    const level = (event.target as HTMLElement).closest<HTMLElement>('[data-preview-level]');
    const levelId = level?.dataset.previewLevel;
    if (!levelId || levelId === this.previewLevelId) return;
    this.previewLevelId = levelId;
    const location = findArrangementLevelLocation(this.families, levelId);
    if (location) { this.libraryParameterTarget = location; this.renderLibraryParameters(); }
    this.renderPreview();
  }

  private handleLibraryHover(event: Event): void {
    if (this.playtestMode || this.lockedPreviewLevelId) return;
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
    const clickedCheckbox = (event.target as HTMLElement).closest<HTMLInputElement>('input[type="checkbox"]');
    if (!clickedCheckbox) this.libraryParameterTarget = target;
    const { board, path, difficulty, variant } = this.resolveLibraryTarget(target);
    const levels = variant ? [variant] : difficulty?.variants ?? (path ? this.pathLevels(path) : board ? this.boardLevels(board) : []);
    const representative = variant ?? difficulty?.representative ?? path?.representative ?? board?.representative;
    if (!representative || levels.length === 0) return;
    if (!clickedCheckbox) {
      this.togglePreviewLock(representative.id);
      this.previewLevelId = representative.id;
    }
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
    variant?: ArrangementLibraryIndex;
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
      || paths.some((path) => path.difficulties.some((difficulty) => difficulty.variants.some((level) => (
        level.sourceName.toLowerCase().includes(query)
        || level.configId.toLowerCase().includes(query)
      ))))
    ));
  }

  private pathLevels(path: ArrangementBoardFamily['paths'][number]): ArrangementLibraryIndex[] {
    return path.difficulties.flatMap((difficulty) => difficulty.variants);
  }

  private boardLevels(board: ArrangementBoardFamily): ArrangementLibraryIndex[] {
    return board.paths.flatMap((path) => this.pathLevels(path));
  }

  private selectionState(levels: ReadonlyArray<ArrangementLibraryIndex>): { checked: boolean; partial: boolean; disabled: boolean } {
    const available = levels.filter((level) => !this.selectedPoolLevelIdSet.has(level.id));
    const selectedCount = available.filter((level) => this.selectedLibraryLevelIds.has(level.id)).length;
    return {
      checked: available.length > 0 && selectedCount === available.length,
      partial: selectedCount > 0 && selectedCount < available.length,
      disabled: available.length === 0,
    };
  }

  private renderGroups(): void {
    if (!this.restoringDraft) {
      clearTimeout(this.draftSaveTimer);
      this.draftSaveTimer = setTimeout(() => this.saveDraft(), 200);
    }
    this.queryAll<HTMLButtonElement>('[data-arrangement-mode]').forEach((button) => {
      const selected = button.dataset.arrangementMode === this.arrangementMode;
      button.setAttribute('aria-selected', String(selected));
      button.classList.toggle('is-active', selected);
    });
    this.groupList.replaceChildren(...this.paginatedNodes(`groups:${this.arrangementMode}`, this.groups, (group) => {
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
      levels.append(...this.paginatedNodes(`chips:${this.arrangementMode}:${group.id}`, group.levelIds, (levelId) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'arranger-group-level';
        chip.dataset.previewLevel = levelId;
        chip.innerHTML = `<span>${levelId}</span><i data-remove-level="${levelId}" data-group-id="${group.id}" title="移除">×</i>`;
        return chip;
      }, () => this.renderGroups()));
      card.append(header, levels);
      return card;
    }, () => this.renderGroups()));
    this.renderPreviewLock();
    const hasEmptyGroup = this.groups.some((group) => group.levelIds.length === 0);
    const hasAnyConfiguredLevel = Object.values(this.arrangementConfigurations)
      .some((configuration) => configuration.groups.some((group) => group.levelIds.length > 0));
    this.query<HTMLButtonElement>('#arranger-add-group').disabled = hasEmptyGroup;
    this.query<HTMLButtonElement>('#arranger-copy-groups').disabled = hasEmptyGroup;
    this.query<HTMLButtonElement>('#arranger-copy-level-data').disabled = this.exporting || !hasAnyConfiguredLevel;
    this.query<HTMLButtonElement>('#arranger-batch-calculate').disabled = this.batchCalculating;
    this.query<HTMLButtonElement>('#arranger-excel-calculate').disabled = this.batchCalculating;
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
        if (!this.lockedPreviewLevelId) this.libraryParameterTarget = { boardIndex: this.activeBoardIndex };
      }
      const columns: HTMLElement[] = [];
      columns.push(this.createLibraryColumn('棋盘', visible.map((board, visibleIndex) => {
        const boardIndex = visibleBoardIndices[visibleIndex];
        return this.createLibraryNode({
          className: 'arranger-library-item arranger-library-item--board',
          boardIndex,
          entry: board.representative,
          state: { checked: false, partial: false, disabled: false },
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
        columns.push(this.createLibraryColumn('路径', this.paginatedNodes(`paths:${board.key}`, board.paths, (path, pathIndex) => this.createLibraryNode({
          className: 'arranger-library-item arranger-library-item--path',
          boardIndex: this.activeBoardIndex!,
          pathIndex,
          entry: path.representative,
          state: { checked: false, partial: false, disabled: false },
          selectable: false,
          active: pathIndex === this.activePathIndex,
          title: `路径 ${path.representative.pathId ?? pathIndex + 1}`,
          badge: `${path.difficulties.length} ›`,
        }), () => this.renderLibrary())));
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
    this.renderPreviewLock();
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
    entry: ArrangementLibraryIndex;
    state: { checked: boolean; partial: boolean; disabled: boolean };
    selectable: boolean;
    active?: boolean;
    title: string;
    details?: string | string[];
    badge: string;
  }): HTMLElement {
    const row = document.createElement('div');
    row.className = `${options.className}${options.selectable && options.state.disabled ? ' is-used' : ''}${options.entry.id === this.previewLevelId ? ' is-previewing' : ''}${options.active ? ' is-active' : ''}`;
    row.dataset.libraryLevel = options.entry.id;
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

  private pathParameterItems(level: ArrangementLibraryIndex): Array<{ label: string; value: string }> {
    const metrics = level.pathMetrics;
    const item = (label: string, value: number | string | undefined): { label: string; value: string } | undefined => (
      value === undefined || value === '' ? undefined : { label, value: String(value) }
    );
    return [
      item('实际路径交叉数量', metrics.crossings),
      item('交叉密度', crossingDensity(level) === undefined ? undefined : `${(crossingDensity(level)! * 100).toFixed(2)}%`),
      item('直行占比', straightRatio(level) === undefined ? undefined : `${(straightRatio(level)! * 100).toFixed(2)}%`),
      item('直角拐弯占比', metrics.rightAngleRatio),
      item('锐角拐弯占比', metrics.acuteAngleRatio),
      item('钝角拐弯占比', metrics.obtuseAngleRatio),
      item('平均路径长度（拐弯的拐点算作端点，看整个棋盘中的线段平均长度）', metrics.averageSegmentLength),
      item('向上移动占比', metrics.directionRatios.上),
      item('向下移动占比', metrics.directionRatios.下),
      item('向左移动占比', metrics.directionRatios.左),
      item('向右移动占比', metrics.directionRatios.右),
      item('向左上移动占比', metrics.directionRatios.左上),
      item('向右上移动占比', metrics.directionRatios.右上),
      item('向左下移动占比', metrics.directionRatios.左下),
      item('向右下移动占比', metrics.directionRatios.右下),
      item('连续向右数量', metrics.consecutiveRightCount),
      item('连续向右下数量', metrics.consecutiveLowerRightCount),
      item('连续遮挡计数', metrics.consecutiveOcclusionCount),
      item('起点位置（分为左上/右上/左下/右下/靠中）', metrics.startPosition),
      item('终点位置', metrics.endPosition),
    ].filter((candidate): candidate is { label: string; value: string } => Boolean(candidate));
  }

  private difficultyParameterItems(levels: ReadonlyArray<ArrangementLibraryIndex>): Array<{ label: string; value: string }> {
    const average = (read: (metrics: ArrangementLibraryIndex['difficultyMetrics']) => number | undefined): number | undefined => {
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
      numberItem('多个更大隐藏数字数量', average((metrics) => metrics.laterHiddenNeighborCount)),
      numberItem('向右下空位数量', average((metrics) => metrics.lowerRightEmptyCount)),
      numberItem('向右空位数量', average((metrics) => metrics.rightEmptyCount)),
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
        { label: '棋盘尺寸', value: `${board.representative.columns} × ${board.representative.rows}` },
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
          ...this.pathParameterItems(path.representative),
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
            ...this.pathParameterItems(path!.representative),
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
      const basicItems = this.libraryParameterHeaders.flatMap((label, index) => {
        const value = this.previewEntry?.id === variant.id ? this.previewEntry.parameterValues[index] : undefined;
        return value ? [{ label, value }] : [];
      });
      groups = [
        { title: '关卡信息', items: basicItems },
        { title: '路径参数', items: this.pathParameterItems(variant) },
        { title: '难度参数', items: this.difficultyParameterItems([variant]) },
      ];
    }
    const resultLevel = variant ?? difficulty?.representative ?? path?.representative ?? board.representative;
    const simulation = this.simulationResults.get(`${this.libraryId}:${resultLevel.id}`);
    groups.unshift({ title: '模拟跑关结果', items: [
      { label: 'id', value: resultLevel.id },
      { label: '状态', value: simulation?.status ?? '尚未计算' },
      ...(simulation ? [{ label: '来源（最近结果）', value: simulation.source }] : []),
      ...(simulation?.metrics ? METRIC_COLUMNS.map(([key, label]) => ({ label, value: String(Number(simulation.metrics![key].toFixed(2))) })) : []),
    ] });
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
    this.renderPreviewLock();
    // Hovering across rows should not queue a database read for every pointer event.
    clearTimeout(this.previewTimer);
    ++this.previewRequest;
    this.query<HTMLButtonElement>('#arranger-playtest-button').disabled = true;
    this.previewTimer = setTimeout(() => void this.loadPreview(), 60);
  }

  private stopPlaytest(): void {
    this.playtest?.dispose();
    this.playtest = undefined;
    this.playtestLevelId = undefined;
  }

  private paginatedNodes<T>(key: string, items: readonly T[], render: (item: T, index: number) => HTMLElement, update: () => void): HTMLElement[] {
    const count = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const page = Math.min(this.listPages.get(key) ?? 0, count - 1);
    const nodes = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
      .map((item, index) => render(item, page * PAGE_SIZE + index));
    if (count === 1) return nodes;
    const pager = document.createElement('div');
    pager.className = 'arranger-library-pagination arranger-inline-pagination';
    const label = document.createElement('span');
    label.textContent = `${page + 1} / ${count}（共 ${items.length} 项）`;
    const previous = document.createElement('button');
    const next = document.createElement('button');
    previous.type = next.type = 'button';
    previous.textContent = '上一页';
    next.textContent = '下一页';
    previous.disabled = page === 0;
    next.disabled = page === count - 1;
    for (const [button, offset] of [[previous, -1], [next, 1]] as const) {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.listPages.set(key, page + offset);
        update();
      });
    }
    pager.append(previous, label, next);
    return [pager, ...nodes];
  }

  private async loadPreview(): Promise<void> {
    const request = ++this.previewRequest;
    const index = this.previewLevelId ? this.libraryById.get(this.previewLevelId) : undefined;
    const preview = this.query('#arranger-preview');
    if (!this.playtestMode || this.playtestLevelId !== index?.id) this.stopPlaytest();
    const modeButton = this.query<HTMLButtonElement>('#arranger-playtest-button');
    modeButton.textContent = this.playtestMode ? '试玩模式' : '预览模式';
    modeButton.setAttribute('aria-pressed', String(this.playtestMode));
    modeButton.title = this.playtestMode ? '点击切换到预览模式' : '点击切换到试玩模式';
    this.query<HTMLInputElement>('#arranger-show-trend').disabled = this.playtestMode;
    this.query<HTMLInputElement>('#arranger-show-connection').disabled = this.playtestMode;
    this.query<HTMLButtonElement>('#arranger-playtest-button').disabled = true;
    if (!index || !this.libraryId) {
      this.query('#arranger-preview-title').textContent = '未选择';
      preview.innerHTML = '<p class="arranger-empty-copy">从关卡库或左侧列表选择一个棋盘。</p>';
      return;
    }
    let entry = this.previewEntry;
    if (entry?.id !== index.id) {
      preview.textContent = '正在读取棋盘…';
      try {
        const [detail] = await loadArrangementDetails(this.libraryId, [index.id]);
        if (request !== this.previewRequest) return;
        entry = { ...index, ...detail };
        const tier = index.difficultyId ?? index.difficulty;
        const siblings = this.library.filter((candidate) =>
          candidate.id !== index.id && candidate.boardKey === index.boardKey
          && candidate.pathKey === index.pathKey && candidate.formationId === index.formationId
          && candidate.pathId === index.pathId
          && (candidate.difficultyId ?? candidate.difficulty ?? Infinity) <= (tier ?? 0));
        const variants = [entry];
        for (let offset = 0; offset < siblings.length; offset += DATABASE_BATCH_SIZE) {
          const batch = siblings.slice(offset, offset + DATABASE_BATCH_SIZE);
          const details = await loadArrangementDetails(this.libraryId, batch.map((candidate) => candidate.id));
          if (request !== this.previewRequest) return;
          variants.push(...batch.map((candidate, i) => ({ ...candidate, ...details[i] })));
        }
        this.previewHiddenDifficulties = hiddenIntroductionDifficulties(variants);
        this.previewEntry = entry;
      } catch (error) {
        if (request === this.previewRequest) preview.textContent = `预览读取失败：${error instanceof Error ? error.message : String(error)}`;
        return;
      }
    }
    this.query<HTMLButtonElement>('#arranger-playtest-button').disabled = false;
    this.query('#arranger-preview-title').textContent = entry.id;
    const level = this.decodeLevel(entry);
    if (this.playtestMode) {
      if (!this.playtest) {
        const libraryId = this.libraryId, levelId = entry.id;
        this.playtest = new ArrangementPlaytest(preview, level, (run) => {
          this.simulationResults.set(`${libraryId}:${levelId}`, {
            metrics: summarizeConfigurationRun(level, run),
            status: run.complete ? '已通关' : `未通关：${run.stoppedReason}`,
            source: '当前棋盘模拟',
          });
          this.renderLibraryParameters();
        });
        this.playtestLevelId = entry.id;
      }
      return;
    }
    const data = entry.levelData.data;
    const svgNamespace = 'http://www.w3.org/2000/svg';
    const board = document.createElementNS(svgNamespace, 'svg');
    board.classList.add('arranger-preview-board');
    board.setAttribute('viewBox', `0 0 ${entry.columns} ${entry.rows}`);
    board.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    board.setAttribute('role', 'img');
    board.setAttribute('aria-label', `${entry.columns} 列 ${entry.rows} 行棋盘及完整连接路径`);

    const trendPoints = this.showTrend ? buildPathTrend(level.solutionPath.map((cell) => ({
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
    path.setAttribute('points', level.solutionPath
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
      if (Math.abs(value) === level.solutionPath.length) group.classList.add('is-end');
      const circle = document.createElementNS(svgNamespace, 'circle');
      circle.setAttribute('cx', String(x + 0.5));
      circle.setAttribute('cy', String(y + 0.5));
      circle.setAttribute('r', '0.38');
      const label = document.createElementNS(svgNamespace, 'text');
      label.setAttribute('x', String(x + 0.5));
      label.setAttribute('y', String(y + 0.51));
      const introduction = this.previewHiddenDifficulties.get(`${x},${y}`);
      label.textContent = value < 0 ? String(introduction ?? '?') : String(value);
      if (value < 0) {
        const title = document.createElementNS(svgNamespace, 'title');
        title.textContent = introduction === undefined
          ? '缺少完整难度数据，无法确定新增难度'
          : `难度 ${introduction} 新增的隐藏位置`;
        group.append(title);
      }
      group.append(circle, label);
      board.append(group);
    }));
    preview.replaceChildren(board);
  }

  private decodeLevel(entry: ArrangementLibraryLevel): LevelData {
    return decodeCompactLevelData(entry.levelData, entry.sourceRow, false);
  }

  private query<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.host.querySelector<T>(selector);
    if (!element) throw new Error(`Missing arrangement tool element: ${selector}`);
    return element;
  }

  private queryAll<T extends HTMLElement = HTMLElement>(selector: string): T[] {
    return [...this.host.querySelectorAll<T>(selector)];
  }
}
