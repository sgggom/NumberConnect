import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearArrangementLibraryFile,
  loadArrangementLibraryFile,
  saveArrangementLibraryFile,
} from './arrangementLibraryCache';

describe('arrangement library cache', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('gracefully disables persistence when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(loadArrangementLibraryFile()).resolves.toBeUndefined();
    await expect(saveArrangementLibraryFile({} as File)).resolves.toBeUndefined();
    await expect(clearArrangementLibraryFile()).resolves.toBeUndefined();
  });
});
