import fs from 'node:fs/promises';
import { readSheet } from 'read-excel-file/node';

const HEADERS = [
  '连续向右数量',
  '连续向下数量',
  '连续向右下数量',
  '连续遮挡计数',
];

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error('Usage: node scripts/export-path-continuity-metrics.mjs <input.xlsx> <output.txt>');
}

const rows = await readSheet(inputPath);
const headers = (rows[0] ?? []).map((value) => String(value ?? '').trim());
const pathJsonIndex = headers.indexOf('路径JSON');
if (pathJsonIndex < 0) throw new Error('没有找到“路径JSON”列。');

let invalidRows = 0;
const outputRows = [HEADERS];
for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
  const rawPathJson = String(rows[rowIndex]?.[pathJsonIndex] ?? '').trim();
  if (!rawPathJson) {
    outputRows.push(['', '', '', '']);
    invalidRows += 1;
    continue;
  }
  try {
    outputRows.push(calculateContinuityMetrics(rawPathJson));
  } catch {
    outputRows.push(['', '', '', '']);
    invalidRows += 1;
  }
}

await fs.writeFile(
  outputPath,
  `\uFEFF${outputRows.map((row) => row.join('\t')).join('\r\n')}`,
  'utf8',
);
console.log(JSON.stringify({
  inputRows: rows.length,
  outputDataRows: outputRows.length - 1,
  invalidRows,
  outputPath,
}));

function calculateContinuityMetrics(rawPathJson) {
  const parsed = JSON.parse(rawPathJson);
  if (!Array.isArray(parsed?.data)) throw new Error('路径JSON缺少data数组');
  const cells = [];
  parsed.data.forEach((row, y) => {
    if (!Array.isArray(row)) throw new Error('路径JSON行格式错误');
    row.forEach((rawValue, x) => {
      const value = Math.abs(Number(rawValue));
      if (Number.isInteger(value) && value > 0) cells[value - 1] = { x, y };
    });
  });
  if (cells.length < 2 || cells.some((cell) => !cell)) throw new Error('路径数字不连续');

  let previousDirection = '';
  let right = 0;
  let down = 0;
  let lowerRight = 0;
  let occlusion = 0;
  for (let index = 1; index < cells.length; index += 1) {
    const deltaX = cells[index].x - cells[index - 1].x;
    const deltaY = cells[index].y - cells[index - 1].y;
    const direction = deltaX > 0 && deltaY === 0
      ? 'right'
      : deltaX === 0 && deltaY > 0
        ? 'down'
        : deltaX > 0 && deltaY > 0 ? 'lower-right' : 'other';
    if (direction === 'right' && previousDirection === 'right') right += 1;
    if (direction === 'down' && previousDirection === 'down') down += 1;
    if (direction === 'lower-right' && previousDirection === 'lower-right') lowerRight += 1;
    if (isOccluding(direction) && isOccluding(previousDirection)) occlusion += 1;
    previousDirection = direction;
  }
  return [right, down, lowerRight, occlusion];
}

function isOccluding(direction) {
  return direction === 'right' || direction === 'down' || direction === 'lower-right';
}
