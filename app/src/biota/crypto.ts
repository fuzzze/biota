// Biota cipher: SHA-256 KDF + CTR keystream + truncated MAC.
// encrypt() mirrors encoder/figma/ui.html; decryptPayload() mirrors
// decoder/decode.py. Payload = [ver(1)|N(2,BE)|salt(8)|mac(4)|ct(N)].

import { sha256, utf8, cat } from "./sha256";

export const ITER = 20000; // MUST match decode.py / the encoders

function derive(sb: number[], salt: number[]): number[] {
  let k = sha256(cat(sb, salt));
  for (let i = 0; i < ITER; i++) k = sha256(cat(k, sb));
  return k;
}

function keystream(key: number[], n: number): number[] {
  const o: number[] = [];
  let c = 0;
  while (o.length < n) {
    const blk = sha256(cat(key, [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255]));
    for (const x of blk) o.push(x);
    c++;
  }
  return o.slice(0, n);
}

function randomBytes(n: number): number[] {
  const buf = new Uint8Array(n);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf);
}

/** Encrypt plaintext bytes with a secret -> payload bytes. */
export function encrypt(plain: number[], secret: string): number[] {
  const sb = utf8(secret);
  const salt = randomBytes(8);
  const key = derive(sb, salt);
  const ks = keystream(key, plain.length);
  const ct = plain.map((b, i) => b ^ ks[i]);
  const mac = sha256(cat(key, ct)).slice(0, 4);
  const N = plain.length;
  return cat([1, (N >>> 8) & 255, N & 255], salt, mac, ct);
}

export interface DecryptResult {
  ok: boolean; // MAC verified (correct secret + intact ciphertext)
  bytes: number[]; // recovered plaintext bytes (valid only when ok)
}

/** Reverse of encrypt(): verify MAC and recover plaintext bytes. */
export function decryptPayload(payload: number[], secret: string): DecryptResult {
  if (payload.length < 15) return { ok: false, bytes: [] };
  const N = (payload[1] << 8) | payload[2];
  const salt = payload.slice(3, 11);
  const mac = payload.slice(11, 15);
  const ct = payload.slice(15, 15 + N);
  if (ct.length < N) return { ok: false, bytes: [] };
  const key = derive(utf8(secret), salt);
  const calcMac = sha256(cat(key, ct)).slice(0, 4);
  const ok = mac.length === 4 && calcMac.every((v, i) => v === mac[i]);
  const ks = keystream(key, N);
  const pt = ct.map((c, i) => c ^ ks[i]);
  return { ok, bytes: pt };
}

/** Decode UTF-8 bytes to a string (lenient). */
export function bytesToString(bytes: number[]): string {
  return new TextDecoder("utf-8").decode(Uint8Array.from(bytes));
}
