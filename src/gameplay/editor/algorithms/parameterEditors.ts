import { EDITOR_ALGORITHMS } from './registry';
import type { EditorAlgorithmSelection } from './types';
import type { EditorShape } from '../types';

const numberField = (labelText: string, value: number, min: number, max: number, onValue: (value: number) => void): HTMLLabelElement => {
  const field = document.createElement('label');
  field.className = 'editor-algorithm-field';
  const label = document.createElement('span');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = '1';
  input.value = String(value);
  input.addEventListener('change', () => onValue(Math.max(min, Math.min(max, Math.floor(Number(input.value) || 0)))));
  field.append(label, input);
  return field;
};

export const renderEditorAlgorithmParameters = (
  host: HTMLElement,
  selection: EditorAlgorithmSelection,
  shape: EditorShape,
  onChange: (next: EditorAlgorithmSelection) => void,
): void => {
  host.replaceChildren();
  const description = document.createElement('p');
  description.textContent = EDITOR_ALGORITHMS[0].description;
  const update = (parameters: Partial<typeof selection.parameters>): void => onChange({
    ...selection,
    parameters: { ...selection.parameters, ...parameters },
  });
  const targetCrossings = shape === 'hex' ? 0 : selection.parameters.targetCrossings;
  const crossings = numberField('最大交叉数量', targetCrossings, 0, 99, (value) => update({ targetCrossings: value }));
  const crossingsInput = crossings.querySelector('input')!;
  crossingsInput.disabled = shape === 'hex';
  crossingsInput.title = shape === 'hex' ? '六边形蜂窝棋盘不会产生交叉' : '路径生成阶段允许出现的最大交叉数量';
  host.append(
    description,
    crossings,
    numberField('路径拐弯概率 %', selection.parameters.turnProbability, 0, 100, (value) => update({ turnProbability: value })),
    numberField('基础隐藏占比 %', selection.parameters.hiddenPercent, 0, 100, (value) => update({ hiddenPercent: value })),
    numberField('目标难度（1–10）', selection.parameters.targetDifficulty, 1, 10, (value) => update({ targetDifficulty: value })),
    numberField('最长连续显示', selection.parameters.maxVisibleRun, 1, 99, (value) => update({ maxVisibleRun: value })),
    numberField('最长连续隐藏', selection.parameters.maxHiddenRun, 1, 99, (value) => update({ maxHiddenRun: value })),
  );
  const note = document.createElement('small');
  note.textContent = '实际隐藏占比 = 基础隐藏占比 + 目标难度%；例如基础 35%、难度 6，最终按 41% 隐藏。最长连续显示/隐藏是临时硬约束；若与目标隐藏数量无法同时满足，则优先保持隐藏数量并选取最接近限制的布局。目标隐藏次数的前 10%（向上取整）作为均匀分散、难度中性的基准点，其余次数按难度生成空间分岔。';
  host.append(note);
};
