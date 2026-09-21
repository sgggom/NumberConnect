import type { LevelData } from '../../game/types';
import { findPathCompletionInWorker } from '../../game/pathCompletionWorker';
import { HandOcclusionSampler, type OcclusionGeometry } from './handOcclusion';
import { clearOcclusion, simulateOccludedPlay, stepOccludedPlay, PLAYER_OBSERVATION_RATES, type PlayerLevel, type NeighborhoodWeight, type CellOcclusion, type HandMode, type OcclusionRun } from './occlusionSimulation';

export interface OcclusionReplay {
  labels: Array<number | null>;
  edges: Array<readonly [number, number]>;
  current: number;
  attempted?: number;
  neighborhood?: NeighborhoodWeight[];
  occlusion: CellOcclusion[];
  mode: HandMode;
  message: string;
  errors: number;
  progress: number;
}
const handLabel = { off: '关', index: '食指', thumb: '拇指' };

export class OcclusionSimulationPanel {
  readonly element = document.createElement('details');
  private abort?: AbortController;
  private sampler?: HandOcclusionSampler;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private live?: ReturnType<typeof stepOccludedPlay>;
  private liveBusy = false;
  private automatic = false;
  private liveTimer?: ReturnType<typeof setTimeout>;
  private runs: OcclusionRun[] = [];
  private baseline: OcclusionRun[] = [];
  private mode: HandMode = 'off';
  private position = 0;
  private geometry?: OcclusionGeometry;
  private config?: { count: number; memory: number; playerLevel: PlayerLevel; randomness: string };

  constructor(private readonly level: LevelData, private readonly options: {
    getMode: () => HandMode;
    getGeometry: () => OcclusionGeometry;
    replay: (frame: OcclusionReplay | undefined) => void;
    lock: (locked: boolean) => void;
  }) {
    this.element.className = 'arranger-occlusion-simulation';
    this.element.innerHTML = `<summary>真实手指遮挡模拟</summary>
      <label>玩家水平<select data-field="player-level" aria-label="玩家水平">${PLAYER_OBSERVATION_RATES.map((rate, i) => `<option value="${i + 1}">${i + 1}档 · ${rate.normal * 100}% / ${rate.afterError * 100}%</option>`).join('')}</select></label>
      <p>观察概率：常规 / 错误后</p>
      <div class="arranger-playtest-controls"><button data-action="auto" type="button">自动</button><button data-action="advance" type="button">手动下一步</button><button data-action="stop-live" type="button">结束逐步模拟</button></div>
      <div class="arranger-playtest-controls"><button data-action="run" type="button">批量统计（5轮）</button><button data-action="cancel" type="button" disabled>取消</button><button data-action="export" type="button" disabled>导出结果</button></div>
      <p data-field="status" role="status">优先选择最高权重，仅在最高权重并列时随机选择。</p>
      <div data-field="replay" hidden>
        <label>回放轮次 <select data-field="trial" aria-label="回放轮次"></select></label>
        <div class="arranger-playtest-controls"><button data-action="previous" type="button">上一步</button><button data-action="play" type="button">播放</button><button data-action="next" type="button">下一步</button><button data-action="exit" type="button">退出回放</button></div>
        <p data-field="step"></p>
        <div class="arranger-choice-grid" data-field="weights" aria-label="九宫格选择权重"></div>
      </div>`;
    this.query('[data-field="player-level"]').addEventListener('change', () => this.invalidate());
    this.query('[data-action="advance"]').addEventListener('click', () => { this.pauseLive(); void this.advance(); });
    this.query('[data-action="auto"]').addEventListener('click', () => {
      if (this.automatic) { this.pauseLive(); return; }
      this.automatic = true; this.query('[data-action="auto"]').textContent = '暂停自动';
      void this.advance();
    });
    this.query('[data-action="stop-live"]').addEventListener('click', () => { this.cancel(); this.options.replay(undefined); });
    this.query('[data-action="run"]').addEventListener('click', () => void this.run());
    this.query('[data-action="cancel"]').addEventListener('click', () => this.cancel());
    this.query('[data-action="export"]').addEventListener('click', () => this.export());
    this.query('[data-action="previous"]').addEventListener('click', () => { this.pause(); this.position = Math.max(0, this.position - 1); this.show(); });
    this.query('[data-action="next"]').addEventListener('click', () => { this.pause(); this.position++; this.show(); });
    this.query('[data-action="play"]').addEventListener('click', () => {
      if (this.timer) { this.pause(); return; }
      if (this.position >= this.selectedRun().frames.length) this.position = 0;
      this.show();
      this.tick();
    });
    this.query('[data-action="exit"]').addEventListener('click', () => { this.pause(); this.options.replay(undefined); });
    this.query('[data-field="trial"]').addEventListener('change', () => { this.pause(); this.position = 0; this.show(); });
    // The independently scrolling sidebar does not change board geometry on toggle.
  }

  dispose(): void { this.disposed = true; this.cancel(); }
  invalidate(): void {
    this.cancel(); this.pause(); this.runs = []; this.baseline = [];
    this.query('[data-field="replay"]').hidden = true;
    this.query<HTMLButtonElement>('[data-action="export"]').disabled = true;
    this.options.replay(undefined);
    this.query('[data-field="status"]').textContent = '模拟设置已变更，请重新跑关。';
  }
  private query<T extends HTMLElement = HTMLElement>(selector: string): T { return this.element.querySelector<T>(selector)!; }
  private pause(): void {
    clearTimeout(this.timer); this.timer = undefined;
    this.query('[data-action="play"]').textContent = '播放';
  }
  private pauseLive(): void {
    this.automatic = false; clearTimeout(this.liveTimer);
    this.query('[data-action="auto"]').textContent = '自动';
  }
  private playerLevel(): PlayerLevel { return Number(this.query<HTMLSelectElement>('[data-field="player-level"]').value) as PlayerLevel; }
  private cancel(): void {
    this.pauseLive(); this.live = undefined;
    this.abort?.abort(); this.sampler?.dispose(); this.pause(); this.options.lock(false);
    this.query<HTMLSelectElement>('[data-field="player-level"]').disabled = false;
    this.query<HTMLButtonElement>('[data-action="run"]').disabled = false;
  }
  private async advance(): Promise<void> {
    if (this.liveBusy || this.disposed || (!this.live && this.abort && !this.abort.signal.aborted)) return;
    this.liveBusy = true;
    this.query<HTMLButtonElement>('[data-action="advance"]').disabled = true;
    let session = this.live;
    try {
      if (!session) {
        this.pause(); this.options.replay(undefined);
        this.query('[data-field="replay"]').hidden = true;
        this.mode = this.options.getMode(); this.geometry = this.options.getGeometry();
        const sampler = new HandOcclusionSampler(this.geometry); this.sampler = sampler;
        this.abort = new AbortController();
        session = stepOccludedPlay({ level: this.level, memorySteps: 0, playerLevel: this.playerLevel(),
          observe: (current) => sampler.observe(this.mode, current), signal: this.abort.signal,
          findCompletion: (request) => findPathCompletionInWorker(this.level.solutionPath, this.level.boardShape, request) });
        this.live = session; this.options.lock(true);
        this.query<HTMLSelectElement>('[data-field="player-level"]').disabled = true;
        this.query<HTMLButtonElement>('[data-action="run"]').disabled = true;
      }
      const result = await session.next();
      if (this.disposed || this.live !== session) return;
      if (result.done) {
        const run = result.value;
        const message = run.complete ? `已通关，尝试 ${run.attempts} 次，错误 ${run.errors} 次。` : `模拟停止：${run.stoppedReason}`;
        this.query('[data-field="status"]').textContent = message;
        this.options.replay({ labels: run.finalLabels, edges: run.finalEdges, current: run.frames.at(-1)?.attempted ?? 0,
          occlusion: clearOcclusion(this.level.solutionPath.length), mode: 'off', message, errors: run.errors, progress: run.finalEdges.length + 1 });
        this.cancel();
      } else {
        const frame = result.value;
        const message = `第 ${frame.step} 步：${frame.observation.observed ? frame.observation.forced ? '无可用候选，已强制观察' : '已移开手指观察' : '未移开手指观察'}。下一步更新本次连线结果。`;
        this.query('[data-field="status"]').textContent = message;
        // Keep weights, visible numbers and edges at the same pre-connection instant.
        // Advancing publishes this decision's result, including the final connection.
        this.options.replay({ ...frame, attempted: undefined, mode: this.mode, message });
      }
    } catch (error) {
      if (!this.disposed && this.live === session) {
        this.query('[data-field="status"]').textContent = `模拟停止：${String(error)}`; this.cancel();
      }
    } finally {
      this.liveBusy = false;
      this.query<HTMLButtonElement>('[data-action="advance"]').disabled = false;
      if (!this.live) this.query<HTMLButtonElement>('[data-action="run"]').disabled = false;
      if (this.automatic && this.live) this.liveTimer = setTimeout(() => void this.advance(), 800);
    }
  }
  private selectedRun(): OcclusionRun { return this.runs[Number(this.query<HTMLSelectElement>('[data-field="trial"]').value) || 0]; }

  private async run(): Promise<void> {
    if (this.abort && !this.abort.signal.aborted) return;
    const status = this.query('[data-field="status"]');
    const config = { count: 5, memory: 0, playerLevel: this.playerLevel(), randomness: 'maximum weight; fresh uniform random only among tied maxima' };
    this.pause(); this.options.replay(undefined);
    this.runs = []; this.baseline = []; this.position = 0;
    this.query('[data-field="replay"]').hidden = true;
    this.query<HTMLButtonElement>('[data-action="export"]').disabled = true;
    const abort = new AbortController(); this.abort = abort;
    this.options.lock(true);
    this.query<HTMLSelectElement>('[data-field="player-level"]').disabled = true;
    this.query<HTMLButtonElement>('[data-action="run"]').disabled = true;
    this.query<HTMLButtonElement>('[data-action="cancel"]').disabled = false;
    this.query<HTMLButtonElement>('[data-action="auto"]').disabled = true;
    this.query<HTMLButtonElement>('[data-action="advance"]').disabled = true;
    this.query<HTMLButtonElement>('[data-action="stop-live"]').disabled = true;
    try {
      this.config = config; this.mode = this.options.getMode(); this.geometry = this.options.getGeometry();
      const sampler = new HandOcclusionSampler(this.geometry); this.sampler = sampler;
      for (let i = 0; i < config.count; i++) {
        status.textContent = `正在跑第 ${i + 1}/${config.count} 轮（${handLabel[this.mode]} + 无手指对照）…`;
        const run = (mode: HandMode) => simulateOccludedPlay({ level: this.level, memorySteps: config.memory, playerLevel: config.playerLevel,
          observe: (current) => sampler.observe(mode, current), signal: abort.signal,
          findCompletion: (request) => findPathCompletionInWorker(this.level.solutionPath, this.level.boardShape, request) });
        this.runs.push(await run(this.mode));
        this.baseline.push(this.mode === 'off' ? this.runs[i] : await run('off'));
      }
      if (abort.signal.aborted || this.disposed) return;
      const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
      const errors = average(this.runs.map((run) => run.errors));
      const extra = errors - average(this.baseline.map((run) => run.errors));
      const attempts = this.runs.reduce((sum, run) => sum + run.attempts, 0);
      const blocked = this.runs.reduce((sum, run) => sum + run.coveredNextSteps, 0);
      status.textContent = `${handLabel[this.mode]} · 通关 ${this.runs.filter((run) => run.complete).length}/${config.count} · 平均尝试 ${average(this.runs.map((run) => run.attempts)).toFixed(1)} 次 · 平均错误 ${errors.toFixed(2)} 次 · 相比无手指 ${extra >= 0 ? '+' : ''}${extra.toFixed(2)} 次错误 · 下一位置被挡 ${attempts ? (blocked / attempts * 100).toFixed(1) : '0'}% · 平均球面积遮挡 ${(average(this.runs.map((run) => run.meanCoverage)) * 100).toFixed(1)}%`;
      const trial = this.query<HTMLSelectElement>('[data-field="trial"]');
      trial.replaceChildren(...this.runs.map((run, i) => {
        const option = document.createElement('option'); option.value = String(i);
        option.textContent = `第 ${i + 1} 轮 · ${run.errors} 次错误${run.complete ? '' : ' · 未通关'}`;
        return option;
      }));
      this.query('[data-field="replay"]').hidden = false;
      this.query<HTMLButtonElement>('[data-action="export"]').disabled = false;
      this.show();
    } catch (error) {
      if (!this.disposed) status.textContent = abort.signal.aborted ? '已取消模拟。' : `模拟失败：${error instanceof Error ? error.message : String(error)}`;
      this.runs = []; this.baseline = [];
    } finally {
      this.sampler?.dispose(); this.sampler = undefined; this.abort = undefined;
      if (!this.disposed) {
        this.options.lock(false);
        this.query<HTMLSelectElement>('[data-field="player-level"]').disabled = false;
        this.query<HTMLButtonElement>('[data-action="run"]').disabled = false;
        this.query<HTMLButtonElement>('[data-action="cancel"]').disabled = true;
        this.query<HTMLButtonElement>('[data-action="auto"]').disabled = false;
        this.query<HTMLButtonElement>('[data-action="advance"]').disabled = false;
        this.query<HTMLButtonElement>('[data-action="stop-live"]').disabled = false;
      }
    }
  }

  private show(): void {
    const run = this.selectedRun(); if (!run || this.disposed) return;
    this.position = Math.min(this.position, run.frames.length);
    const frame = run.frames[this.position];
    const done = !frame;
    this.query<HTMLButtonElement>('[data-action="previous"]').disabled = this.position === 0;
    this.query<HTMLButtonElement>('[data-action="next"]').disabled = done;
    const message = frame ? `第 ${frame.step}/${run.frames.length} 次：${frame.observation.observed ? frame.observation.forced ? '强制观察；' : '已观察；' : '未观察；'}${frame.reason}；本次${frame.outcome === 'error' ? '错误' : '成功'}。橙圈为数字被挡，粉圈为尝试位置。`
      : run.complete ? `回放结束，已通关，错误 ${run.errors} 次。` : `模拟停止：${run.stoppedReason}`;
    this.query('[data-field="step"]').textContent = message;
    const weights = this.query('[data-field="weights"]');
    weights.hidden = !frame;
    weights.replaceChildren(...(frame?.neighborhood ?? []).map((cell) => {
      const item = document.createElement('div');
      const direction = cell.dx === 0 && cell.dy === 0 ? '按住位置' : `${cell.dy < 0 ? '上' : cell.dy > 0 ? '下' : ''}${cell.dx < 0 ? '左' : cell.dx > 0 ? '右' : ''}`;
      item.className = `arranger-choice-cell${cell.index === frame?.attempted ? ' is-chosen' : ''}${cell.probability === 0 ? ' is-excluded' : ''}${cell.rejected ? ' is-error' : ''}`;
      item.style.setProperty('--choice-strength', String(cell.probability));
      item.title = `${direction}：${cell.reason}；权重 ${cell.weight.toFixed(3)}；遮挡 ${(cell.coverage * 100).toFixed(1)}%`;
      const label = document.createElement('span'); label.textContent = direction;
      const probability = document.createElement('strong'); probability.textContent = `权重 ${Number(cell.weight.toFixed(2))}`;
      const weight = document.createElement('small'); weight.textContent = `概率 ${(cell.probability * 100).toFixed(1)}%`;
      item.append(label);
      if (cell.weight > 0) item.append(probability, weight);
      return item;
    }));
    this.options.replay(frame ? { labels: frame.labels, edges: frame.edges, current: frame.current, attempted: frame.attempted,
      occlusion: frame.occlusion, neighborhood: frame.neighborhood, mode: this.mode, message, errors: frame.errors, progress: frame.progress }
      : { labels: run.finalLabels, edges: run.finalEdges, current: run.frames.at(-1)?.attempted ?? 0,
        occlusion: clearOcclusion(this.level.solutionPath.length), mode: 'off', message, errors: run.errors,
        progress: run.finalEdges.length ? run.finalEdges.length + 1 : 0 });
  }
  private tick(): void {
    this.query('[data-action="play"]').textContent = '暂停';
    this.timer = setTimeout(() => {
      this.timer = undefined; this.position++; this.show();
      if (this.position < this.selectedRun().frames.length) this.tick(); else this.pause();
    }, 800);
  }
  private export(): void {
    if (!this.runs.length) return;
    const report = { algorithm: 'arranger-alpha-occlusion-v7', mode: this.mode, config: this.config,
      assumptions: { alphaThreshold: 128, glyphSamplesBlocked: '3/9', ballSamples: 49, policy: '3x3: (known next +1, hidden +0.5), glyph blocked x0.5, same previous successful direction +0.2, hidden closer to next displayed target +0.3 only if target currently readable (no memory-only bonus, no skipping blocked target); other visible and excluded cells always zero; select maximum weight; uniformly sample tied maxima only', decisionHandPosition: 'current connected cell; no hand-lift scan', observation: 'player level normal/after-error rates; forced when all weights are zero, or after error if no unblocked non-rejected eligible neighbor; clears hand occlusion for this decision only, never reveals hidden labels', scope: 'current board; model statistics, not calibrated human difficulty' },
      geometry: this.geometry, level: this.level, runs: this.runs, noHandBaseline: this.baseline };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = '手指遮挡模拟结果.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
