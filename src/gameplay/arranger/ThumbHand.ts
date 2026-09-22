import type { Point } from './thumbRig';
import { drawThumbMesh, type HandBounds } from './thumbMesh';

/** Deforms the texture with an edge-anchored grip that moves inward only for distant targets. */
export class ThumbHand {
  readonly canvas = document.createElement('canvas');
  private readonly texture = new Image();
  private frame = 0;
  private target?: Point;
  private bounds?: HandBounds;
  private disposed = false;
  private size = 1;
  private leftHand = false;
  private clipBounds?: HandBounds;

  setClipBounds(bounds: HandBounds): void { this.clipBounds = bounds; }

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

  move(x: number, y: number, bounds: HandBounds): void {
    this.target = { x, y };
    this.bounds = bounds;
    this.canvas.hidden = false;
    this.schedule();
  }

  async rasterize(x: number, y: number, bounds: HandBounds): Promise<HTMLCanvasElement> {
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (this.canvas.width !== Math.ceil(width * dpr) || this.canvas.height !== Math.ceil(height * dpr)) {
      this.canvas.width = Math.ceil(width * dpr);
      this.canvas.height = Math.ceil(height * dpr);
    }
    const context = this.canvas.getContext('2d', { willReadFrequently: true })!;
    drawThumbMesh(context, this.texture, this.target, this.bounds, width, height,
      this.size, this.leftHand, dpr, this.clipBounds);
  }
}
