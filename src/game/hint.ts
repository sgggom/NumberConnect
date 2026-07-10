export const isConsecutiveHint = (currentPathLength: number, nextVisibleIndex: number): boolean =>
  currentPathLength > 0 && nextVisibleIndex === currentPathLength;
