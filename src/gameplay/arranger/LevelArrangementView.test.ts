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
    expect(markup).toContain('id="arranger-copy-level-data"');
    expect(markup).toContain('id="arranger-config-switcher"');
    expect(markup).toContain('data-arrangement-mode="main"');
    expect(markup).toContain('data-arrangement-mode="daily"');
    expect(markup).toContain('data-arrangement-mode="bead"');
    expect(markup).toContain('主玩法配置');
    expect(markup).toContain('每日挑战配置');
    expect(markup).toContain('拼豆玩法配置');
    expect(markup).toContain('导出三模式关卡数据');
    expect(markup).toContain('id="arranger-page-next"');
    expect(markup).toContain('id="arranger-show-trend"');
    expect(markup).toContain('id="arranger-show-connection"');
    expect(markup).toContain('id="arranger-show-connection" type="checkbox"><span>连线</span>');
    expect(markup).toContain('id="arranger-playtest-button"');
    expect(markup).toContain('id="arranger-library-parameters-body"');
    expect(markup).toContain('id="arranger-auto-layout"');
    expect(markup).toContain('id="arranger-auto-dialog"');
    expect(markup).toContain('id="arranger-auto-read-layout"');
    expect(markup).toContain('id="arranger-auto-level-count"');
    expect(markup).toContain('id="arranger-auto-level-count" type="number" min="1" step="1" value="400"');
    expect(markup).toContain('id="arranger-auto-board-count" type="number" min="1" max="20" step="1" value="4"');
    expect(markup).toContain('id="arranger-auto-path-gap"');
    expect(markup).toContain('id="arranger-auto-occlusion-preference"');
    expect(markup).toContain('<option value="random" selected>随机</option>');
    expect(markup).toContain('阶段数量随每关棋盘数量自动变化');
    expect(markup).toContain('难度范围');
    expect(markup).not.toContain('id="arranger-auto-add-stage"');
    expect(markup).not.toContain('起始关');
    expect(markup).not.toContain('结束关');
  });
});
