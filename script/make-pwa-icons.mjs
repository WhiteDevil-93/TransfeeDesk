// One-off: render the TransferDesk PWA icon (192/512 PNG) without deps.
// Draws a rounded-blue tile with a white rounded-square frame + cross bars,
// matching the app logo. Writes client/public/icon-192.png & icon-512.png.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "client", "public");

function crc32(buf) {
  let c, table = crc32.table || (crc32.table = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })());
  let crc = -1; for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff]; return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function inRounded(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
  const dx = x - cx, dy = y - cy;
  if (x >= x0 + r && x <= x1 - r) return true;
  if (y >= y0 + r && y <= y1 - r) return true;
  return dx * dx + dy * dy <= r * r;
}
function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const put = (x, y, [r, g, b, a]) => { const i = (y * size + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; };
  const BG = [2, 132, 199, 255], WHITE = [255, 255, 255, 255], CLEAR = [0, 0, 0, 0];
  const u = size / 32; // icon is a 32-unit grid
  const tileR = 7 * u;
  // outer tile (rounded), blue
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) put(x, y, inRounded(x + 0.5, y + 0.5, 0, 0, size - 1, size - 1, tileR) ? BG : CLEAR);
  // white rounded-square frame (the logo box)
  const f = (c) => 2 * u + c * u;
  const fR = 8 * u;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const inOuter = inRounded(x + 0.5, y + 0.5, f(0), f(0), f(32), f(32), fR);
    if (!inOuter) continue;
    // frame thickness ~2.4 units; hollow center
    const inInner = inRounded(x + 0.5, y + 0.5, f(2.4), f(2.4), f(29.6), f(29.6), Math.max(0, fR - 2.4 * u));
    if (!inInner) put(x, y, WHITE);
  }
  // cross bars (the transfer glyph): horizontal + vertical + X diagonals, thick
  const bar = (cx, cy, r) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const dx = x + 0.5 - cx, dy = y + 0.5 - cy; if (dx * dx + dy * dy <= r * r) put(x, y, WHITE); } };
  const bR = 1.2 * u;
  // horizontal top bar (y=13, x 9..20), horizontal bottom bar (y=19, x 12..23)
  for (let x = Math.floor(9 * u); x < Math.ceil(20 * u); x++) { const y = Math.round(13 * u); for (let dy = -1; dy <= 1; dy++) if (y + dy >= 0 && y + dy < size) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && x + dx < size) put(x + dx, y + dy, WHITE); }
  for (let x = Math.floor(12 * u); x < Math.ceil(23 * u); x++) { const y = Math.round(19 * u); for (let dy = -1; dy <= 1; dy++) if (y + dy >= 0 && y + dy < size) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && x + dx < size) put(x + dx, y + dy, WHITE); }
  // diagonal strokes: top (20,13)->(16.5,9.5) and (20,13)->(16.5,16.5); bottom (12,19)->(15.5,15.5) and (12,19)->(15.5,22.5)
  const diag = (x0, y0, x1, y1) => { const n = 40; for (let i = 0; i <= n; i++) { const t = i / n; const cx = (x0 + (x1 - x0) * t) * u, cy = (y0 + (y1 - y0) * t) * u; bar(cx, cy, bR); } };
  diag(20, 13, 16.5, 9.5); diag(20, 13, 16.5, 16.5); diag(12, 19, 15.5, 15.5); diag(12, 19, 15.5, 22.5);
  return px;
}
function encodePNG(size, px) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  // raw: each row prefixed with filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
for (const s of [192, 512]) { writeFileSync(join(root, `icon-${s}.png`), encodePNG(s, draw(s))); console.log("wrote icon-" + s + ".png"); }
