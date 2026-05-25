// Base-6 digit packing: each byte -> 4 base-6 digits (MSB first).
// A valid byte's first digit is in {0,1} (since 255 < 2*216).

import { utf8 } from "./sha256";
import { encrypt } from "./crypto";
import { rsFrame } from "./rs";

export const toDigits = (b: number): [number, number, number, number] => [
  Math.floor(b / 216) % 6,
  Math.floor(b / 36) % 6,
  Math.floor(b / 6) % 6,
  b % 6,
];

/** Bytes -> flat base-6 digit stream (4 digits per byte). */
export function bytesToDigits(bytes: number[]): number[] {
  const out: number[] = [];
  for (const b of bytes) out.push(...toDigits(b));
  return out;
}

/** Digit stream -> bytes (groups of 4, masked to a byte like decode.py). */
export function digitsToBytes(digits: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 3 < digits.length; i += 4) {
    out.push((digits[i] * 216 + digits[i + 1] * 36 + digits[i + 2] * 6 + digits[i + 3]) & 0xff);
  }
  return out;
}

/** Full encode pipeline up to the (unpadded) digit stream. */
export function encodeToDigits(text: string, secret: string): { digits: number[]; frameLen: number } {
  const frame = rsFrame(encrypt(utf8(text), secret));
  return { digits: bytesToDigits(frame), frameLen: frame.length };
}
