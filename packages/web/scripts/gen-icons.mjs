#!/usr/bin/env node
/**
 * Generates the PWA icons (public/icons/*.png + favicon.svg) without native
 * dependencies: a tiny rasterizer draws a phone handset on a rounded teal
 * square with 4x4 supersampling and writes PNGs with node:zlib.
 *
 *   node scripts/gen-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const BG = [15, 118, 110]; // #0f766e
const FG = [255, 255, 255];

/* ---------- geometry in a 0..1 unit square ---------- */

function roundedRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function capsule(x, y, ax, ay, bx, by, r) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  const px = ax + t * dx;
  const py = ay + t * dy;
  return (x - px) ** 2 + (y - py) ** 2 <= r * r;
}

/** Classic handset: two ear/mouth pieces joined by a curved grip, rotated 45°. */
function handset(x, y) {
  // rotate around centre by -45°
  const c = Math.SQRT1_2;
  const ux = (x - 0.5) * c - (y - 0.5) * c;
  const uy = (x - 0.5) * c + (y - 0.5) * c;
  // grip: arc band (ring segment)
  const cx = 0;
  const cy = 0.42;
  const d = Math.hypot(ux - cx, uy - cy);
  const ang = Math.atan2(uy - cy, ux - cx);
  const grip = d >= 0.36 && d <= 0.47 && ang < -Math.PI * 0.22 && ang > -Math.PI * 0.78;
  // ends
  const left = capsule(ux, uy, -0.3, -0.02, -0.2, 0.12, 0.085);
  const right = capsule(ux, uy, 0.3, -0.02, 0.2, 0.12, 0.085);
  return grip || left || right;
}

/** Signal arcs top-right. */
function waves(x, y) {
  const d = Math.hypot(x - 0.3, y - 0.7);
  const a = Math.atan2(0.7 - y, x - 0.3);
  if (a < 0.15 || a > 1.42) return false;
  return (d > 0.47 && d < 0.53) || (d > 0.58 && d < 0.64);
}

function render(size, { maskable }) {
  const ss = 4;
  const px = Buffer.alloc(size * size * 4);
  const pad = maskable ? 0 : 0.04;
  const radius = maskable ? 0 : 0.2;
  // maskable icons must keep content inside the central 80% safe zone
  const scale = maskable ? 0.62 : 0.78;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let bgHits = 0;
      let fgHits = 0;
      for (let sj = 0; sj < ss; sj++) {
        for (let si = 0; si < ss; si++) {
          const x = (i + (si + 0.5) / ss) / size;
          const y = (j + (sj + 0.5) / ss) / size;
          const inBg = maskable ? true : roundedRect(x, y, pad, pad, 1 - pad, 1 - pad, radius);
          if (!inBg) continue;
          bgHits++;
          const gx = (x - 0.5) / scale + 0.5;
          const gy = (y - 0.5) / scale + 0.5;
          if (handset(gx, gy) || waves(gx, gy)) fgHits++;
        }
      }
      const total = ss * ss;
      const a = bgHits / total;
      const f = bgHits ? fgHits / bgHits : 0;
      const o = (j * size + i) * 4;
      for (let k = 0; k < 3; k++) px[o + k] = Math.round(BG[k] * (1 - f) + FG[k] * f);
      px[o + 3] = Math.round(a * 255);
    }
  }
  return px;
}

/* ---------- PNG encoder ---------- */

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
];
for (const [name, size, maskable] of targets) {
  fs.writeFileSync(path.join(outDir, name), encodePng(size, render(size, { maskable })));
  console.log('wrote', name);
}

// Vector favicon (same motif, simplified)
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="2" y="2" width="60" height="60" rx="13" fill="#0f766e"/>
  <path fill="#fff" d="M22.6 14.5c1.3-1.3 3.4-1.2 4.6.2l4.3 5.1c1 1.2 1 3-.1 4.2l-2.6 2.8c1.9 4 5 7.2 9 9.1l2.8-2.6c1.2-1.1 3-1.1 4.2-.1l5.1 4.3c1.4 1.2 1.5 3.3.2 4.6l-3 3c-2.3 2.3-5.8 3-8.8 1.7C27.6 42.7 21.3 36.4 17.2 27.7c-1.3-3-.6-6.5 1.7-8.8z"/>
  <path fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" d="M37 15a13 13 0 0 1 12 12M37 8a20 20 0 0 1 19 19"/>
</svg>
`;
fs.writeFileSync(path.join(outDir, 'favicon.svg'), svg);
console.log('wrote favicon.svg');
