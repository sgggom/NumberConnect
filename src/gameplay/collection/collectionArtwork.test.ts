import { describe, expect, it } from 'vitest';
import {
  COLLECTION_ARTWORK_NAMES,
  collectionArtworkName,
  collectionArtworkResourcePath,
  collectionArtworkUrl,
} from './collectionArtwork';

describe('collection artwork', () => {
  it('assigns each built-in picture in route order', () => {
    expect(COLLECTION_ARTWORK_NAMES.map((_, index) => collectionArtworkName(index))).toEqual([
      'apple',
      'banana',
      'orange',
      'grapes',
      'basket',
      'pineapple',
    ]);
  });

  it('cycles pictures for collection routes longer than the artwork set', () => {
    expect(collectionArtworkName(6)).toBe('apple');
    expect(collectionArtworkName(7)).toBe('banana');
  });

  it('builds matching level resource and browser image paths', () => {
    expect(collectionArtworkResourcePath(2)).toBe('LevelBackgrounds/orange');
    expect(collectionArtworkUrl(2)).toBe('./level-backgrounds/orange.png');
  });
});
