/// <reference lib="webworker" />

import { readArrangementWorkbookStream } from './streamArrangementWorkbook';

interface ArrangementLibraryWorkerRequest {
  buffer: ArrayBuffer;
}

self.onmessage = async (event: MessageEvent<ArrangementLibraryWorkerRequest>): Promise<void> => {
  try {
    const result = readArrangementWorkbookStream(event.data.buffer, (message) => {
      self.postMessage({ type: 'progress', message });
    });
    self.postMessage({ type: 'complete', result });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : '读取关卡库失败。',
    });
  }
};

export {};
