export interface BoardViewportLayoutInput {
  viewportWidth: number;
  viewportHeight: number;
  contentLeft: number;
  contentTop: number;
  contentWidth: number;
  contentHeight: number;
  zoom: number;
  scrollX: number;
  scrollY: number;
  edgeInset?: number;
}

export interface BoardViewportLayout {
  rootX: number;
  rootY: number;
  scrollX: number;
  scrollY: number;
  viewportWidthRatio: number;
  viewportHeightRatio: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const axisLayout = (
  viewportSize: number,
  contentStart: number,
  contentSize: number,
  zoom: number,
  scroll: number,
  edgeInset: number,
): { root: number; ratio: number } => {
  const scaledContentSize = Math.max(1, contentSize * zoom);
  if (scaledContentSize <= viewportSize) {
    return {
      root: -contentStart * zoom + (viewportSize - scaledContentSize) * 0.5,
      ratio: 1,
    };
  }
  const inset = Math.max(0, Math.min(viewportSize * 0.25, edgeInset));
  const overflow = scaledContentSize - viewportSize + inset * 2;
  return {
    root: inset - contentStart * zoom - overflow * scroll,
    ratio: viewportSize / scaledContentSize,
  };
};

export const calculateBoardViewportLayout = (
  input: BoardViewportLayoutInput,
): BoardViewportLayout => {
  const zoom = Math.max(0.01, input.zoom);
  const viewportWidth = Math.max(1, input.viewportWidth);
  const viewportHeight = Math.max(1, input.viewportHeight);
  const edgeInset = Math.max(0, input.edgeInset ?? 0);
  const scrollX = clamp01(input.scrollX);
  const scrollY = clamp01(input.scrollY);
  const horizontal = axisLayout(
    viewportWidth,
    input.contentLeft,
    input.contentWidth,
    zoom,
    scrollX,
    edgeInset,
  );
  const vertical = axisLayout(
    viewportHeight,
    input.contentTop,
    input.contentHeight,
    zoom,
    scrollY,
    edgeInset,
  );
  return {
    rootX: horizontal.root,
    rootY: vertical.root,
    scrollX,
    scrollY,
    viewportWidthRatio: horizontal.ratio,
    viewportHeightRatio: vertical.ratio,
  };
};
