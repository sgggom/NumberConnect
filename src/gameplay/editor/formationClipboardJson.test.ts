import { describe, expect, it } from 'vitest';
import { encodeFormationClipboardJson } from './formationClipboardJson';

describe('formation clipboard JSON', () => {
  it('encodes active cells as 999 and empty cells as 0', () => {
    const text = encodeFormationClipboardJson(3, 4, new Set([
      '1,0', '2,0',
      '0,1', '1,1', '2,1',
      '1,2',
    ]));

    expect(JSON.parse(text)).toEqual({
      data: [
        [0, 999, 999, 0],
        [999, 999, 999, 0],
        [0, 999, 0, 0],
      ],
    });
  });
});
