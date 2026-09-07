import { describe, expect, it } from 'vitest';
import indexMarkup from '../../index.html?raw';
import { EDITOR_ALGORITHMS } from '../gameplay/editor/algorithms/registry';

describe('migrated product scope', () => {
  it('uses puzzle directly without exposing obsolete gameplay, difficulty, or input selectors', () => {
    expect(indexMarkup).not.toContain('name="main-gameplay"');
    expect(indexMarkup).not.toContain('id="settings-main-difficulty"');
    expect(indexMarkup).not.toContain('id="settings-input-mode"');
  });

  it('removes level information and jump controls to make room for the state machine', () => {
    expect(indexMarkup).not.toContain('id="level-debug-crossing-count"');
    expect(indexMarkup).not.toContain('id="level-debug-level-input"');
  });

  it('exposes the new stage model and authored ranks without the retired generators', () => {
    expect(indexMarkup).toContain('id="level-debug-hidden-difficulty"');
    expect(indexMarkup).toContain('id="level-debug-generate-difficulty"');
    expect(indexMarkup).toContain('id="difficulty-flow"');
    expect(indexMarkup).toContain('动态难度实时状态机');
    expect(indexMarkup).not.toContain('id="level-debug-generate-tier-counts"');
    expect(indexMarkup).not.toContain('实时生成隐藏位置');
  });

  it('provides whole-level and per-stage experience sections in the result panel', () => {
    expect(indexMarkup).toContain('id="result-experience"');
    expect(indexMarkup).toContain('aria-label="整关体验汇总"');
    expect(indexMarkup).toContain('id="result-experience-stages"');
    expect(indexMarkup).toContain('各阶段明细');
    expect(indexMarkup).toContain('id="level-debug-error-history-list"');
    expect(indexMarkup).toContain('每次错误');
    expect(indexMarkup).not.toContain('id="level-debug-experience-radar"');
    expect(indexMarkup).not.toContain('id="level-debug-experience-title"');
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
