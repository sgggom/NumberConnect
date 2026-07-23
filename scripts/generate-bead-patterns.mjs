import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(ROOT, 'public', 'bead-patterns');
mkdirSync(OUTPUT, { recursive: true });

const createCanvas = (width, height) => Array.from({ length: height }, () => Array(width).fill(null));

const painter = (grid) => {
  const height = grid.length;
  const width = grid[0].length;
  const set = (x, y, color) => {
    if (Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < width && y >= 0 && y < height) {
      grid[y][x] = color;
    }
  };
  const rect = (x1, y1, x2, y2, color) => {
    for (let y = Math.max(0, y1); y <= Math.min(height - 1, y2); y += 1) {
      for (let x = Math.max(0, x1); x <= Math.min(width - 1, x2); x += 1) set(x, y, color);
    }
  };
  const ellipse = (cx, cy, rx, ry, color) => {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) set(x, y, color);
      }
    }
  };
  const polygon = (points, color) => {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
          const [xi, yi] = points[i];
          const [xj, yj] = points[j];
          if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) set(x, y, color);
      }
    }
  };
  const line = (x1, y1, x2, y2, color) => {
    let x = x1;
    let y = y1;
    const dx = Math.abs(x2 - x1);
    const sx = x1 < x2 ? 1 : -1;
    const dy = -Math.abs(y2 - y1);
    const sy = y1 < y2 ? 1 : -1;
    let error = dx + dy;
    while (true) {
      set(x, y, color);
      if (x === x2 && y === y2) break;
      const doubled = error * 2;
      if (doubled >= dy) { error += dy; x += sx; }
      if (doubled <= dx) { error += dx; y += sy; }
    }
  };
  return { set, rect, ellipse, polygon, line };
};

const definePattern = ({ id, name, width, height, palette }, paint) => {
  const grid = createCanvas(width, height);
  paint(painter(grid), palette, grid);
  return { id, name, width, height, palette, grid };
};

const strawberry = definePattern({
  id: 'strawberry-heart-20x20',
  name: '草莓甜心',
  width: 20,
  height: 20,
  palette: {
    red: '#F4475D', darkRed: '#A92F48', highlight: '#FF7D8D',
    green: '#42B96B', lightGreen: '#79D879', seed: '#FFD766',
  },
}, ({ set, polygon }, c) => {
  polygon([[9, 3], [12, 3], [16, 6], [17, 10], [16, 14], [13, 18], [10, 20], [7, 18], [4, 14], [3, 10], [4, 6]], c.darkRed);
  polygon([[9, 5], [11, 5], [15, 7], [15, 13], [12, 17], [10, 18], [8, 17], [5, 13], [5, 8]], c.red);
  polygon([[9, 6], [6, 2], [9, 3], [10, 0], [11, 3], [15, 2], [12, 7]], c.green);
  [[10, 2], [8, 4], [12, 4], [10, 5]].forEach(([x, y]) => set(x, y, c.lightGreen));
  [[7, 8], [11, 8], [13, 10], [8, 12], [11, 13], [9, 16]].forEach(([x, y]) => set(x, y, c.seed));
  [[6, 9], [6, 10], [7, 13]].forEach(([x, y]) => set(x, y, c.highlight));
});

const whale = definePattern({
  id: 'little-whale-30x30',
  name: '蓝鲸伙伴',
  width: 30,
  height: 30,
  palette: {
    blue: '#4AA9DD', darkBlue: '#246791', lightBlue: '#9BE1F2',
    cyan: '#6ED5E8', black: '#172033', white: '#FFFFFF', pink: '#FF8FA9',
  },
}, ({ set, ellipse, polygon, line }, c) => {
  polygon([[21, 13], [26, 8], [29, 8], [27, 14], [29, 21], [26, 21], [21, 18]], c.darkBlue);
  polygon([[21, 14], [26, 10], [28, 10], [26, 15], [28, 19], [26, 19], [21, 17]], c.blue);
  ellipse(13, 16, 11, 8, c.darkBlue);
  ellipse(13, 15, 9.5, 6.5, c.blue);
  ellipse(12, 19, 7.5, 3, c.lightBlue);
  polygon([[13, 19], [18, 21], [16, 25], [12, 22]], c.darkBlue);
  polygon([[14, 20], [17, 21], [16, 23], [13, 22]], c.blue);
  ellipse(7, 13, 1.5, 1.5, c.black);
  set(7, 12, c.white);
  set(5, 16, c.pink);
  line(5, 18, 9, 19, c.black);
  line(8, 7, 8, 4, c.cyan);
  line(8, 5, 5, 3, c.cyan);
  line(9, 5, 12, 3, c.cyan);
  [[24, 5], [26, 3], [27, 6]].forEach(([x, y]) => set(x, y, c.lightBlue));
});

const rocket = definePattern({
  id: 'star-rocket-30x40',
  name: '星际火箭',
  width: 30,
  height: 40,
  palette: {
    outline: '#26344F', cream: '#FFF2D2', red: '#EF5361', darkRed: '#A9384A',
    blue: '#4EB8E8', lightBlue: '#A7E7F4', orange: '#FF9738', yellow: '#FFD85C',
  },
}, ({ set, rect, ellipse, polygon }, c) => {
  [[4, 7], [24, 5], [26, 16], [3, 22], [25, 30], [6, 33]].forEach(([x, y], index) => {
    set(x, y, index % 2 ? c.blue : c.yellow);
    if (x + 1 < 30) set(x + 1, y, index % 2 ? c.blue : c.yellow);
    if (y + 1 < 40) set(x, y + 1, index % 2 ? c.blue : c.yellow);
  });
  polygon([[10, 29], [20, 29], [19, 36], [15, 40], [11, 36]], c.outline);
  polygon([[12, 30], [18, 30], [17, 35], [15, 38], [13, 35]], c.orange);
  polygon([[14, 31], [16, 31], [16, 35], [15, 37], [14, 35]], c.yellow);
  polygon([[10, 22], [5, 30], [5, 34], [12, 31]], c.outline);
  polygon([[20, 22], [25, 30], [25, 34], [18, 31]], c.outline);
  polygon([[10, 24], [7, 30], [7, 32], [12, 29]], c.red);
  polygon([[20, 24], [23, 30], [23, 32], [18, 29]], c.red);
  polygon([[15, 1], [22, 12], [22, 27], [18, 33], [12, 33], [8, 27], [8, 12]], c.outline);
  polygon([[15, 3], [20, 13], [20, 27], [17, 31], [13, 31], [10, 27], [10, 13]], c.cream);
  polygon([[15, 3], [20, 13], [10, 13]], c.red);
  rect(10, 24, 20, 28, c.red);
  rect(12, 24, 18, 26, c.darkRed);
  ellipse(15, 18, 5, 5, c.outline);
  ellipse(15, 18, 3.5, 3.5, c.blue);
  ellipse(14, 17, 1.2, 1.2, c.lightBlue);
});

const lighthouse = definePattern({
  id: 'coastal-lighthouse-30x50',
  name: '海岸灯塔',
  width: 30,
  height: 50,
  palette: {
    outline: '#253650', red: '#E95662', darkRed: '#A73747', cream: '#FFF3D6',
    yellow: '#FFD65C', paleYellow: '#FFEBA0', blue: '#4BA9DB', darkBlue: '#286D9E', white: '#FFFFFF',
  },
}, ({ set, rect, polygon, line }, c, grid) => {
  polygon([[11, 10], [1, 7], [1, 13]], c.paleYellow);
  polygon([[19, 10], [29, 7], [29, 13]], c.paleYellow);
  for (let y = 44; y < 50; y += 1) {
    for (let x = 0; x < 30; x += 1) {
      if ((x + y) % 5 < 3) set(x, y, y % 2 ? c.blue : c.darkBlue);
    }
  }
  polygon([[15, 2], [22, 8], [8, 8]], c.outline);
  polygon([[15, 3], [20, 7], [10, 7]], c.red);
  rect(8, 8, 22, 10, c.outline);
  rect(10, 9, 20, 14, c.cream);
  rect(11, 9, 13, 13, c.yellow);
  rect(17, 9, 19, 13, c.yellow);
  rect(7, 14, 23, 16, c.outline);
  rect(9, 14, 21, 14, c.white);
  for (let y = 17; y <= 43; y += 1) {
    const halfWidth = Math.round(4 + (y - 17) / 9);
    const left = 15 - halfWidth;
    const right = 15 + halfWidth;
    const stripe = Math.floor((y - 17) / 5) % 2 === 0 ? c.cream : c.red;
    for (let x = left; x <= right; x += 1) {
      set(x, y, x === left || x === right ? c.outline : stripe);
    }
  }
  rect(7, 42, 23, 45, c.outline);
  rect(9, 42, 21, 43, c.darkRed);
  [[15, 21], [15, 31], [15, 39]].forEach(([x, y]) => {
    rect(x - 1, y - 1, x + 1, y + 1, c.outline);
    set(x, y, c.yellow);
  });
  line(4, 47, 11, 46, c.white);
  line(18, 47, 26, 46, c.white);
  grid[49][3] = c.darkBlue;
  grid[49][26] = c.darkBlue;
});

const cherryBunny = definePattern({
  id: 'cherry-bunny-20x20',
  name: '樱桃小兔',
  width: 20,
  height: 20,
  palette: {
    outline: '#6B4262', cream: '#FFF0E5', pink: '#F8A9C4', blush: '#FF779E',
    red: '#E94761', darkRed: '#A72F48', green: '#55B873', black: '#302438', white: '#FFFFFF',
  },
}, ({ set, ellipse, line }, c) => {
  ellipse(6, 5, 3, 5, c.outline);
  ellipse(14, 5, 3, 5, c.outline);
  ellipse(6, 5, 1.5, 3.8, c.pink);
  ellipse(14, 5, 1.5, 3.8, c.pink);
  ellipse(10, 12, 8, 7, c.outline);
  ellipse(10, 12, 7, 6, c.cream);
  ellipse(6, 13, 1.8, 1.3, c.blush);
  ellipse(14, 13, 1.8, 1.3, c.blush);
  ellipse(7, 10, 1, 1.4, c.black);
  ellipse(13, 10, 1, 1.4, c.black);
  set(7, 9, c.white);
  set(13, 9, c.white);
  set(10, 12, c.pink);
  line(10, 13, 8, 14, c.outline);
  line(10, 13, 12, 14, c.outline);
  ellipse(15, 4, 2, 2, c.darkRed);
  ellipse(17, 5, 2, 2, c.red);
  line(16, 3, 16, 1, c.green);
  line(16, 2, 18, 1, c.green);
});

const sunflowerFox = definePattern({
  id: 'sunflower-fox-30x30',
  name: '向日葵狐狸',
  width: 30,
  height: 30,
  palette: {
    outline: '#633A35', orange: '#E97932', lightOrange: '#F7A54A', cream: '#FFF0CF',
    yellow: '#FFD54F', gold: '#E8A52E', brown: '#74452D', green: '#4FA86B',
    black: '#251F28', white: '#FFFFFF', pink: '#F58DA3',
  },
}, ({ set, ellipse, polygon, line }, c) => {
  const petals = [[23, 2], [26, 3], [28, 6], [27, 9], [24, 11], [21, 10], [19, 7], [20, 4]];
  petals.forEach(([x, y]) => ellipse(x, y, 2.3, 2.3, c.yellow));
  ellipse(24, 6, 3, 3, c.brown);
  set(23, 5, c.gold);
  set(25, 7, c.gold);
  line(24, 9, 25, 15, c.green);
  line(25, 13, 28, 12, c.green);
  polygon([[4, 4], [12, 8], [18, 8], [26, 4], [23, 17], [20, 25], [15, 28], [10, 25], [7, 17]], c.outline);
  polygon([[6, 7], [12, 10], [18, 10], [24, 7], [21, 18], [18, 24], [15, 26], [12, 24], [9, 18]], c.orange);
  polygon([[7, 7], [12, 10], [9, 13]], c.cream);
  polygon([[23, 7], [18, 10], [21, 13]], c.cream);
  ellipse(15, 20, 7, 5, c.cream);
  ellipse(11, 16, 1.3, 1.6, c.black);
  ellipse(19, 16, 1.3, 1.6, c.black);
  set(11, 15, c.white);
  set(19, 15, c.white);
  ellipse(15, 20, 1.5, 1.2, c.black);
  line(15, 21, 12, 23, c.outline);
  line(15, 21, 18, 23, c.outline);
  set(9, 20, c.pink);
  set(21, 20, c.pink);
  [[7, 14], [8, 15], [22, 14], [21, 15]].forEach(([x, y]) => set(x, y, c.lightOrange));
});

const mushroomCottage = definePattern({
  id: 'mushroom-cottage-30x40',
  name: '蘑菇小屋',
  width: 30,
  height: 40,
  palette: {
    outline: '#493B50', red: '#E55262', darkRed: '#A7374B', cream: '#FFF1D0',
    tan: '#D8A76F', brown: '#7B4A3D', blue: '#75C8DE', yellow: '#FFD45D',
    green: '#4AA66C', lightGreen: '#77C66E', white: '#FFFFFF',
  },
}, ({ set, rect, ellipse, polygon, line }, c) => {
  for (let x = 2; x < 29; x += 2) {
    const top = 35 + (x % 4 === 0 ? 0 : 1);
    line(x, 39, x, top, x % 3 === 0 ? c.lightGreen : c.green);
  }
  polygon([[5, 15], [8, 8], [15, 3], [22, 8], [26, 15], [23, 20], [7, 20]], c.outline);
  polygon([[7, 14], [10, 8], [15, 5], [20, 8], [24, 14], [21, 18], [9, 18]], c.red);
  ellipse(11, 10, 2, 2, c.cream);
  ellipse(18, 8, 2.5, 2, c.cream);
  ellipse(20, 14, 1.8, 1.8, c.cream);
  ellipse(14, 15, 1.5, 1.5, c.cream);
  polygon([[9, 18], [21, 18], [23, 36], [7, 36]], c.outline);
  polygon([[10, 19], [20, 19], [21, 34], [9, 34]], c.cream);
  rect(10, 23, 13, 27, c.brown);
  rect(11, 24, 12, 26, c.blue);
  rect(17, 23, 20, 27, c.brown);
  rect(18, 24, 19, 26, c.blue);
  polygon([[12, 35], [12, 29], [15, 27], [18, 29], [18, 35]], c.brown);
  polygon([[14, 35], [14, 30], [15, 29], [16, 30], [16, 35]], c.tan);
  set(16, 32, c.yellow);
  line(3, 34, 3, 29, c.green);
  ellipse(3, 28, 2, 2, c.yellow);
  set(3, 28, c.brown);
  line(26, 35, 27, 30, c.green);
  ellipse(27, 29, 2, 2, c.white);
  set(27, 29, c.yellow);
});

const moonCastle = definePattern({
  id: 'moon-castle-30x50',
  name: '月夜城堡',
  width: 30,
  height: 50,
  palette: {
    outline: '#222B4C', purple: '#6656A5', lightPurple: '#9A7CD1', blue: '#4C78B8',
    moon: '#FFD968', paleMoon: '#FFF0A6', cyan: '#75D4E8', pink: '#F18AB5',
    green: '#4E9E78', darkGreen: '#276B5B', white: '#FFFFFF',
  },
}, ({ set, rect, ellipse, polygon, line }, c) => {
  ellipse(8, 8, 6, 6, c.moon);
  ellipse(10, 6, 5, 5, c.paleMoon);
  ellipse(12, 5, 4, 4, null);
  [[22, 4], [25, 9], [18, 12], [4, 17], [26, 18], [15, 5]].forEach(([x, y], index) => {
    set(x, y, index % 2 ? c.pink : c.cyan);
    if (index < 3) set(x + 1, y, c.white);
  });
  polygon([[3, 48], [5, 39], [9, 37], [13, 40], [17, 36], [22, 38], [27, 48]], c.darkGreen);
  polygon([[0, 50], [0, 45], [5, 43], [10, 46], [15, 42], [21, 45], [29, 42], [30, 50]], c.green);
  polygon([[5, 28], [9, 22], [13, 28]], c.outline);
  polygon([[17, 28], [21, 21], [25, 28]], c.outline);
  polygon([[6, 28], [9, 24], [12, 28]], c.lightPurple);
  polygon([[18, 28], [21, 23], [24, 28]], c.lightPurple);
  rect(5, 28, 13, 44, c.outline);
  rect(17, 28, 25, 44, c.outline);
  rect(7, 30, 11, 43, c.purple);
  rect(19, 30, 23, 43, c.purple);
  polygon([[10, 34], [15, 27], [20, 34]], c.outline);
  polygon([[12, 34], [15, 30], [18, 34]], c.blue);
  rect(10, 34, 20, 46, c.outline);
  rect(12, 35, 18, 45, c.blue);
  [[9, 33], [9, 38], [21, 33], [21, 38], [15, 36]].forEach(([x, y]) => {
    rect(x - 1, y - 1, x + 1, y + 1, c.paleMoon);
    set(x, y, c.cyan);
  });
  polygon([[13, 46], [13, 41], [15, 39], [17, 41], [17, 46]], c.outline);
  polygon([[15, 45], [15, 41], [16, 42], [16, 45]], c.pink);
  line(4, 47, 26, 47, c.outline);
});

const catMetadata = { id: 'orange-cat-20x20', name: '橙色小猫', width: 20, height: 20 };
const existingCat = JSON.parse(readFileSync(join(OUTPUT, `${catMetadata.id}.json`), 'utf8'));
if (!Array.isArray(existingCat.data)) throw new Error('Invalid orange cat bead data');
const catGrid = existingCat.data.map((row) => [...row]);
if (
  catGrid.length !== catMetadata.height
  || catGrid.some((row) => !Array.isArray(row) || row.length !== catMetadata.width)
) {
  throw new Error('Invalid orange cat bead data');
}

const patterns = [
  { ...catMetadata, grid: catGrid },
  strawberry,
  whale,
  rocket,
  lighthouse,
  cherryBunny,
  sunflowerFox,
  mushroomCottage,
  moonCastle,
];

const toJson = (pattern) => {
  const rows = pattern.grid
    .map((row) => `    ${JSON.stringify(row).replaceAll(',', ', ')}`)
    .join(',\n');
  return `{\n  "data": [\n${rows}\n  ]\n}\n`;
};

const toSvg = (pattern) => {
  const cell = 14;
  const padding = 14;
  const width = pattern.width * cell + padding * 2;
  const height = pattern.height * cell + padding * 2;
  const beads = [];
  for (let y = 0; y < pattern.height; y += 1) {
    for (let x = 0; x < pattern.width; x += 1) {
      const color = pattern.grid[y][x];
      if (!color) continue;
      const cx = padding + x * cell + cell / 2;
      const cy = padding + y * cell + cell / 2;
      beads.push(`<circle cx="${cx}" cy="${cy}" r="5.6" fill="${color}" stroke="#ffffff" stroke-opacity=".16" stroke-width=".8"/>`);
      beads.push(`<circle cx="${cx - 1.8}" cy="${cy - 2}" r="1.25" fill="#ffffff" fill-opacity=".48"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs><pattern id="pegs" width="${cell}" height="${cell}" patternUnits="userSpaceOnUse"><circle cx="${cell / 2}" cy="${cell / 2}" r="5" fill="#172434"/></pattern></defs>
  <rect width="${width}" height="${height}" rx="22" fill="#0b1420"/>
  <rect x="${padding}" y="${padding}" width="${pattern.width * cell}" height="${pattern.height * cell}" fill="url(#pegs)"/>
  ${beads.join('\n  ')}
</svg>
`;
};

for (const pattern of patterns) {
  const filename = `${pattern.id}.json`;
  writeFileSync(join(OUTPUT, filename), toJson(pattern));
  writeFileSync(join(OUTPUT, `${pattern.id}.svg`), toSvg(pattern));
}

const manifest = {
  patterns: patterns.map((pattern) => ({
    id: pattern.id,
    name: pattern.name,
    width: pattern.width,
    height: pattern.height,
    data: `${pattern.id}.json`,
    preview: `${pattern.id}.svg`,
  })),
};
writeFileSync(join(OUTPUT, 'patterns.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Generated ${patterns.length} bead patterns in ${OUTPUT}`);
