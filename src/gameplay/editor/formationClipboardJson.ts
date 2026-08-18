export const encodeFormationClipboardJson = (
  rows: number,
  columns: number,
  activeCells: ReadonlySet<string>,
): string => JSON.stringify({
  data: Array.from({ length: rows }, (_, y) => Array.from(
    { length: columns },
    (_, x) => (activeCells.has(`${x},${y}`) ? 999 : 0),
  )),
});
