import { createReachingThumbPose, THUMB_ROOT, type Point } from './thumbRig';

/** Deforms the texture with an edge-anchored grip that moves inward only for distant targets. */
export class ThumbHand {
  readonly canvas = document.createElement('canvas');
  private readonly texture = new Image();
  private frame = 0;
  private target?: Point;
  private bounds?: DOMRect;
  private disposed = false;
  private size = 1;
  private leftHand = false;
  private clipBounds?: DOMRect;

  setClipBounds(bounds: DOMRect): void { this.clipBounds = bounds; }

  setLeftHand(left: boolean): void { this.leftHand = left; this.schedule(); }

  setSize(size: number): void {
    this.size = Math.max(.5, Math.min(1, size));
    this.schedule();
  }

  constructor(offscreen = false) {
    this.canvas.className = 'arranger-playtest-thumb-rig';
    this.canvas.hidden = true;
    if (offscreen) this.canvas.style.visibility = 'hidden';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.texture.onload = () => this.schedule();
    this.texture.src = `${import.meta.env.BASE_URL}ui/tutorial-thumb.png`;
    document.body.append(this.canvas);
  }

  move(x: number, y: number, bounds: DOMRect): void {
    this.target = { x, y };
    this.bounds = bounds;
    this.canvas.hidden = false;
    this.schedule();
  }

  async rasterize(x: number, y: number, bounds: DOMRect): Promise<HTMLCanvasElement> {
    await this.texture.decode();
    if (this.disposed) throw new Error('手指采样器已关闭。');
    this.target = { x, y };
    this.bounds = bounds;
    this.canvas.hidden = false;
    this.draw();
    return this.canvas;
  }

  hide(): void { this.canvas.hidden = true; }
  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.canvas.remove();
  }

  private schedule(): void {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  }

  private draw(): void {
    if (!this.target || !this.bounds || !this.texture.complete || !this.texture.naturalWidth || this.canvas.hidden) return;
    const scale = 720 / 1024 * this.size;
    // Resting grip stays at the screen edge; the rig moves it when the thumb cannot reach.
    const anchor = { x: window.innerWidth + 85 * this.size, y: this.bounds.top + this.bounds.height * .62 };
    const offset = { x: anchor.x - THUMB_ROOT.x * scale, y: anchor.y - THUMB_ROOT.y * scale };
    const targetX = this.leftHand ? window.innerWidth - this.target.x : this.target.x;
    const pose = createReachingThumbPose({ x: (targetX - offset.x) / scale, y: (this.target.y - offset.y) / scale });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (this.canvas.width !== Math.ceil(width * dpr) || this.canvas.height !== Math.ceil(height * dpr)) {
      this.canvas.width = Math.ceil(width * dpr);
      this.canvas.height = Math.ceil(height * dpr);
    }
    const context = this.canvas.getContext('2d')!;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.save();
    if (this.leftHand) {
      const clip = this.clipBounds ?? this.bounds;
      context.beginPath(); context.rect(clip.x, clip.y, clip.width, clip.height); context.clip();
    }
    const columns = 28;
    const rows = 42;
    const vertices: Array<{ source: Point; destination: Point }> = [];
    for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
      const source = { x: x * 1024 / columns, y: y * 1536 / rows };
      const warped = pose(source);
      // Visual alignment is thumb-only; keep the mouse marker and index cursor unchanged.
      const screenX = offset.x + warped.x * scale + 20 * this.size;
      vertices.push({ source, destination: { x: this.leftHand ? width - screenX : screenX, y: offset.y + warped.y * scale + 20 * this.size } });
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
      context.drawImage(this.texture, 0, 0, 1024, 1536);
      context.restore();
    };
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      const a = y * (columns + 1) + x;
      triangle(a, a + 1, a + columns + 2);
      triangle(a, a + columns + 2, a + columns + 1);
    }
    context.restore();
  }
}
