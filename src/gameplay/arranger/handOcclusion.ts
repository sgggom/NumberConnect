import { sampleCellOcclusion } from './handOcclusionSampling';
export { sampleCellOcclusion } from './handOcclusionSampling';
import type { HandBounds } from './thumbMesh';
import { ThumbHand } from './ThumbHand';
import type { CellOcclusion, HandMode } from './occlusionSimulation';
import type { Point } from './thumbRig';

export interface OcclusionGeometry {
  centers: Point[];
  radius: number;
  board: HandBounds;
  viewportWidth: number;
  viewportHeight: number;
  pixelRatio?: number;
  handSize?: number;
  leftHand?: boolean;
  clipBoard?: HandBounds;
}

export class HandOcclusionSampler {
  private readonly thumb = new ThumbHand(true);
  private readonly index = new Image();
  private readonly canvas = document.createElement('canvas');
  private readonly cache = new Map<string, CellOcclusion[]>();
  private disposed = false;

  constructor(readonly geometry: OcclusionGeometry) {
    this.thumb.setSize(geometry.handSize ?? 1);
    this.thumb.setLeftHand(geometry.leftHand ?? false);
    this.thumb.setClipBounds(geometry.clipBoard ?? geometry.board);
    this.index.src = `${import.meta.env.BASE_URL}ui/tutorial-finger.png`;
  }

  dispose(): void { this.disposed = true; this.thumb.dispose(); this.cache.clear(); }

  async observe(mode: HandMode, current: number): Promise<CellOcclusion[]> {
    if (this.disposed) throw new DOMException('采样已取消', 'AbortError');
    const key = `${mode}:${current}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const result = await this.observeAt(mode, this.geometry.centers[current]);
    this.cache.set(key, result);
    return result;
  }

  async observeAt(mode: HandMode, cursor: Point): Promise<CellOcclusion[]> {
    if (this.disposed) throw new DOMException('采样已取消', 'AbortError');
    const { centers, radius, board, viewportWidth, viewportHeight } = this.geometry;
    let result: CellOcclusion[];
    if (mode === 'off') result = centers.map(() => ({ coverage: 0, numberBlocked: false }));
    else {
      let canvas: HTMLCanvasElement;
      if (mode === 'thumb') canvas = await this.thumb.rasterize(cursor.x, cursor.y, board);
      else {
        await this.index.decode();
        this.canvas.width = Math.ceil(viewportWidth);
        this.canvas.height = Math.ceil(viewportHeight);
        const size = this.geometry.handSize ?? 1;
        const width = 720 * size;
        const height = this.index.naturalHeight * width / this.index.naturalWidth;
        const context = this.canvas.getContext('2d', { willReadFrequently: true })!;
        context.save();
        if (this.geometry.leftHand) {
          const clip = this.geometry.clipBoard ?? board;
          context.beginPath(); context.rect(clip.x, clip.y, clip.width, clip.height); context.clip();
        }
        context.translate(cursor.x, cursor.y);
        if (this.geometry.leftHand) context.scale(-1, 1);
        context.drawImage(this.index, -width * .045, -height * .006 - 20 * size, width, height);
        context.restore();
        canvas = this.canvas;
      }
      if (this.disposed) throw new DOMException('采样已取消', 'AbortError');
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      const sx = canvas.width / viewportWidth;
      const sy = canvas.height / viewportHeight;
      result = centers.map((center) => sampleCellOcclusion(center, radius, (x, y) => {
        const px = Math.floor(x * sx);
        const py = Math.floor(y * sy);
        if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return 0;
        return pixels.data[(py * canvas.width + px) * 4 + 3];
      }));
    }
    return result;
  }
}
