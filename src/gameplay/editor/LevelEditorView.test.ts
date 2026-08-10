import { describe, expect, it, vi } from 'vitest';
import { mountLevelEditorView } from './LevelEditorView';

const renderEditorMarkup = (): string => {
  let markup = '';
  const host = {
    dataset: {} as DOMStringMap,
    childElementCount: 0,
    replaceChildren: vi.fn(),
    setAttribute: vi.fn(),
    set innerHTML(value: string) { markup = value; },
  } as unknown as HTMLElement;
  mountLevelEditorView(host);
  return markup;
};

describe('level editor view layout', () => {
  it('shows size, hidden ratio, and longest visibility runs in the information summary', () => {
    const markup = renderEditorMarkup();

    expect(markup).toContain('id="editor-info-size"');
    expect(markup).toContain('id="editor-info-hidden-ratio"');
    expect(markup).toContain('id="editor-info-longest-visible-run">0 格</strong>');
    expect(markup).toContain('id="editor-info-longest-hidden-run">0 格</strong>');
    expect(markup).not.toContain('路径结构');
    expect(markup).toContain('最长连续显示');
    expect(markup).toContain('最长连续隐藏');
  });

  it('places simulation and the level list in the insights column before the board', () => {
    const markup = renderEditorMarkup();
    const infoIndex = markup.indexOf('class="editor-info-panel"');
    const simulationIndex = markup.indexOf('class="editor-simulation-panel editor-simulation-panel--embedded"');
    const levelListIndex = markup.indexOf('class="editor-level-panel"');
    const boardIndex = markup.indexOf('class="editor-board-pane"');
    const configIndex = markup.indexOf('class="editor-sidebar"');

    expect(infoIndex).toBeGreaterThanOrEqual(0);
    expect(simulationIndex).toBeGreaterThan(infoIndex);
    expect(levelListIndex).toBeGreaterThan(simulationIndex);
    expect(boardIndex).toBeGreaterThan(levelListIndex);
    expect(configIndex).toBeGreaterThan(boardIndex);
  });

  it('removes the top title and save indicator while keeping the back button in the info header', () => {
    const markup = renderEditorMarkup();

    expect(markup).not.toContain('class="editor-header"');
    expect(markup).not.toContain('id="editor-title"');
    expect(markup).not.toContain('id="editor-save-id"');

    const infoHeaderIndex = markup.indexOf('class="editor-info-panel__header"');
    const backButtonIndex = markup.indexOf('id="editor-back-button"');
    const infoTitleIndex = markup.indexOf('id="editor-info-title"');

    expect(backButtonIndex).toBeGreaterThan(infoHeaderIndex);
    expect(infoTitleIndex).toBeGreaterThan(backButtonIndex);
  });

  it('keeps the add action in the level list and removes it from the config module', () => {
    const markup = renderEditorMarkup();

    expect(markup).toContain('id="editor-level-add"');
    expect(markup).not.toContain('id="editor-save-button"');
  });

  it('shows the algorithm picker without a redundant visible label', () => {
    const markup = renderEditorMarkup();

    expect(markup).toContain('class="editor-algorithm-select" aria-label="算法"');
    expect(markup).toContain('<option value="algorithm-8" selected>算法8</option>');
    expect(markup).not.toContain('class="editor-algorithm-select">算法');
  });

  it('orders the bottom actions in two paired rows followed by a full-width playtest action', () => {
    const markup = renderEditorMarkup();
    const actionsIndex = markup.indexOf('class="editor-actions"');
    const fillIndex = markup.indexOf('id="editor-fill-button"');
    const clearIndex = markup.indexOf('id="editor-clear-button"');
    const generateIndex = markup.indexOf('id="editor-generate-path-button"');
    const hiddenIndex = markup.indexOf('id="editor-calculate-hidden-button"');
    const undoIndex = markup.indexOf('id="editor-undo-delete-button"');
    const playtestIndex = markup.indexOf('id="editor-playtest-button"');

    expect(fillIndex).toBeGreaterThan(actionsIndex);
    expect(clearIndex).toBeGreaterThan(fillIndex);
    expect(generateIndex).toBeGreaterThan(clearIndex);
    expect(hiddenIndex).toBeGreaterThan(generateIndex);
    expect(undoIndex).toBeGreaterThan(hiddenIndex);
    expect(playtestIndex).toBeGreaterThan(undoIndex);
    expect(markup).not.toContain('class="editor-board-actions"');
  });

  it('keeps a dedicated label layer inside the path generation progress button', () => {
    const markup = renderEditorMarkup();

    expect(markup).toContain('id="editor-generate-path-button"');
    expect(markup).toContain('id="editor-generate-path-label">生成路径</span>');
    expect(markup).toContain('id="editor-calculate-hidden-button"');
    expect(markup).toContain('id="editor-calculate-hidden-label">计算隐藏</span>');
  });
});
