import type { LibraryFilterRule, LibraryFilterOperator } from './libraryFilters';
export interface LibraryFilterSelection { rules: LibraryFilterRule[] }
export function chooseLibraryFilters(host: HTMLElement, headers: readonly string[], current: LibraryFilterRule[], legacy: boolean): Promise<LibraryFilterSelection | undefined> {
  const dialog = document.createElement('dialog'); dialog.className = 'arranger-batch-dialog arranger-filter-dialog';
  dialog.setAttribute('aria-label', '关卡库筛选');
  const title = document.createElement('h3'); title.textContent = `关卡库筛选 · ${headers.filter(Boolean).length} 个 key`;
  const help = document.createElement('p'); help.textContent = '勾选需要筛选的表头 key 并设置条件。所有条件同时满足才保留；数值比较包含边界。筛选读取 Excel 原表数据。' + (legacy ? '已补齐旧缓存中分开保存的路径、难度和模拟统计字段。旧版未保存的原始字段值（如路径JSON、连续向下数量）为空；需原表精确值时可重新导入。' : '');
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = '搜索表头 key'; search.setAttribute('aria-label', '搜索筛选字段');
  const list = document.createElement('div'); list.className = 'arranger-filter-fields';
  const fields = headers.flatMap((header, column) => {
    if (!header) return [];
    const row = document.createElement('div'); row.className = 'arranger-filter-field';
    const label = document.createElement('label'), checkbox = document.createElement('input'); checkbox.type = 'checkbox';
    label.append(checkbox, document.createTextNode(header));
    const select = document.createElement('select'); select.setAttribute('aria-label', `${header} 筛选方式`);
    for (const [value, text] of [['contains','包含'],['eq','等于'],['gte','大于等于'],['lte','小于等于'],['empty','为空'],['notEmpty','不为空']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
    }
    const input = document.createElement('input'); input.type = 'text'; input.setAttribute('aria-label', `${header} 筛选值`);
    const previous = current.find((rule) => rule.column === column);
    checkbox.checked = !!previous; select.value = previous?.operator ?? 'contains'; input.value = previous?.value ?? '';
    const refresh = () => { select.disabled = !checkbox.checked; input.disabled = !checkbox.checked || ['empty','notEmpty'].includes(select.value); };
    checkbox.addEventListener('change', refresh); select.addEventListener('change', refresh); refresh();
    row.append(label, select, input); list.append(row);
    return [{ row, header, column, checkbox, select, input }];
  });
  search.addEventListener('input', () => fields.forEach((field) => { field.row.hidden = !field.header.toLowerCase().includes(search.value.trim().toLowerCase()); }));
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const actions = document.createElement('div'); actions.className = 'arranger-group-actions';
  const apply = document.createElement('button'), clear = document.createElement('button'), cancel = document.createElement('button');
  apply.textContent = '应用筛选'; clear.textContent = '清空筛选'; cancel.textContent = '取消';
  [apply, clear, cancel].forEach((button) => button.type = 'button'); actions.append(apply, clear, cancel);
  dialog.append(title, help, search, list, status, actions); host.append(dialog); dialog.showModal();
  return new Promise((resolve) => {
    const finish = (rules?: LibraryFilterSelection) => { dialog.close(); dialog.remove(); resolve(rules); };
    apply.addEventListener('click', () => {
      const selected = fields.filter((field) => field.checkbox.checked);
      const invalid = selected.find((field) => !['empty','notEmpty'].includes(field.select.value)
        && (!field.input.value.trim() || ['gte','lte'].includes(field.select.value) && !Number.isFinite(Number(field.input.value))));
      if (invalid) { status.textContent = `请填写“${invalid.header}”的有效筛选值。`; invalid.input.focus(); return; }
      finish({ rules: selected.map((field) => ({ column: field.column, operator: field.select.value as LibraryFilterOperator, value: field.input.value })) });
    });
    clear.addEventListener('click', () => finish({ rules: [] })); cancel.addEventListener('click', () => finish());
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(); });
  });
}
