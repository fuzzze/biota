// Intrinsic grid geometry — must match all three Biota codebases.
export const W0 = 340;
export const DX0 = Math.round((W0 * Math.sqrt(3)) / 2); // 294
export const DY0 = W0 * 0.75; // 255
export const R0 = 120; // central matching-disk radius at base scale
export const MAX_TPL = 466; // largest template dimension (tpl_5), for canvas margins

// Render scale for the in-app encoder (tile lattice dx = DX0 * RENDER_SCALE).
// Tiles are painted from the vector source (tile.svg) so they stay crisp at any
// scale; this just trades output resolution against file size.
export const RENDER_SCALE = 0.5;

// Pixel size each rotated tile SVG is rasterized to. Chosen so the hexagon inside
// the 0 0 340 340 viewBox lands at exactly DX0 * RENDER_SCALE = the lattice pitch,
// letting paintGrid blit the tile 1:1 (no extra scaling) for maximum sharpness.
export const TILE_PX = Math.round(W0 * RENDER_SCALE);

