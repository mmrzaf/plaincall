import { describe, expect, it } from 'vitest';
import { computeGrid } from './layout';

const WIDE = 16 / 9;

describe('computeGrid', () => {
  it('gives one tile as much room as fits', () => {
    const layout = computeGrid(1, 1600, 900, 8, WIDE);
    expect(layout).toEqual({ columns: 1, rows: 1, tileWidth: 1600, tileHeight: 900 });
  });

  it('places two tiles side by side on a wide area', () => {
    const layout = computeGrid(2, 1600, 900, 8, WIDE);
    expect(layout.columns).toBe(2);
    expect(layout.rows).toBe(1);
  });

  it('stacks two tiles on a tall area', () => {
    const layout = computeGrid(2, 400, 900, 8, WIDE);
    expect(layout.columns).toBe(1);
    expect(layout.rows).toBe(2);
  });

  it('makes a square of four tiles on a wide area', () => {
    const layout = computeGrid(4, 1600, 900, 8, WIDE);
    expect(layout.columns).toBe(2);
    expect(layout.rows).toBe(2);
  });

  it('never lets tiles overflow the area', () => {
    for (const count of [1, 2, 3, 5, 7, 9, 13, 20]) {
      for (const [width, height] of [[1600, 900], [390, 700], [900, 400], [700, 700]] as const) {
        const { columns, rows, tileWidth, tileHeight } = computeGrid(count, width, height, 8, WIDE);
        expect(columns * rows, `${count} tiles`).toBeGreaterThanOrEqual(count);
        expect(columns * tileWidth + 8 * (columns - 1)).toBeLessThanOrEqual(width + 1);
        expect(rows * tileHeight + 8 * (rows - 1)).toBeLessThanOrEqual(height + 1);
      }
    }
  });

  it('keeps the aspect ratio', () => {
    const { tileWidth, tileHeight } = computeGrid(6, 1200, 800, 8, WIDE);
    expect(tileWidth / tileHeight).toBeCloseTo(WIDE, 1);
  });

  it('copes with empty or negative areas and odd counts', () => {
    expect(computeGrid(3, 0, 0, 8, WIDE).columns).toBeGreaterThanOrEqual(1);
    expect(computeGrid(0, 800, 600, 8, WIDE).columns).toBe(1);
    expect(computeGrid(3, -5, 600, 8, WIDE).tileWidth).toBe(0);
    expect(() => computeGrid(50, 100, 100, 8, WIDE)).not.toThrow();
  });
});
