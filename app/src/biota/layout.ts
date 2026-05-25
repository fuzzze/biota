// Honeycomb layout planning for the encoder (pure; the caller draws templates).

import { DX0, DY0, MAX_TPL } from "./constants";

export type AspectKind = "vertical" | "square" | "horizontal";

export function aspectRatio(kind: AspectKind): number {
  switch (kind) {
    case "vertical": return 9 / 16;
    case "horizontal": return 16 / 9;
    default: return 1;
  }
}

export interface Layout {
  width: number;
  height: number;
  cols: number;
  rows: number;
  dx: number;
  dy: number;
  off: number;
  pad: number; // origin padding (half of largest scaled tile)
  cells: { cx: number; cy: number }[]; // one per (padded) digit, row-major
}

function dims(tileCount: number, cols: number, scale: number) {
  const dx = DX0 * scale, dy = DY0 * scale, off = dx / 2;
  const rows = Math.ceil(tileCount / cols);
  const pad = Math.ceil((MAX_TPL * scale) / 2) + 2;
  const width = Math.ceil(2 * pad + off + (cols - 1) * dx);
  const height = Math.ceil(2 * pad + (rows - 1) * dy);
  return { dx, dy, off, rows, pad, width, height };
}

/** Pick the column count whose resulting image aspect best matches the target. */
export function chooseCols(tileCount: number, kind: AspectKind, scale: number): number {
  if (tileCount <= 1) return 1;
  const target = aspectRatio(kind);
  let best = 1, bestErr = Infinity;
  for (let c = 1; c <= tileCount; c++) {
    const d = dims(tileCount, c, scale);
    const err = Math.abs(d.width / d.height - target);
    if (err < bestErr) { bestErr = err; best = c; }
  }
  return best;
}

/** Plan the full grid: canvas size + center of every (padded) cell. */
export function planLayout(tileCount: number, cols: number, scale: number): Layout {
  cols = Math.max(1, cols);
  const { dx, dy, off, rows, pad, width, height } = dims(tileCount, cols, scale);
  const padded = rows * cols;
  const parityOff = (r: number) => (r % 2 === 0 ? off : 0);
  const cells: { cx: number; cy: number }[] = [];
  for (let i = 0; i < padded; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    cells.push({ cx: pad + parityOff(r) + c * dx, cy: pad + r * dy });
  }
  return { width, height, cols, rows, dx, dy, off, pad, cells };
}
