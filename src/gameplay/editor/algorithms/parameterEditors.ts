import { EDITOR_ALGORITHMS } from './registry';
import type { EditorAlgorithmSelection } from './types';
import type { EditorShape } from '../types';

const numberField = (
  labelText: string,
  value: number,
  min: number,
  max: number,
  onValue: (value: number) => void,
): HTMLLabelElement => {
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
  switch (selection.id) {
    case 'algorithm-1': {
      const description = document.createElement('p');
      description.textContent = EDITOR_ALGORITHMS.find((item) => item.id === selection.id)?.description ?? '';
      const field = document.createElement('label');
      field.className = 'editor-algorithm-field';
      const label = document.createElement('span');
      label.textContent = '最大交叉数量';
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '99';
      input.step = '1';
      const crossingsDisabled = shape === 'hex';
      input.value = String(crossingsDisabled ? 0 : selection.parameters.targetCrossings);
      input.disabled = crossingsDisabled;
      input.title = crossingsDisabled ? '六边形蜂窝棋盘不会产生交叉' : '允许出现的最大交叉数量';
      input.addEventListener('change', () => {
        const targetCrossings = Math.max(0, Math.min(99, Math.floor(Number(input.value) || 0)));
        onChange({
          ...selection,
          parameters: { ...selection.parameters, targetCrossings },
        });
      });
      field.append(label, input);
      host.append(description, field);
      if (crossingsDisabled) {
        const note = document.createElement('small');
        note.textContent = '六边形蜂窝棋盘无交叉，固定为 0。';
        host.append(note);
      }
      break;
    }
    case 'algorithm-2': {
      const description = document.createElement('p');
      description.textContent = EDITOR_ALGORITHMS.find((item) => item.id === selection.id)?.description ?? '';
      const update = (parameters: Partial<typeof selection.parameters>): void => onChange({
        ...selection,
        parameters: { ...selection.parameters, ...parameters },
      });
      const targetCrossings = shape === 'hex' ? 0 : selection.parameters.targetCrossings;
      const crossings = numberField('最大交叉数量', targetCrossings, 0, 99, (value) => update({ targetCrossings: value }));
      const crossingsInput = crossings.querySelector('input')!;
      crossingsInput.disabled = shape === 'hex';
      crossingsInput.title = shape === 'hex' ? '六边形蜂窝棋盘不会产生交叉' : '允许出现的最大交叉数量';
      host.append(
        description,
        crossings,
        numberField('拐弯概率 %', selection.parameters.turnProbability, 0, 100, (value) => update({ turnProbability: value })),
        numberField('隐藏比例 %', selection.parameters.hiddenPercent, 0, 90, (value) => update({ hiddenPercent: value })),
        numberField('最长连续隐藏', selection.parameters.maxHiddenRun, 1, 8, (value) => update({ maxHiddenRun: value })),
        numberField('最长连续显示', selection.parameters.maxVisibleRun, 1, 12, (value) => update({ maxVisibleRun: value })),
      );
      const note = document.createElement('small');
      note.textContent = '多数步骤按拐弯概率随机选择方向；接近死局时会启用安全引导并自动回退。';
      host.append(note);
      break;
    }
    case 'algorithm-3': {
      const description = document.createElement('p');
      description.textContent = EDITOR_ALGORITHMS.find((item) => item.id === selection.id)?.description ?? '';
      const update = (parameters: Partial<typeof selection.parameters>): void => onChange({
        ...selection,
        parameters: { ...selection.parameters, ...parameters },
      });
      const crossingsDisabled = shape === 'hex';
      const targetCrossings = crossingsDisabled ? 0 : selection.parameters.targetCrossings;
      const crossings = numberField('最大交叉数量', targetCrossings, 0, 99, (value) => update({ targetCrossings: value }));
      const crossingsInput = crossings.querySelector('input')!;
      crossingsInput.disabled = crossingsDisabled;
      crossingsInput.title = crossingsDisabled ? '六边形蜂窝棋盘不会产生交叉' : '允许出现的最大交叉数量';
      const crossingHidden = numberField(
        '交叉处隐藏概率 %',
        crossingsDisabled ? 0 : selection.parameters.crossingHiddenProbability,
        0,
        100,
        (value) => update({ crossingHiddenProbability: value }),
      );
      const crossingHiddenInput = crossingHidden.querySelector('input')!;
      crossingHiddenInput.disabled = crossingsDisabled;
      crossingHiddenInput.title = crossingsDisabled
        ? '六边形蜂窝棋盘不会产生交叉'
        : '交叉线段两端数字成为隐藏候选的概率';
      host.append(
        description,
        crossings,
        numberField('路径拐弯概率 %', selection.parameters.turnProbability, 0, 100, (value) => update({ turnProbability: value })),
        numberField('直线处隐藏概率 %', selection.parameters.straightHiddenProbability, 0, 100, (value) => update({ straightHiddenProbability: value })),
        numberField('拐弯处隐藏概率 %', selection.parameters.turnHiddenProbability, 0, 100, (value) => update({ turnHiddenProbability: value })),
        crossingHidden,
        numberField('隐藏占比 %', selection.parameters.hiddenPercent, 0, 100, (value) => update({ hiddenPercent: value })),
        numberField(
          '隐藏成片最大尺寸（格）',
          selection.parameters.maxHiddenClusterSize,
          1,
          8,
          (value) => update({ maxHiddenClusterSize: value }),
        ),
      );
      const note = document.createElement('small');
      note.textContent = crossingsDisabled
        ? '六边形棋盘无交叉；其余概率先决定隐藏候选，再受隐藏占比、成片尺寸和唯一解限制。'
        : '交叉概率作用于交叉线段两端数字；各概率先决定候选，再受隐藏占比、成片尺寸和唯一解限制。';
      host.append(note);
      break;
    }
  }
};
