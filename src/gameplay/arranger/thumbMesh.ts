import { createScreenThumbPose, type Point } from './thumbRig';
export interface HandBounds { x: number; y: number; left: number; top: number; right: number; bottom: number; width: number; height: number }

/** Shared mesh renderer for live canvas and worker OffscreenCanvas. */
export function drawThumbMesh(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  texture: CanvasImageSource, target: Point, bounds: HandBounds, width: number, height: number,
  size: number, leftHand: boolean, dpr: number, clipBounds?: HandBounds): void {
  const pose = createScreenThumbPose(target, bounds, width, size, leftHand);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.save();
    if (leftHand) {
      const clip = clipBounds ?? bounds;
      context.beginPath(); context.rect(clip.x, clip.y, clip.width, clip.height); context.clip();
    }
    const columns = 28;
    const rows = 42;
    const vertices: Array<{ source: Point; destination: Point }> = [];
    for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
      const source = { x: x * 1024 / columns, y: y * 1536 / rows };
      vertices.push({ source, destination: pose(source) });
    }
    const triangle = (a: number, b: number, c: number) => {
      const s = [vertices[a].source, vertices[b].source, vertices[c].source];
      const p = [vertices[a].destination, vertices[b].destination, vertices[c].destination];
      const det = (s[1].x - s[0].x) * (s[2].y - s[0].y) - (s[2].x - s[0].x) * (s[1].y - s[0].y);
      const ax = ((p[1].x - p[0].x) * (s[2].y - s[0].y) - (p[2].x - p[0].x) * (s[1].y - s[0].y)) / det;
      const ay = ((p[1].y - p[0].y) * (s[2].y - s[0].y) - (p[2].y - p[0].y) * (s[1].y - s[0].y)) / det;
      const bx = ((p[2].x - p[0].x) * (s[1].x - s[0].x) - (p[1].x - p[0].x) * (s[2].x - s[0].x)) / det;
      const by = ((p[2].y - p[0].y) * (s[1].x - s[0].x) - (p[1].y - p[0].y) * (s[2].x - s[0].x)) / det;
      context.save();
      context.beginPath();
      // Slightly overlap triangle edges to avoid hairline seams from antialiasing.
      const center = { x: (p[0].x + p[1].x + p[2].x) / 3, y: (p[0].y + p[1].y + p[2].y) / 3 };
      p.forEach((point, i) => {
        const distance = Math.hypot(point.x - center.x, point.y - center.y) || 1;
        const x = point.x + (point.x - center.x) / distance * .5;
        const y = point.y + (point.y - center.y) / distance * .5;
        if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.closePath();
      context.clip();
      context.transform(ax, ay, bx, by, p[0].x - ax * s[0].x - bx * s[0].y, p[0].y - ay * s[0].x - by * s[0].y);
      context.drawImage(texture, 0, 0, 1024, 1536);
      context.restore();
    };
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      const a = y * (columns + 1) + x;
      triangle(a, a + 1, a + columns + 2);
      triangle(a, a + columns + 2, a + columns + 1);
    }
    context.restore();
}
