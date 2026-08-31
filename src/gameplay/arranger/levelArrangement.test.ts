import { describe, expect, it } from 'vitest';
import {
  addArrangementLevels,
  arrangementBoardFamilies,
  arrangementLevelDataJson,
  arrangementRows,
  combinedArrangementLevelDataJson,
  findArrangementLevelLocation,
  parseArrangementClipboardText,
  parseArrangementLibraryRows,
  removeArrangementLevel,
} from './levelArrangement';

const headers = [
  '关卡名', '配置ID', '配置表行号', '配置内隐藏序号', '关卡JSON', '路径JSON', '棋盘形状', '目标难度', '中推理平均错误数',
  '实际路径交叉数量', '直角拐弯占比', '实际隐藏数', '低推理平均错误数',
];
const levelJson = JSON.stringify({ data: [[1, -2], [4, 3]] });
const pathJson = JSON.stringify({ data: [[1, 2], [4, 3]] });

describe('level arrangement data', () => {
  it('reads the batch playtest result format into a sequential level library', () => {
    const result = parseArrangementLibraryRows([
      headers,
      ['level_55_10_1', 'path_2_2', 2, 1, levelJson, pathJson, '正方形', 6, 1.25, 3, 0.25, 6, 1.5],
      ['level_55_10_2', 'path_2_2', 2, 2, levelJson, pathJson, '正方形', 6, 2.5],
    ]);

    expect(result.skippedRows).toBe(0);
    expect(result.levels.map(({ id }) => id)).toEqual(['level_55_10_1', 'level_55_10_2']);
    expect(result.levels[0]).toMatchObject({
      sourceRow: 2,
      sourceName: 'level_55_10_1',
      formationId: 55,
      pathId: 10,
      difficultyId: 1,
      configId: 'path_2_2',
      boardKey: '[[1,1],[1,1]]',
      pathKey: '[[1,2],[4,3]]',
      shapeName: '正方形',
      difficulty: 6,
      mediumErrorCount: 1.25,
      pathMetrics: { crossings: 3, rightAngleRatio: 0.25 },
      difficultyMetrics: { hiddenCount: 6, lowErrors: 1.5, mediumErrors: 1.25 },
      rows: 2,
      columns: 2,
    });
    expect(result.levels[0].levelData.data).toEqual([[1, -2], [4, 3]]);
    expect(result.parameterHeaders.some((label) => label.endsWith('JSON'))).toBe(false);
  });

  it('requires the two source columns and skips invalid data rows', () => {
    expect(() => parseArrangementLibraryRows([['关卡名']])).toThrow('关卡JSON');
    const result = parseArrangementLibraryRows([
      headers,
      ['bad', 'bad', 2, 1, '{', pathJson, '正方形', 6, 0],
      ['good', 'good', 2, 2, levelJson, pathJson, '正方形', 6, 0],
    ]);
    expect(result.skippedRows).toBe(1);
    expect(result.levels[0].id).toBe('good');
  });

  it('keeps repeated level names as distinct hidden variants', () => {
    const result = parseArrangementLibraryRows([
      headers,
      ['path_4_4_1', 'path_4_4', 2, 1, levelJson, pathJson, '正方形', 1, 0],
      ['path_4_4_1', 'path_4_4', 2, 2, levelJson, pathJson, '正方形', 1, 0],
    ]);

    expect(result.skippedRows).toBe(0);
    expect(result.levels.map(({ id }) => id)).toEqual([
      'path_4_4_1',
      'path_4_4_1__row_2__hidden_2',
    ]);
  });

  it('restores width-height order encoded in rectangular configuration ids', () => {
    const rectangleHeaders = [
      ...headers,
      '行数', '列数', '向上移动占比', '向左移动占比',
      '连续向右数量', '连续向下数量', '连续向右下数量', '连续遮挡计数',
      '起点位置（分为左上/右上/左下/右下/靠中）', '终点位置',
    ];
    const rectangleLevel = JSON.stringify({ data: [[1, -2, 3], [6, 5, 4]] });
    const rectanglePath = JSON.stringify({ data: [[1, 2, 3], [6, 5, 4]] });
    const result = parseArrangementLibraryRows([
      rectangleHeaders,
      [
        'path_2_3_5', 'path_2_3', 2, 1, rectangleLevel, rectanglePath, '长方形', 5, 1,
        0, 0.2, 1, 0,
        2, 3, 0.1, 0.2, 4, 5, 6, 7, '右上', '左下',
      ],
    ]);

    expect(result.levels[0]).toMatchObject({ columns: 2, rows: 3 });
    expect(result.levels[0].pathMetrics).toMatchObject({
      directionRatios: { 上: 0.2, 左: 0.1 },
      consecutiveRightCount: 5,
      consecutiveDownCount: 4,
      consecutiveLowerRightCount: 6,
      consecutiveOcclusionCount: 7,
      startPosition: '左下',
      endPosition: '右上',
    });
    const parameters = Object.fromEntries(result.parameterHeaders.map((header, index) => (
      [header, result.levels[0].parameterValues[index]]
    )));
    expect(parameters).toMatchObject({ 行数: '3', 列数: '2' });
  });

  it.each([
    ['level_44', 4, 4],
    ['level_45', 4, 5],
    ['level_46', 4, 6],
    ['level_54', 5, 4],
    ['level_55', 5, 5],
    ['level_56', 5, 6],
    ['level_57', 5, 7],
    ['level_58', 5, 8],
    ['level_66', 6, 6],
    ['level_67', 6, 7],
    ['level_68', 6, 8],
    ['level_69', 6, 9],
    ['level_77', 7, 7],
    ['level_78', 7, 8],
    ['level_79', 7, 9],
    ['level_710', 7, 10],
    ['level_88', 8, 8],
    ['level_89', 8, 9],
    ['level_810', 8, 10],
    ['level_811', 8, 11],
    ['level_812', 8, 12],
  ] as const)('supports the compact rectangular size id %s', (configId, width, height) => {
    let value = 1;
    const path = Array.from({ length: width }, (_, row) => {
      const values = Array.from({ length: height }, () => value++);
      return row % 2 === 0 ? values : values.reverse();
    });
    const json = JSON.stringify({ data: path });
    const result = parseArrangementLibraryRows([
      headers,
      [`${configId}_1_1`, `${configId}_1`, 2, 1, json, json, '长方形', 1, 0],
    ]);

    expect(result.levels[0]).toMatchObject({ columns: width, rows: height });
    expect(JSON.parse(result.levels[0].boardKey)).toHaveLength(height);
    expect(JSON.parse(result.levels[0].boardKey)[0]).toHaveLength(width);
  });

  it('keeps a structured level as the board and path representative when guide levels come first', () => {
    const result = parseArrangementLibraryRows([
      headers,
      ['guide_45_1', 'guide_45_1', 2, 1, levelJson, pathJson, '长方形', 1, 0],
      ['level_45_12_5', 'level_45_12', 3, 1, levelJson, pathJson, '长方形', 5, 0],
    ]);

    const families = arrangementBoardFamilies(result.levels);
    expect(families).toHaveLength(1);
    expect(families[0].representative).toMatchObject({ id: 'level_45_12_5', formationId: 45 });
    expect(families[0].paths[0].representative).toMatchObject({ id: 'level_45_12_5', pathId: 12 });
  });

  it('groups levels by board, then path, then difficulty', () => {
    const secondPathJson = JSON.stringify({ data: [[1, 4], [2, 3]] });
    const boardWithGapJson = JSON.stringify({ data: [[1, 0], [2, 3]] });
    const result = parseArrangementLibraryRows([
      headers,
      ['board_1', 'same-config', 7, 1, levelJson, pathJson, '正方形', 1, 0],
      ['board_5_a', 'same-config', 7, 2, levelJson, pathJson, '正方形', 5, 1],
      ['board_5_b', 'same-config', 7, 3, levelJson, pathJson, '正方形', 5, 2],
      ['second_path', 'other-path', 8, 1, levelJson, secondPathJson, '正方形', 5, 0],
      ['other_board', 'other-board', 9, 1, levelJson, boardWithGapJson, '自定义', 5, 0],
    ]);

    const families = arrangementBoardFamilies(result.levels);
    expect(families).toHaveLength(2);
    expect(families[0].paths).toHaveLength(2);
    expect(families[0].paths[0].difficulties.map(({ difficulty }) => difficulty)).toEqual([1, 5]);
    expect(families[0].paths[0].difficulties[1].variants.map(({ id }) => id)).toEqual(['board_5_a', 'board_5_b']);
    expect(families[1].representative).toMatchObject({ id: 'other_board', shapeName: '自定义' });
  });

  it('locates an arranged level in its board, path, and difficulty hierarchy', () => {
    const secondPathJson = JSON.stringify({ data: [[1, 4], [2, 3]] });
    const result = parseArrangementLibraryRows([
      headers,
      ['level_44_9_3', 'same', 2, 1, levelJson, pathJson, '正方形', 3, 0],
      ['level_44_10_5', 'other-path', 3, 1, levelJson, secondPathJson, '正方形', 5, 0],
    ]);
    const families = arrangementBoardFamilies(result.levels);

    expect(findArrangementLevelLocation(families, 'level_44_10_5')).toEqual({
      boardIndex: 0,
      pathIndex: 1,
      difficultyIndex: 0,
    });
    expect(findArrangementLevelLocation(families, 'missing')).toBeUndefined();
  });

  it('sorts formation and path columns by numeric ids', () => {
    const secondPathJson = JSON.stringify({ data: [[1, 4], [2, 3]] });
    const otherBoardJson = JSON.stringify({ data: [[1, 0], [2, 3]] });
    const result = parseArrangementLibraryRows([
      headers,
      ['level_10_10_1', 'same', 2, 1, levelJson, pathJson, '正方形', 1, 0],
      ['level_9_10_1', 'other', 3, 1, otherBoardJson, otherBoardJson, '自定义', 1, 0],
      ['level_10_9_1', 'same', 4, 1, levelJson, secondPathJson, '正方形', 1, 0],
    ]);

    const families = arrangementBoardFamilies(result.levels);
    expect(families.map(({ representative }) => representative.formationId)).toEqual([9, 10]);
    expect(families[1].paths.map(({ representative }) => representative.pathId)).toEqual([9, 10]);
  });

  it('adds each board only once and exports the requested id/levelName rows', () => {
    let groups = [
      { id: 1, levelIds: [] as string[] },
      { id: 2, levelIds: ['level_3'] },
    ];
    groups = addArrangementLevels(groups, 1, ['level_1', 'level_2', 'level_1', 'level_3']);
    expect(groups[0].levelIds).toEqual(['level_1', 'level_2']);
    expect(arrangementRows(groups)).toEqual([
      [1, '[level_1,level_2]'],
      [2, '[level_3]'],
    ]);
    expect(removeArrangementLevel(groups, 1, 'level_1')[0].levelIds).toEqual(['level_2']);
  });

  it('reads copied id and levelName arrangement rows from the clipboard', () => {
    expect(parseArrangementClipboardText([
      'id\tlevelName',
      '1\t[level_56_44_3,level_67_8_5]',
      '2\t[level_68_10_6]',
    ].join('\r\n'))).toEqual([
      { id: 1, levelIds: ['level_56_44_3', 'level_67_8_5'] },
      { id: 2, levelIds: ['level_68_10_6'] },
    ]);
    expect(parseArrangementClipboardText([
      'id\t"levelName"',
      '1\t"[level_56_44_3,level_67_8_5]"',
      '2\t[level_68_10_6]',
    ].join('\r\n'))).toEqual([
      { id: 1, levelIds: ['level_56_44_3', 'level_67_8_5'] },
      { id: 2, levelIds: ['level_68_10_6'] },
    ]);
    expect(() => parseArrangementClipboardText('1\t[level_1]\n2\t[level_1]')).toThrow('重复');
  });

  it('keeps every arranged level and adds dynamic difficulties 1 to 10 for each used path', () => {
    const otherPathJson = JSON.stringify({ data: [[1, 4], [2, 3]] });
    const result = parseArrangementLibraryRows([
      headers,
      ['level_56_44_1', 'same', 2, 1, levelJson, pathJson, '正方形', 1, 0],
      ['level_56_44_3', 'same', 3, 1, levelJson, pathJson, '正方形', 3, 0],
      ['level_56_44_10', 'same', 4, 1, levelJson, pathJson, '正方形', 10, 0],
      ['level_56_44_11', 'same', 5, 1, levelJson, pathJson, '正方形', 11, 0],
      ['level_56_45_1', 'other', 6, 1, levelJson, otherPathJson, '正方形', 1, 0],
    ]);
    const exported = JSON.parse(arrangementLevelDataJson([
      { id: 1, levelIds: ['level_56_44_11'] },
    ], result.levels));
    expect(Object.keys(exported)).toEqual([
      'level_56_44_1',
      'level_56_44_3',
      'level_56_44_10',
      'level_56_44_11',
    ]);
    expect(exported.level_56_44_1).toEqual(JSON.parse(levelJson));
  });

  it('exports one level library containing levels used by all three configurations', () => {
    const secondPathJson = JSON.stringify({ data: [[1, 4], [2, 3]] });
    const thirdPathJson = JSON.stringify({ data: [[3, 4], [2, 1]] });
    const result = parseArrangementLibraryRows([
      headers,
      ['level_44_1_1', 'main', 2, 1, levelJson, pathJson, '正方形', 1, 0],
      ['level_44_2_1', 'daily', 3, 1, levelJson, secondPathJson, '正方形', 1, 0],
      ['level_44_3_1', 'bead', 4, 1, levelJson, thirdPathJson, '正方形', 1, 0],
      ['level_44_4_1', 'unused', 5, 1, levelJson, JSON.stringify({ data: [[2, 1], [3, 4]] }), '正方形', 1, 0],
    ]);
    const exported = JSON.parse(combinedArrangementLevelDataJson([
      [{ id: 1, levelIds: ['level_44_1_1'] }],
      [{ id: 1, levelIds: ['level_44_2_1'] }],
      [{ id: 1, levelIds: ['level_44_3_1'] }],
    ], result.levels));

    expect(Object.keys(exported)).toEqual(['level_44_1_1', 'level_44_2_1', 'level_44_3_1']);
  });
});
