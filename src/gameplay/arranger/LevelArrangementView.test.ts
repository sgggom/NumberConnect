import { describe, expect, it, vi } from 'vitest';
import { mountLevelArrangementView } from './LevelArrangementView';

const renderMarkup = (): string => {
  let markup = '';
  const host = {
    setAttribute: vi.fn(),
    set innerHTML(value: string) { markup = value; },
  } as unknown as HTMLElement;
  mountLevelArrangementView(host);
  return markup;
};

describe('level arrangement view', () => {
  it('places the level list, difficulty-5 library, and preview in order', () => {
    const markup = renderMarkup();
    const groups = markup.indexOf('id="arranger-group-list"');
    const library = markup.indexOf('id="arranger-library-list"');
    const preview = markup.indexOf('id="arranger-preview"');
    expect(groups).toBeGreaterThanOrEqual(0);
    expect(library).toBeGreaterThan(groups);
    expect(preview).toBeGreaterThan(library);
  });

  it('provides xlsx import, search, grouping, pagination, and export controls', () => {
    const markup = renderMarkup();
    expect(markup).toContain('id="arranger-open-file"');
    expect(markup).toContain('accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"');
    expect(markup).toContain('id="arranger-search"');
    expect(markup).toContain('id="arranger-add-selected"');
    expect(markup).not.toContain('id="arranger-selected-list"');
    expect(markup).toContain('棋盘 ＞ 路径 ＞ 难度');
    expect(markup).not.toContain('棋盘 ＞ 路径 ＞ 难度 ＞ 隐藏');
    expect(markup).toContain('id="arranger-add-group"');
    expect(markup).toContain('id="arranger-copy-groups"');
    expect(markup).toContain('id="arranger-page-next"');
    expect(markup).toContain('id="arranger-show-trend"');
    expect(markup).toContain('id="arranger-show-connection"');
    expect(markup).toContain('id="arranger-show-connection" type="checkbox"><span>连线</span>');
    expect(markup).toContain('id="arranger-playtest-button"');
    expect(markup).toContain('id="arranger-library-parameters-body"');
    expect(markup).toContain('id="arranger-auto-layout"');
    expect(markup).toContain('id="arranger-auto-dialog"');
    expect(markup).toContain('id="arranger-auto-path-gap"');
  });
});
