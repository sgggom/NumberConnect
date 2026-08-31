import { decodeCompactLevelData, type CompactLevelData } from '../../game/levelDataFormat';

export interface ArrangementLibraryLevel {
  id: string;
  boardKey: string;
  pathKey: string;
  shapeName: string;
  sourceRow: number;
  sourceName: string;
  formationId?: number;
  pathId?: number;
  difficultyId?: number;
  configId: string;
  difficulty?: number;
  mediumErrorCount?: number;
  pathMetrics: ArrangementPathMetrics;
  difficultyMetrics: ArrangementDifficultyMetrics;
  rows: number;
  columns: number;
  parameterValues: string[];
  levelData: CompactLevelData;
}

export interface ArrangementPathMetrics {
  crossings?: number;
  rightAngleRatio?: number;
  acuteAngleRatio?: number;
  obtuseAngleRatio?: number;
  averageSegmentLength?: number;
  directionRatios: Partial<Record<'上' | '下' | '左' | '右' | '左上' | '右上' | '左下' | '右下', number>>;
  consecutiveRightCount?: number;
  consecutiveDownCount?: number;
  consecutiveLowerRightCount?: number;
  consecutiveOcclusionCount?: number;
  startPosition?: string;
  endPosition?: string;
}

export interface ArrangementDifficultyMetrics {
  hiddenCount?: number;
  hiddenRatio?: number;
  longestVisible?: number;
  longestHidden?: number;
  averageSteps?: number;
  lowErrors?: number;
  mediumErrors?: number;
  highErrors?: number;
  averageConnectable?: number;
  directConnectRatio?: number;
  averageDistanceToNextVisible?: number;
  averageStepScore?: number;
  earlyScore?: number;
  middleScore?: number;
  lateScore?: number;
}

export interface ArrangementBoardFamily {
  key: string;
  representative: ArrangementLibraryLevel;
  paths: ArrangementPathFamily[];
}

export interface ArrangementPathFamily {
  key: string;
  representative: ArrangementLibraryLevel;
  difficulties: ArrangementDifficultyFamily[];
}

export interface ArrangementDifficultyFamily {
  difficulty?: number;
  representative: ArrangementLibraryLevel;
  variants: ArrangementLibraryLevel[];
}

export interface ArrangementLevelGroup {
  id: number;
  levelIds: string[];
}

export interface ArrangementLevelLocation {
  boardIndex: number;
  pathIndex: number;
  difficultyIndex: number;
}

export interface ArrangementLibraryParseResult {
  levels: ArrangementLibraryLevel[];
  parameterHeaders: string[];
  skippedRows: number;
}

export interface ArrangementLibraryRowParser {
  addRow: (row: ReadonlyArray<unknown>, sourceRow: number) => void;
  finish: () => ArrangementLibraryParseResult;
}

export const findArrangementLevelLocation = (
  families: ReadonlyArray<ArrangementBoardFamily>,
  levelId: string,
): ArrangementLevelLocation | undefined => {
  for (let boardIndex = 0; boardIndex < families.length; boardIndex += 1) {
    const board = families[boardIndex];
    for (let pathIndex = 0; pathIndex < board.paths.length; pathIndex += 1) {
      const path = board.paths[pathIndex];
      const difficultyIndex = path.difficulties.findIndex((difficulty) => (
        difficulty.variants.some((variant) => variant.id === levelId)
      ));
      if (difficultyIndex >= 0) return { boardIndex, pathIndex, difficultyIndex };
    }
  }
  return undefined;
};

const REQUIRED_HEADERS = [
  '关卡名', '关卡JSON', '路径JSON', '棋盘形状', '目标难度',
] as const;

export const ARRANGEMENT_PATH_PARAMETER_HEADERS = new Set([
  '实际路径交叉数量', '直角拐弯占比', '锐角拐弯占比', '钝角拐弯占比',
  '平均路径长度（拐弯的拐点算作端点，看整个棋盘中的线段平均长度）',
  '向上移动占比', '向下移动占比', '向左移动占比', '向右移动占比',
  '向左上移动占比', '向右上移动占比', '向左下移动占比', '向右下移动占比',
  '连续向右数量', '连续向下数量', '连续向右下数量', '连续遮挡计数',
  '起点位置（分为左上/右上/左下/右下/靠中）', '终点位置',
]);

export const ARRANGEMENT_DIFFICULTY_PARAMETER_HEADERS = new Set([
  '目标难度', '实际隐藏数', '实际隐藏占比 %', '实际最长连续显示', '实际最长连续隐藏',
  '平均总步数', '低推理平均错误数', '中推理平均错误数', '高推理平均错误数',
  '平均可连接数量', '直接连接占比 %', '平均距离下个显示数字', '平均每步难度分',
  '前期平均难度分', '中期平均难度分', '后期平均难度分',
]);

const numericCell = (value: unknown): number | undefined => {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const parseStructuredLevelId = (value: string): {
  formationId?: number;
  pathId?: number;
  difficultyId?: number;
} => {
  const match = /^level_(\d+)_(\d+)_(\d+)$/.exec(value);
  if (!match) return {};
  return {
    formationId: Number(match[1]),
    pathId: Number(match[2]),
    difficultyId: Number(match[3]),
  };
};

const normalizedPathGrid = (rawJson: string): number[][] => {
  const parsed = JSON.parse(rawJson) as { data?: unknown };
  if (!Array.isArray(parsed.data) || parsed.data.length === 0) throw new Error('路径JSON格式错误');
  return parsed.data.map((row) => {
    if (!Array.isArray(row)) throw new Error('路径JSON格式错误');
    return row.map((value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) throw new Error('路径JSON格式错误');
      return numeric;
    });
  });
};

const transposeGrid = (grid: ReadonlyArray<ReadonlyArray<number>>): number[][] => (
  Array.from({ length: grid[0].length }, (_, y) => grid.map((row) => row[y]))
);

const configuredSize = (configId: string): { width: number; height: number } | undefined => {
  const compactMatch = /^level_(\d)(\d{1,2})(?:_|$)/i.exec(configId.trim());
  if (compactMatch) {
    return { width: Number(compactMatch[1]), height: Number(compactMatch[2]) };
  }
  const match = /(?:^|_)(\d+)_(\d+)$/.exec(configId);
  if (!match) return undefined;
  return { width: Number(match[1]), height: Number(match[2]) };
};

const shouldTransposeGrid = (configId: string, grid: ReadonlyArray<ReadonlyArray<number>>): boolean => {
  const size = configuredSize(configId);
  return Boolean(
    size
    && size.width !== size.height
    && grid.length === size.width
    && grid[0].length === size.height,
  );
};

const transposePosition = (value: string): string => ({
  左上: '左上',
  右上: '左下',
  左下: '右上',
  右下: '右下',
  靠中: '靠中',
}[value] ?? value);

const TRANSPOSED_DIRECTION_HEADERS: Record<string, string> = {
  向上移动占比: '向左移动占比',
  向下移动占比: '向右移动占比',
  向左移动占比: '向上移动占比',
  向右移动占比: '向下移动占比',
  向左上移动占比: '向左上移动占比',
  向右上移动占比: '向左下移动占比',
  向左下移动占比: '向右上移动占比',
  向右下移动占比: '向右下移动占比',
  连续向右数量: '连续向下数量',
  连续向下数量: '连续向右数量',
  连续向右下数量: '连续向右下数量',
  连续遮挡计数: '连续遮挡计数',
};

export const createArrangementLibraryRowParser = (
  headerRow: ReadonlyArray<unknown>,
): ArrangementLibraryRowParser => {
  const headers = headerRow.map((value) => String(value ?? '').trim());
  REQUIRED_HEADERS.forEach((header) => {
    if (!headers.includes(header)) throw new Error(`跑关结果缺少“${header}”列。`);
  });
  const indexOf = (header: string): number => headers.indexOf(header);
  const parameterColumns = headers.flatMap((header, columnIndex) => (
    !header
    || header === '关卡JSON'
    || header === '路径JSON'
    || ARRANGEMENT_PATH_PARAMETER_HEADERS.has(header)
    || ARRANGEMENT_DIFFICULTY_PARAMETER_HEADERS.has(header)
      ? []
      : [{ header, columnIndex }]
  ));
  const parameterHeaders = parameterColumns.map(({ header }) => header);
  const levels: ArrangementLibraryLevel[] = [];
  const seenLevelIds = new Set<string>();
  const pathCacheByConfig = new Map<string, Map<string, {
    transpose: boolean;
    pathKey: string;
    boardKey: string;
  }>>();
  const pathMetricsByKey = new Map<string, ArrangementPathMetrics>();
  let skippedRows = 0;

  const addRow = (row: ReadonlyArray<unknown>, sourceRow: number): void => {
    const rawJson = String(row[indexOf('关卡JSON')] ?? '').trim();
    const rawPathJson = String(row[indexOf('路径JSON')] ?? '').trim();
    if (!rawJson || !rawPathJson) {
      skippedRows += 1;
      return;
    }
    try {
      const libraryIndex = levels.length + 1;
      const sourceName = String(row[indexOf('关卡名')] ?? '').trim();
      if (!sourceName) throw new Error('关卡名为空');
      const configRow = numericCell(row[indexOf('配置表行号')]) ?? sourceRow;
      const hiddenSequence = numericCell(row[indexOf('配置内隐藏序号')]) ?? 1;
      let levelId = sourceName;
      if (seenLevelIds.has(levelId)) {
        const suffix = `__row_${configRow}__hidden_${hiddenSequence}`;
        levelId = `${sourceName}${suffix}`;
        let collision = 2;
        while (seenLevelIds.has(levelId)) levelId = `${sourceName}${suffix}_${collision++}`;
      }
      const structuredId = parseStructuredLevelId(sourceName);
      const configId = String(row[indexOf('配置ID')] ?? '').trim();
      const rawLevelGrid = normalizedPathGrid(rawJson);
      let configPathCache = pathCacheByConfig.get(configId);
      if (!configPathCache) {
        configPathCache = new Map();
        pathCacheByConfig.set(configId, configPathCache);
      }
      let cachedPath = configPathCache.get(rawPathJson);
      if (!cachedPath) {
        const rawPathGrid = normalizedPathGrid(rawPathJson);
        const transpose = shouldTransposeGrid(configId, rawPathGrid);
        const pathGrid = transpose ? transposeGrid(rawPathGrid) : rawPathGrid;
        cachedPath = {
          transpose,
          pathKey: JSON.stringify(pathGrid),
          boardKey: JSON.stringify(pathGrid.map((pathRow) => pathRow.map((value) => value === 0 ? 0 : 1))),
        };
        configPathCache.set(rawPathJson, cachedPath);
      }
      const { transpose, pathKey, boardKey } = cachedPath;
      const levelGrid = transpose ? transposeGrid(rawLevelGrid) : rawLevelGrid;
      decodeCompactLevelData({ data: levelGrid }, libraryIndex, false);
      const parameterValues = parameterColumns.map(({ header, columnIndex }): string => {
        const sourceHeader = transpose ? TRANSPOSED_DIRECTION_HEADERS[header] ?? header : header;
        let value = row[indexOf(sourceHeader) >= 0 ? indexOf(sourceHeader) : columnIndex];
        if (transpose && header === '行数') value = row[indexOf('列数')];
        if (transpose && header === '列数') value = row[indexOf('行数')];
        if (transpose && (header === '起点位置（分为左上/右上/左下/右下/靠中）' || header === '终点位置')) {
          value = transposePosition(String(value ?? '').trim());
        }
        if (value === undefined || value === null || String(value).trim() === '') return '';
        return String(value);
      });
      const metricCell = (header: string): unknown => row[indexOf(
        transpose ? TRANSPOSED_DIRECTION_HEADERS[header] ?? header : header,
      )];
      const positionCell = (header: string): string => {
        const value = String(row[indexOf(header)] ?? '').trim();
        return transpose ? transposePosition(value) : value;
      };
      let pathMetrics = pathMetricsByKey.get(pathKey);
      if (!pathMetrics) {
        pathMetrics = {
          crossings: numericCell(row[indexOf('实际路径交叉数量')]),
          rightAngleRatio: numericCell(row[indexOf('直角拐弯占比')]),
          acuteAngleRatio: numericCell(row[indexOf('锐角拐弯占比')]),
          obtuseAngleRatio: numericCell(row[indexOf('钝角拐弯占比')]),
          averageSegmentLength: numericCell(row[indexOf('平均路径长度（拐弯的拐点算作端点，看整个棋盘中的线段平均长度）')]),
          directionRatios: {
            上: numericCell(metricCell('向上移动占比')),
            下: numericCell(metricCell('向下移动占比')),
            左: numericCell(metricCell('向左移动占比')),
            右: numericCell(metricCell('向右移动占比')),
            左上: numericCell(metricCell('向左上移动占比')),
            右上: numericCell(metricCell('向右上移动占比')),
            左下: numericCell(metricCell('向左下移动占比')),
            右下: numericCell(metricCell('向右下移动占比')),
          },
          consecutiveRightCount: numericCell(metricCell('连续向右数量')),
          consecutiveDownCount: numericCell(metricCell('连续向下数量')),
          consecutiveLowerRightCount: numericCell(metricCell('连续向右下数量')),
          consecutiveOcclusionCount: numericCell(metricCell('连续遮挡计数')),
          startPosition: positionCell('起点位置（分为左上/右上/左下/右下/靠中）') || undefined,
          endPosition: positionCell('终点位置') || undefined,
        };
        pathMetricsByKey.set(pathKey, pathMetrics);
      }
      levels.push({
        id: levelId,
        boardKey,
        pathKey,
        shapeName: String(row[indexOf('棋盘形状')] ?? '').trim(),
        sourceRow,
        sourceName,
        ...structuredId,
        configId,
        difficulty: numericCell(row[indexOf('目标难度')]),
        mediumErrorCount: numericCell(row[indexOf('中推理平均错误数')]),
        pathMetrics,
        difficultyMetrics: {
          hiddenCount: numericCell(row[indexOf('实际隐藏数')]),
          hiddenRatio: numericCell(row[indexOf('实际隐藏占比 %')]),
          longestVisible: numericCell(row[indexOf('实际最长连续显示')]),
          longestHidden: numericCell(row[indexOf('实际最长连续隐藏')]),
          averageSteps: numericCell(row[indexOf('平均总步数')]),
          lowErrors: numericCell(row[indexOf('低推理平均错误数')]),
          mediumErrors: numericCell(row[indexOf('中推理平均错误数')]),
          highErrors: numericCell(row[indexOf('高推理平均错误数')]),
          averageConnectable: numericCell(row[indexOf('平均可连接数量')]),
          directConnectRatio: numericCell(row[indexOf('直接连接占比 %')]),
          averageDistanceToNextVisible: numericCell(row[indexOf('平均距离下个显示数字')]),
          averageStepScore: numericCell(row[indexOf('平均每步难度分')]),
          earlyScore: numericCell(row[indexOf('前期平均难度分')]),
          middleScore: numericCell(row[indexOf('中期平均难度分')]),
          lateScore: numericCell(row[indexOf('后期平均难度分')]),
        },
        rows: levelGrid.length,
        columns: levelGrid[0].length,
        parameterValues,
        levelData: { data: levelGrid },
      });
      seenLevelIds.add(levelId);
    } catch {
      skippedRows += 1;
    }
  };

  return {
    addRow,
    finish: () => {
      if (levels.length === 0) throw new Error('没有读取到有效的关卡JSON。');
      return { levels, parameterHeaders, skippedRows };
    },
  };
};

export const parseArrangementLibraryRows = (
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
): ArrangementLibraryParseResult => {
  if (rows.length === 0) throw new Error('跑关结果中没有数据。');
  const parser = createArrangementLibraryRowParser(rows[0]);
  rows.slice(1).forEach((row, rowIndex) => parser.addRow(row, rowIndex + 2));
  return parser.finish();
};

export const arrangementBoardFamilies = (
  levels: ReadonlyArray<ArrangementLibraryLevel>,
): ArrangementBoardFamily[] => {
  const groups = new Map<string, ArrangementLibraryLevel[]>();
  levels.forEach((level) => {
    const variants = groups.get(level.boardKey);
    if (variants) variants.push(level);
    else groups.set(level.boardKey, [level]);
  });
  return [...groups.entries()].map(([key, boardLevels]) => {
    const pathGroups = new Map<string, ArrangementLibraryLevel[]>();
    boardLevels.forEach((level) => {
      const pathLevels = pathGroups.get(level.pathKey);
      if (pathLevels) pathLevels.push(level);
      else pathGroups.set(level.pathKey, [level]);
    });
    const paths = [...pathGroups.entries()].map(([pathKey, pathLevels]): ArrangementPathFamily => {
      const difficultyGroups = new Map<number | undefined, ArrangementLibraryLevel[]>();
      pathLevels.forEach((level) => {
        const difficultyLevels = difficultyGroups.get(level.difficulty);
        if (difficultyLevels) difficultyLevels.push(level);
        else difficultyGroups.set(level.difficulty, [level]);
      });
      const difficulties = [...difficultyGroups.entries()]
        .sort(([left], [right]) => (left ?? Number.MAX_SAFE_INTEGER) - (right ?? Number.MAX_SAFE_INTEGER))
        .map(([difficulty, variants]): ArrangementDifficultyFamily => ({
          difficulty,
          representative: variants[0],
          variants: [...variants].sort((left, right) => left.sourceRow - right.sourceRow),
        }));
      const representative = pathLevels.find((level) => level.pathId !== undefined) ?? pathLevels[0];
      return { key: pathKey, representative, difficulties };
    }).sort((left, right) => (
      (left.representative.pathId ?? Number.MAX_SAFE_INTEGER)
      - (right.representative.pathId ?? Number.MAX_SAFE_INTEGER)
      || left.representative.sourceRow - right.representative.sourceRow
    ));
    const representative = boardLevels.find((level) => level.formationId !== undefined) ?? boardLevels[0];
    return { key, representative, paths };
  }).sort((left, right) => (
    (left.representative.formationId ?? Number.MAX_SAFE_INTEGER)
    - (right.representative.formationId ?? Number.MAX_SAFE_INTEGER)
    || left.representative.sourceRow - right.representative.sourceRow
  ));
};

export const readArrangementLibraryFile = async (
  file: File,
  onProgress?: (message: string) => void,
): Promise<ArrangementLibraryParseResult> => {
  if (typeof Worker === 'undefined') {
    const { readSheet } = await import('read-excel-file/browser');
    return parseArrangementLibraryRows(await readSheet(file));
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./arrangementLibrary.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{
      type: 'progress' | 'complete' | 'error';
      message?: string;
      result?: ArrangementLibraryParseResult;
    }>) => {
      if (event.data.type === 'progress') {
        if (event.data.message) onProgress?.(event.data.message);
        return;
      }
      worker.terminate();
      if (event.data.type === 'complete' && event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.message ?? '读取关卡库失败。'));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || '关卡库读取线程异常退出，文件可能过大。'));
    };
    void file.arrayBuffer().then((buffer) => {
      worker.postMessage({ buffer }, [buffer]);
    }, (error) => {
      worker.terminate();
      reject(error);
    });
  });
};

export const addArrangementLevels = (
  groups: ReadonlyArray<ArrangementLevelGroup>,
  targetGroupId: number,
  levelIds: ReadonlyArray<string>,
): ArrangementLevelGroup[] => {
  const used = new Set(groups.flatMap((group) => group.levelIds));
  const additions = levelIds.filter((levelId, index) => !used.has(levelId) && levelIds.indexOf(levelId) === index);
  return groups.map((group) => group.id === targetGroupId
    ? { ...group, levelIds: [...group.levelIds, ...additions] }
    : { ...group, levelIds: [...group.levelIds] });
};

export const removeArrangementLevel = (
  groups: ReadonlyArray<ArrangementLevelGroup>,
  targetGroupId: number,
  levelId: string,
): ArrangementLevelGroup[] => groups.map((group) => ({
  ...group,
  levelIds: group.id === targetGroupId
    ? group.levelIds.filter((candidate) => candidate !== levelId)
    : [...group.levelIds],
}));

export const arrangementRows = (
  groups: ReadonlyArray<ArrangementLevelGroup>,
): Array<[number, string]> => groups.map((group) => [group.id, `[${group.levelIds.join(',')}]`]);

export const parseArrangementClipboardText = (text: string): ArrangementLevelGroup[] => {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error('剪贴板中没有排布数据。');
  const dataLines = /^id\s+"?levelName"?$/i.test(lines[0]) ? lines.slice(1) : lines;
  if (dataLines.length === 0) throw new Error('剪贴板中只有表头，没有排布数据。');
  const groupIds = new Set<number>();
  const usedLevelIds = new Set<string>();
  return dataLines.map((line, index) => {
    const match = /^(\d+)\s+(?:"\[([^\]]*)\]"|\[([^\]]*)\])$/.exec(line);
    if (!match) throw new Error(`排布第 ${index + 1} 行格式错误，应为“关卡ID [关卡列表]”。`);
    const id = Number(match[1]);
    if (!Number.isInteger(id) || id < 1) throw new Error(`排布第 ${index + 1} 行的关卡ID无效。`);
    if (groupIds.has(id)) throw new Error(`排布中的关卡ID ${id} 重复。`);
    groupIds.add(id);
    const levelIds = (match[2] ?? match[3] ?? '')
      .split(',').map((value) => value.trim()).filter(Boolean);
    if (levelIds.length === 0) throw new Error(`排布第 ${index + 1} 行没有棋盘关卡。`);
    levelIds.forEach((levelId) => {
      if (usedLevelIds.has(levelId)) throw new Error(`排布中的棋盘关卡 ${levelId} 重复。`);
      usedLevelIds.add(levelId);
    });
    return { id, levelIds };
  });
};

export const arrangementLevelDataJson = (
  groups: ReadonlyArray<ArrangementLevelGroup>,
  library: ReadonlyArray<ArrangementLibraryLevel>,
): string => {
  const libraryById = new Map(library.map((level) => [level.id, level]));
  const usedLevelIds = new Set(groups.flatMap((group) => group.levelIds));
  const usedPathKeys = new Set([...usedLevelIds].flatMap((levelId) => {
    const level = libraryById.get(levelId);
    if (!level) return [];
    return [level.formationId !== undefined && level.pathId !== undefined
      ? `id:${level.formationId}:${level.pathId}`
      : `path:${level.pathKey}`];
  }));
  const selected = library.filter((level) => {
    if (usedLevelIds.has(level.id)) return true;
    if (level.difficultyId === undefined || level.difficultyId < 1 || level.difficultyId > 10) return false;
    const pathKey = level.formationId !== undefined && level.pathId !== undefined
      ? `id:${level.formationId}:${level.pathId}`
      : `path:${level.pathKey}`;
    return usedPathKeys.has(pathKey);
  }).sort((left, right) => (
    (left.formationId ?? Number.MAX_SAFE_INTEGER) - (right.formationId ?? Number.MAX_SAFE_INTEGER)
    || (left.pathId ?? Number.MAX_SAFE_INTEGER) - (right.pathId ?? Number.MAX_SAFE_INTEGER)
    || (left.difficultyId ?? Number.MAX_SAFE_INTEGER) - (right.difficultyId ?? Number.MAX_SAFE_INTEGER)
    || left.sourceRow - right.sourceRow
  ));
  return JSON.stringify(Object.fromEntries(selected.map((level) => [
    level.id,
    level.levelData,
  ])));
};

export const combinedArrangementLevelDataJson = (
  configurations: ReadonlyArray<ReadonlyArray<ArrangementLevelGroup>>,
  library: ReadonlyArray<ArrangementLibraryLevel>,
): string => arrangementLevelDataJson(configurations.flatMap((groups) => groups), library);
