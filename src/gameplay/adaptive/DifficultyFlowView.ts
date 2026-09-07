import { buildDifficultyFlow, type FlowInput } from './difficultyFlow';

export class DifficultyFlowView {
  private readonly stage: HTMLElement;
  private readonly status: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly nodes: HTMLElement[];
  private readonly details: HTMLElement[];
  private readonly badges: HTMLElement[];
  private readonly branches: HTMLElement;

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = `<div class="level-debug-card__heading"><div><span id="difficulty-flow-stage">实时处理</span><h2>动态难度状态机</h2></div><b id="difficulty-flow-status" role="status"></b></div>
      <div class="difficulty-orbit"><svg class="difficulty-orbit-track" viewBox="0 0 800 540" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="orbit-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0L6 3L0 6" fill="none" stroke="#73a497" /></marker></defs><path d="M400 50 A310 220 0 0 1 710 270 A310 220 0 0 1 400 490 A310 220 0 0 1 90 270 A310 220 0 0 1 400 50" fill="none" stroke="#adcac0" stroke-width="2" marker-mid="url(#orbit-arrow)" marker-end="url(#orbit-arrow)"/><path d="M510.3 64.1L526.9 69.4" fill="none" stroke="#73a497" stroke-width="2" marker-end="url(#orbit-arrow)"/><path d="M683.0 179.3L689.8 192.3" fill="none" stroke="#73a497" stroke-width="2" marker-end="url(#orbit-arrow)"/><path d="M689.8 347.7L683.0 360.7" fill="none" stroke="#73a497" stroke-width="2" marker-end="url(#orbit-arrow)"/><path d="M526.9 470.6L510.3 475.9" fill="none" stroke="#73a497" stroke-width="2" marker-end="url(#orbit-arrow)"/><path d="M289.7 475.9L273.1 470.6" fill="none" stroke="#73a497" stroke-width="2" marker-end="url(#orbit-arrow)"/><path d="M117.0 360.7L110.2 347.7" fill="none" stroke="#73a497" stroke-width="2" marker-end="url(#orbit-arrow)"/><path d="M110.2 192.3L117.0 179.3" fill="none" stroke="#73a497" stroke-width="2" marker-end="url(#orbit-arrow)"/><path d="M273.1 69.4L289.7 64.1" fill="none" stroke="#73a497" stroke-width="2" marker-end="url(#orbit-arrow)"/></svg><div class="difficulty-persisted" data-persisted></div><ol class="difficulty-flow-steps" aria-label="动态难度处理步骤">${Array.from({ length: 8 }, (_, i) =>
      `<li data-flow-step="${i + 1}"><span class="difficulty-flow-number">${i + 1}</span><div class="difficulty-flow-body"><div class="difficulty-flow-heading"><strong></strong><small></small></div><p></p></div></li>`).join('')}</ol></div>
      <div class="difficulty-flow-branches"><span data-branch="advance">完成 → ① 读取状态 · 开启下一轮</span><span data-branch="retry">重开 −1 档（最低 1）／复活原棋盘 → ⑤</span></div>
      <div class="difficulty-live" data-live></div><section class="difficulty-history"><h3>变化记录 <small>持久化 · 最近 5 条结算 · 新 → 旧</small></h3><ol data-history></ol></section><p id="difficulty-flow-summary" class="difficulty-flow-summary" aria-live="polite"></p>
      <p class="difficulty-flow-footnote">顺时针 ① → ⑧ → ① · 绿色为当前状态，虚线为跳过 · 通过率为实验估计</p>`;
    this.stage = root.querySelector('#difficulty-flow-stage')!;
    this.status = root.querySelector('#difficulty-flow-status')!;
    this.summary = root.querySelector('#difficulty-flow-summary')!;
    this.nodes = [...root.querySelectorAll<HTMLElement>('[data-flow-step]')];
    this.details = this.nodes.map(node => node.querySelector('p')!);
    this.badges = this.nodes.map(node => node.querySelector('small')!);
    this.branches = root.querySelector('.difficulty-flow-branches')!;
  }

  render(input: FlowInput, event?: 'selection' | 'result' | 'retry'): void {
    const flow = buildDifficultyFlow(input);
    const state = input.persisted;
    const entry = input.entry;
    const center = this.root.querySelector<HTMLElement>('[data-persisted]')!;
    center.replaceChildren();
    const heading = document.createElement('h3'); heading.textContent = '持久化数据'; center.append(heading);
    const note = document.createElement('small'); note.textContent = '本机保存 · 刷新后继续使用'; center.append(note);
    const values = [
      ['玩家能力', input.skill.toFixed(3)], ['受挫', `${input.stress} / 3`],
      ['累计证据权重', state?.evidence.toFixed(2) ?? '—'],
      ['各阶段上次完成档位', state?.lastDifficulties.map(v => v ?? '—').join(' / ') ?? '—'],
      ['原始 → 当前档位', entry ? `${entry.selection.difficulty} → ${entry.replayDifficulty ?? entry.selection.difficulty}${entry.excluded ? '（调试覆盖）' : entry.replayDifficulty !== undefined ? '（临时）' : ''}` : '不参与动态选档'],
      ['本阶段能力评价', entry ? entry.measured ? '已评价 · 不重复计分' : '未评价' : '不计分'],
      ['尝试状态', entry ? `错误 ${entry.errors} · 辅助${entry.assisted ? '已用' : '未用'}` : '—'],
    ];
    const dl = document.createElement('dl');
    values.forEach(([label, value]) => { const row = document.createElement('div'); const dt = document.createElement('dt'); const dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; row.append(dt, dd); dl.append(row); });
    const columns = document.createElement('div'); columns.className = 'difficulty-persisted-columns';
    columns.append(dl);
    const stats = input.playStats;
    const total = stats?.levels.length ?? 0;
    const average = (value: number) => total ? (value / total).toFixed(2) : '—';
    const totals = document.createElement('dl'); totals.dataset.playStats = '';
    const metrics = [['总共关卡数', String(total)], ['平均每关错误数', average(stats?.errors ?? 0)],
      ['平均广告观看次数', average(stats?.ads ?? 0)], ['平均复活次数', average(stats?.revives ?? 0)]];
    metrics.forEach(([label, value]) => {
      const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = label; dd.textContent = value; row.append(dt, dd); totals.append(row);
    });
    const scope = document.createElement('small'); scope.className = 'difficulty-stats-scope';
    scope.textContent = '更新后累计 · 普通拼图（含引导／当前关） · 重开不重复计关 · 均值按关';
    totals.append(scope); columns.append(totals); center.append(columns);
    this.root.querySelector<HTMLElement>('[data-live]')!.textContent = `实时数据 · 不作为跨局存档：当前状态  ${flow.currentStep ? `${flow.currentStep} / 8` : '等待'}　｜　棋盘进度 ${input.progress} / ${input.total}　｜　${flow.status}`;
    const history = this.root.querySelector<HTMLElement>('[data-history]')!;
    history.replaceChildren();
    const outcomes = { clean: '无错完成', normal: '有错完成', assisted: '辅助完成', fail: '失败' };
    const records = state?.history ?? [];
    records.slice(-5).reverse().forEach((record, index) => {
      const li = document.createElement('li');
      const previous = records[records.length - index - 2];
      const [level, stage] = record.key.split(':');
      li.textContent = `关 ${level} · 阶段 ${stage} · ${outcomes[record.outcome]} · 第 ${record.difficulty} 档 ｜ 能力 ${record.skillBefore.toFixed(3)} → ${record.skillAfter.toFixed(3)} ｜ 受挫 ${previous ? previous.stress + ' → ' : records.length < 200 ? '0 → ' : ''}${record.stress}${record.evidenceUsed ? '' : ' · 不重复评价能力'}`;
      history.append(li);
    });
    if (!records.length) { const li = document.createElement('li'); li.textContent = '暂无结算变化；引导、手动调试不计入评分记录。'; history.append(li); }

    this.stage.textContent = flow.stageLabel;
    this.status.textContent = flow.status;
    this.root.dataset.currentStep = String(flow.currentStep);
    this.root.dataset.phase = input.phase;
    this.nodes.forEach((node, i) => {
      const step = flow.nodes[i];
      node.dataset.state = step.state;
      if (step.state === 'active') node.setAttribute('aria-current', 'step');
      else node.removeAttribute('aria-current');
      node.querySelector('strong')!.textContent = step.title;
      this.details[i].textContent = step.detail;
      this.badges[i].textContent = ({ waiting: '待处理', done: '已处理', active: '当前', skipped: '跳过' })[step.state];
      // Briefly replay completed processing steps without delaying gameplay or scoring.
      if (event) {
        const surface = node.querySelector<HTMLElement>('.difficulty-flow-body')!;
        surface.getAnimations().forEach(animation => animation.cancel());
        const order = event === 'selection' && i < 5 ? i : event === 'result' && i >= 5 ? i - 5
          : event === 'retry' && i === 4 ? 0 : -1;
        if (order >= 0 && step.state !== 'skipped' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          surface.animate([{ backgroundColor: '#d5eee5' }, { backgroundColor: '#f6f8fa' }],
            { duration: 480, delay: order * 100, easing: 'ease-out' });
        }
      }
    });
    this.branches.dataset.active = flow.branch;
    this.branches.querySelector<HTMLElement>('[data-branch="retry"]')!.textContent = entry && !entry.excluded && !entry.completed
      ? '重开 −1 档（最低 1）／复活原棋盘 → ⑤'
      : '重开／复活保持档位 → ⑤';
    if (this.summary.textContent !== flow.summary) this.summary.textContent = flow.summary;
  }
}
