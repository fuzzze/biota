// Grayscale image primitives for the decoder.

export interface RGBA {
  data: Uint8ClampedArray | Uint8Array; // RGBA, row-major
  width: number;
  height: number;
}

export interface Gray {
  px: Float32Array;
  w: number;
  h: number;
}

/** RGBA over black background -> luminance (arcs ~255, transparent bg -> 0). */
export function compositeLum(img: RGBA): Gray {
  const { data, width: w, height: h } = img;
  const px = new Float32Array(w * h);
  for (let i = 0, p = 0; i < px.length; i++, p += 4) {
    const al = data[p + 3] / 255;
    px[i] = ((data[p] + data[p + 1] + data[p + 2]) / 3) * al;
  }
  return { px, w, h };
}

// ---- antialiased separable resample (triangle filter, Pillow-like) ----
function resampleWeights(nIn: number, nOut: number): { idx: Int32Array; w: Float32Array; taps: number }[] {
  const scale = nIn / nOut;
  const filterScale = Math.max(1, scale); // antialias when downscaling
  const support = filterScale; // triangle support radius
  const result: { idx: Int32Array; w: Float32Array; taps: number }[] = [];
  for (let o = 0; o < nOut; o++) {
    const center = (o + 0.5) * scale;
    const left = Math.max(0, Math.floor(center - support + 0.5));
    const right = Math.min(nIn, Math.ceil(center + support + 0.5));
    const taps = right - left;
    const idx = new Int32Array(taps);
    const w = new Float32Array(taps);
    let sum = 0;
    for (let k = 0; k < taps; k++) {
      const s = left + k;
      const t = Math.abs((s + 0.5 - center) / filterScale);
      const weight = t < 1 ? 1 - t : 0;
      idx[k] = s;
      w[k] = weight;
      sum += weight;
    }
    if (sum > 0) for (let k = 0; k < taps; k++) w[k] /= sum;
    result.push({ idx, w, taps });
  }
  return result;
}

export function resizeGray(src: Gray, dw: number, dh: number): Gray {
  const { px, w: sw, h: sh } = src;
  // horizontal
  const hw = resampleWeights(sw, dw);
  const tmp = new Float32Array(dw * sh);
  for (let y = 0; y < sh; y++) {
    const row = y * sw;
    for (let x = 0; x < dw; x++) {
      const { idx, w, taps } = hw[x];
      let acc = 0;
      for (let k = 0; k < taps; k++) acc += px[row + idx[k]] * w[k];
      tmp[y * dw + x] = acc;
    }
  }
  // vertical
  const vw = resampleWeights(sh, dh);
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const { idx, w, taps } = vw[y];
    for (let x = 0; x < dw; x++) {
      let acc = 0;
      for (let k = 0; k < taps; k++) acc += tmp[idx[k] * dw + x] * w[k];
      out[y * dw + x] = acc;
    }
  }
  return { px: out, w: dw, h: dh };
}

/** Crop a centered (s x s) window around the image center. */
export function centerCrop(src: Gray, s: number): Float32Array {
  const r = s >> 1;
  const cy = (src.h >> 1) - r;
  const cx = (src.w >> 1) - r;
  const out = new Float32Array(s * s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const sy = cy + y, sx = cx + x;
      out[y * s + x] = sy >= 0 && sy < src.h && sx >= 0 && sx < src.w ? src.px[sy * src.w + sx] : 0;
    }
  }
  return out;
}

/** Boolean disk mask of size s (radius s>>1). */
export function diskMask(s: number): Uint8Array {
  const r = s >> 1;
  const m = new Uint8Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) m[y * s + x] = (y - r) * (y - r) + (x - r) * (x - r) <= r * r ? 1 : 0;
  return m;
}

/** Separable centered 2D sliding-window maximum (size odd). Out-of-range ignored. */
export function maxFilter2D(src: Float32Array, w: number, h: number, size: number): Float32Array {
  const r = size >> 1;
  const tmp = new Float32Array(w * h);
  // horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let mx = -Infinity;
      const lo = Math.max(0, x - r), hi = Math.min(w - 1, x + r);
      for (let k = lo; k <= hi; k++) if (src[row + k] > mx) mx = src[row + k];
      tmp[row + x] = mx;
    }
  }
  // vertical
  const out = new Float32Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let mx = -Infinity;
      const lo = Math.max(0, y - r), hi = Math.min(h - 1, y + r);
      for (let k = lo; k <= hi; k++) if (tmp[k * w + x] > mx) mx = tmp[k * w + x];
      out[y * w + x] = mx;
    }
  }
  return out;
}
