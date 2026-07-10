import { EDITOR_ALGORITHMS } from './registry';
import type { EditorAlgorithmSelection } from './types';
import type { EditorShape } from '../types';

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
      label.textContent = '交叉数量';
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '99';
      input.step = '1';
      const crossingsDisabled = shape === 'hex';
      input.value = String(crossingsDisabled ? 0 : selection.parameters.targetCrossings);
      input.disabled = crossingsDisabled;
      input.title = crossingsDisabled ? '六边形蜂窝棋盘不会产生交叉' : '目标交叉数量';
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
  }
};
