import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { zipSync, strToU8 } from 'fflate';
import {
  commitArrangementLibrary, createArrangementIndexBuilder, deleteArrangementLibrary,
  loadActiveArrangementLibrary, loadArrangementDetails, loadArrangementDraft,
  loadArrangementIndices, saveArrangementDraft, writeArrangementBatch,
} from './arrangementDatabase';
import { parseArrangementLibraryRows, arrangementBoardFamilies, selectArrangementExportLevels } from './levelArrangement';
import { readArrangementWorkbookStream } from './streamArrangementWorkbook';
import { generateAutoArrangement, generateAutoArrangementAsync, parseDifficultyIdRange } from './autoArrangement';

const headers = ['关卡名', '关卡JSON', '路径JSON', '棋盘形状', '目标难度'];
const json = JSON.stringify({ data: [[1, -2], [4, 3]] });
const levels = () => parseArrangementLibraryRows([headers,
  ['level_22_1_1', json, json, '正方形', 1],
  ['level_22_1_2', json, json, '正方形', 2],
]).levels;
const manifest = (id: string, count = 2) => ({ id, count, name: 'test.xlsx', parameterHeaders: [], skippedRows: 0 });

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
});

describe('disk-backed arrangement library', () => {
  it('upgrades old indices with the number of connections without keeping grids in memory', async () => {
    const input = levels();
    delete input[0].pathMetrics.connectionCount;
    await writeArrangementBatch('legacy', input, createArrangementIndexBuilder());
    const restored = await loadArrangementIndices('legacy');
    expect(restored.map((level) => level.pathMetrics.connectionCount)).toEqual([3, 3]);
    expect(restored.every((level) => !('levelData' in level))).toBe(true);
    expect((await loadArrangementIndices('legacy'))[0].pathMetrics.connectionCount).toBe(3);
  });
  it('restores only indices and retrieves grids on demand, preserving grouping and export selection', async () => {
    const input = levels();
    await writeArrangementBatch('a', input, createArrangementIndexBuilder());
    await commitArrangementLibrary(manifest('a'));
    const index = await loadArrangementIndices('a');
    expect(index).toHaveLength(2);
    expect(index[0]).not.toHaveProperty('levelData');
    expect(index[0]).not.toHaveProperty('parameterValues');
    expect(index[0].pathKey.length).toBeLessThan(input[0].pathKey.length);
    expect(index[0].pathMetrics).toBe(index[1].pathMetrics);
    expect(arrangementBoardFamilies(index)[0].paths).toHaveLength(1);
    expect(selectArrangementExportLevels([{ id: 1, levelIds: [input[0].id] }], index)).toHaveLength(2);
    expect((await loadArrangementDetails('a', [input[1].id]))[0].levelData).toEqual(input[1].levelData);
    await expect(loadArrangementDetails('a', ['missing'])).rejects.toThrow('找不到');
  });

  it('keeps the committed library and draft when a replacement fails partway through', async () => {
    await writeArrangementBatch('old', levels(), createArrangementIndexBuilder());
    await commitArrangementLibrary(manifest('old'));
    const configuration = { groups: [{ id: 1, levelIds: ['level_22_1_1'] }], selectedGroupId: 1 };
    const draft = { mode: 'daily' as const, configurations: { main: configuration, daily: configuration, bead: configuration } };
    await saveArrangementDraft('old', draft);
    await writeArrangementBatch('failed', levels(), createArrangementIndexBuilder());
    await deleteArrangementLibrary('failed');
    expect((await loadActiveArrangementLibrary())?.id).toBe('old');
    expect(await loadArrangementDraft('old')).toEqual(draft);
    expect(await loadArrangementIndices('old')).toHaveLength(2);
    expect(await loadArrangementIndices('failed')).toEqual([]);
  });

  it('rolls back a database batch when cloning one record fails', async () => {
    const input = levels();
    Object.assign(input[1].levelData, { invalid: () => undefined });
    await expect(writeArrangementBatch('bad', input, createArrangementIndexBuilder())).rejects.toThrow();
    expect(await loadArrangementIndices('bad')).toEqual([]);
  });

  it('streams workbook rows to awaited batches instead of retaining full results', async () => {
    const cell = (value: string, column: number) => `<c r="${String.fromCharCode(65 + column)}1" t="inlineStr"><is><t>${value}</t></is></c>`;
    const row = (values: string[], n: number) => `<row r="${n}">${values.map(cell).join('')}</row>`;
    const sheet = `<worksheet><sheetData>${row(headers, 1)}${row(['level_22_1_1', json, json, '正方形', '1'], 2)}</sheetData></worksheet>`;
    const archive = zipSync({ 'xl/sharedStrings.xml': strToU8('<sst></sst>'), 'xl/worksheets/sheet1.xml': strToU8(sheet) });
    const buildIndex = createArrangementIndexBuilder();
    const batch = vi.fn(async (input) => { await writeArrangementBatch('stream', input, buildIndex); });
    const result = await readArrangementWorkbookStream(archive.buffer as ArrayBuffer, undefined, batch);
    expect(result.levels).toEqual([]);
    expect(batch).toHaveBeenCalledOnce();
    expect(await loadArrangementIndices('stream')).toHaveLength(1);
    await expect(readArrangementWorkbookStream(archive.buffer as ArrayBuffer, undefined, async () => { throw new Error('disk full'); })).rejects.toThrow('disk full');
  });

  it('preserves automatic arrangement choices while yielding to the page', async () => {
    const families = arrangementBoardFamilies(levels());
    const config = { levelCount: 2, boardsPerLevel: 1, pathRepeatInterval: 0, occlusionPreference: 'random' as const,
      stages: [{ formationIds: [22], difficultyIds: [1, 2] }], randomSource: () => 0 };
    const progress = vi.fn();
    expect(await generateAutoArrangementAsync(families, config, progress)).toEqual(generateAutoArrangement(families, config));
    expect(progress).toHaveBeenCalled();
  });

  it('supports inline-string workbooks and applies backpressure across ZIP chunks', async () => {
    const cell = (value: string, column: number) => `<c r="${String.fromCharCode(65 + column)}1" t="inlineStr"><is><t>${value}</t></is></c>`;
    const rows = [headers, ...Array.from({ length: 1200 }, (_, index) => [`level_22_${index}_1`, json, json, '正方形', '1'])];
    const sheet = `<worksheet><sheetData>${rows.map((row, index) => `<row r="${index + 1}">${row.map(cell).join('')}</row>`).join('')}</sheetData></worksheet>`;
    const archive = zipSync({ 'xl/worksheets/sheet1.xml': strToU8(sheet) }, { level: 0 });
    let pending = false;
    let count = 0;
    let batches = 0;
    await readArrangementWorkbookStream(archive.buffer as ArrayBuffer, undefined, async (batch) => {
      expect(pending).toBe(false);
      pending = true;
      await new Promise((resolve) => setTimeout(resolve, 1));
      count += batch.length;
      batches += 1;
      pending = false;
    });
    expect(count).toBe(1200);
    expect(batches).toBeGreaterThan(1);
  });

  it('rejects huge numeric ranges before allocating or entering an endless loop', () => {
    expect(() => parseDifficultyIdRange('1-10000000')).toThrow('范围过大');
    expect(() => parseDifficultyIdRange('9007199254740992-9007199254740994')).toThrow('范围过大');
  });
});
