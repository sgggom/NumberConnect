import type { CellOcclusion } from './occlusionSimulation';
import type { Point } from './thumbRig';

/** Samples the visible circle and central glyph area, not the image's bounding box. */
export function sampleCellOcclusion(center: Point, radius: number, alphaAt: (x: number, y: number) => number): CellOcclusion {
  let total = 0;
  let blocked = 0;
  for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
    if (x * x + y * y > 16) continue;
    total++;
    if (alphaAt(center.x + x * radius / 4, center.y + y * radius / 4) >= 128) blocked++;
  }
  let glyphBlocked = 0;
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    if (alphaAt(center.x + x * radius * .3, center.y + y * radius * .3) >= 128) glyphBlocked++;
  }
  return { coverage: blocked / total, numberBlocked: glyphBlocked >= 3 };
}
