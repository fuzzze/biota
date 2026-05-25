// Shared encoder rendering: pure planning + a canvas-agnostic paint loop used by
// both the app (DOM canvas) and the Node test harness (@napi-rs/canvas).

import { planLayout, chooseCols, type AspectKind, type Layout } from "./layout";
import { encodeToDigits } from "./digits";
import { RENDER_SCALE } from "./constants";

// Solid black background: identical to a transparent export for the decoder
// (background luminance = 0), but the saved PNG is visible in any image viewer.
export const BG = "#000000";

export interface Ctx2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(img: unknown, dx: number, dy: number, dw: number, dh: number): void;
}

export interface Tile {
  img: unknown; // HTMLImageElement | napi Image
  w: number; // native template pixel width
  h: number; // native template pixel height
}

export function planEncode(text: string, secret: string, kind: AspectKind) {
  const { digits } = encodeToDigits(text, secret);
  const cols = chooseCols(digits.length, kind, RENDER_SCALE);
  const layout = planLayout(digits.length, cols, RENDER_SCALE);
  return { digits, cols, layout };
}

export function paintGrid(ctx: Ctx2D, layout: Layout, digits: number[], tiles: Tile[]): void {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, layout.width, layout.height);
  layout.cells.forEach((cell, i) => {
    const d = i < digits.length ? digits[i] : 0;
    const t = tiles[d];
    const w = t.w * RENDER_SCALE, h = t.h * RENDER_SCALE;
    (ctx.drawImage as (img: unknown, dx: number, dy: number, dw: number, dh: number) => void)(
      t.img, cell.cx - w / 2, cell.cy - h / 2, w, h,
    );
  });
}
