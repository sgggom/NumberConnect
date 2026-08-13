import readExcelFile, { type SheetData } from 'read-excel-file/browser';
import workbookUrl from '../../../excel/关卡表.xlsx?url';
import { decodeCompactLevelData } from '../../game/levelDataFormat';
import type { LevelData } from '../../game/types';

export interface Mode5CampaignLevel {
  id: number;
  formationIds: number[];
  stageLevelIds: number[];
}

export interface Mode5WorkbookData {
  levels: LevelData[];
  campaign: Mode5CampaignLevel[];
}

const parseJsonArray = (value: unknown, label: string): unknown[] => {
  if (typeof value !== 'string') throw new Error(`${label} 必须是 JSON 数组文本。`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} 不是有效 JSON。`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${label} 必须是 JSON 数组。`);
  return parsed;
};

const tableRows = (data: SheetData, sheetName: string): Array<[number, unknown]> => {
  const [header, ...rows] = data;
  if (header?.[0] !== 'id' || header?.[1] !== 'data') {
    throw new Error(`${sheetName} sheet 表头必须为 id、data。`);
  }
  return rows.map((row, index) => {
    const id = Number(row[0]);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error(`${sheetName} sheet 第 ${index + 2} 行 id 必须是正整数。`);
    }
    return [id, row[1]];
  });
};

export const parseMode5WorkbookSheets = (
  sheets: ReadonlyArray<{ sheet: string; data: SheetData }>,
): Mode5WorkbookData => {
  const levelSheet = sheets.find(({ sheet }) => sheet === '关卡');
  const formationSheet = sheets.find(({ sheet }) => sheet === '阵型');
  if (!levelSheet || !formationSheet) throw new Error('关卡表.xlsx 必须包含“关卡”和“阵型”sheet。');

  const formations = new Map<number, number[][]>();
  tableRows(formationSheet.data, '阵型').forEach(([id, rawData]) => {
    if (formations.has(id)) throw new Error(`阵型 id ${id} 重复。`);
    const data = parseJsonArray(rawData, `阵型 ${id} data`);
    formations.set(id, data as number[][]);
  });

  const levels: LevelData[] = [];
  const campaign = tableRows(levelSheet.data, '关卡').map(([id, rawData], levelIndex) => {
    if (id !== levelIndex + 1) throw new Error('关卡 id 必须从 1 开始连续排列。');
    const formationIds = parseJsonArray(rawData, `关卡 ${id} data`).map((value) => Number(value));
    if (formationIds.length === 0 || formationIds.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
      throw new Error(`关卡 ${id} data 必须包含至少一个正整数阵型 id。`);
    }
    const stageLevelIds = formationIds.map((formationId) => {
      const data = formations.get(formationId);
      if (!data) throw new Error(`关卡 ${id} 引用了不存在的阵型 ${formationId}。`);
      const stageLevelId = levels.length + 1;
      const decodedLevel = decodeCompactLevelData({ data }, stageLevelId, false);
      levels.push(levelIndex === 0
        ? decodedLevel
        : {
            ...decodedLevel,
            pathSource: 'generated',
            algorithm: { id: 'algorithm-8', parameters: {} },
          });
      return stageLevelId;
    });
    return { id, formationIds, stageLevelIds };
  });

  return { levels, campaign };
};

export const loadMode5Workbook = async (): Promise<Mode5WorkbookData> => {
  const response = await fetch(workbookUrl);
  if (!response.ok) throw new Error('无法加载玩法5关卡配表。');
  const sheets = await readExcelFile(await response.arrayBuffer());
  return parseMode5WorkbookSheets(sheets);
};
