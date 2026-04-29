import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

const SIZES = [16, 32, 48, 128];
const SVG_PATH = "public/icon/icon.svg";

const svg = readFileSync(SVG_PATH);

for (const size of SIZES) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    background: "rgba(0, 0, 0, 0)",
  });
  const png = resvg.render().asPng();
  const outPath = `public/icon/icon-${size}.png`;
  writeFileSync(outPath, png);
  console.log(`wrote ${outPath} (${png.length} B)`);
}
