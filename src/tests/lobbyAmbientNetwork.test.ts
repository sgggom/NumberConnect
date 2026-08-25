import { describe, expect, it } from 'vitest';
import { trimAmbientRoute, type AmbientPoint } from '../app/LobbyAmbientNetwork';

describe('trimAmbientRoute', () => {
  it('keeps points at ten grid cells and removes points beyond the radius', () => {
    const points: AmbientPoint[] = Array.from({ length: 12 }, (_, index) => ({ x: index * 60, y: 0 }));

    trimAmbientRoute(points, { x: 660, y: 0 }, 600, 128);

    expect(points[0]).toEqual({ x: 60, y: 0 });
    expect(points.at(-1)).toEqual({ x: 660, y: 0 });
  });

  it('retains only the connected suffix after a route leaves and re-enters the radius', () => {
    const points: AmbientPoint[] = [
      { x: 0, y: 0 },
      { x: 700, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 0 },
    ];

    trimAmbientRoute(points, { x: 0, y: 0 }, 600, 128);

    expect(points).toEqual([
      { x: 100, y: 0 },
      { x: 0, y: 0 },
    ]);
  });

  it('applies a safety cap while the route remains inside the radius', () => {
    const points: AmbientPoint[] = Array.from({ length: 8 }, (_, index) => ({ x: index, y: 0 }));

    trimAmbientRoute(points, { x: 7, y: 0 }, 600, 4);

    expect(points).toEqual([
      { x: 4, y: 0 },
      { x: 5, y: 0 },
      { x: 6, y: 0 },
      { x: 7, y: 0 },
    ]);
  });
});
