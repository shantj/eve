import { Resvg } from "@resvg/resvg-js";
import { PNG } from "pngjs";
import Ajv from "ajv";

const color = { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" };
const obj = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const drawing = obj({
  background: color,
  layers: {
    type: "array",
    minItems: 1,
    maxItems: 20,
    items: obj({
      fill: color,
      path: {
        type: "string",
        minLength: 4,
        maxLength: 2000,
        pattern: "^[Mm][MmLlHhVvCcSsQqTtAaZz0-9., +\\-]*$",
      },
    }),
  },
});
export const artSchema = obj({
  concept: { type: "string", minLength: 1, maxLength: 600 },
  icon: drawing,
  illustration: drawing,
});
const valid = new Ajv().compile(artSchema);
export const assetNames = {
  icon: "AppIcon.appiconset/Icon.png",
  illustration: "BrandArtwork.imageset/Artwork.png",
};
export function renderArt(art) {
  if (!valid(art)) throw Error("设计图层或颜色无效");
  const files = {};
  for (const [k, dest] of Object.entries(assetNames)) {
    const { background, layers } = art[k];
    const [w, h] = k === "icon" ? [1024, 1024] : [900, 450];
    const paths = layers
      .map((l) => '<path fill="' + l.fill + '" d="' + l.path + '"/>')
      .join("");
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      w +
      '" height="' +
      h +
      '" viewBox="0 0 ' +
      (k === "icon" ? "100 100" : "200 100") +
      '"><rect width="100%" height="100%" fill="' +
      background +
      '"/>' +
      paths +
      "</svg>";
    const pixels = new Resvg(svg, { font: { loadSystemFonts: false } }).render()
      .pixels;
    const bg = Buffer.from(background.slice(1), "hex");
    let drawn = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (
        Math.abs(bg[0] - pixels[i]) +
          Math.abs(bg[1] - pixels[i + 1]) +
          Math.abs(bg[2] - pixels[i + 2]) >
        36
      )
        drawn++;
    if (drawn < w * h * 0.005) throw Error("设计稿没有可辨识的图形：" + k);
    files[dest] = PNG.sync.write(
      { width: w, height: h, data: pixels },
      { colorType: 2, inputColorType: 6 },
    );
  }
  files["BrandArtwork.imageset/Contents.json"] = Buffer.from(
    JSON.stringify({
      images: [{ filename: "Artwork.png", idiom: "universal" }],
      info: { author: "EVE Design", version: 1 },
    }),
  );
  return files;
}
