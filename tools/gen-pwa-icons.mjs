// Generates PWA icons (any + maskable) and the Apple touch icon from the brand
// mark in app/public/favicon.svg. The favicon draws the worm-arc pattern as
// black fills inside a hex mask; we recolor those fills to the accent green and
// place them on the app's dark background. Run: node tools/gen-pwa-icons.mjs
// (requires rsvg-convert on PATH). Output PNGs land in app/public/icons/.

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pub = resolve(root, "app/public");
const iconsDir = resolve(pub, "icons");
const tmpDir = resolve(root, "tools/.icontmp");

const BG = "#0e1013";      // --bg
const ACCENT = "#6ee7a8";  // --accent

// Pull the inner markup of favicon.svg (defs + the drawing group) so we can
// re-wrap it with a background and recolor.
const fav = readFileSync(resolve(pub, "favicon.svg"), "utf8");
const inner = fav
  .replace(/<\?xml[^>]*\?>/, "")
  .replace(/<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "")
  .replaceAll("#000000", ACCENT);

// `scale` shrinks the 340x340 mark toward the center, leaving a safe margin.
// Maskable icons need their content inside the central 80% safe zone.
function iconSvg(scale) {
  const off = (340 * (1 - scale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="340" height="340" viewBox="0 0 340 340">
  <rect width="340" height="340" fill="${BG}"/>
  <g transform="translate(${off} ${off}) scale(${scale})">${inner}</g>
</svg>`;
}

mkdirSync(iconsDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

const jobs = [
  { svg: iconSvg(0.84), size: 192, out: "icons/icon-192.png" },
  { svg: iconSvg(0.84), size: 512, out: "icons/icon-512.png" },
  { svg: iconSvg(0.66), size: 512, out: "icons/maskable-512.png" }, // bigger safe margin
  { svg: iconSvg(0.84), size: 180, out: "apple-touch-icon.png" },
];

for (const { svg, size, out } of jobs) {
  const tmp = resolve(tmpDir, `${size}-${out.replace(/\W/g, "_")}.svg`);
  writeFileSync(tmp, svg);
  execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size), "-o", resolve(pub, out), tmp]);
  console.log(`wrote app/public/${out} (${size}px)`);
}

rmSync(tmpDir, { recursive: true, force: true });
