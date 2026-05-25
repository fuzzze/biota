// Intrinsic grid geometry — must match all three Biota codebases.
export const W0 = 340;
export const DX0 = Math.round((W0 * Math.sqrt(3)) / 2); // 294
export const DY0 = W0 * 0.75; // 255
export const R0 = 120; // central matching-disk radius at base scale
export const MAX_TPL = 466; // largest template dimension (tpl_5), for canvas margins

// Render scale for the in-app encoder (tile lattice dx = DX0 * RENDER_SCALE).
// Small enough to keep generated PNGs and the decoder's FFTs fast, large enough
// for reliable NCC classification on clean exports.
export const RENDER_SCALE = 0.22;

