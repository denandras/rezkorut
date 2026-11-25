// Card 08 — jsQR proof without a real camera (headless verification).
//
// The camera cannot be exercised headless, so this script proves the exact
// dynamic-import path the CheckinPanel fallback uses:
//   1. `await import("jsqr")` — the same dynamic import the component runs
//      when BarcodeDetector is absent (Safari/iOS);
//   2. a QR PNG is generated with the `qrcode` package for the URL the
//      ticket e-mail encodes (https://rezkorut.hu/j/<code>);
//   3. the PNG pixels are fed to jsQR as raw RGBA data — the same shape the
//      component produces from the canvas via getImageData — and the
//      decoded URL is printed and asserted.
//
// Run from the repo root: node scripts/card08-jsqr-check.mjs

import assert from "node:assert/strict";
import QRCode from "qrcode";
import sharp from "sharp";

const CODE = "CARD08TEST";
const URL = `https://rezkorut.hu/j/${CODE}`;

async function main() {
  // 1. The dynamic import — exactly what CheckinPanel does on the fallback
  //    path (imported only when BarcodeDetector is absent).
  const { default: jsQR } = await import("jsqr");
  console.log("dynamic import(\"jsqr\") OK:", typeof jsQR === "function");

  // 2. Generate the QR PNG with the same settings the ticket e-mail uses.
  const png = await QRCode.toBuffer(URL, {
    errorCorrectionLevel: "H",
    margin: 2,
    width: 640,
    color: { dark: "#0b1a10", light: "#f5f0e4" },
  });
  console.log("QR PNG generated:", png.length, "bytes");

  // 3. Decode: raw RGBA pixels in, like the canvas ImageData path.
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const result = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  console.log("jsQR decode:", JSON.stringify(result?.data ?? null));
  assert.equal(result?.data, URL, "jsQR must decode the QR back to the /j/<code> URL");
  console.log(`OK — decoded URL matches: ${URL}`);
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
