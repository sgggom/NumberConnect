import { describe, expect, it } from 'vitest';
import indexMarkup from '../../index.html?raw';

describe('migrated product scope', () => {
  it('does not expose main gameplay selection in settings', () => {
    const values = [...indexMarkup.matchAll(/name="main-gameplay" value="([^"]+)"/g)]
      .map((match) => match[1]);

    expect(values).toEqual([]);
    expect(indexMarkup).not.toContain('id="settings-main-gameplay"');
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

  it('does not expose internal level-authoring tools', () => {
    expect(indexMarkup).not.toContain('id="lobby-tools-dialog"');
    expect(indexMarkup).not.toContain('id="editor-screen"');
    expect(indexMarkup).not.toContain('id="arranger-screen"');
  });

  it('offers cool and warm lobby artwork themes without restoring the removed night theme', () => {
    expect(indexMarkup).not.toContain('value="night"');
    expect(indexMarkup).toContain('id="lobby-theme"');
    expect(indexMarkup).toContain('name="lobby-theme" value="cool"');
    expect(indexMarkup).toContain('name="lobby-theme" value="warm"');
    expect(indexMarkup).not.toContain('lobby-theme-panel--night');
  });

  it('uses the supplied gameplay HUD resources', () => {
    expect(indexMarkup).toContain('id="play-back-button"');
    expect(indexMarkup).toContain('set-2/fanhui.png');
    expect(indexMarkup).toContain('set-2/icon_tishi.png');
    expect(indexMarkup).toContain('set-2/icon_fanwei.png');
    expect(indexMarkup).toContain('id="play-progress-start"');
    expect(indexMarkup).toContain('id="play-progress-end"');
    expect(indexMarkup).not.toContain('id="undo-step-button"');
  });

  it('includes the puzzle finale result summary', () => {
    expect(indexMarkup).toContain('class="play-puzzle-finale__mask"');
    expect(indexMarkup).toContain('id="play-puzzle-finale-time"');
    expect(indexMarkup).toContain('id="play-puzzle-finale-reward-progress"');
  });
});
