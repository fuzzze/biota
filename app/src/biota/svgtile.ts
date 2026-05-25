// Vector tile source. The 6 digit rotations are produced from a single SVG
// (templates/tile.svg) rather than pre-rasterized PNGs, so the encoder can paint
// crisp tiles at any output resolution. Digit d -> rotate d*60° about the tile
// center (170,170 in the 0 0 340 340 viewBox); +60° matches the PNG tpl_1, so the
// rotation direction agrees with the decoder's reference templates.

const CENTER = 170; // viewBox center == hexagon center

/** The 6 rotation variants of the base tile SVG, indexed by digit 0..5. */
export function rotatedTileSvgs(base: string): string[] {
  return [0, 1, 2, 3, 4, 5].map((d) => {
    if (d === 0) return base;
    const deg = d * 60;
    const openEnd = base.indexOf(">", base.indexOf("<svg")) + 1;
    const head = base.slice(0, openEnd);
    const body = base.slice(openEnd).replace("</svg>", "</g></svg>");
    return `${head}<g transform="rotate(${deg} ${CENTER} ${CENTER})">${body}`;
  });
}

/** Force a concrete pixel size so rasterizers render the SVG crisply at `px`. */
export function sizedSvg(svg: string, px: number): string {
  return svg.replace(
    /<svg\b[^>]*?>/,
    (tag) => tag
      .replace(/\bwidth="[^"]*"/, `width="${px}px"`)
      .replace(/\bheight="[^"]*"/, `height="${px}px"`),
  );
}
