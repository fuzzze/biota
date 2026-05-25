// Browser-side template loading.
//   - Encoder tiles are rasterized from the vector source (tile.svg) at TILE_PX,
//     one per digit rotation, so painted output is crisp at any scale.
//   - Decoder templates are the bundled PNG references (tpl_0..5), whose luminance
//     Grays drive NCC classification — identical to the Python/Sketch/Figma tools.

import tpl0 from "../assets/templates/tpl_0.png";
import tpl1 from "../assets/templates/tpl_1.png";
import tpl2 from "../assets/templates/tpl_2.png";
import tpl3 from "../assets/templates/tpl_3.png";
import tpl4 from "../assets/templates/tpl_4.png";
import tpl5 from "../assets/templates/tpl_5.png";
import tileSvg from "../assets/tile.svg?raw";

import { compositeLum, type Gray } from "./imaging";
import { rotatedTileSvgs, sizedSvg } from "./svgtile";
import { TILE_PX } from "./constants";
import type { Tile } from "./render";
import type { TemplateSet } from "./decode";

const PNG_URLS = [tpl0, tpl1, tpl2, tpl3, tpl4, tpl5];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

function toGray(img: HTMLImageElement): Gray {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, c.width, c.height);
  return compositeLum({ data: id.data, width: id.width, height: id.height });
}

// Rasterize one SVG string to an opaque-free canvas at px*px (browsers render the
// SVG at the drawn size, so the result is sharp).
function rasterizeSvg(svg: string, px: number): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = px;
      c.height = px;
      c.getContext("2d")!.drawImage(img, 0, 0, px, px);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("failed to rasterize tile.svg")); };
    img.src = url;
  });
}

async function svgEncoderTiles(): Promise<Tile[]> {
  const svgs = rotatedTileSvgs(tileSvg).map((s) => sizedSvg(s, TILE_PX));
  const canvases = await Promise.all(svgs.map((s) => rasterizeSvg(s, TILE_PX)));
  return canvases.map((c) => ({ img: c, w: c.width, h: c.height }));
}

async function pngTemplateSet(): Promise<TemplateSet> {
  const images = await Promise.all(PNG_URLS.map(loadImage));
  return images.map((img) => ({ gray: toGray(img) }));
}

export async function loadTemplates(): Promise<{ tiles: Tile[]; set: TemplateSet }> {
  const [tiles, set] = await Promise.all([svgEncoderTiles(), pngTemplateSet()]);
  return { tiles, set };
}
