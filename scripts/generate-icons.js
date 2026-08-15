// scripts/generate-icons.js
//
// One-time (rerunnable) generator for the PWA app icons, in the app's own
// navy/cream palette (see design tokens at the top of public/styles.css).
// Zero-dependency by design, matching the rest of this repo: no image
// library, just Node's built-in `zlib` for PNG compression and a hand-rolled
// CRC32/PNG encoder. Run with `node scripts/generate-icons.js` any time you
// want to regenerate public/icons/*.png (e.g. after tweaking the palette
// or the glyph below).

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const NAVY = [0x1f, 0x2e, 0x3d, 255]; // --ink
const CREAM = [0xef, 0xea, 0xe0, 255]; // --chart

const OUT_DIR = path.join(__dirname, "..", "public", "icons");

// ---------- Tiny RGBA canvas ----------
function makeCanvas(size) {
  const pixels = new Uint8Array(size * size * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = NAVY[0];
    pixels[i + 1] = NAVY[1];
    pixels[i + 2] = NAVY[2];
    pixels[i + 3] = NAVY[3];
  }
  return { size, pixels };
}

function setPixel(canvas, x, y, color) {
  if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return;
  const i = (y * canvas.size + x) * 4;
  canvas.pixels[i] = color[0];
  canvas.pixels[i + 1] = color[1];
  canvas.pixels[i + 2] = color[2];
  canvas.pixels[i + 3] = color[3];
}

/** Fills an axis-aligned rounded rect (fractional 0..1 coordinates) with color. */
function fillRoundedRect(canvas, fx0, fy0, fx1, fy1, fRadius, color) {
  const s = canvas.size;
  const x0 = fx0 * s;
  const y0 = fy0 * s;
  const x1 = fx1 * s;
  const y1 = fy1 * s;
  const r = fRadius * s;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      const cx = Math.min(Math.max(x + 0.5, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y + 0.5, y0 + r), y1 - r);
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) setPixel(canvas, x, y, color);
    }
  }
}

/** Draws the mark: a simple suitcase silhouette, matching the header's 🧳 motif. */
function drawSuitcaseMark(canvas) {
  // Handle (frame) above the body.
  fillRoundedRect(canvas, 0.38, 0.2, 0.62, 0.4, 0.03, CREAM);
  fillRoundedRect(canvas, 0.43, 0.24, 0.57, 0.36, 0.02, NAVY);
  // Body.
  fillRoundedRect(canvas, 0.18, 0.36, 0.82, 0.8, 0.06, CREAM);
  // Strap band across the middle.
  fillRoundedRect(canvas, 0.18, 0.55, 0.82, 0.61, 0, NAVY);
  // Two feet/latches near the bottom for a touch of detail.
  fillRoundedRect(canvas, 0.34, 0.7, 0.4, 0.76, 0.01, NAVY);
  fillRoundedRect(canvas, 0.6, 0.7, 0.66, 0.76, 0.01, NAVY);
}

// ---------- Minimal PNG encoder (signature + IHDR + IDAT + IEND) ----------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(canvas) {
  const { size, pixels } = canvas;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Raw scanlines, each prefixed with filter-type byte 0 (none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    raw.set(pixels.subarray(y * size * 4, (y + 1) * size * 4), rowStart + 1);
  }
  const idatData = zlib.deflateSync(raw);

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", idatData), chunk("IEND", Buffer.alloc(0))]);
}

function generate(size, filename) {
  const canvas = makeCanvas(size);
  drawSuitcaseMark(canvas);
  const png = encodePng(canvas);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, filename);
  fs.writeFileSync(outPath, png);
  console.log(`wrote ${path.relative(process.cwd(), outPath)} (${size}x${size}, ${png.length} bytes)`);
}

generate(512, "icon-512.png");
generate(192, "icon-192.png");
generate(180, "apple-touch-icon.png");
generate(32, "favicon-32.png");
