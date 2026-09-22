import type { OcclusionGeometry } from './handOcclusion';
import type { CellOcclusion, HandMode } from './occlusionSimulation';
import { sampleCellOcclusion } from './handOcclusionSampling';
import { drawThumbMesh } from './thumbMesh';

/** Worker-owned textures, canvas and bounded geometry caches shared across difficulty jobs. */
export class WorkerHandOcclusion {
  private readonly canvas = new OffscreenCanvas(1, 1);
  private readonly textures = new Map<string, Promise<ImageBitmap>>();
  private readonly geometries = new Map<string, Map<number, CellOcclusion[]>>();

  private texture(mode: 'thumb' | 'index', assetBaseUrl: string): Promise<ImageBitmap> {
    const key = `${assetBaseUrl}:${mode}`;
    let promise = this.textures.get(key);
    if (!promise) {
      const url = new URL(`ui/${mode === 'thumb' ? 'tutorial-thumb' : 'tutorial-finger'}.png`, assetBaseUrl);
      promise = fetch(url).then(async (response) => {
        if (!response.ok) throw new Error(`手指图片加载失败：${response.status}`);
        return createImageBitmap(await response.blob());
      });
      this.textures.set(key, promise);
      void promise.catch(() => this.textures.delete(key));
    }
    return promise;
  }

  forGeometry(mode: HandMode, geometry: OcclusionGeometry, assetBaseUrl = `${self.location.origin}/`): (current: number) => Promise<CellOcclusion[]> {
    const key = JSON.stringify([assetBaseUrl, mode, geometry]);
    let cache = this.geometries.get(key);
    if (!cache) cache = new Map();
    this.geometries.delete(key); this.geometries.set(key, cache);
    while (this.geometries.size > 4) this.geometries.delete(this.geometries.keys().next().value!);
    const samples = cache;
    return async (current) => {
      const cached = samples.get(current);
      if (cached) return cached;
      const result = await this.sample(mode, geometry, current, assetBaseUrl);
      samples.set(current, result); return result;
    };
  }

  private async sample(mode: HandMode, geometry: OcclusionGeometry, current: number, assetBaseUrl: string): Promise<CellOcclusion[]> {
    if (mode === 'off') return geometry.centers.map(() => ({ coverage: 0, numberBlocked: false }));
    const texture = await this.texture(mode, assetBaseUrl), cursor = geometry.centers[current];
    const { viewportWidth: width, viewportHeight: height } = geometry;
    const dpr = mode === 'thumb' ? Math.min(geometry.pixelRatio ?? 1, 2) : 1;
    if (this.canvas.width !== Math.ceil(width * dpr) || this.canvas.height !== Math.ceil(height * dpr)) {
      this.canvas.width = Math.ceil(width * dpr); this.canvas.height = Math.ceil(height * dpr);
    }
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    const size = geometry.handSize ?? 1;
    if (mode === 'thumb') {
      drawThumbMesh(ctx, texture, cursor, geometry.board, width, height, size, geometry.leftHand ?? false, dpr, geometry.clipBoard);
    } else {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width, height); ctx.save();
      if (geometry.leftHand) {
        const clip = geometry.clipBoard ?? geometry.board;
        ctx.beginPath(); ctx.rect(clip.x, clip.y, clip.width, clip.height); ctx.clip();
      }
      ctx.translate(cursor.x, cursor.y); if (geometry.leftHand) ctx.scale(-1, 1);
      const imageWidth = 720 * size, imageHeight = texture.height * imageWidth / texture.width;
      ctx.drawImage(texture, -imageWidth * .045, -imageHeight * .006 - 20 * size, imageWidth, imageHeight);
      ctx.restore();
    }
    const pixels = ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const sx = this.canvas.width / width, sy = this.canvas.height / height;
    return geometry.centers.map((center) => sampleCellOcclusion(center, geometry.radius, (x, y) => {
      const px = Math.floor(x * sx), py = Math.floor(y * sy);
      return px < 0 || py < 0 || px >= pixels.width || py >= pixels.height ? 0 : pixels.data[(py * pixels.width + px) * 4 + 3];
    }));
  }
}
