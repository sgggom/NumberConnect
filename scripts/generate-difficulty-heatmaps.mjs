import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEVELS_PATH = path.join(ROOT, 'public', 'levels', 'levels.json');
const OUTPUT_DIR = path.join(ROOT, 'output', 'difficulty-heatmaps');

const OFFSETS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

const COLORS = [
  { at: 0, value: '#1d4ed8' },
  { at: 0.35, value: '#06b6d4' },
  { at: 0.6, value: '#facc15' },
  { at: 0.8, value: '#f97316' },
  { at: 1, value: '#dc2626' },
];

const keyOf = ({ x, y }) => `${x},${y}`;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const hexToRgb = (hex) => ({
  r: Number.parseInt(hex.slice(1, 3), 16),
  g: Number.parseInt(hex.slice(3, 5), 16),
  b: Number.parseInt(hex.slice(5, 7), 16),
});

const rgbToHex = ({ r, g, b }) => `#${[r, g, b]
  .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
  .join('')}`;

const heatColor = (rawValue) => {
  const value = clamp01(rawValue);
  const rightIndex = COLORS.findIndex((stop) => stop.at >= value);
  if (rightIndex <= 0) return COLORS[0].value;
  const left = COLORS[rightIndex - 1];
  const right = COLORS[rightIndex];
  const progress = (value - left.at) / (right.at - left.at);
  const leftRgb = hexToRgb(left.value);
  const rightRgb = hexToRgb(right.value);
  return rgbToHex({
    r: leftRgb.r + (rightRgb.r - leftRgb.r) * progress,
    g: leftRgb.g + (rightRgb.g - leftRgb.g) * progress,
    b: leftRgb.b + (rightRgb.b - leftRgb.b) * progress,
  });
};

const readableTextColor = (hex) => {
  const { r, g, b } = hexToRgb(hex);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 150 ? '#172033' : '#ffffff';
};

const directionName = ([dx, dy]) => ({
  '0,-1': '向上',
  '0,1': '向下',
  '-1,0': '向左',
  '1,0': '向右',
  '-1,-1': '左上',
  '1,-1': '右上',
  '-1,1': '左下',
  '1,1': '右下',
}[`${dx},${dy}`] ?? `${dx},${dy}`);

const properCrossings = (solutionPath) => {
  const cross = (a, b, c) => (
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  );
  const crossings = [];

  for (let first = 0; first < solutionPath.length - 1; first += 1) {
    for (let second = first + 2; second < solutionPath.length - 1; second += 1) {
      const a = solutionPath[first];
      const b = solutionPath[first + 1];
      const c = solutionPath[second];
      const d = solutionPath[second + 1];
      if ([keyOf(a), keyOf(b)].some((key) => key === keyOf(c) || key === keyOf(d))) continue;

      const abC = cross(a, b, c);
      const abD = cross(a, b, d);
      const cdA = cross(c, d, a);
      const cdB = cross(c, d, b);
      if (abC * abD >= 0 || cdA * cdB >= 0) continue;

      const denominator = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
      const x = (
        (a.x * b.y - a.y * b.x) * (c.x - d.x)
        - (a.x - b.x) * (c.x * d.y - c.y * d.x)
      ) / denominator;
      const y = (
        (a.x * b.y - a.y * b.x) * (c.y - d.y)
        - (a.y - b.y) * (c.x * d.y - c.y * d.x)
      ) / denominator;
      crossings.push({
        segments: [`${first + 1}-${first + 2}`, `${second + 1}-${second + 2}`],
        point: { x, y },
      });
    }
  }

  return crossings;
};

const analyzeLevel = (level) => {
  const solutionPath = level.solutionPath;
  const nodeCount = solutionPath.length;
  const active = new Set(level.activeCells.map(keyOf));
  const order = new Map(solutionPath.map((cell, index) => [keyOf(cell), index + 1]));
  const directions = solutionPath.slice(1).map((cell, index) => [
    cell.x - solutionPath[index].x,
    cell.y - solutionPath[index].y,
  ]);

  const turnIndicators = solutionPath.map((_, index) => {
    if (index === 0 || index === solutionPath.length - 1) return 0;
    const before = directions[index - 1];
    const after = directions[index];
    return before[0] === after[0] && before[1] === after[1] ? 0 : 1;
  });
  const turnCount = turnIndicators.reduce((sum, value) => sum + value, 0);
  const turnRate = turnCount / Math.max(1, directions.length - 1);

  const directionCounts = new Map();
  directions.forEach((direction) => {
    const key = direction.join(',');
    directionCounts.set(key, (directionCounts.get(key) ?? 0) + 1);
  });
  let directionEntropy = 0;
  directionCounts.forEach((count) => {
    const probability = count / directions.length;
    directionEntropy -= probability * Math.log2(probability);
  });
  const normalizedDirectionEntropy = directionEntropy / 3;

  const straightRuns = [];
  let runStart = 0;
  for (let index = 1; index <= directions.length; index += 1) {
    const changed = index === directions.length
      || directions[index][0] !== directions[runStart][0]
      || directions[index][1] !== directions[runStart][1];
    if (!changed) continue;
    straightRuns.push({
      from: runStart + 1,
      to: index + 1,
      edges: index - runStart,
      direction: directionName(directions[runStart]),
      start: solutionPath[runStart],
      end: solutionPath[index],
    });
    runStart = index;
  }
  const longestStraight = Math.max(...straightRuns.map((run) => run.edges));
  const straightRelief = Math.min(longestStraight / 5, 1);
  const zigzag = (
    0.6 * turnRate
    + 0.25 * normalizedDirectionEntropy
    + 0.15 * (1 - straightRelief)
  );

  const decisions = solutionPath.map((cell, index) => {
    if (index >= solutionPath.length - 1) {
      return { number: index + 1, wrongChoices: [], score: 0 };
    }
    const wrongChoices = [];
    OFFSETS.forEach(([dx, dy]) => {
      const candidate = order.get(`${cell.x + dx},${cell.y + dy}`);
      if (candidate !== undefined && candidate > index + 2) wrongChoices.push(candidate);
    });
    wrongChoices.sort((left, right) => left - right);
    return {
      number: index + 1,
      wrongChoices,
      score: Math.min(wrongChoices.length / 3, 1),
    };
  });
  const ambiguity = decisions.reduce((sum, decision) => sum + decision.score, 0)
    / Math.max(1, decisions.length - 1);

  const gapThreshold = Math.max(4, nodeCount / 4);
  const localUnrelated = level.activeCells.map((cell) => {
    const currentNumber = order.get(keyOf(cell));
    let degree = 0;
    let weightedGap = 0;
    const unrelatedNumbers = [];
    OFFSETS.forEach(([dx, dy]) => {
      const candidate = order.get(`${cell.x + dx},${cell.y + dy}`);
      if (candidate === undefined) return;
      degree += 1;
      const gap = Math.abs(currentNumber - candidate);
      if (gap <= 1) return;
      weightedGap += Math.min((gap - 1) / gapThreshold, 1);
      unrelatedNumbers.push(candidate);
    });
    unrelatedNumbers.sort((left, right) => left - right);
    return {
      number: currentNumber,
      unrelatedNumbers,
      score: degree === 0 ? 0 : weightedGap / degree,
    };
  });
  const unrelatedByNumber = new Map(localUnrelated.map((item) => [item.number, item]));
  const unrelated = localUnrelated.reduce((sum, item) => sum + item.score, 0)
    / localUnrelated.length;

  const crossings = properCrossings(solutionPath);
  const crossing = Math.min(crossings.length / 3, 1);
  const globalScore = 100 * (
    0.45 * ambiguity
    + 0.25 * zigzag
    + 0.2 * unrelated
    + 0.1 * crossing
  );

  const cells = solutionPath.map((cell, index) => {
    const number = index + 1;
    const decision = decisions[index];
    const unrelatedItem = unrelatedByNumber.get(number);
    const heat = clamp01(
      0.5 * decision.score
      + 0.3 * unrelatedItem.score
      + 0.2 * turnIndicators[index]
    );
    return {
      ...cell,
      number,
      heat,
      decisionScore: decision.score,
      wrongChoices: decision.wrongChoices,
      unrelatedScore: unrelatedItem.score,
      unrelatedNumbers: unrelatedItem.unrelatedNumbers,
      isTurn: turnIndicators[index] === 1,
    };
  });

  return {
    levelId: level.levelId,
    rows: level.rows,
    columns: level.columns,
    nodeCount,
    globalScore,
    ambiguity,
    zigzag,
    unrelated,
    crossings,
    turnCount,
    turnRate,
    normalizedDirectionEntropy,
    straightRuns,
    longestStraight,
    active,
    cells,
  };
};

const renderHeatmapSvg = (analysis) => {
  const pitch = 72;
  const radius = 27;
  const boardTop = 154;
  const boardWidth = analysis.columns * pitch;
  const boardHeight = analysis.rows * pitch;
  const width = Math.max(760, boardWidth + 96);
  const boardLeft = (width - boardWidth) / 2;
  const height = boardHeight + boardTop + 76;
  const position = ({ x, y }) => ({
    x: boardLeft + x * pitch + pitch / 2,
    y: boardTop + y * pitch + pitch / 2,
  });
  const longestRuns = analysis.straightRuns
    .filter((run) => run.edges === analysis.longestStraight)
    .map((run) => `${run.from}→${run.to} ${run.direction}`)
    .join('；');

  const grid = [];
  for (let y = 0; y < analysis.rows; y += 1) {
    for (let x = 0; x < analysis.columns; x += 1) {
      grid.push(`<rect x="${boardLeft + x * pitch + 7}" y="${boardTop + y * pitch + 7}" width="${pitch - 14}" height="${pitch - 14}" rx="15" fill="#1f2937" fill-opacity="${analysis.active.has(`${x},${y}`) ? 0.34 : 0.13}" stroke="#64748b" stroke-opacity="0.18"/>`);
    }
  }

  const pathPoints = analysis.cells
    .map((cell) => {
      const point = position(cell);
      return `${point.x},${point.y}`;
    })
    .join(' ');

  const cells = analysis.cells.map((cell) => {
    const point = position(cell);
    const color = heatColor(cell.heat);
    const textColor = readableTextColor(color);
    const ring = cell.number === 1
      ? '<circle r="31" fill="none" stroke="#86efac" stroke-width="4"/>'
      : cell.number === analysis.nodeCount
        ? '<circle r="31" fill="none" stroke="#f0abfc" stroke-width="4"/>'
        : '';
    const turnMark = cell.isTurn
      ? `<circle cx="${radius - 6}" cy="${-radius + 7}" r="5" fill="#ffffff" fill-opacity="0.9"/>`
      : '';
    const tooltip = [
      `数字 ${cell.number}`,
      `局部难度 ${Math.round(cell.heat * 100)}`,
      `潜在误选 ${cell.wrongChoices.length}: ${cell.wrongChoices.join(', ') || '无'}`,
      `无关邻居: ${cell.unrelatedNumbers.join(', ') || '无'}`,
      cell.isTurn ? '路径转向点' : '非转向点',
    ].join(' | ');
    return `
      <g transform="translate(${point.x} ${point.y})">
        <title>${escapeXml(tooltip)}</title>
        <circle r="${radius + 5}" fill="#020617" fill-opacity="0.46"/>
        <circle r="${radius}" fill="${color}" stroke="#ffffff" stroke-opacity="0.72" stroke-width="2"/>
        ${ring}
        ${turnMark}
        <text y="-2" text-anchor="middle" dominant-baseline="middle" font-size="18" font-weight="800" fill="${textColor}">${cell.number}</text>
        <text y="15" text-anchor="middle" dominant-baseline="middle" font-size="10" font-weight="700" fill="${textColor}" fill-opacity="0.86">${Math.round(cell.heat * 100)}</text>
      </g>`;
  }).join('');

  const crossingMarks = analysis.crossings.map((crossing) => {
    const point = position(crossing.point);
    return `<g transform="translate(${point.x} ${point.y})" stroke="#fb7185" stroke-width="5" stroke-linecap="round">
      <line x1="-10" y1="-10" x2="10" y2="10"/>
      <line x1="10" y1="-10" x2="-10" y2="10"/>
    </g>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="heatLegend" x1="0" y1="0" x2="1" y2="0">
      ${COLORS.map((stop) => `<stop offset="${stop.at * 100}%" stop-color="${stop.value}"/>`).join('')}
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="#07111f"/>
  <rect x="20" y="20" width="${width - 40}" height="${height - 40}" rx="28" fill="#0f172a" stroke="#334155"/>
  <text x="48" y="58" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="27" font-weight="800" fill="#f8fafc">图案关卡 ${analysis.levelId} · 难度热力图</text>
  <text x="48" y="88" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="15" font-weight="600" fill="#94a3b8">综合混乱度 ${analysis.globalScore.toFixed(1)} · ${analysis.columns}×${analysis.rows} · ${analysis.nodeCount} 节点 · 交叉 ${analysis.crossings.length}</text>
  <text x="48" y="114" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="13" fill="#cbd5e1">最长直线：${escapeXml(longestRuns)} · 圆内小字为局部难度</text>
  <rect x="${width - 244}" y="48" width="172" height="12" rx="6" fill="url(#heatLegend)"/>
  <text x="${width - 250}" y="79" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="11" fill="#93c5fd">低</text>
  <text x="${width - 164}" y="79" text-anchor="middle" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="11" fill="#fde68a">中</text>
  <text x="${width - 66}" y="79" text-anchor="end" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="11" fill="#fca5a5">高</text>
  <g>${grid.join('')}</g>
  <polyline points="${pathPoints}" fill="none" stroke="#dbeafe" stroke-opacity="0.38" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  ${crossingMarks}
  ${cells}
  <text x="48" y="${height - 34}" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="12" fill="#64748b">局部难度 = 50% 潜在误选 + 30% 无关邻居 + 20% 转向；绿色圈为起点，紫色圈为终点，白点为转向。</text>
</svg>`;
};

const levels = JSON.parse(await readFile(LEVELS_PATH, 'utf8'));
const analyses = levels.map(analyzeLevel);
await mkdir(OUTPUT_DIR, { recursive: true });

for (const analysis of analyses) {
  const svg = renderHeatmapSvg(analysis);
  await writeFile(path.join(OUTPUT_DIR, `level-${analysis.levelId}.svg`), svg, 'utf8');
}

const summary = analyses.map((analysis) => ({
  levelId: analysis.levelId,
  size: `${analysis.columns}×${analysis.rows}`,
  nodeCount: analysis.nodeCount,
  globalScore: Number(analysis.globalScore.toFixed(1)),
  ambiguity: Number((analysis.ambiguity * 100).toFixed(1)),
  zigzag: Number((analysis.zigzag * 100).toFixed(1)),
  unrelated: Number((analysis.unrelated * 100).toFixed(1)),
  crossings: analysis.crossings.length,
  longestStraight: analysis.longestStraight,
  hottestCells: [...analysis.cells]
    .sort((left, right) => right.heat - left.heat)
    .slice(0, 5)
    .map((cell) => ({ number: cell.number, heat: Math.round(cell.heat * 100) })),
}));
await writeFile(
  path.join(OUTPUT_DIR, 'summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
  'utf8',
);

const gallery = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Number Connect 难度热力图</title>
  <style>
    body { margin: 0; padding: 32px; background: #020617; color: #f8fafc; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }
    h1 { margin: 0 0 24px; }
    main { display: grid; grid-template-columns: repeat(auto-fit, minmax(520px, 1fr)); gap: 24px; align-items: start; }
    figure { margin: 0; padding: 12px; border: 1px solid #1e293b; border-radius: 22px; background: #0f172a; }
    img { display: block; width: 100%; height: auto; border-radius: 14px; }
  </style>
</head>
<body>
  <h1>Number Connect · 关卡难度热力图</h1>
  <main>${analyses.map((analysis) => `<figure><img src="./level-${analysis.levelId}.svg" alt="关卡 ${analysis.levelId} 难度热力图"></figure>`).join('')}</main>
</body>
</html>`;
await writeFile(path.join(OUTPUT_DIR, 'index.html'), gallery, 'utf8');

console.log(`Generated ${analyses.length} heatmaps in ${OUTPUT_DIR}`);
