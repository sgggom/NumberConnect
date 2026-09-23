import type { ArrangementLibraryIndex } from './levelArrangement';
export type LibraryFilterOperator = 'contains' | 'eq' | 'gte' | 'lte' | 'empty' | 'notEmpty';
export interface LibraryFilterRule { column: number; operator: LibraryFilterOperator; value: string }
export function matchesLibraryFilters(values: readonly string[], rules: readonly LibraryFilterRule[]): boolean {
  return rules.every(({ column, operator, value }) => {
    const actual = String(values[column] ?? '').trim(), expected = value.trim();
    if (operator === 'empty') return actual === '';
    if (operator === 'notEmpty') return actual !== '';
    if (operator === 'contains') return actual.toLowerCase().includes(expected.toLowerCase());
    if (operator === 'eq') return actual.toLowerCase() === expected.toLowerCase()
      || actual !== '' && expected !== '' && Number.isFinite(Number(actual)) && Number.isFinite(Number(expected)) && Number(actual) === Number(expected);
    if (!actual || !expected || !Number.isFinite(Number(actual)) || !Number.isFinite(Number(expected))) return false;
    return operator === 'gte' ? Number(actual) >= Number(expected) : Number(actual) <= Number(expected);
  });
}

/** Compare the full path before applying row-level filters. */
export function increasingErrorTrendLevelIds(levels: readonly ArrangementLibraryIndex[]): Set<string> {
  const paths = new Map<string, ArrangementLibraryIndex[]>();
  for (const level of levels) {
    const key = level.formationId !== undefined && level.pathId !== undefined
      ? JSON.stringify(['id', level.formationId, level.pathId]) : JSON.stringify(['path', level.boardKey, level.pathKey]);
    const group = paths.get(key) ?? []; group.push(level); paths.set(key, group);
  }
  const accepted = new Set<string>();
  for (const path of paths.values()) {
    const byDifficulty = new Map<number, { min: number; max: number }>();
    let valid = true;
    for (const level of path) {
      const difficulty = level.difficultyId ?? level.difficulty;
      if (difficulty !== 1 && difficulty !== 5 && difficulty !== 10) continue;
      const errors = level.importedSimulation?.metrics.errors;
      if (difficulty === undefined || !Number.isFinite(difficulty) || errors === undefined || !Number.isFinite(errors) || errors < 0) {
        valid = false; break;
      }
      const range = byDifficulty.get(difficulty);
      byDifficulty.set(difficulty, { min: Math.min(range?.min ?? errors, errors), max: Math.max(range?.max ?? errors, errors) });
    }
    if (!valid || byDifficulty.size !== 3) continue;
    const first = byDifficulty.get(1)!, middle = byDifficulty.get(5)!, last = byDifficulty.get(10)!;
    // Every selected difficulty must increase; all other difficulties are retained but ignored.
    if (middle.min <= first.max || last.min <= middle.max) continue;
    path.forEach((level) => accepted.add(level.id));
  }
  return accepted;
}
