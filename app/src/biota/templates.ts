// Browser-side template loading: the 6 tile rotations are bundled into the app.
// Returns both the HTMLImageElements (for the encoder's canvas compositing) and
// their luminance Grays (for the decoder).

import tpl0 from "../assets/templates/tpl_0.png";
import tpl1 from "../assets/templates/tpl_1.png";
import tpl2 from "../assets/templates/tpl_2.png";
import tpl3 from "../assets/templates/tpl_3.png";
import tpl4 from "../assets/templates/tpl_4.png";
import tpl5 from "../assets/templates/tpl_5.png";
import { compositeLum, type Gray } from "./imaging";
import type { TemplateSet } from "./decode";

const URLS = [tpl0, tpl1, tpl2, tpl3, tpl4, tpl5];

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

export async function loadTemplates(): Promise<{ images: HTMLImageElement[]; set: TemplateSet }> {
  const images = await Promise.all(URLS.map(loadImage));
  const set: TemplateSet = images.map((img) => ({ gray: toGray(img) }));
  return { images, set };
}
