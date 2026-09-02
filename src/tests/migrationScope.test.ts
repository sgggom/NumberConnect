import { describe, expect, it } from 'vitest';
import indexMarkup from '../../index.html?raw';
import { EDITOR_ALGORITHMS } from '../gameplay/editor/algorithms/registry';

describe('migrated product scope', () => {
  it('uses puzzle directly without exposing obsolete gameplay, difficulty, or input selectors', () => {
    expect(indexMarkup).not.toContain('name="main-gameplay"');
    expect(indexMarkup).not.toContain('id="settings-main-difficulty"');
    expect(indexMarkup).not.toContain('id="settings-input-mode"');
  });

  it('shows the actual path crossing count in the level debug panel', () => {
    expect(indexMarkup).toContain('id="level-debug-crossing-count"');
    expect(indexMarkup).toContain('<dt>交叉次数</dt>');
  });

  it('keeps the two hidden-difficulty debug generators as separate controls', () => {
    expect(indexMarkup).toContain('id="level-debug-hidden-difficulty"');
    expect(indexMarkup).toContain('id="level-debug-generate-difficulty"');
    expect(indexMarkup).toContain('id="level-debug-tier-0-count"');
    expect(indexMarkup).toContain('id="level-debug-tier-1-count"');
    expect(indexMarkup).toContain('id="level-debug-tier-2-count"');
    expect(indexMarkup).toContain('id="level-debug-generate-tier-counts"');
    expect(indexMarkup).toContain('两个入口独立生效');
  });

  it('provides whole-level and per-stage experience sections in the result panel', () => {
    expect(indexMarkup).toContain('id="result-experience"');
    expect(indexMarkup).toContain('aria-label="整关体验汇总"');
    expect(indexMarkup).toContain('id="result-experience-stages"');
    expect(indexMarkup).toContain('各阶段明细');
    expect(indexMarkup).toContain('id="level-debug-error-history-list"');
    expect(indexMarkup).toContain('每次错误');
    expect(indexMarkup).toContain('id="level-debug-experience-radar"');
    expect(indexMarkup).toContain('id="level-debug-experience-legend"');
  });

  it('keeps daily challenge, bead gameplay, and gallery as standalone lobby destinations', () => {
    expect(indexMarkup).toContain('id="default-daily-challenge-button"');
    expect(indexMarkup).toContain('id="default-bead-mode-button"');
    expect(indexMarkup).toContain('id="default-gallery-button"');
    expect(indexMarkup).toContain('class="default-gallery-button"');
    expect(indexMarkup).not.toContain('default-feature-card--gallery');
    expect(indexMarkup).toContain('id="bead-back-button"');
    expect(indexMarkup).toContain('id="daily-back-button"');
    expect(indexMarkup).toContain('id="favorites-back-button"');
    expect(indexMarkup).not.toContain('id="primary-tab-bar"');
  });

  it('exposes the current generator as algorithm 1', () => {
    expect(EDITOR_ALGORITHMS.map(({ id }) => id)).toEqual(['algorithm-1']);
    expect(indexMarkup).toContain('id="default-editor-button"');
  });

  it('opens level tools from the lobby logo and exposes both destinations', () => {
    expect(indexMarkup).toContain('id="lobby-tools-dialog"');
    expect(indexMarkup).toContain('id="lobby-open-editor-button"');
    expect(indexMarkup).toContain('id="lobby-open-arranger-button"');
    expect(indexMarkup).toContain('id="arranger-screen"');
  });
});
