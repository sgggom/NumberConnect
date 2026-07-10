import { createRandom, shuffle } from './random';
import { cellKey, type Cell } from './types';

const canHide = (pathCount: number, hidden: Set<number>, index: number, maxHiddenRun: number): boolean => {
  if (index <= 0 || index >= pathCount - 1 || hidden.has(index)) return false;

  let runLength = 1;
  for (let cursor = index - 1; cursor >= 0 && hidden.has(cursor); cursor -= 1) runLength += 1;
  for (let cursor = index + 1; cursor < pathCount && hidden.has(cursor); cursor += 1) runLength += 1;
  return runLength <= maxHiddenRun;
};

const longestVisibleRun = (pathCount: number, hidden: Set<number>): { start: number; length: number } => {
  let bestStart = 0;
  let bestLength = 0;
  let currentStart = 0;
  let currentLength = 0;

  for (let index = 0; index < pathCount; index += 1) {
    if (hidden.has(index)) {
      if (currentLength > bestLength) {
        bestStart = currentStart;
        bestLength = currentLength;
      }
      currentStart = index + 1;
      currentLength = 0;
    } else {
      currentLength += 1;
    }
  }

  if (currentLength > bestLength) return { start: currentStart, length: currentLength };
  return { start: bestStart, length: bestLength };
};

export const selectHiddenCells = (
  solutionPath: Cell[],
  hiddenPercent: number,
  maxHiddenRun: number,
  maxVisibleRun: number,
  seed: number,
): Set<string> => {
  const result = new Set<string>();
  if (solutionPath.length < 3 || hiddenPercent <= 0 || maxHiddenRun <= 0) return result;

  const hidden = new Set<number>();
  const targetCount = Math.min(
    solutionPath.length - 2,
    Math.max(0, Math.round((solutionPath.length * hiddenPercent) / 100)),
  );
  const visibleLimit = Math.max(1, maxVisibleRun);
  const candidates = Array.from({ length: solutionPath.length - 2 }, (_, index) => index + 1);
  shuffle(candidates, createRandom(seed ^ 0x5f3759df));

  let guard = solutionPath.length * 2;
  while (guard > 0) {
    guard -= 1;
    const run = longestVisibleRun(solutionPath.length, hidden);
    if (run.length <= visibleLimit) break;

    let added = false;
    const preferred = run.start + visibleLimit;
    for (let offset = 0; offset < run.length && !added; offset += 1) {
      const direction = offset % 2 === 0 ? 1 : -1;
      const candidate = preferred + Math.floor(offset / 2) * direction;
      if (candidate < run.start || candidate >= run.start + run.length) continue;
      if (canHide(solutionPath.length, hidden, candidate, maxHiddenRun)) {
        hidden.add(candidate);
        added = true;
      }
    }
    if (!added) break;
  }

  for (let pass = 0; pass < 3 && hidden.size < targetCount; pass += 1) {
    for (const candidate of candidates) {
      if (hidden.size >= targetCount) break;
      if (canHide(solutionPath.length, hidden, candidate, maxHiddenRun)) hidden.add(candidate);
    }
  }

  hidden.forEach((index) => result.add(cellKey(solutionPath[index])));
  return result;
};
