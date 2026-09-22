import { readConfigurationBatchSettings, type ConfigurationBatchSettings } from './configurationBatchSettings';
import type { WeightConfig } from './occlusionSimulation';

const WEIGHTS: Array<[keyof WeightConfig, string]> = [
  ['nextNumber', '下一数字加分'], ['hiddenNumber', '隐藏数字加分'], ['occludedMultiplier', '遮挡≥50%倍率'],
  ['sameDirection', '同方向加分'], ['closerTarget', '靠近目标加分'],
];

export class BatchSimulationSettingsFields {
  readonly element = document.createElement('div');
  constructor() {
    this.element.className = 'arranger-batch-settings';
    this.element.innerHTML = `<fieldset><legend>5. 手指设置</legend><div class="arranger-batch-settings-grid">
      <label>手指类型<select data-setting="mode" aria-label="手指类型"><option value="thumb">拇指</option><option value="index">食指</option></select></label>
      <label>左右手<select data-setting="side" aria-label="左右手"><option value="right">右手</option><option value="left">左手</option></select></label>
      <label>手指大小<input data-setting="handSize" aria-label="手指大小" type="number" min="0.5" max="1" step="0.01" required></label>
      </div></fieldset>
      <fieldset><legend>6. 玩家能力</legend><div class="arranger-batch-settings-grid">
      <label>推理强度<select data-setting="reasoning" aria-label="推理强度"><option value="low">低 · 不预判</option><option value="medium">中 · 预判2步</option><option value="high">高 · 预判5步</option></select></label>
      <label>平时观察概率（%）<input data-setting="normal" aria-label="平时观察概率" type="number" min="0" max="100" step="1" required></label>
      <label>错误后观察概率（%）<input data-setting="afterError" aria-label="错误后观察概率" type="number" min="0" max="100" step="1" required></label>
      <label>观察推理概率（%）<input data-setting="reasoningObservation" aria-label="观察推理概率" type="number" min="0" max="100" step="1" required></label>
      </div></fieldset>
      <fieldset><legend>7. 权重参数</legend><div class="arranger-batch-settings-grid">
      ${WEIGHTS.map(([key, label]) => `<label>${label}<input data-setting="weight-${key}" aria-label="${label}" type="number" min="0" ${key === 'occludedMultiplier' ? 'max="1"' : ''} step="any" required></label>`).join('')}
      </div><small>遮挡不足50%时仍保留75%的基础权重。</small></fieldset>
      <button type="button" data-reload-settings>使用当前模拟配置</button>
      <small>打开时自动带入当前模拟配置；此处修改仅用于本次批量跑关。</small>`;
    this.reload();
    this.element.querySelector('[data-reload-settings]')!.addEventListener('click', () => {
      this.reload(); this.element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  private control(key: string): HTMLInputElement | HTMLSelectElement {
    return this.element.querySelector(`[data-setting="${key}"]`)!;
  }
  private reload(): void {
    const settings = readConfigurationBatchSettings();
    this.control('mode').value = settings.mode;
    this.control('side').value = settings.leftHand ? 'left' : 'right';
    this.control('handSize').value = String(settings.handSize);
    this.control('reasoning').value = settings.player.reasoning;
    for (const key of ['normal', 'afterError', 'reasoningObservation'] as const) this.control(key).value = String(Math.round((settings.player[key] ?? 0) * 100));
    WEIGHTS.forEach(([key]) => { this.control(`weight-${key}`).value = String(settings.weights[key]); });
  }
  valid(): boolean {
    return [...this.element.querySelectorAll<HTMLInputElement>('input')].every((input) => input.checkValidity() && Number.isFinite(input.valueAsNumber));
  }
  value(): ConfigurationBatchSettings {
    const number = (key: string) => (this.control(key) as HTMLInputElement).valueAsNumber;
    return {
      mode: this.control('mode').value as ConfigurationBatchSettings['mode'],
      leftHand: this.control('side').value === 'left', handSize: number('handSize'),
      player: { reasoning: this.control('reasoning').value as ConfigurationBatchSettings['player']['reasoning'],
        normal: number('normal') / 100, afterError: number('afterError') / 100, reasoningObservation: number('reasoningObservation') / 100 },
      weights: Object.fromEntries(WEIGHTS.map(([key]) => [key, number(`weight-${key}`)])) as unknown as WeightConfig,
    };
  }
}
