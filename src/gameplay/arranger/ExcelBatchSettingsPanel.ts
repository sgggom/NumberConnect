import { BatchSimulationSettingsFields } from './BatchSimulationSettingsFields';
import type { ConfigurationBatchSettings } from './configurationBatchSettings';

export function chooseExcelBatchSettings(host: HTMLElement, name: string, count: number, skippedRows: number): Promise<{ repetitions: number; settings: ConfigurationBatchSettings } | undefined> {
  const dialog = document.createElement('dialog');
  dialog.className = 'arranger-batch-dialog arranger-excel-settings';
  dialog.setAttribute('aria-label', 'Excel 全部关卡计算');
  const title = document.createElement('h3'); title.textContent = 'Excel 全部关卡计算';
  const description = document.createElement('p');
  description.textContent = `${name}：共 ${count} 条关卡记录，整表全部计算，包含所有路径、所有难度和重复记录。与当前选中、锁定的关卡及配置列表无关。${skippedRows ? `跳过 ${skippedRows} 行无效数据。` : ''}`;
  const settings = new BatchSimulationSettingsFields();
  const times = document.createElement('label'); times.textContent = '每关模拟次数 ';
  const repetitions = document.createElement('input'); repetitions.type = 'number'; repetitions.min = '1'; repetitions.max = '1000'; repetitions.step = '1'; repetitions.value = '1'; repetitions.required = true; repetitions.setAttribute('aria-label', '每关模拟次数'); times.append(repetitions);
  const summary = document.createElement('p'); summary.setAttribute('role', 'status');
  const actions = document.createElement('div'); actions.className = 'arranger-group-actions';
  const start = document.createElement('button'); start.type = 'button'; start.textContent = '计算全部关卡';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消';
  actions.append(start, cancel); dialog.append(title, description, times, settings.element, summary, actions);
  const refresh = () => {
    start.disabled = !count || !repetitions.checkValidity() || !settings.valid();
    summary.textContent = start.disabled ? '请填写有效的模拟次数和参数。' : `${count} 条记录 × ${repetitions.value} 次 = ${count * repetitions.valueAsNumber} 次模拟`;
  };
  dialog.addEventListener('input', refresh); dialog.addEventListener('change', refresh);
  host.append(dialog); refresh(); dialog.showModal();
  return new Promise((resolve) => {
    const finish = (value?: { repetitions: number; settings: ConfigurationBatchSettings }) => { dialog.close(); dialog.remove(); resolve(value); };
    start.addEventListener('click', () => { refresh(); if (!start.disabled) finish({ repetitions: repetitions.valueAsNumber, settings: settings.value() }); });
    cancel.addEventListener('click', () => finish());
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(); });
  });
}
