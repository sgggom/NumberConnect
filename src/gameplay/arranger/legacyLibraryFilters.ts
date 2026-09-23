import { ARRANGEMENT_PATH_PARAMETER_HEADERS, ARRANGEMENT_DIFFICULTY_PARAMETER_HEADERS, type ArrangementLibraryIndex, type ArrangementLibraryLevel } from './levelArrangement';
import { METRIC_COLUMNS } from './configurationBatchMetrics';

export function legacyLibraryFilterHeaders(parameters: readonly string[]): string[] {
  return [...new Set([...parameters, '关卡JSON', '路径JSON', ...ARRANGEMENT_PATH_PARAMETER_HEADERS,
    '连续向下数量', ...ARRANGEMENT_DIFFICULTY_PARAMETER_HEADERS,
    'id', '难度', '模拟次数', '通关次数', ...METRIC_COLUMNS.map(([, title]) => title), '状态'])];
}
export function legacyLibraryFilterValues(headers: readonly string[], parameters: readonly string[],
  level: ArrangementLibraryIndex, detail: Pick<ArrangementLibraryLevel, 'parameterValues' | 'levelData'>): string[] {
  const p = level.pathMetrics, d = level.difficultyMetrics, sim = level.importedSimulation;
  const values: Record<string, unknown> = {
    '关卡名': level.sourceName, '配置ID': level.configId, '棋盘形状': level.shapeName,
    '行数': level.rows, '列数': level.columns, '关卡JSON': JSON.stringify(detail.levelData),
    '实际路径交叉数量': p.crossings, '直角拐弯占比': p.rightAngleRatio, '锐角拐弯占比': p.acuteAngleRatio, '钝角拐弯占比': p.obtuseAngleRatio,
    '平均路径长度（拐弯的拐点算作端点，看整个棋盘中的线段平均长度）': p.averageSegmentLength,
    '连续向右数量': p.consecutiveRightCount, '连续向右下数量': p.consecutiveLowerRightCount, '连续遮挡计数': p.consecutiveOcclusionCount,
    '起点位置（分为左上/右上/左下/右下/靠中）': p.startPosition, '终点位置': p.endPosition,
    '目标难度': level.difficulty, '向右/右下隐藏数字周围更大隐藏数字数量': d.laterHiddenNeighborCount,
    '向右空位数量': d.rightEmptyCount, '向右下空位数量': d.lowerRightEmptyCount,
    '实际隐藏数': d.hiddenCount, '实际隐藏占比 %': d.hiddenRatio, '实际最长连续显示': d.longestVisible, '实际最长连续隐藏': d.longestHidden,
    '平均总步数': d.averageSteps, '低推理平均错误数': d.lowErrors, '中推理平均错误数': d.mediumErrors, '高推理平均错误数': d.highErrors,
    '平均可连接数量': d.averageConnectable, '直接连接占比 %': d.directConnectRatio, '平均距离下个显示数字': d.averageDistanceToNextVisible,
    '平均每步难度分': d.averageStepScore, '前期平均难度分': d.earlyScore, '中期平均难度分': d.middleScore, '后期平均难度分': d.lateScore,
    'id': level.sourceName, '难度': level.difficultyId ?? level.difficulty,
    '模拟次数': sim?.repetitions, '通关次数': sim?.completedRuns, '状态': sim?.status,
  };
  Object.entries(p.directionRatios).forEach(([direction, ratio]) => { values[`向${direction}移动占比`] = ratio; });
  METRIC_COLUMNS.forEach(([key, title]) => { values[title] = sim?.metrics[key]; });
  // Original generic columns take priority where available; missing fields stay missing.
  parameters.forEach((header, i) => { if (detail.parameterValues[i] !== undefined) values[header] = detail.parameterValues[i]; });
  return headers.map((header) => String(values[header] ?? ''));
}
