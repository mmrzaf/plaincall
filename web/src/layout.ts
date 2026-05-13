export interface GridLayout {
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
}

/**
 * Chooses how many columns give the largest tiles of a fixed aspect ratio for
 * `count` tiles inside a `width` by `height` area separated by `gap` pixels.
 */
export function computeGrid(count: number, width: number, height: number, gap: number, aspect: number): GridLayout {
  const tiles = Math.max(1, Math.floor(count));
  if (!(width > 0) || !(height > 0)) {
    return { columns: 1, rows: tiles, tileWidth: 0, tileHeight: 0 };
  }

  let best: GridLayout = { columns: 1, rows: tiles, tileWidth: 0, tileHeight: 0 };
  let bestArea = -1;
  let bestEmpty = Infinity;

  for (let columns = 1; columns <= tiles; columns++) {
    const rows = Math.ceil(tiles / columns);
    const cellWidth = (width - gap * (columns - 1)) / columns;
    const cellHeight = (height - gap * (rows - 1)) / rows;
    if (cellWidth <= 0 || cellHeight <= 0) continue;

    const tileWidth = Math.min(cellWidth, cellHeight * aspect);
    const tileHeight = tileWidth / aspect;
    const area = tileWidth * tileHeight;
    const empty = columns * rows - tiles;

    const larger = area > bestArea + 1e-6;
    const sameSizeFewerGaps = Math.abs(area - bestArea) <= 1e-6 && empty < bestEmpty;
    if (larger || sameSizeFewerGaps) {
      best = { columns, rows, tileWidth: Math.floor(tileWidth), tileHeight: Math.floor(tileHeight) };
      bestArea = area;
      bestEmpty = empty;
    }
  }
  return best;
}
