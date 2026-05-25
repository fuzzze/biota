#!/usr/bin/env python3
"""
Decode text hidden in tile rotations of a honeycomb grid PNG.

Pipeline (reverse of the Sketch encoder):
  PNG -> detect lattice (scale/origin/size, auto) -> classify each tile's
  rotation against 6 templates -> base-6 digits -> bytes ->
  Reed-Solomon error correction -> decrypt(secret) + verify MAC -> text.

Usage:
  python3 decode.py <grid.png> "<secret>"     # direct
  python3 decode.py                            # interactive (macOS file picker + hidden secret)

Requirements: numpy scipy pillow reedsolo
Templates: tpl_0.png .. tpl_5.png (the symbol rendered at 0/60/.../300 deg, @1x)
           looked up in $HEX_TPL_DIR, ./templates, ../templates, script dir, /tmp/hexdecode.
"""
import os, sys, getpass, subprocess, hashlib
import numpy as np
from PIL import Image
from scipy.signal import fftconvolve
from scipy.ndimage import maximum_filter
try:
    import reedsolo
except Exception:
    reedsolo = None

# ---- format constants (MUST match the encoder) ----
ITER = 20000
NSYM = 8        # RS parity per body block (corrects up to 4 byte errors / block)
KBLK = 223      # RS data bytes per body block (KBLK+NSYM <= 255)
HDR_NSYM = 4    # RS parity for the 2-byte length header (corrects up to 2 errors)

# ---- intrinsic grid geometry (tile W=340 at base scale) ----
W0 = 340
DX0 = round(W0 * np.sqrt(3) / 2)   # 294
DY0 = W0 * 0.75                    # 255
R0 = 120                           # central matching-disk radius (base scale)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
def find_tpl_dir():
    candidates = (
        os.environ.get('HEX_TPL_DIR'),
        os.path.join(SCRIPT_DIR, 'templates'),
        os.path.join(SCRIPT_DIR, '..', 'templates'),
        SCRIPT_DIR,
        '/tmp/hexdecode',
    )
    for d in candidates:
        if d and os.path.exists(os.path.join(d, 'tpl_0.png')):
            return os.path.abspath(d)
    return None
TPLDIR = find_tpl_dir()

# ========== crypto (mirrors the Sketch encoder) ==========
def sha(b): return hashlib.sha256(bytes(b)).digest()
def derive(secret, salt):
    sb = secret.encode('utf-8'); k = sha(sb + bytes(salt))
    for _ in range(ITER): k = sha(k + sb)
    return k
def keystream(key, n):
    out = b''; c = 0
    while len(out) < n:
        out += sha(key + bytes([(c >> 24) & 255, (c >> 16) & 255, (c >> 8) & 255, c & 255])); c += 1
    return out[:n]
def decrypt_payload(payload, secret):
    if len(payload) < 15: return False, b''
    N = (payload[1] << 8) | payload[2]
    salt, mac, ct = payload[3:11], payload[11:15], payload[15:15 + N]
    if len(ct) < N: return False, b''
    key = derive(secret, salt)
    ok = sha(key + ct)[:4] == mac
    pt = bytes(c ^ k for c, k in zip(ct, keystream(key, N)))
    return ok, pt

# ========== Reed-Solomon framing (decode/correct) ==========
def rs_decode_frame(allb):
    """returns (payload_bytes, errors_corrected); raises on uncorrectable/malformed input"""
    if reedsolo is None:
        raise RuntimeError("reedsolo not installed (pip install reedsolo)")
    if len(allb) < 6:
        raise ValueError("frame too short")
    h, _, he = reedsolo.RSCodec(HDR_NSYM).decode(bytearray(allb[:6]))
    bl = (h[0] << 8) | h[1]
    body = bytearray(allb[6:6 + bl])
    if len(body) < bl:
        raise ValueError(f"truncated body ({len(body)}<{bl})")
    rsc = reedsolo.RSCodec(NSYM)
    payload = bytearray(); pos = 0; errs = len(he)
    while pos < bl:
        rem = bl - pos
        bln = (KBLK + NSYM) if rem > (KBLK + NSYM) else rem
        d, _, e = rsc.decode(bytearray(body[pos:pos + bln]))
        payload += d; errs += len(e); pos += bln
    return bytes(payload), errs

# ========== image / templates ==========
def composite_lum(path):
    a = np.asarray(Image.open(path).convert('RGBA')).astype(np.float32)
    al = a[..., 3:4] / 255.0
    return (a[..., :3] * al).mean(2)          # arcs ~255, bg 0

def disk_mask(s):
    r = s // 2; yy, xx = np.ogrid[:s, :s]
    return ((yy - r) ** 2 + (xx - r) ** 2) <= r * r

def center_crop(img, s):
    h, w = img.shape; r = s // 2
    return img[h // 2 - r:h // 2 + r + 1, w // 2 - r:w // 2 + r + 1]

def load_templates(scale):
    if TPLDIR is None:
        raise FileNotFoundError("templates tpl_0..5.png not found (set $HEX_TPL_DIR)")
    s = 2 * int(round(R0 * scale)) + 1; m = disk_mask(s); tpls = []
    for k in range(6):
        t = composite_lum(os.path.join(TPLDIR, f'tpl_{k}.png'))
        if abs(scale - 1.0) > 1e-3:
            ns = int(round(t.shape[0] * scale)); t = np.asarray(Image.fromarray(t).resize((ns, ns), Image.BILINEAR))
        tpls.append(center_crop(t, s).astype(np.float32) * m)
    return tpls, m, s

def estimate_scale(F):
    F0 = F - F.mean()
    A = np.fft.fftshift(np.fft.ifft2(np.abs(np.fft.fft2(F0)) ** 2).real)
    H, W = A.shape; cy, cx = H // 2, W // 2
    def axis_fund(sig):
        pk = [r for r in range(15, len(sig) - 1) if sig[r] >= sig[r - 1] and sig[r] > sig[r + 1] and sig[r] > 0]
        if not pk: return None, 0.0
        mx = max(sig[r] for r in pk); strong = [r for r in pk if sig[r] >= 0.6 * mx]
        f = min(strong); return f, float(sig[f] / sig[0])
    fh, ch = axis_fund(A[cy, cx:cx + min(1500, W // 2)])         # horizontal -> dx
    fv, cv = axis_fund(A[cy:cy + min(1500, H // 2), cx])          # vertical -> 2*dy
    cand = []
    if fh: cand.append((ch, fh / DX0))
    if fv: cand.append((cv, fv / (2 * DY0)))
    cand.sort(reverse=True)
    return cand[0][1] if cand else 1.0

def classify(g, cy, cx, tpls, m, s):
    r = s // 2; patch = g[cy - r:cy + r + 1, cx - r:cx + r + 1]
    if patch.shape != (s, s): return 0
    pv = (patch.astype(np.float32) * m)[m > 0]; pv = pv - pv.mean()
    best, bk = -2.0, 0
    for k in range(6):
        tv = tpls[k][m > 0]; tv = tv - tv.mean()
        sc = float((pv * tv).sum() / (np.linalg.norm(pv) * np.linalg.norm(tv) + 1e-9))
        if sc > best: best, bk = sc, k
    return bk

def read_digits(grid):
    g = composite_lum(grid); F = (g > 128).astype(np.float32)
    scale = estimate_scale(F); print(f'scale est: {scale:.3f}')
    tpls, m, s = load_templates(scale)
    Tinv = np.mean(tpls, axis=0); kern = (Tinv - Tinv[m > 0].mean()) * m
    corr = fftconvolve(F - F.mean(), kern[::-1, ::-1], mode='same')
    nbh = int(round(0.85 * DX0 * scale)) | 1
    mxf = maximum_filter(corr, size=nbh)
    peaks = np.argwhere((corr == mxf) & (corr > 0.4 * corr.max()))
    pts = [(int(y), int(x), float(corr[y, x])) for y, x in peaks]
    if not pts:
        raise SystemExit('No tiles detected — is this an encoded grid PNG?')

    # geometry is fixed by the scheme: derive dx/dy/off from detected scale (no drift)
    dx = DX0 * scale; dy = DY0 * scale; off = dx / 2.0
    ys = [p[0] for p in pts]; y0 = min(ys)
    ay0 = y0 + float(np.median([(y - y0) - dy * round((y - y0) / dy) for y in ys]))
    ridx = lambda y: int(round((y - ay0) / dy))
    # trim sparse boundary rows: image margins can spawn spurious peaks that shift
    # row indices and flip the even/odd shift parity (Biota pads to full rows).
    rowc = {}
    for y, x, c in pts: rowc[ridx(y)] = rowc.get(ridx(y), 0) + 1
    maxrow = max(rowc.values())
    dense = [r for r, n in rowc.items() if n >= max(2, 0.4 * maxrow)]
    r_lo, r_hi = min(dense), max(dense)
    R = r_hi - r_lo + 1
    ay = ay0 + r_lo * dy   # origin of 0-based row 0 = top dense row = encoder row 0
    parity_off = lambda r: off if r % 2 == 0 else 0.0   # r is 0-based
    inb = [(y, x, c) for y, x, c in pts if r_lo <= ridx(y) <= r_hi]
    vals = [x - parity_off(ridx(y) - r_lo) for y, x, c in inb]; x0 = min(vals)
    ax = x0 + float(np.median([(v - x0) - dx * round((v - x0) / dx) for v in vals]))

    raw = {}
    for y, x, c in inb:
        r = ridx(y) - r_lo; cc = int(round((x - parity_off(r) - ax) / dx)); k = (r, cc)
        if k not in raw or c > raw[k][2]: raw[k] = (y, x, c)
    colc = {}
    for _, cc in raw: colc[cc] = colc.get(cc, 0) + 1
    valid = sorted(c for c, n in colc.items() if n >= max(2, 0.5 * R))
    c_lo, c_hi = valid[0], valid[-1]; C = c_hi - c_lo + 1; ax += c_lo * dx
    cells = {(r, cc - c_lo): v for (r, cc), v in raw.items() if c_lo <= cc <= c_hi}
    print(f'fit: scale={scale:.3f} dx={dx:.1f} dy={dy:.1f} R={R} C={C} cells={len(cells)}')

    digits = []
    for r in range(R):
        for cc in range(C):
            if (r, cc) in cells: y, x, _ = cells[(r, cc)]
            else: y = int(round(ay + r * dy)); x = int(round(ax + parity_off(r) + cc * dx))
            digits.append(classify(g, int(y), int(x), tpls, m, s))
    return digits

# ========== CLI ==========
def choose_file():
    try:
        out = subprocess.check_output(
            ['osascript', '-e',
             'POSIX path of (choose file with prompt "Select encoded PNG" of type {"png","public.png"})'],
            stderr=subprocess.DEVNULL)
        return out.decode().strip()
    except Exception:
        return input('Path to PNG: ').strip()

def main():
    grid = sys.argv[1] if len(sys.argv) > 1 else choose_file()
    secret = sys.argv[2] if len(sys.argv) > 2 else getpass.getpass('Secret: ')
    if not grid:
        raise SystemExit('No file selected.')

    dg = read_digits(grid)
    allb = bytes(((dg[i]*216 + dg[i+1]*36 + dg[i+2]*6 + dg[i+3]) & 0xFF) for i in range(0, len(dg) - 3, 4))
    try:
        payload, errs = rs_decode_frame(allb)
        print(f'RS: ok, corrected {errs} byte error(s)')
    except Exception as e:
        print('RS: FAILED to correct ->', e)
        print('DECODED TEXT: <unavailable: too many errors>')
        return
    ok, pt = decrypt_payload(payload, secret)
    print('secret check:', 'OK' if ok else 'FAILED (wrong secret or corrupted)')
    print('DECODED TEXT:', repr(pt.decode('utf-8', errors='replace')) if ok else '<unavailable: wrong secret>')

if __name__ == '__main__':
    main()
