import { describe, expect, it } from 'vitest';
import {
  addArrangementLevels,
  arrangementBoardFamilies,
  arrangementRows,
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
      level: { rows: 2, columns: 2 },
    });
    expect(result.levels[0].level.hiddenCells).toEqual([{ x: 1, y: 0 }]);
    expect(result.levels[0].parameters).toContainEqual({ label: '实际路径交叉数量', value: '3' });
    expect(result.levels[0].parameters.some(({ label }) => label.endsWith('JSON'))).toBe(false);
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

    expect(result.levels[0].level).toMatchObject({ columns: 2, rows: 3 });
    expect(result.levels[0].pathMetrics).toMatchObject({
      directionRatios: { 上: 0.2, 左: 0.1 },
      consecutiveRightCount: 5,
      consecutiveDownCount: 4,
      consecutiveLowerRightCount: 6,
      consecutiveOcclusionCount: 7,
      startPosition: '左下',
      endPosition: '右上',
    });
    expect(result.levels[0].parameters).toEqual(expect.arrayContaining([
      { label: '行数', value: '3' },
      { label: '列数', value: '2' },
      { label: '连续向右数量', value: '5' },
      { label: '连续向下数量', value: '4' },
      { label: '连续向右下数量', value: '6' },
      { label: '连续遮挡计数', value: '7' },
    ]));
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
});
