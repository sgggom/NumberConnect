import { filterConfigurationBatchTasks, type ConfigurationBatchTask } from './configurationBatchTasks';
import { BatchSimulationSettingsFields } from './BatchSimulationSettingsFields';
import type { ConfigurationBatchSettings } from './configurationBatchSettings';
import { deleteBatchHistory, describeBatchSettings, listBatchHistory, type BatchHistoryEntry } from './configurationBatchHistory';

export const BATCH_CONFIGURATION_LABELS = { main: '主玩法', daily: '挑战', bead: '活动' } as const;

type BatchSelection = { tasks: ConfigurationBatchTask[]; repetitions: number; settings: ConfigurationBatchSettings; scope: string } | { resume: BatchHistoryEntry };

export function chooseConfigurationBatchScope(host: HTMLElement, tasks: ConfigurationBatchTask[], current: string, onHistory: (entry: BatchHistoryEntry) => Promise<void>, onApplyHistory: (entry: BatchHistoryEntry) => Promise<void>): Promise<BatchSelection | undefined> {
  const dialog = document.createElement('dialog'); dialog.className = 'arranger-batch-dialog arranger-batch-scope';
  dialog.setAttribute('aria-label', '计算范围选择');
  const difficulties = [...new Set([0, 1, 2, 3, ...tasks.map((task) => task.difficulty ?? 0)])].sort((a, b) => a - b);
  dialog.innerHTML = `<h3>计算范围选择</h3>
    <fieldset><legend>1. 配置表</legend><label><input type="checkbox" data-select-all="configuration">全选</label>
      ${Object.entries(BATCH_CONFIGURATION_LABELS).map(([key, label]) => `<label><input type="checkbox" data-configuration="${key}">${label}</label>`).join('')}
    </fieldset>
    <fieldset><legend>2. 关卡范围</legend>
      <label><input type="radio" name="batch-range" value="all" checked>全部</label>
      <label><input type="radio" name="batch-range" value="interval">指定范围</label>
      <div class="arranger-batch-range"><span>level</span><input type="number" data-from min="1" step="1" aria-label="起始关卡" placeholder="a" disabled><span>～ level</span><input type="number" data-to min="1" step="1" aria-label="结束关卡" placeholder="b" disabled><button type="button" data-clear-range>清空</button></div>
      <small>按各配置表的关号筛选，包含起止关；每关内全部棋盘均参与。</small>
    </fieldset>
    <fieldset><legend>3. 难度范围</legend><label><input type="checkbox" data-select-all="difficulty" checked>全选</label>
      ${difficulties.map((value) => `<label><input type="checkbox" data-difficulty="${value}" checked>${value}</label>`).join('')}
      <button type="button" data-clear-difficulties>全部清除</button>
      <small>包含所选路径在库中的对应难度；未标注难度的引导关按0筛选。活动对应拼豆玩法配置。</small>
    </fieldset>
    <fieldset><legend>4. 关卡模拟次数</legend><label>每关模拟次数<input type="number" data-repetitions min="1" max="1000" step="1" value="1" aria-label="每关模拟次数"></label><small>每个棋盘难度版本独立模拟，局面数量、卡点和错误次数取平均值。</small></fieldset>
    <p data-summary role="status"></p>
    <div class="arranger-group-actions"><button type="button" data-start>开始计算</button><button type="button" data-cancel>取消</button></div>`;
  const query = <T extends HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  const simulationSettings = new BatchSimulationSettingsFields();
  dialog.insertBefore(simulationSettings.element, query('[data-summary]'));
  const columns = document.createElement('div'); columns.className = 'arranger-batch-columns';
  const config = document.createElement('section'); config.className = 'arranger-batch-config-column';
  const history = document.createElement('section'); history.className = 'arranger-batch-history-column';
  const fields = [...dialog.children].filter((child) => child.tagName === 'FIELDSET' || child === simulationSettings.element);
  config.append(...fields); columns.append(config, history); dialog.insertBefore(columns, query('[data-summary]'));
  history.innerHTML = '<h4>历史记录</h4><small>自动保存在当前浏览器。可将历史结果应用到当前列表，也可查看结果、导出 CSV；中断后点击“继续计算”补跑未保存的版本；单关未完成的模拟次数重新计算，沿用原参数和尺寸。删除历史会同时清理其 Excel 源数据。</small><p data-history-status role="status"></p><div data-history-list></div>';
  let finishSelection: (result?: BatchSelection) => void;
  const historyStatus = query('[data-history-status]');
  const historyList = query('[data-history-list]');
  const renderHistory = async () => {
    historyStatus.textContent = '正在读取历史…';
    try {
      const entries = await listBatchHistory(); historyList.replaceChildren();
      historyStatus.textContent = entries.length ? `共 ${entries.length} 条记录` : '暂无历史记录';
      for (const entry of entries) {
        const card = document.createElement('article'); card.className = 'arranger-batch-history-card';
        const title = document.createElement('strong'); title.textContent = `${new Date(entry.createdAt).toLocaleString()} · ${entry.name}`;
        const info = document.createElement('p');
        info.textContent = `${entry.scope}\n每版本 ${entry.repetitions} 次；结果 ${entry.saved}/${entry.total} 个版本；${entry.status}\n${describeBatchSettings(entry.settings)}\n棋盘 ${Math.round(entry.geometry.boardWidth)}×${Math.round(entry.geometry.boardHeight)}；视窗 ${entry.geometry.viewportWidth}×${entry.geometry.viewportHeight}；像素比 ${entry.geometry.pixelRatio}\n关卡库：${entry.libraryId}`;
        const actions = document.createElement('div'); actions.className = 'arranger-group-actions';
        const apply = document.createElement('button'); apply.type = 'button'; apply.textContent = '应用到当前列表'; apply.disabled = entry.saved === 0;
        const view = document.createElement('button'); view.type = 'button'; view.textContent = '查看结果';
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除';
        view.addEventListener('click', async () => {
          view.disabled = true;
          try { await onHistory(entry); } catch (error) { historyStatus.textContent = `读取失败：${String(error)}`; }
          finally { view.disabled = false; }
        });
        apply.addEventListener('click', async () => {
          apply.disabled = true;
          try {
            await onApplyHistory(entry);
            query<HTMLButtonElement>('[data-cancel]').click();
          } catch (error) { historyStatus.textContent = `应用失败：${error instanceof Error ? error.message : String(error)}`; }
          finally { apply.disabled = entry.saved === 0; }
        });
        remove.addEventListener('click', async () => {
          remove.disabled = true;
          try { await deleteBatchHistory(entry.id); await renderHistory(); }
          catch (error) { historyStatus.textContent = `删除失败：${String(error)}`; remove.disabled = false; }
        });
        const resume = document.createElement('button'); resume.type = 'button'; resume.textContent = '继续计算';
        resume.disabled = !entry.resumable || entry.saved >= entry.total;
        resume.addEventListener('click', () => finishSelection({ resume: entry }));
        if (!entry.resumable && entry.saved < entry.total) {
          const note = document.createElement('small'); note.textContent = '旧版记录未保存待跑清单，无法自动续跑。'; info.append(document.createElement('br'), note);
        }
        actions.append(resume, apply, view, remove); card.append(title, info, actions); historyList.append(card);
      }
    } catch (error) { historyStatus.textContent = `历史读取失败：${String(error)}`; }
  };
  void renderHistory();
  const modeInputs = [...dialog.querySelectorAll<HTMLInputElement>('[data-configuration]')];
  const difficultyInputs = [...dialog.querySelectorAll<HTMLInputElement>('[data-difficulty]')];
  modeInputs.forEach((input) => { input.checked = input.dataset.configuration === current; });
  const allRange = query<HTMLInputElement>('[name="batch-range"][value="all"]');
  const intervalRange = query<HTMLInputElement>('[name="batch-range"][value="interval"]');
  const from = query<HTMLInputElement>('[data-from]'), to = query<HTMLInputElement>('[data-to]');
  const repetitions = query<HTMLInputElement>('[data-repetitions]');
  let selection: ConfigurationBatchTask[] = [];
  const refresh = () => {
    from.disabled = to.disabled = allRange.checked;
    for (const [name, inputs] of [['configuration', modeInputs], ['difficulty', difficultyInputs]] as const) {
      const all = query<HTMLInputElement>(`[data-select-all="${name}"]`);
      all.checked = inputs.every((input) => input.checked);
      all.indeterminate = !all.checked && inputs.some((input) => input.checked);
    }
    const configurations = modeInputs.filter((input) => input.checked).map((input) => input.dataset.configuration!);
    const selectedDifficulties = difficultyInputs.filter((input) => input.checked).map((input) => Number(input.dataset.difficulty));
    const invalidRange = !allRange.checked && (!Number.isInteger(from.valueAsNumber) || !Number.isInteger(to.valueAsNumber)
      || from.valueAsNumber < 1 || from.valueAsNumber > to.valueAsNumber);
    selection = filterConfigurationBatchTasks(tasks, { configurations, difficulties: selectedDifficulties,
      range: allRange.checked ? undefined : { from: from.valueAsNumber, to: to.valueAsNumber } });
    const invalidRepetitions = !Number.isInteger(repetitions.valueAsNumber) || !repetitions.checkValidity() || repetitions.valueAsNumber < 1;
    const invalidSettings = !simulationSettings.valid();
    query<HTMLButtonElement>('[data-start]').disabled = !selection.length || invalidRange || invalidRepetitions || invalidSettings;
    query('[data-summary]').textContent = !configurations.length ? '请选择至少一个配置表。'
      : !selectedDifficulties.length ? '请选择至少一个难度。' : invalidRange ? '请输入有效的起始和结束关号，起始不能大于结束。'
      : invalidRepetitions ? '模拟次数须为1～1000的整数。'
      : invalidSettings ? '请填写有效的手指、概率和权重参数。'
      : `已选 ${configurations.length} 个配置表，共 ${selection.length} 个棋盘难度版本 × ${repetitions.valueAsNumber} 次 = ${selection.length * repetitions.valueAsNumber} 次模拟。`;
  };
  query<HTMLInputElement>('[data-select-all="configuration"]').addEventListener('change', (event) => {
    modeInputs.forEach((input) => { input.checked = (event.target as HTMLInputElement).checked; }); refresh();
  });
  query<HTMLInputElement>('[data-select-all="difficulty"]').addEventListener('change', (event) => {
    difficultyInputs.forEach((input) => { input.checked = (event.target as HTMLInputElement).checked; }); refresh();
  });
  query('[data-clear-range]').addEventListener('click', () => { intervalRange.checked = true; from.value = to.value = ''; refresh(); });
  query('[data-clear-difficulties]').addEventListener('click', () => { difficultyInputs.forEach((input) => { input.checked = false; }); refresh(); });
  dialog.addEventListener('input', (event) => { if (event.target === from || event.target === to || event.target === repetitions || simulationSettings.element.contains(event.target as Node)) refresh(); });
  dialog.addEventListener('change', refresh);
  host.append(dialog); refresh(); dialog.showModal();
  return new Promise((resolve) => {
    const finish = finishSelection = (result?: BatchSelection) => { dialog.close(); dialog.remove(); resolve(result); };
    query('[data-start]').addEventListener('click', () => { refresh(); if (!query<HTMLButtonElement>('[data-start]').disabled) finish({ tasks: selection, repetitions: repetitions.valueAsNumber, settings: simulationSettings.value(), scope: `${modeInputs.filter((input) => input.checked).map((input) => BATCH_CONFIGURATION_LABELS[input.dataset.configuration as keyof typeof BATCH_CONFIGURATION_LABELS]).join('＋')} · ${allRange.checked ? '全部关卡' : `level${from.value}～level${to.value}`} · 难度 ${difficultyInputs.filter((input) => input.checked).map((input) => input.dataset.difficulty).join('、')}` }); });
    query('[data-cancel]').addEventListener('click', () => finish());
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(); });
  });
}
