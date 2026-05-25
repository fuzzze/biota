// Biota decoder: PNG pixels -> text. Port of decoder/decode.py.
//   composite_lum -> estimate scale (axial autocorrelation) -> matched-filter
//   tile centers -> snap to lattice -> classify rotations (NCC vs 6 templates)
//   -> base-6 digits -> bytes -> Reed-Solomon -> decrypt + verify MAC.

import { fft, fft2d, nextPow2 } from "./fft";
import {
  RGBA, Gray, compositeLum, resizeGray, centerCrop, diskMask, maxFilter2D,
} from "./imaging";
import { digitsToBytes } from "./digits";
import { rsDecodeFrame } from "./rs";
import { decryptPayload, bytesToString } from "./crypto";
import { DX0, DY0, R0 } from "./constants";

const MAXWORK = 2000; // downscale loaded images so the FFTs stay bounded

export interface TemplateLum { gray: Gray } // native-resolution luminance of tpl_k
export type TemplateSet = TemplateLum[]; // length 6

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function mean(a: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s / a.length;
}

// ---------- scale estimation via axial autocorrelation ----------
function axisFund(sig: Float64Array, lim: number): { f: number | null; conf: number } {
  const peaks: number[] = [];
  for (let r = 15; r < lim - 1; r++) if (sig[r] >= sig[r - 1] && sig[r] > sig[r + 1] && sig[r] > 0) peaks.push(r);
  if (peaks.length === 0) return { f: null, conf: 0 };
  let mx = -Infinity;
  for (const r of peaks) if (sig[r] > mx) mx = sig[r];
  const strong = peaks.filter((r) => sig[r] >= 0.6 * mx);
  const f = Math.min(...strong);
  return { f, conf: sig[f] / sig[0] };
}

// accumulate Σ |FFT(line - mean)|^2 over rows (axis=0) or columns (axis=1), IFFT -> autocorr
function axialAutocorr(F: Float32Array, w: number, h: number, mu: number, axis: 0 | 1): Float64Array {
  const len = axis === 0 ? w : h;
  const cnt = axis === 0 ? h : w;
  const P = nextPow2(2 * len);
  const acc = new Float64Array(P);
  const re = new Float64Array(P), im = new Float64Array(P);
  for (let c = 0; c < cnt; c++) {
    re.fill(0); im.fill(0);
    if (axis === 0) {
      const off = c * w;
      for (let x = 0; x < len; x++) re[x] = F[off + x] - mu;
    } else {
      for (let y = 0; y < len; y++) re[y] = F[y * w + c] - mu;
    }
    fft(re, im, false);
    for (let k = 0; k < P; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
  }
  const ai = new Float64Array(P);
  fft(acc, ai, true); // inverse; acc now holds the real autocorrelation
  return acc;
}

function estimateScale(F: Float32Array, w: number, h: number): number {
  const mu = mean(F);
  const ah = axialAutocorr(F, w, h, mu, 0);
  const av = axialAutocorr(F, w, h, mu, 1);
  const rh = axisFund(ah, Math.min(1500, w >> 1));
  const rv = axisFund(av, Math.min(1500, h >> 1));
  const cand: [number, number][] = []; // [conf, scale]
  if (rh.f) cand.push([rh.conf, rh.f / DX0]);
  if (rv.f) cand.push([rv.conf, rv.f / (2 * DY0)]);
  if (cand.length === 0) return 1;
  cand.sort((a, b) => b[0] - a[0]);
  return cand[0][1];
}

// ---------- matched filter (FFT convolution, 'same') ----------
// Returns cross-correlation of F0 (w x h) with an (s x s) odd kernel, centered.
function matchedFilter(F0: Float32Array, w: number, h: number, kern: Float32Array, s: number): Float32Array {
  const r = s >> 1;
  const Pw = nextPow2(w + s - 1), Ph = nextPow2(h + s - 1);
  const re = new Float64Array(Pw * Ph), im = new Float64Array(Pw * Ph);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) re[y * Pw + x] = F0[y * w + x];
  // kernel reversed in both axes (conv with reversed kernel == correlation)
  const kre = new Float64Array(Pw * Ph), kim = new Float64Array(Pw * Ph);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) kre[y * Pw + x] = kern[(s - 1 - y) * s + (s - 1 - x)];
  fft2d(re, im, Pw, Ph, false);
  fft2d(kre, kim, Pw, Ph, false);
  for (let i = 0; i < re.length; i++) {
    const a = re[i], b = im[i], c = kre[i], d = kim[i];
    re[i] = a * c - b * d;
    im[i] = a * d + b * c;
  }
  fft2d(re, im, Pw, Ph, true);
  const out = new Float32Array(w * h);
  for (let p = 0; p < h; p++) for (let q = 0; q < w; q++) out[p * w + q] = re[(p + r) * Pw + (q + r)];
  return out;
}

// ---------- classification ----------
interface Classifier {
  s: number;
  mask: Uint8Array;
  maskIdx: Int32Array; // indices where mask>0
  tplVec: Float32Array[]; // 6 mean-subtracted masked vectors
  tplNorm: number[];
}

function buildClassifier(tpls: TemplateSet, scale: number): { cls: Classifier; kern: Float32Array } {
  const s = 2 * Math.round(R0 * scale) + 1;
  const mask = diskMask(s);
  const maskIdxArr: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) maskIdxArr.push(i);
  const maskIdx = Int32Array.from(maskIdxArr);

  const masked: Float32Array[] = []; // s*s masked templates (for the invariant kernel)
  for (let k = 0; k < 6; k++) {
    const ns = Math.round(tpls[k].gray.w * scale);
    const resized = Math.abs(scale - 1) > 1e-3 ? resizeGray(tpls[k].gray, ns, ns) : tpls[k].gray;
    const cropped = centerCrop(resized, s);
    for (let i = 0; i < cropped.length; i++) cropped[i] *= mask[i];
    masked.push(cropped);
  }
  // rotation-invariant kernel = mean of 6 templates, mean-centered over mask, * mask
  const Tinv = new Float32Array(s * s);
  for (let i = 0; i < Tinv.length; i++) { let v = 0; for (let k = 0; k < 6; k++) v += masked[k][i]; Tinv[i] = v / 6; }
  let tinvMean = 0; for (const i of maskIdx) tinvMean += Tinv[i]; tinvMean /= maskIdx.length;
  const kern = new Float32Array(s * s);
  for (let i = 0; i < kern.length; i++) kern[i] = (Tinv[i] - tinvMean) * mask[i];

  // per-template masked, mean-subtracted vectors + norms
  const tplVec: Float32Array[] = [];
  const tplNorm: number[] = [];
  for (let k = 0; k < 6; k++) {
    const vec = new Float32Array(maskIdx.length);
    let m = 0;
    for (let j = 0; j < maskIdx.length; j++) { vec[j] = masked[k][maskIdx[j]]; m += vec[j]; }
    m /= maskIdx.length;
    let nrm = 0;
    for (let j = 0; j < vec.length; j++) { vec[j] -= m; nrm += vec[j] * vec[j]; }
    tplVec.push(vec);
    tplNorm.push(Math.sqrt(nrm));
  }
  return { cls: { s, mask, maskIdx, tplVec, tplNorm }, kern };
}

function classify(g: Gray, cy: number, cx: number, cls: Classifier): number {
  const { s, maskIdx, tplVec, tplNorm } = cls;
  const r = s >> 1;
  if (cy - r < 0 || cx - r < 0 || cy + r >= g.h || cx + r >= g.w) return 0;
  const pv = new Float32Array(maskIdx.length);
  let m = 0;
  for (let j = 0; j < maskIdx.length; j++) {
    const idx = maskIdx[j];
    const py = (idx / s) | 0, px = idx % s;
    const v = g.px[(cy - r + py) * g.w + (cx - r + px)];
    pv[j] = v; m += v;
  }
  m /= maskIdx.length;
  let pnrm = 0;
  for (let j = 0; j < pv.length; j++) { pv[j] -= m; pnrm += pv[j] * pv[j]; }
  pnrm = Math.sqrt(pnrm);
  let best = -2, bk = 0;
  for (let k = 0; k < 6; k++) {
    let dot = 0;
    const tv = tplVec[k];
    for (let j = 0; j < pv.length; j++) dot += pv[j] * tv[j];
    const sc = dot / (pnrm * tplNorm[k] + 1e-9);
    if (sc > best) { best = sc; bk = k; }
  }
  return bk;
}

export interface ReadResult {
  digits: number[];
  scale: number;
  dx: number;
  dy: number;
  R: number;
  C: number;
  tiles: number;
}

/** Detect the grid in a (working-resolution) luminance image and read base-6 digits. */
function readDigits(g: Gray, tpls: TemplateSet): ReadResult {
  const w = g.w, h = g.h;
  const F = new Float32Array(w * h);
  for (let i = 0; i < F.length; i++) F[i] = g.px[i] > 128 ? 1 : 0;

  const scale = estimateScale(F, w, h);
  const { cls, kern } = buildClassifier(tpls, scale);
  const s = cls.s;

  const fMean = mean(F);
  const F0 = new Float32Array(F.length);
  for (let i = 0; i < F.length; i++) F0[i] = F[i] - fMean;
  const corr = matchedFilter(F0, w, h, kern, s);

  let cmax = -Infinity;
  for (let i = 0; i < corr.length; i++) if (corr[i] > cmax) cmax = corr[i];
  let nbh = Math.round(0.85 * DX0 * scale) | 1;
  if (nbh < 1) nbh = 1;
  const mxf = maxFilter2D(corr, w, h, nbh);

  const pts: { y: number; x: number; c: number }[] = [];
  const thr = 0.4 * cmax;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = corr[y * w + x];
    if (v === mxf[y * w + x] && v > thr) pts.push({ y, x, c: v });
  }
  if (pts.length === 0) throw new Error("No tiles detected — is this an encoded Biota PNG?");

  const dx = DX0 * scale, dy = DY0 * scale, off = dx / 2;
  const ys = pts.map((p) => p.y);
  const y0 = Math.min(...ys);
  const ay0 = y0 + median(ys.map((y) => (y - y0) - dy * Math.round((y - y0) / dy)));
  const ridx = (y: number) => Math.round((y - ay0) / dy);

  // Trim sparse boundary rows: image margins can spawn a few spurious peaks above
  // or below the grid, which would shift row indices and flip the even/odd shift
  // parity (Biota always pads to full rows, so real rows are densely populated).
  const rowCount = new Map<number, number>();
  for (const p of pts) { const r = ridx(p.y); rowCount.set(r, (rowCount.get(r) || 0) + 1); }
  const maxRow = Math.max(...rowCount.values());
  const denseRows = [...rowCount.entries()].filter(([, n]) => n >= Math.max(2, 0.4 * maxRow)).map(([r]) => r);
  const rLo = Math.min(...denseRows), rHi = Math.max(...denseRows);
  const R = rHi - rLo + 1;
  const ay = ay0 + rLo * dy; // origin of (0-based) row 0 = top dense row = encoder row 0 (even/shifted)
  const parityOff = (r: number) => (r % 2 === 0 ? off : 0); // r is 0-based

  const inBlock = pts.filter((p) => { const r = ridx(p.y); return r >= rLo && r <= rHi; });
  const vals = inBlock.map((p) => p.x - parityOff(ridx(p.y) - rLo));
  const x0 = Math.min(...vals);
  let ax = x0 + median(vals.map((v) => (v - x0) - dx * Math.round((v - x0) / dx)));

  const raw = new Map<string, { r: number; cc: number; y: number; x: number; c: number }>();
  for (const p of inBlock) {
    const r = ridx(p.y) - rLo;
    const cc = Math.round((p.x - parityOff(r) - ax) / dx);
    const key = `${r},${cc}`;
    const prev = raw.get(key);
    if (!prev || p.c > prev.c) raw.set(key, { r, cc, y: p.y, x: p.x, c: p.c });
  }
  const colc = new Map<number, number>();
  for (const v of raw.values()) colc.set(v.cc, (colc.get(v.cc) || 0) + 1);
  if ((globalThis as any).process?.env?.BIOTA_DEBUG) {
    const rowc = new Map<number, number>();
    for (const v of raw.values()) rowc.set(v.r, (rowc.get(v.r) || 0) + 1);
    console.error("[dbg] R=", R, "rLo=", rLo, "rHi=", rHi, "pts=", pts.length, "rawcells=", raw.size);
    console.error("[dbg] colc=", JSON.stringify([...colc.entries()].sort((a, b) => a[0] - b[0])));
    console.error("[dbg] rowc=", JSON.stringify([...rowc.entries()].sort((a, b) => a[0] - b[0])));
  }
  const valid = [...colc.entries()].filter(([, n]) => n >= Math.max(2, 0.5 * R)).map(([c]) => c).sort((a, b) => a - b);
  if (valid.length === 0) throw new Error("No coherent grid columns found");
  const cLo = valid[0], cHi = valid[valid.length - 1];
  const C = cHi - cLo + 1;
  ax += cLo * dx;
  const cells = new Map<string, { y: number; x: number }>();
  for (const v of raw.values()) if (v.cc >= cLo && v.cc <= cHi) cells.set(`${v.r},${v.cc - cLo}`, { y: v.y, x: v.x });

  const digits: number[] = [];
  for (let r = 0; r < R; r++) {
    for (let cc = 0; cc < C; cc++) {
      const cell = cells.get(`${r},${cc}`);
      const y = cell ? cell.y : Math.round(ay + r * dy);
      const x = cell ? cell.x : Math.round(ax + parityOff(r) + cc * dx);
      digits.push(classify(g, Math.round(y), Math.round(x), cls));
    }
  }
  return { digits, scale, dx, dy, R, C, tiles: digits.length };
}

export interface DecodeResult {
  ok: boolean; // MAC verified
  text: string; // decoded text (when ok)
  errsCorrected: number; // RS byte errors corrected
  info: ReadResult;
  stage: "decoded" | "rs-failed" | "wrong-secret";
  message?: string; // human-readable status / error
}

/** Full decode: RGBA image + 6 native templates + secret -> text. */
export function decodeImage(img: RGBA, tpls: TemplateSet, secret: string): DecodeResult {
  let g = compositeLum(img);
  const longest = Math.max(g.w, g.h);
  if (longest > MAXWORK) {
    const f = MAXWORK / longest;
    g = resizeGray(g, Math.max(1, Math.round(g.w * f)), Math.max(1, Math.round(g.h * f)));
  }
  const info = readDigits(g, tpls);
  const allb = digitsToBytes(info.digits);
  let payload: number[];
  let errs: number;
  try {
    const dec = rsDecodeFrame(allb);
    payload = dec.payload;
    errs = dec.errs;
  } catch (e) {
    return { ok: false, text: "", errsCorrected: 0, info, stage: "rs-failed", message: String((e as Error).message || e) };
  }
  const { ok, bytes } = decryptPayload(payload, secret);
  if (!ok) return { ok: false, text: "", errsCorrected: errs, info, stage: "wrong-secret", message: "Wrong secret or corrupted data (MAC mismatch)" };
  return { ok: true, text: bytesToString(bytes), errsCorrected: errs, info, stage: "decoded" };
}
