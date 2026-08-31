import { Unzip, UnzipInflate } from 'fflate';
import { Parser } from 'saxen';
import {
  createArrangementLibraryRowParser,
  type ArrangementLibraryParseResult,
  type ArrangementLibraryRowParser,
} from './levelArrangement';

const SHEET_ENTRY = 'xl/worksheets/sheet1.xml';
const SHARED_STRINGS_ENTRY = 'xl/sharedStrings.xml';
const ZIP_INPUT_CHUNK_SIZE = 1024 * 1024;

const localName = (name: string): string => name.replace(/^.*:/, '');
const elementName = (element: string | { originalName?: string; name?: string }): string => (
  localName(typeof element === 'string' ? element : element.originalName ?? element.name ?? '')
);

const streamZipEntry = (
  archive: Uint8Array,
  targetName: string,
  onChunk: (chunk: Uint8Array, final: boolean) => void,
): void => {
  let found = false;
  let complete = false;
  let failure: Error | undefined;
  const unzip = new Unzip((file) => {
    file.ondata = (error, data, final) => {
      if (error) {
        failure = error;
        return;
      }
      if (file.name !== targetName || failure) return;
      try {
        onChunk(data, final);
        if (final) complete = true;
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
      }
    };
    if (file.name === targetName) found = true;
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < archive.length && !complete && !failure; offset += ZIP_INPUT_CHUNK_SIZE) {
    const end = Math.min(archive.length, offset + ZIP_INPUT_CHUNK_SIZE);
    unzip.push(archive.subarray(offset, end), end === archive.length);
  }
  if (failure) throw failure;
  if (!found || !complete) throw new Error(`工作簿缺少 ${targetName}。`);
};

const readSharedStrings = (archive: Uint8Array): string[] => {
  const values: string[] = [];
  const parser = new Parser({ proxy: true });
  const decoder = new TextDecoder();
  let insideItem = false;
  let insideText = false;
  let value = '';
  parser.on('openTag', (element: { originalName?: string; name?: string }) => {
    const name = elementName(element);
    if (name === 'si') {
      insideItem = true;
      value = '';
    } else if (insideItem && name === 't') insideText = true;
  });
  parser.on('text', (text: string, decode: (value: string) => string) => {
    if (insideItem && insideText) value += decode(text);
  });
  parser.on('closeTag', (element: { originalName?: string; name?: string }) => {
    const name = elementName(element);
    if (name === 't') insideText = false;
    else if (name === 'si') {
      values.push(value);
      insideItem = false;
    }
  });
  parser.on('error', (error: Error) => { throw error; });
  streamZipEntry(archive, SHARED_STRINGS_ENTRY, (chunk, final) => {
    const text = decoder.decode(chunk, { stream: !final });
    if (text) parser.write(text);
    if (final) parser.end();
  });
  return values;
};

const columnIndex = (reference: string): number => {
  const letters = /^([A-Z]+)/i.exec(reference)?.[1]?.toUpperCase();
  if (!letters) return -1;
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
};

const cellValue = (type: string | undefined, rawValue: string, sharedStrings: ReadonlyArray<string>): unknown => {
  if (type === 's') return sharedStrings[Number(rawValue)] ?? '';
  if (type === 'b') return rawValue === '1';
  if (type === 'str' || type === 'inlineStr') return rawValue;
  if (rawValue === '') return null;
  const numeric = Number(rawValue);
  return Number.isFinite(numeric) ? numeric : rawValue;
};

export const readArrangementWorkbookStream = (
  buffer: ArrayBuffer,
  onProgress?: (message: string) => void,
): ArrangementLibraryParseResult => {
  const archive = new Uint8Array(buffer);
  onProgress?.('正在读取共享文本…');
  const sharedStrings = readSharedStrings(archive);
  onProgress?.('正在逐行读取关卡数据…');

  const parser = new Parser({ proxy: true });
  const decoder = new TextDecoder();
  let libraryParser: ArrangementLibraryRowParser | undefined;
  let currentRow: unknown[] | undefined;
  let currentRowNumber = 0;
  let currentColumn = -1;
  let currentType: string | undefined;
  let currentValue = '';
  let captureValue = false;
  let processedRows = 0;

  parser.on('openTag', (element: { originalName?: string; name?: string; attrs: Record<string, string> }) => {
    const name = elementName(element);
    if (name === 'row') {
      currentRow = [];
      currentRowNumber = Number(element.attrs.r) || processedRows + 1;
    } else if (name === 'c' && currentRow) {
      currentColumn = columnIndex(element.attrs.r ?? '');
      currentType = element.attrs.t;
      currentValue = '';
    } else if ((name === 'v' || name === 't') && currentColumn >= 0) {
      captureValue = true;
    }
  });
  parser.on('text', (text: string, decode: (value: string) => string) => {
    if (captureValue) currentValue += decode(text);
  });
  parser.on('closeTag', (element: { originalName?: string; name?: string }) => {
    const name = elementName(element);
    if (name === 'v' || name === 't') captureValue = false;
    else if (name === 'c' && currentRow && currentColumn >= 0) {
      currentRow[currentColumn] = cellValue(currentType, currentValue, sharedStrings);
      currentColumn = -1;
      currentType = undefined;
      currentValue = '';
    } else if (name === 'row' && currentRow) {
      processedRows += 1;
      if (!libraryParser) libraryParser = createArrangementLibraryRowParser(currentRow);
      else libraryParser.addRow(currentRow, currentRowNumber);
      if (processedRows % 5000 === 0) onProgress?.(`已整理 ${processedRows - 1} 行关卡数据…`);
      currentRow = undefined;
    }
  });
  parser.on('error', (error: Error) => { throw error; });
  streamZipEntry(archive, SHEET_ENTRY, (chunk, final) => {
    const text = decoder.decode(chunk, { stream: !final });
    if (text) parser.write(text);
    if (final) parser.end();
  });
  if (!libraryParser) throw new Error('跑关结果中没有数据。');
  return libraryParser.finish();
};
