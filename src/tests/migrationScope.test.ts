import { describe, expect, it } from 'vitest';
import indexMarkup from '../../index.html?raw';
import { EDITOR_ALGORITHMS } from '../gameplay/editor/algorithms/registry';

describe('migrated product scope', () => {
  it('exposes puzzle as the only selectable main gameplay', () => {
    const values = [...indexMarkup.matchAll(/name="main-gameplay" value="([^"]+)"/g)]
      .map((match) => match[1]);

    expect(values).toEqual(['puzzle']);
    expect(indexMarkup).toContain('value="puzzle" checked');
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

  it('exposes algorithm 8 as the editor algorithm', () => {
    expect(EDITOR_ALGORITHMS.map(({ id }) => id)).toEqual(['algorithm-8']);
    expect(indexMarkup).toContain('id="default-editor-button"');
  });
});
