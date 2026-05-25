// Reed-Solomon over GF(256), prim=0x11d, generator=2, fcr=0.
//
// rsEncode/rsFrame are ported verbatim from the JS encoders (byte-for-byte equal
// to Python `reedsolo`). rsDecode* is a new port of the `reedsolo` decoder
// (Berlekamp-Massey + Chien + Forney), since the encoders never needed to decode.
// Verified end-to-end against decoder/decode.py on samples/sample_encrypted.png.

export const NSYM = 8; // RS parity per body block (corrects up to 4 byte errors)
export const KBLK = 223; // RS data bytes per body block (KBLK+NSYM <= 255)
export const HDR_NSYM = 4; // RS parity for the 2-byte length header
const PRIM = 0x11d;

// ---- GF(256) tables (generator = 2) ----
function gfInit() {
  const exp = new Array<number>(512);
  const log = new Array<number>(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = x;
    log[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= PRIM;
  }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
  return { exp, log };
}
const GF = gfInit();

const gmul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : GF.exp[(GF.log[a] + GF.log[b]) % 255]);
const gdiv = (a: number, b: number): number => (a === 0 ? 0 : GF.exp[(GF.log[a] + 255 - GF.log[b]) % 255]);
const ginv = (a: number): number => GF.exp[255 - GF.log[a]];
function gpow(x: number, power: number): number {
  // handles negative powers (Python's % is non-negative)
  let i = (GF.log[x] * power) % 255;
  if (i < 0) i += 255;
  return GF.exp[i];
}

// ================= encode side (verbatim) =================
function rsGenPoly(nsym: number): number[] {
  let g = [1];
  for (let i = 0; i < nsym; i++) {
    const f = [1, GF.exp[i]];
    const ng = new Array<number>(g.length + 1).fill(0);
    for (let a = 0; a < g.length; a++) for (let b = 0; b < f.length; b++) ng[a + b] ^= gmul(g[a], f[b]);
    g = ng;
  }
  return g;
}

export function rsEncode(msg: number[], nsym: number): number[] {
  const gen = rsGenPoly(nsym);
  const out = msg.concat(new Array<number>(nsym).fill(0));
  for (let i = 0; i < msg.length; i++) {
    const coef = out[i];
    if (coef !== 0) for (let j = 1; j < gen.length; j++) out[i + j] ^= gmul(gen[j], coef);
  }
  return msg.concat(out.slice(msg.length));
}

export function rsFrame(payload: number[]): number[] {
  let body: number[] = [];
  for (let i = 0; i < payload.length; i += KBLK) body = body.concat(rsEncode(payload.slice(i, i + KBLK), NSYM));
  const bl = body.length;
  return rsEncode([(bl >>> 8) & 255, bl & 255], HDR_NSYM).concat(body);
}

// ================= decode side (port of reedsolo) =================
// Polynomials are coefficient lists, index 0 = highest degree.

function polyScale(p: number[], x: number): number[] {
  return p.map((c) => gmul(c, x));
}
function polyAdd(p: number[], q: number[]): number[] {
  const r = new Array<number>(Math.max(p.length, q.length)).fill(0);
  for (let i = 0; i < p.length; i++) r[i + r.length - p.length] = p[i];
  for (let i = 0; i < q.length; i++) r[i + r.length - q.length] ^= q[i];
  return r;
}
function polyMul(p: number[], q: number[]): number[] {
  const r = new Array<number>(p.length + q.length - 1).fill(0);
  for (let j = 0; j < q.length; j++) for (let i = 0; i < p.length; i++) r[i + j] ^= gmul(p[i], q[j]);
  return r;
}
function polyEval(poly: number[], x: number): number {
  let y = poly[0];
  for (let i = 1; i < poly.length; i++) y = gmul(y, x) ^ poly[i];
  return y;
}

function calcSyndromes(msg: number[], nsym: number): number[] {
  const synd = [0];
  for (let i = 0; i < nsym; i++) synd.push(polyEval(msg, gpow(2, i))); // fcr = 0
  return synd;
}

function findErrorLocator(synd: number[], nsym: number): number[] {
  let errLoc = [1];
  let oldLoc = [1];
  const syndShift = synd.length > nsym ? synd.length - nsym : 0;
  for (let i = 0; i < nsym; i++) {
    const K = i + syndShift;
    let delta = synd[K];
    for (let j = 1; j < errLoc.length; j++) delta ^= gmul(errLoc[errLoc.length - (j + 1)], synd[K - j]);
    oldLoc = oldLoc.concat([0]);
    if (delta !== 0) {
      if (oldLoc.length > errLoc.length) {
        const newLoc = polyScale(oldLoc, delta);
        oldLoc = polyScale(errLoc, ginv(delta));
        errLoc = newLoc;
      }
      errLoc = polyAdd(errLoc, polyScale(oldLoc, delta));
    }
  }
  while (errLoc.length && errLoc[0] === 0) errLoc.shift();
  const errs = errLoc.length - 1;
  if (errs * 2 > nsym) throw new Error("RS: too many errors to correct");
  return errLoc;
}

function findErrors(errLocRev: number[], nmess: number): number[] {
  const errs = errLocRev.length - 1;
  const errPos: number[] = [];
  for (let i = 0; i < nmess; i++) {
    if (polyEval(errLocRev, gpow(2, i)) === 0) errPos.push(nmess - 1 - i);
  }
  if (errPos.length !== errs) throw new Error("RS: error localization failed (Chien)");
  return errPos;
}

function findErrataLocator(coefPos: number[]): number[] {
  let eLoc = [1];
  for (const i of coefPos) eLoc = polyMul(eLoc, polyAdd([1], [gpow(2, i), 0]));
  return eLoc;
}

function findErrorEvaluator(synd: number[], errLoc: number[], nsym: number): number[] {
  // remainder of (synd * errLoc) / x^(nsym+1)
  const prod = polyMul(synd, errLoc);
  const divisor = [1].concat(new Array<number>(nsym + 1).fill(0));
  const out = prod.slice();
  for (let i = 0; i < prod.length - (divisor.length - 1); i++) {
    const coef = out[i];
    if (coef !== 0) for (let j = 1; j < divisor.length; j++) if (divisor[j] !== 0) out[i + j] ^= gmul(divisor[j], coef);
  }
  const sep = -(divisor.length - 1);
  return out.slice(out.length + sep);
}

function correctErrata(msgIn: number[], synd: number[], errPos: number[]): number[] {
  const coefPos = errPos.map((p) => msgIn.length - 1 - p);
  const errLoc = findErrataLocator(coefPos);
  const errEval = findErrorEvaluator(synd.slice().reverse(), errLoc, errLoc.length - 1).reverse();

  const X: number[] = [];
  for (const cp of coefPos) {
    const l = 255 - cp;
    X.push(gpow(2, -l));
  }

  const E = new Array<number>(msgIn.length).fill(0);
  for (let i = 0; i < X.length; i++) {
    const Xi = X[i];
    const XiInv = ginv(Xi);
    let errLocPrime = 1;
    for (let j = 0; j < X.length; j++) if (j !== i) errLocPrime = gmul(errLocPrime, 1 ^ gmul(XiInv, X[j]));
    let y = polyEval(errEval.slice().reverse(), XiInv);
    y = gmul(gpow(Xi, 1), y); // 1 - fcr = 1
    if (errLocPrime === 0) throw new Error("RS: errata correction failed (singular)");
    E[errPos[i]] = gdiv(y, errLocPrime);
  }
  return polyAdd(msgIn, E);
}

/** Decode one RS codeword (data+parity); returns corrected data and error count. */
export function rsDecodeChunk(codeword: number[], nsym: number): { data: number[]; errs: number } {
  if (codeword.length > 255) throw new Error("RS: codeword too long");
  let msgOut = codeword.slice();
  const synd = calcSyndromes(msgOut, nsym);
  if (Math.max(...synd) === 0) return { data: msgOut.slice(0, msgOut.length - nsym), errs: 0 };
  const errLoc = findErrorLocator(synd, nsym);
  const errPos = findErrors(errLoc.slice().reverse(), msgOut.length);
  msgOut = correctErrata(msgOut, synd, errPos);
  const check = calcSyndromes(msgOut, nsym);
  if (Math.max(...check) > 0) throw new Error("RS: could not correct message");
  return { data: msgOut.slice(0, msgOut.length - nsym), errs: errPos.length };
}

/** Decode a full Biota frame (RS header + RS body blocks) -> payload bytes. */
export function rsDecodeFrame(allb: number[]): { payload: number[]; errs: number } {
  if (allb.length < 6) throw new Error("RS: frame too short");
  const hdr = rsDecodeChunk(allb.slice(0, 6), HDR_NSYM);
  const bl = (hdr.data[0] << 8) | hdr.data[1];
  const body = allb.slice(6, 6 + bl);
  if (body.length < bl) throw new Error(`RS: truncated body (${body.length}<${bl})`);
  const payload: number[] = [];
  let errs = hdr.errs;
  let pos = 0;
  while (pos < bl) {
    const rem = bl - pos;
    const bln = rem > KBLK + NSYM ? KBLK + NSYM : rem;
    const dec = rsDecodeChunk(body.slice(pos, pos + bln), NSYM);
    payload.push(...dec.data);
    errs += dec.errs;
    pos += bln;
  }
  return { payload, errs };
}
