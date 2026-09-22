import { ConfigurationSimulationPool, configurationSimulationConcurrency } from './configurationSimulationPool';
import type { LevelData } from '../../game/types';
import { findPathCompletionInWorker } from '../../game/pathCompletionWorker';
import { HandOcclusionSampler } from './handOcclusion';
import { simulateRepeatedConfiguration } from './repeatedConfigurationSimulation';
import { configurationBatchGeometry, readConfigurationBatchSettings, type ConfigurationBatchSettings } from './configurationBatchSettings';
import { METRIC_COLUMNS, csvCell, type ConfigurationMetrics } from './configurationBatchMetrics';

import type { ConfigurationBatchTask } from './configurationBatchTasks';
import { BATCH_CONFIGURATION_LABELS } from './ConfigurationBatchScopePanel';
import { describeBatchSettings, loadBatchHistoryResults, saveBatchHistory, type BatchHistoryEntry } from './configurationBatchHistory';
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
    const scroll = document.createElement('div'); scroll.className = 'arranger-batch-table'; scroll.append(table);
    const actions = document.createElement('div'); actions.className = 'arranger-group-actions';
    this.exportButton.textContent = '导出 CSV'; this.cancelButton.textContent = '取消计算'; this.closeButton.textContent = '关闭';
    for (const button of [this.exportButton, this.cancelButton, this.closeButton]) button.type = 'button';
    actions.append(this.exportButton, this.cancelButton, this.closeButton);
    this.dialog.append(title, help, this.settingsInfo, this.status, this.persistenceStatus, scroll, actions); host.append(this.dialog);
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
    this.results = []; this.rows.replaceChildren();
    this.settingsInfo.textContent = `${entry.scope} · 每版本 ${entry.repetitions} 次\n${describeBatchSettings(entry.settings)}`;
    this.status.textContent = `历史记录：${new Date(entry.createdAt).toLocaleString()} · ${entry.status} · 已保存 ${results.length}/${entry.total} 个版本`;
    this.persistenceStatus.textContent = '';
    results.forEach((result) => this.append(result));
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
    onResult?: (result: ConfigurationBatchResult) => void, repetitions = 1, settingsOverride?: ConfigurationBatchSettings, historyContext?: { libraryId: string; scope: string }): Promise<void> {
    if (this.abort) return;
    const abort = new AbortController(); this.abort = abort;
    this.onResult = onResult;
    const settings = structuredClone(settingsOverride ?? readConfigurationBatchSettings());
    this.settingsInfo.textContent = describeBatchSettings(settings);
    const viewport = { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio || 1 };
    const threaded = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined';
    const concurrency = threaded ? Math.min(configurationSimulationConcurrency(), tasks.length) : 1;
    const pool = threaded ? new ConfigurationSimulationPool(concurrency) : undefined;
    const stopWorkers = () => pool?.dispose();
    abort.signal.addEventListener('abort', stopWorkers, { once: true });
    const started = performance.now();
    this.historyError = ''; this.persistenceStatus.textContent = '正在保存历史记录…';
    this.history = { id: crypto.randomUUID(), createdAt: Date.now(), name, libraryId: historyContext?.libraryId ?? '',
      scope: historyContext?.scope ?? name, settings, repetitions, total: tasks.length, saved: 0,
      status: '未完成（运行中或页面刷新中断）', geometry: { boardWidth: board.width, boardHeight: board.height,
        viewportWidth: viewport.width, viewportHeight: viewport.height, pixelRatio: viewport.pixelRatio } };
    this.persistHistory();
    const resize = () => { abort.abort(); };
    window.addEventListener('resize', resize);
    this.name = name; this.results = []; this.rows.replaceChildren();
    this.exportButton.disabled = true; this.cancelButton.disabled = false;
    this.dialog.showModal();
    let failed = 0, next = 0, running = 0, fatal = '', completedSimulations = 0;
    const updateProgress = () => {
      this.status.textContent = `${name}：${this.results.length}/${tasks.length}个版本，模拟 ${completedSimulations}/${tasks.length * repetitions}次，${threaded ? `${concurrency}线程` : '兼容单线程'}，运行 ${running}，失败 ${failed}，耗时 ${((performance.now() - started) / 1000).toFixed(1)}秒`;
    };
    const lane = async () => {
      while (!abort.signal.aborted && next < tasks.length) {
        const order = next++, task = tasks[order]; running++; updateProgress();
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
        if (!pool) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    };
    try {
      await Promise.all(Array.from({ length: concurrency }, () => lane()));
      this.status.textContent = `${name}：${fatal ? `线程失败：${fatal}` : abort.signal.aborted ? '已取消（取消或窗口尺寸变化）' : '计算完成'}，${this.results.length}/${tasks.length} 个棋盘，失败 ${failed} 个，${threaded ? `${concurrency}线程` : '兼容单线程'}，耗时 ${((performance.now() - started) / 1000).toFixed(1)}秒。`;
    } finally {
      pool?.dispose(); abort.signal.removeEventListener('abort', stopWorkers);
      window.removeEventListener('resize', resize); this.abort = undefined;
      if (this.history) {
        this.history.status = fatal ? `线程失败：${fatal}` : abort.signal.aborted ? '已取消（保留已完成结果）' : '计算完成';
        this.persistHistory();
      }
      await this.historyWrites;
      this.persistenceStatus.textContent = this.historyError || '历史记录已保存，可在“计算配置”中查看。';
      this.history = undefined;
      this.cancelButton.disabled = true; this.exportButton.disabled = !this.results.length;
    }
  }

  private values(result: Result): Array<string | number> {
    return [BATCH_CONFIGURATION_LABELS[result.configuration as keyof typeof BATCH_CONFIGURATION_LABELS] ?? '', result.groupId, result.stage, result.configuredId, result.id, result.difficulty ?? 0, result.repetitions ?? '', result.completedRuns ?? '', ...METRIC_COLUMNS.map(([key]) => result.metrics ? Number(result.metrics[key].toFixed(2)) : ''), result.status];
  }
  private append(result: Result): void {
    const index = this.results.findIndex((existing) => existing.order > result.order);
    const insertion = index < 0 ? this.results.length : index;
    this.results.splice(insertion, 0, result);
    if (this.history) { this.history.saved = this.results.length; this.persistHistory(result); }
    this.onResult?.(result);
    const tr = document.createElement('tr');
    this.values(result).forEach((value) => { const td = document.createElement('td'); td.textContent = String(value); tr.append(td); });
    this.rows.insertBefore(tr, this.rows.children[insertion] ?? null); this.exportButton.disabled = false;
  }
  private export(): void {
    const text = [this.headers, ...this.results.map((result) => this.values(result))].map((row) => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', text], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${this.name}-批量计算.csv`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
