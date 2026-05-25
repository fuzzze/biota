// Node verification harness (run from app/ dir):  npx tsx tests/run.ts
// Validates the TS port against the Python reference and the existing sample.
import { createCanvas, loadImage, type Image } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decodeImage, type TemplateSet } from "../src/biota/decode";
import { type AspectKind } from "../src/biota/layout";
import { rsEncode, rsDecodeChunk } from "../src/biota/rs";
import { planEncode, paintGrid, type Tile } from "../src/biota/render";
import { compositeLum, type RGBA } from "../src/biota/imaging";

const TPL_DIR = "../templates";
const SAMPLE = "../samples/sample_encrypted.png";

let pass = 0, fail = 0, skip = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.error(`  ✗ ${name} ${detail}`); fail++; }
}

// Find a Python interpreter that has decode.py's deps (numpy/scipy/pillow/reedsolo).
function findPython(): string | null {
  const cands = ["python3", "/usr/bin/python3", "python3.12", "python3.11", "python3.10", "python3.9"];
  for (const p of cands) {
    try {
      execFileSync(p, ["-c", "import numpy,scipy,PIL,reedsolo"], { stdio: "ignore" });
      return p;
    } catch { /* try next */ }
  }
  return null;
}

function imageData(img: Image): RGBA {
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, img.width, img.height);
  return { data: id.data, width: id.width, height: id.height };
}

async function loadTemplates(): Promise<{ tpls: TemplateSet; imgs: Image[] }> {
  const imgs: Image[] = [];
  const tpls: TemplateSet = [];
  for (let k = 0; k < 6; k++) {
    const img = await loadImage(`${TPL_DIR}/tpl_${k}.png`);
    imgs.push(img);
    tpls.push({ gray: compositeLum(imageData(img)) });
  }
  return { tpls, imgs };
}

function render(text: string, secret: string, kind: AspectKind, imgs: Image[]) {
  const { digits, cols, layout } = planEncode(text, secret, kind);
  const canvas = createCanvas(layout.width, layout.height);
  const ctx = canvas.getContext("2d");
  const tiles: Tile[] = imgs.map((img) => ({ img, w: img.width, h: img.height }));
  paintGrid(ctx as any, layout, digits, tiles);
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { rgba: { data: id.data, width: id.width, height: id.height } as RGBA, png: canvas.toBuffer("image/png"), cols, layout };
}

async function main() {
  const { tpls, imgs } = await loadTemplates();

  console.log("RS decode (errors-only correction):");
  {
    const msg = Array.from({ length: 120 }, (_, i) => (i * 37 + 11) & 0xff);
    const cw = rsEncode(msg, 8);
    for (const p of [0, 5, 60, 119]) cw[p] ^= 0xa5; // 4 byte errors (nsym=8 -> up to 4)
    const dec = rsDecodeChunk(cw, 8);
    check("corrects 4/120 byte errors", JSON.stringify(dec.data) === JSON.stringify(msg), `errs=${dec.errs}`);
  }

  console.log("Sample decode (decoder/decode.py parity):");
  {
    const expected = "Welcome to Biota! Secret message hidden in tile rotations.";
    const t0 = Date.now();
    const res = decodeImage(imageData(await loadImage(SAMPLE)), tpls, "biota-demo");
    console.log(`    scale=${res.info.scale.toFixed(3)} R=${res.info.R} C=${res.info.C} tiles=${res.info.tiles} (${Date.now() - t0}ms)`);
    check("decodes sample text", res.ok && res.text === expected, `got ${JSON.stringify(res.text)} stage=${res.stage} ${res.message ?? ""}`);
    const wrong = decodeImage(imageData(await loadImage(SAMPLE)), tpls, "nope");
    check("rejects wrong secret", !wrong.ok && wrong.stage === "wrong-secret");
  }

  console.log("Encode -> decode round-trip (all aspects):");
  const text = "Привет, Biota! 🌿 Round-trip 123 — проверка.";
  const secret = "correct horse battery staple";
  for (const kind of ["vertical", "square", "horizontal"] as AspectKind[]) {
    const { rgba, cols } = render(text, secret, kind, imgs);
    const res = decodeImage(rgba, tpls, secret);
    check(`${kind} (cols=${cols}, ${rgba.width}x${rgba.height})`, res.ok && res.text === text, `got ${JSON.stringify(res.text)} stage=${res.stage}`);
  }

  console.log("Cross-tool: app encoder -> Python decoder:");
  {
    const py = findPython();
    if (!py) {
      console.log("  ⊘ skipped (no Python with numpy/scipy/pillow/reedsolo in PATH)");
      skip++;
    } else {
      const { png } = render(text, secret, "square", imgs);
      const p = join(tmpdir(), `biota_xtool_${Date.now()}.png`);
      writeFileSync(p, png);
      try {
        const out = execFileSync(py, ["../decoder/decode.py", p, secret], { encoding: "utf8", env: { ...process.env, HEX_TPL_DIR: TPL_DIR } });
        check(`python (${py}) decodes app PNG`, out.includes("Привет, Biota!"), `\n--- python output ---\n${out}`);
      } catch (e: any) {
        check(`python (${py}) decodes app PNG`, false, `(python failed: ${e.message})`);
      }
    }
  }

  console.log(`\n${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ""}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
