import { ConfigurationSimulationPool, configurationSimulationConcurrency } from './configurationSimulationPool';
import type { LevelData } from '../../game/types';
import { findPathCompletionInWorker } from '../../game/pathCompletionWorker';
import { HandOcclusionSampler } from './handOcclusion';
import { simulateRepeatedConfiguration } from './repeatedConfigurationSimulation';
import { configurationBatchGeometry, readConfigurationBatchSettings, type ConfigurationBatchSettings } from './configurationBatchSettings';
import { METRIC_COLUMNS, csvCell, type ConfigurationMetrics } from './configurationBatchMetrics';

import type { ConfigurationBatchTask } from './configurationBatchTasks';
import { BATCH_CONFIGURATION_LABELS } from './ConfigurationBatchScopePanel';
import { describeBatchSettings, loadBatchHistoryResults, saveBatchHistory, saveBatchResumePlan, loadBatchResumePlan, listBatchHistory, pendingBatchOrders, withBatchHistoryLock, type BatchHistoryEntry } from './configurationBatchHistory';
export interface ConfigurationBatchResult extends ConfigurationBatchTask { metrics?: ConfigurationMetrics; status: string; repetitions?: number; completedRuns?: number }
type Result = ConfigurationBatchResult & { order: number };

export class ConfigurationBatchPanel {
  private readonly dialog = document.createElement('dialog');
  private readonly status = document.createElement('p');
  private readonly settingsInfo = document.createElement('p');
  private readonly rows = document.createElement('tbody');
  private readonly exportButton = document.createElement('button');
  private readonly cancelButton = document.createElement('button');
  private readonly closeButton = document.createElement('button');
  private abort?: AbortController;
  private results: Result[] = [];
  private resultCount = 0;
  private page = 0;
  private readonly tableArea = document.createElement('div');
  private readonly pager = document.createElement('div');
  private readonly viewResults = document.createElement('button');
  private readonly pageLabel = document.createElement('span');
  private readonly previousPage = document.createElement('button');
  private readonly nextPage = document.createElement('button');
  private name = '';
  private history?: BatchHistoryEntry;
  private historyWrites: Promise<void> = Promise.resolve();
  private historyError = '';
  private readonly persistenceStatus = document.createElement('p');
  private onResult?: (result: ConfigurationBatchResult) => void;
  private headers = ['配置表', '配置关号', '棋盘序号', '配置棋盘ID', 'id', '难度', '模拟次数', '通关次数', ...METRIC_COLUMNS.map(([, title]) => title), '状态'];

  constructor(host: HTMLElement) {
    this.dialog.className = 'arranger-batch-dialog';
    this.dialog.setAttribute('aria-label', '当前配置批量计算');
    const title = document.createElement('h3'); title.textContent = '当前配置批量计算';
    const help = document.createElement('p');
    help.textContent = '按所选配置、关号和难度计算，每个版本运行指定次数。局面数量、卡点和错误次数取平均，保留两位小数；总数字数和隐藏数不变。同一轮内重试不重复计局面，多空位为至少3个未遮挡隐藏格，间隔按下一个显示数字计算，卡点为触发强制观察的位置数。';
    const table = document.createElement('table'), head = document.createElement('thead'), tr = document.createElement('tr');
    this.headers.forEach((label) => { const th = document.createElement('th'); th.textContent = label; tr.append(th); });
    head.append(tr); table.append(head, this.rows);
    const scroll = this.tableArea; scroll.className = 'arranger-batch-table'; scroll.append(table);
    const pager = this.pager; pager.className = 'arranger-group-actions';
    this.previousPage.type = this.nextPage.type = 'button';
    this.previousPage.textContent = '上一页结果'; this.nextPage.textContent = '下一页结果';
    this.previousPage.addEventListener('click', () => { this.page--; this.renderRows(); });
    this.nextPage.addEventListener('click', () => { this.page++; this.renderRows(); });
    pager.append(this.previousPage, this.pageLabel, this.nextPage);
    const actions = document.createElement('div'); actions.className = 'arranger-group-actions';
    this.exportButton.textContent = '导出 CSV'; this.cancelButton.textContent = '取消计算'; this.closeButton.textContent = '关闭';
    for (const button of [this.exportButton, this.cancelButton, this.closeButton]) button.type = 'button';
    this.viewResults.type = 'button'; this.viewResults.textContent = '查看结果表';
    this.viewResults.addEventListener('click', () => this.showResultTable());
    actions.append(this.exportButton, this.viewResults, this.cancelButton, this.closeButton);
    this.dialog.append(title, help, this.settingsInfo, this.status, this.persistenceStatus, scroll, pager, actions); host.append(this.dialog);
    this.cancelButton.addEventListener('click', () => { this.abort?.abort(); this.status.textContent = '正在取消，已完成结果会保留…'; });
    this.closeButton.addEventListener('click', () => { this.abort?.abort(); this.dialog.close(); });
    this.dialog.addEventListener('cancel', () => this.abort?.abort());
    this.exportButton.addEventListener('click', () => this.export());
  }

  async showHistory(entry: BatchHistoryEntry): Promise<void> {
    if (this.abort) return;
    const results = await loadBatchHistoryResults(entry.id);
    this.history = undefined; this.onResult = undefined;
    this.name = `${entry.name}-${new Date(entry.createdAt).toISOString().slice(0, 10)}`;
    this.results = []; this.resultCount = 0; this.page = 0; this.rows.replaceChildren();
    this.settingsInfo.textContent = `${entry.scope} · 每版本 ${entry.repetitions} 次\n${describeBatchSettings(entry.settings)}`;
    this.status.textContent = `历史记录：${new Date(entry.createdAt).toLocaleString()} · ${entry.status} · 已保存 ${results.length}/${entry.total} 个版本`;
    this.persistenceStatus.textContent = '';
    results.forEach((result) => this.append(result));
    this.showResultTable();
    this.viewResults.disabled = !results.length;
    this.cancelButton.disabled = true; this.exportButton.disabled = !results.length;
    this.dialog.showModal();
  }

  private persistHistory(result?: Result): void {
    if (!this.history) return;
    const snapshot = structuredClone(this.history);
    this.historyWrites = this.historyWrites.then(() => saveBatchHistory(snapshot, result)).catch((error) => {
      this.historyError = `历史保存失败：${String(error)}。请导出 CSV 保留本次结果。`;
      this.persistenceStatus.textContent = this.historyError;
    });
  }

  cancel(): void { this.abort?.abort(); }

  async run(name: string, tasks: ConfigurationBatchTask[], board: DOMRect, load: (id: string) => Promise<LevelData>,
    onResult?: (result: ConfigurationBatchResult) => void, repetitions = 1, settingsOverride?: ConfigurationBatchSettings, historyContext?: { libraryId: string; scope: string; ownedLibrary?: boolean }, resumeEntry?: BatchHistoryEntry): Promise<void> {
    if (this.abort) return;
    const id = resumeEntry?.id ?? crypto.randomUUID();
    await withBatchHistoryLock(id, () => this.execute(id, name, tasks, board, load, onResult, repetitions, settingsOverride, historyContext, resumeEntry));
  }

  private async execute(id: string, name: string, tasks: ConfigurationBatchTask[], board: DOMRect, load: (id: string) => Promise<LevelData>,
    onResult?: (result: ConfigurationBatchResult) => void, repetitions = 1, settingsOverride?: ConfigurationBatchSettings,
    historyContext?: { libraryId: string; scope: string; ownedLibrary?: boolean }, resumeEntry?: BatchHistoryEntry): Promise<void> {
    let previous: Result[] = [];
    if (resumeEntry) {
      const entry = (await listBatchHistory()).find((item) => item.id === id);
      const plan = await loadBatchResumePlan(id);
      if (!entry || !plan) throw new Error('此记录没有续跑清单，无法继续计算。');
      resumeEntry = entry;
      tasks = plan.tasks; name = entry.name; settingsOverride = entry.settings; repetitions = entry.repetitions;
      board = new DOMRect(plan.board.x, plan.board.y, plan.board.width, plan.board.height);
      previous = await loadBatchHistoryResults(id);
    }
    if (this.abort) return;
    const abort = new AbortController(); this.abort = abort;
    this.onResult = onResult;
    const settings: ConfigurationBatchSettings = structuredClone(settingsOverride ?? readConfigurationBatchSettings());
    this.settingsInfo.textContent = describeBatchSettings(settings);
    const viewport = resumeEntry ? { width: resumeEntry.geometry.viewportWidth, height: resumeEntry.geometry.viewportHeight, pixelRatio: resumeEntry.geometry.pixelRatio } : { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio || 1 };
    const threaded = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined';
    const concurrency = threaded ? Math.min(configurationSimulationConcurrency(settings.workerCount), tasks.length) : 1;
    const pool = threaded ? new ConfigurationSimulationPool(concurrency) : undefined;
    const stopWorkers = () => pool?.dispose();
    abort.signal.addEventListener('abort', stopWorkers, { once: true });
    const started = performance.now();
    this.historyError = ''; this.persistenceStatus.textContent = '正在保存历史记录…';
    this.history = resumeEntry ? { ...resumeEntry, status: '未完成（续跑中或页面刷新中断）' } : { id, createdAt: Date.now(), name, libraryId: historyContext?.libraryId ?? '',
      scope: historyContext?.scope ?? name, settings, repetitions, total: tasks.length, saved: 0, resumable: true, ownedLibrary: historyContext?.ownedLibrary,
      status: '未完成（运行中或页面刷新中断）', geometry: { boardWidth: board.width, boardHeight: board.height,
        viewportWidth: viewport.width, viewportHeight: viewport.height, pixelRatio: viewport.pixelRatio } };
    try {
      if (!resumeEntry) await saveBatchResumePlan(this.history, { id, tasks, board: { x: board.x, y: board.y, width: board.width, height: board.height } });
      else await saveBatchHistory(this.history);
    } catch (error) {
      pool?.dispose(); this.abort = undefined; this.history = undefined;
      throw new Error(`无法保存续跑记录：${String(error)}`);
    }
    const resize = () => { abort.abort(); };
    window.addEventListener('resize', resize);
    this.name = name; this.results = []; this.resultCount = 0; this.page = 0; this.rows.replaceChildren();
    previous.forEach((result) => { this.results[result.order] = result; this.onResult?.(result); });
    this.resultCount = previous.length;
    const pending = pendingBatchOrders(tasks, previous);
    this.exportButton.disabled = !this.resultCount; this.cancelButton.disabled = false;
    this.viewResults.disabled = true; this.tableArea.hidden = this.pager.hidden = true;
    this.dialog.showModal();
    let failed = previous.filter((row) => row.status.startsWith('失败')).length, next = 0, running = 0, fatal = '', completedSimulations = previous.reduce((sum, row) => sum + (row.repetitions ?? 0), 0);
    let lastProgressAt = -Infinity;
    const updateProgress = () => {
      if (performance.now() - lastProgressAt < 100) return;
      lastProgressAt = performance.now();
      this.status.textContent = `${name}：${this.resultCount}/${tasks.length}个版本，模拟 ${completedSimulations}/${tasks.length * repetitions}次，${threaded ? `${concurrency}线程` : '兼容单线程'}，运行 ${running}，失败 ${failed}，耗时 ${((performance.now() - started) / 1000).toFixed(1)}秒`;
    };
    const lane = async () => {
      while (!abort.signal.aborted && next < pending.length) {
        const order = pending[next++], task = tasks[order]; running++; updateProgress();
        let sampler: HandOcclusionSampler | undefined;
        let previousProgress = 0;
        const progress = (completed: number) => { completedSimulations += completed - previousProgress; previousProgress = completed; updateProgress(); };
        try {
          const level = await load(task.id);
          if (abort.signal.aborted) break;
          const geometry = configurationBatchGeometry(level, board, viewport, settings);
          if (pool) {
            const result = await pool.run({ level, geometry, mode: settings.mode, player: settings.player, weights: settings.weights, repetitions }, progress);
            if (!abort.signal.aborted) this.append({ ...task, ...result, order });
          } else {
            sampler = new HandOcclusionSampler(geometry);
            const result = await simulateRepeatedConfiguration({ level, memorySteps: 0, player: settings.player, weights: settings.weights,
              observe: (current) => sampler!.observe(settings.mode, current), signal: abort.signal,
              findCompletion: (request) => findPathCompletionInWorker(level.solutionPath, level.boardShape, request) }, repetitions, progress);
            if (!abort.signal.aborted) this.append({ ...task, order, ...result });
          }
        } catch (error) {
          if (abort.signal.aborted) break;
          failed++;
          const message = error instanceof Error ? error.message : String(error);
          this.append({ ...task, order, status: `失败：${message}` });
          if (pool?.stopped) { fatal = message; abort.abort(); }
        } finally { sampler?.dispose(); running--; updateProgress(); }
        // Bound queued history writes to at most one result per running lane.
        await this.historyWrites;
        if (!pool) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    };
    try {
      await Promise.all(Array.from({ length: concurrency }, () => lane()));
      this.status.textContent = `${name}：${fatal ? `线程失败：${fatal}` : abort.signal.aborted ? '已取消（取消或窗口尺寸变化）' : '计算完成'}，${this.resultCount}/${tasks.length} 个棋盘，失败 ${failed} 个，${threaded ? `${concurrency}线程` : '兼容单线程'}，耗时 ${((performance.now() - started) / 1000).toFixed(1)}秒。`;
    } finally {
      pool?.dispose(); abort.signal.removeEventListener('abort', stopWorkers);
      window.removeEventListener('resize', resize); this.abort = undefined;
      if (this.history) {
        this.history.status = fatal ? `线程失败：${fatal}` : abort.signal.aborted ? '已取消（保留已完成结果）' : '计算完成';
        this.persistHistory();
      }
      await this.historyWrites;
      this.viewResults.disabled = !this.resultCount;
      this.persistenceStatus.textContent = this.historyError || '历史记录已保存，可在“计算配置”中查看或继续计算。';
      this.history = undefined;
      this.cancelButton.disabled = true; this.exportButton.disabled = !this.resultCount;
    }
  }

  private values(result: Result): Array<string | number> {
    return [BATCH_CONFIGURATION_LABELS[result.configuration as keyof typeof BATCH_CONFIGURATION_LABELS] ?? result.configuration ?? '', result.groupId, result.stage, result.configuredId, result.id, result.difficulty ?? 0, result.repetitions ?? '', result.completedRuns ?? '', ...METRIC_COLUMNS.map(([key]) => result.metrics ? Number(result.metrics[key].toFixed(2)) : ''), result.status];
  }
  private append(result: Result): void {
    if (!this.results[result.order]) this.resultCount++;
    this.results[result.order] = result;
    if (this.history) { this.history.saved = this.resultCount; this.persistHistory(result); }
    this.onResult?.(result);
    this.exportButton.disabled = false;
  }
  private showResultTable(): void {
    this.tableArea.hidden = this.pager.hidden = false;
    this.renderRows();
  }
  private renderRows(): void {
    const count = Math.max(1, Math.ceil(this.resultCount / 100));
    this.page = Math.max(0, Math.min(this.page, count - 1));
    const first = this.page * 100, last = first + 100;
    let index = 0;
    const fragment = document.createDocumentFragment();
    // Sparse slots keep original task order without an O(n) insertion per completed job.
    for (const result of this.results) {
      if (!result) continue;
      if (index >= last) break;
      if (index++ < first) continue;
      const tr = document.createElement('tr');
      this.values(result).forEach((value) => { const td = document.createElement('td'); td.textContent = String(value); tr.append(td); });
      fragment.append(tr);
    }
    this.rows.replaceChildren(fragment);
    this.pageLabel.textContent = `${this.page + 1}/${count} 页 · 共 ${this.resultCount} 条 · 每页100条（导出包含全部结果）`;
    this.previousPage.disabled = this.page === 0;
    this.nextPage.disabled = this.page >= count - 1;
  }
  private export(): void {
    const text = [this.headers, ...this.results.filter(Boolean).map((result) => this.values(result))].map((row) => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', text], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${this.name}-批量计算.csv`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
