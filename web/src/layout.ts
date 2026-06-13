export type GridLayout = { columns: number; rows: number };

export function chooseGridLayout(count: number, width: number, height: number): GridLayout {
  if (count <= 1) return { columns: 1, rows: 1 };
  const gap = 12;
  const compact = width < 720;
  const targetRatio = 16 / 9;
  const minimumColumns = compact && count >= 4 ? 2 : 1;
  const maximumColumns = compact ? Math.min(2, count) : count;
  let best: GridLayout = { columns: 1, rows: count };
  let bestScore = -Infinity;

  for (let columns = minimumColumns; columns <= maximumColumns; columns += 1) {
    const rows = Math.ceil(count / columns);
    const cellWidth = (width - gap * (columns - 1)) / columns;
    const cellHeight = (height - gap * (rows - 1)) / rows;
    if (cellWidth <= 0 || cellHeight <= 0) continue;

    const fittedWidth = Math.min(cellWidth, cellHeight * targetRatio);
    const fittedHeight = Math.min(cellHeight, cellWidth / targetRatio);
    const area = fittedWidth * fittedHeight * count;
    const emptySlots = rows * columns - count;
    const minimumWidth = compact ? 145 : 205;
    const minimumHeight = compact ? 112 : 150;
    const undersizePenalty = Math.max(0, minimumWidth - cellWidth) * 8_000
      + Math.max(0, minimumHeight - cellHeight) * 8_000;
    const emptyPenalty = emptySlots * area * 0.045;
    const score = area - undersizePenalty - emptyPenalty;
    if (score > bestScore) {
      bestScore = score;
      best = { columns, rows };
    }
  }
  return best;
}
