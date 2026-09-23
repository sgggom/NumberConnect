import { METRIC_COLUMNS, type ConfigurationMetrics } from './configurationBatchMetrics';

export interface ImportedSimulationResult {
  metrics: Partial<ConfigurationMetrics>;
  status: string;
  repetitions?: number;
  completedRuns?: number;
}
const numeric = (value: unknown): number | undefined => {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};
export function createImportedSimulationParser(headers: readonly unknown[]) {
  const names = headers.map((header) => String(header ?? '').trim().replace(/\s+/g, '').toLowerCase());
  const column = (name: string) => names.indexOf(name.toLowerCase());
  const metrics = METRIC_COLUMNS.map(([key, title]) => ({ key, column: column(title) }));
  // Old editor-only workbooks have no simulation metric columns.
  const enabled = metrics.some((metric) => metric.column >= 0);
  const columns = new Set(enabled ? [...metrics.map((metric) => metric.column),
    ...['id', '难度', '模拟次数', '通关次数', '状态'].map(column)].filter((index) => index >= 0) : []);
  return {
    columns,
    parse(row: readonly unknown[], levelId: string, difficulty?: number): ImportedSimulationResult | undefined {
      if (!enabled) return undefined;
      const id = String(row[column('id')] ?? '').trim();
      const sourceDifficulty = numeric(row[column('难度')]);
      // Appended results must describe this row, not a differently sorted export.
      if (id && id !== levelId || sourceDifficulty !== undefined && difficulty !== undefined && sourceDifficulty !== difficulty) return undefined;
      const values: Partial<ConfigurationMetrics> = {};
      for (const metric of metrics) {
        const value = numeric(row[metric.column]);
        if (value !== undefined) values[metric.key] = value;
      }
      const status = String(row[column('状态')] ?? '').trim();
      const repetitions = numeric(row[column('模拟次数')]);
      const completedRuns = numeric(row[column('通关次数')]);
      if (!Object.keys(values).length && !status && repetitions === undefined && completedRuns === undefined) return undefined;
      return { metrics: values, status: status || '已导入模拟结果', repetitions, completedRuns };
    },
  };
}
