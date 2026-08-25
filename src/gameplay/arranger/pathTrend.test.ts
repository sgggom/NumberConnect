import { describe, expect, it } from 'vitest';
import { buildPathTrend, pathTrendColorAt } from './pathTrend';

describe('path trend', () => {
  it('compresses local zigzags while preserving endpoints', () => {
    const source = Array.from({ length: 80 }, (_, index) => ({
      x: index % 2,
      y: index * 0.1,
    }));
    const trend = buildPathTrend(source);
    expect(trend.length).toBeLessThanOrEqual(27);
    expect(trend[0]).toEqual(source[0]);
    expect(trend.at(-1)).toEqual(source.at(-1));
    trend.slice(1).forEach((point, index) => {
      const previous = trend[index];
      const dx = Math.abs(point.x - previous.x);
      const dy = Math.abs(point.y - previous.y);
      expect(dx < 0.001 || dy < 0.001 || Math.abs(dx - dy) < 0.001).toBe(true);
    });
  });

  it('reduces a straight path to its start and end', () => {
    const trend = buildPathTrend(Array.from({ length: 25 }, (_, index) => ({ x: index, y: index })));
    expect(trend).toEqual([{ x: 0, y: 0 }, { x: 24, y: 24 }]);
  });

  it('maps the trend endpoints from blue to purple', () => {
    expect(pathTrendColorAt(0)).toBe('rgb(36, 155, 255)');
    expect(pathTrendColorAt(1)).toBe('rgb(155, 92, 255)');
  });
});
