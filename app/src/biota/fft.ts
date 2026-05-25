// Minimal iterative radix-2 FFT (in-place, power-of-two lengths) used by the
// decoder for lattice-scale estimation (axial autocorrelation) and the
// matched-filter convolution that locates tile centers.

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** In-place complex FFT. re/im length must be a power of two. inverse=true scales by 1/N. */
export function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curR = 1, curI = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = i + k + half;
        const ur = re[a], ui = im[a];
        const vr = re[b] * curR - im[b] * curI;
        const vi = re[b] * curI + im[b] * curR;
        re[a] = ur + vr; im[a] = ui + vi;
        re[b] = ur - vr; im[b] = ui - vi;
        const ncr = curR * wr - curI * wi;
        curI = curR * wi + curI * wr;
        curR = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/** In-place 2D FFT on a w*h grid (w, h powers of two), row-major. */
export function fft2d(re: Float64Array, im: Float64Array, w: number, h: number, inverse: boolean): void {
  const rowRe = new Float64Array(w), rowIm = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    const off = y * w;
    rowRe.set(re.subarray(off, off + w));
    rowIm.set(im.subarray(off, off + w));
    fft(rowRe, rowIm, inverse);
    re.set(rowRe, off);
    im.set(rowIm, off);
  }
  const colRe = new Float64Array(h), colIm = new Float64Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) { colRe[y] = re[y * w + x]; colIm[y] = im[y * w + x]; }
    fft(colRe, colIm, inverse);
    for (let y = 0; y < h; y++) { re[y * w + x] = colRe[y]; im[y * w + x] = colIm[y]; }
  }
}
