import { describe, expect, it } from 'vitest';
import {
  comboSoundBracketGroupRange,
  isComboSoundArrangement,
  isComboSoundPattern,
  parseComboSoundArrangement,
  parseComboSoundPattern,
  remapComboSoundArrangementAfterRemoval,
} from '../game/types';

describe('connection sound composition syntax', () => {
  it('parses fixed notes and random-choice groups as sequence tokens', () => {
    expect(parseComboSoundPattern('1[234]58')).toEqual([[1], [2, 3, 4], [5], [8]]);
    expect(parseComboSoundPattern('[123]')).toEqual([[1, 2, 3]]);
  });

  it('rejects empty, incomplete, nested, and out-of-range groups', () => {
    expect(isComboSoundPattern('')).toBe(false);
    expect(isComboSoundPattern('1[]2')).toBe(false);
    expect(isComboSoundPattern('1[23')).toBe(false);
    expect(isComboSoundPattern('1[[23]]')).toBe(false);
    expect(isComboSoundPattern('1[29]')).toBe(false);
  });

  it('resolves either bracket to the complete random-choice group', () => {
    expect(comboSoundBracketGroupRange('1[234]58', 1)).toEqual({ start: 1, end: 6 });
    expect(comboSoundBracketGroupRange('1[234]58', 5)).toEqual({ start: 1, end: 6 });
    expect(comboSoundBracketGroupRange('1[234]58', 3)).toBeUndefined();
  });
});

describe('connection sound arrangement syntax', () => {
  it('parses comma-separated melody numbers and random melody groups', () => {
    expect(parseComboSoundArrangement('1,2,[3,4],12')).toEqual([[1], [2], [3, 4], [12]]);
    expect(isComboSoundArrangement('1,2,[3,4],12', 12)).toBe(true);
  });

  it('rejects malformed separators, groups, and melody numbers', () => {
    expect(parseComboSoundArrangement('1 2')).toBeUndefined();
    expect(parseComboSoundArrangement('1,,2')).toBeUndefined();
    expect(parseComboSoundArrangement('[1,]')).toBeUndefined();
    expect(parseComboSoundArrangement('0,1')).toBeUndefined();
    expect(parseComboSoundArrangement('1,[2,3')).toBeUndefined();
    expect(isComboSoundArrangement('1,3', 2)).toBe(false);
  });

  it('removes deleted melodies and renumbers later melody references', () => {
    expect(remapComboSoundArrangementAfterRemoval('1,2,[3,4],12', 2)).toBe('1,[2,3],11');
    expect(remapComboSoundArrangementAfterRemoval('[2],1', 2)).toBe('1');
  });
});
