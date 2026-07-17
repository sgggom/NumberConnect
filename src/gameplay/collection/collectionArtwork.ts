export const COLLECTION_ARTWORK_NAMES = [
  'apple',
  'banana',
  'orange',
  'grapes',
  'basket',
  'pineapple',
] as const;

export const collectionArtworkName = (index: number): string => {
  const normalizedIndex = Math.max(0, Math.floor(index));
  return COLLECTION_ARTWORK_NAMES[normalizedIndex % COLLECTION_ARTWORK_NAMES.length];
};

export const collectionArtworkResourcePath = (index: number): string => (
  `LevelBackgrounds/${collectionArtworkName(index)}`
);

export const collectionArtworkUrl = (index: number): string => (
  `./level-backgrounds/${collectionArtworkName(index)}.png`
);
