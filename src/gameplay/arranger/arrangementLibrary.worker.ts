/// <reference lib="webworker" />

import { readArrangementWorkbookStream } from './streamArrangementWorkbook';
import { commitArrangementLibrary, createArrangementIndexBuilder, writeArrangementBatch } from './arrangementDatabase';

interface ArrangementLibraryWorkerRequest {
  buffer: ArrayBuffer;
  file?: File;
  libraryId?: string;
  activate?: boolean;
}

self.onmessage = async (event: MessageEvent<ArrangementLibraryWorkerRequest>): Promise<void> => {
  try {
    const { file, libraryId } = event.data;
    const buildIndex = createArrangementIndexBuilder();
    let count = 0;
    const result = await readArrangementWorkbookStream(file ? await file.arrayBuffer() : event.data.buffer, (message) => {
      self.postMessage({ type: 'progress', message });
    }, libraryId ? async (levels) => {
      await writeArrangementBatch(libraryId, levels, buildIndex);
      count += levels.length;
    } : undefined, event.data.activate === false);
    if (file && libraryId) {
      const manifest = { id: libraryId, name: file.name, count, parameterHeaders: result.parameterHeaders, skippedRows: result.skippedRows };
      await commitArrangementLibrary(manifest, event.data.activate ?? true);
      self.postMessage({ type: 'complete', manifest });
    } else self.postMessage({ type: 'complete', result });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : '读取关卡库失败。',
    });
  }
};

export {};
