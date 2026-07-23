import { describe, expect, it } from 'vitest';
import { calculateBoardViewportLayout } from './boardViewport';

describe('board viewport layout', () => {
  it('moves a zoomed board between its aligned edges', () => {
    const left = calculateBoardViewportLayout({
      viewportWidth: 600,
      viewportHeight: 600,
      contentLeft: -300,
      contentTop: 0,
      contentWidth: 600,
      contentHeight: 600,
      zoom: 1.5,
      scrollX: 0,
      scrollY: 0,
    });
    const center = calculateBoardViewportLayout({
      viewportWidth: 600,
      viewportHeight: 600,
      contentLeft: -300,
      contentTop: 0,
      contentWidth: 600,
      contentHeight: 600,
      zoom: 1.5,
      scrollX: 0.5,
      scrollY: 0.5,
    });
    const right = calculateBoardViewportLayout({
      viewportWidth: 600,
      viewportHeight: 600,
      contentLeft: -300,
      contentTop: 0,
      contentWidth: 600,
      contentHeight: 600,
      zoom: 1.5,
      scrollX: 1,
      scrollY: 1,
    });

    expect(left.rootX).toBe(450);
    expect(center.rootX).toBe(300);
    expect(right.rootX).toBe(150);
    expect(center.rootY).toBe(-150);
    expect(center.viewportWidthRatio).toBeCloseTo(2 / 3);
    expect(center.viewportHeightRatio).toBeCloseTo(2 / 3);
  });

  it('centers content that remains smaller than the viewport and clamps scrolling', () => {
    const layout = calculateBoardViewportLayout({
      viewportWidth: 600,
      viewportHeight: 500,
      contentLeft: -100,
      contentTop: 20,
      contentWidth: 200,
      contentHeight: 200,
      zoom: 1.5,
      scrollX: 9,
      scrollY: -4,
    });

    expect(layout.rootX).toBe(300);
    expect(layout.rootY).toBe(70);
    expect(layout.scrollX).toBe(1);
    expect(layout.scrollY).toBe(0);
    expect(layout.viewportWidthRatio).toBe(1);
    expect(layout.viewportHeightRatio).toBe(1);
  });

  it('keeps zoomed content inset from the viewport edges without changing its preview ratio', () => {
    const left = calculateBoardViewportLayout({
      viewportWidth: 600,
      viewportHeight: 600,
      contentLeft: -300,
      contentTop: 0,
      contentWidth: 600,
      contentHeight: 600,
      zoom: 1.5,
      scrollX: 0,
      scrollY: 0,
      edgeInset: 16,
    });
    const right = calculateBoardViewportLayout({
      viewportWidth: 600,
      viewportHeight: 600,
      contentLeft: -300,
      contentTop: 0,
      contentWidth: 600,
      contentHeight: 600,
      zoom: 1.5,
      scrollX: 1,
      scrollY: 1,
      edgeInset: 16,
    });

    expect(left.rootX).toBe(466);
    expect(left.rootY).toBe(16);
    expect(right.rootX).toBe(134);
    expect(right.rootY).toBe(-316);
    expect(left.viewportWidthRatio).toBeCloseTo(2 / 3);
    expect(left.viewportHeightRatio).toBeCloseTo(2 / 3);
  });
});
