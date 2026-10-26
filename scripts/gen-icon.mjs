#!/usr/bin/env node
/**
 * gen-icon.mjs - generates packages/desktop/build/icon.png (512x512 RGBA)
 *
 * Draws a rounded blue square with a white telephone handset ("call" glyph)
 * and two sound-wave arcs. Completely dependency-free:
 *   - the handset is an SVG-style path (M/L/H/V/C/Z, absolute + relative)
 *     flattened to a polygon and filled with a non-zero scanline rasteriser,
 *   - the background and waves use signed-distance functions,
 *   - 4x4 supersampling gives anti-aliased edges,
 *   - the PNG is encoded by hand (IHDR/IDAT/IEND + CRC32, node:zlib deflate).
 * electron-builder derives the Windows .ico and macOS .icns from this PNG.
 *
 * Usage:  node scripts/gen-icon.mjs [outputPath] [size]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] ?? path.join(here, '..', 'packages', 'desktop', 'build', 'icon.png'));
const SIZE = Number(process.argv[3] ?? 512);
const SS = 4; // supersamples per axis

/* ------------------------------------------------------------------ */
/* Glyph geometry, defined in a 24x24 "icon font" coordinate space      */
/* ------------------------------------------------------------------ */

// Material Design "call" handset (Apache-2.0 licensed glyph geometry).
const HANDSET =
  'M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83' +
  'l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99' +
  ' 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z';

/** Parse a small subset of SVG path syntax into closed polygons (arrays of [x,y]). */
function flattenPath(d, steps = 24) {
  const tokens = d.match(/[MmLlHhVvCcZz]|-?(?:\d+\.?\d*|\.\d+)/g);
  const polys = [];
  let poly = [];
  let x = 0, y = 0, cmd = '', i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M': {
        if (poly.length) polys.push(poly);
        x = (rel ? x : 0) + num(); y = (rel ? y : 0) + num();
        poly = [[x, y]];
        cmd = rel ? 'l' : 'L'; // implicit lineto after moveto
        break;
      }
      case 'L': x = (rel ? x : 0) + num(); y = (rel ? y : 0) + num(); poly.push([x, y]); break;
      case 'H': x = (rel ? x : 0) + num(); poly.push([x, y]); break;
      case 'V': y = (rel ? y : 0) + num(); poly.push([x, y]); break;
      case 'C': {
        const ox = rel ? x : 0, oy = rel ? y : 0;
        const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num(), x3 = ox + num(), y3 = oy + num();
        for (let s = 1; s <= steps; s++) {
          const t = s / steps, mt = 1 - t;
          poly.push([
            mt * mt * mt * x + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3,
            mt * mt * mt * y + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3,
          ]);
        }
        x = x3; y = y3;
        break;
      }
      case 'Z': if (poly.length) polys.push(poly); poly = []; break;
      default: throw new Error(`Unsupported path command ${cmd}`);
    }
  }
  if (poly.length) polys.push(poly);
  return polys;
}

// Map 24-unit glyph space onto the icon (glyph spans ~3..21, centred, 62% of the icon).
const GLYPH_SCALE = (0.62 * SIZE) / 18;
const toPx = ([gx, gy]) => [SIZE / 2 + (gx - 12) * GLYPH_SCALE, SIZE / 2 + (gy - 12) * GLYPH_SCALE];
const handsetPolys = flattenPath(HANDSET).map((p) => p.map(toPx));

/** For one horizontal sample line, return sorted [xStart, xEnd] spans inside the polygons (non-zero rule). */
function spansAt(py) {
  const xs = [];
  for (const poly of handsetPolys) {
    for (let k = 0; k < poly.length; k++) {
      const [x0, y0] = poly[k];
      const [x1, y1] = poly[(k + 1) % poly.length];
      if (y0 === y1) continue;
      const dir = y1 > y0 ? 1 : -1;
      if ((py >= Math.min(y0, y1)) && (py < Math.max(y0, y1))) {
        xs.push([x0 + ((py - y0) / (y1 - y0)) * (x1 - x0), dir]);
      }
    }
  }
  xs.sort((a, b) => a[0] - b[0]);
  const spans = [];
  let wind = 0, start = 0;
  for (const [x, dir] of xs) {
    const before = wind;
    wind += dir;
    if (before === 0 && wind !== 0) start = x;
    else if (before !== 0 && wind === 0) spans.push([start, x]);
  }
  return spans;
}

/* ---------------- signed distance helpers (pixel space) ---------------- */

const len = Math.hypot;
function sdRoundBox(px, py, cx, cy, hx, hy, r) {
  const qx = Math.abs(px - cx) - hx + r;
  const qy = Math.abs(py - cy) - hy + r;
  return len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
/** Ring segment of radius R, half-thickness t, angles a0..a1 (radians, y axis down), rounded caps. */
function sdArc(px, py, cx, cy, R, t, a0, a1) {
  const dx = px - cx, dy = py - cy;
  const ang = Math.atan2(dy, dx);
  if (ang >= a0 && ang <= a1) return Math.abs(len(dx, dy) - R) - t;
  const e0x = cx + Math.cos(a0) * R, e0y = cy + Math.sin(a0) * R;
  const e1x = cx + Math.cos(a1) * R, e1y = cy + Math.sin(a1) * R;
  return Math.min(len(px - e0x, py - e0y), len(px - e1x, py - e1y)) - t;
}

const [waveCx, waveCy] = toPx([13, 11]);
function inWaves(px, py) {
  const t = 0.95 * GLYPH_SCALE;
  for (const R of [3.6, 7.2]) {
    if (sdArc(px, py, waveCx, waveCy, R * GLYPH_SCALE, t, -Math.PI / 2 + 0.22, -0.22) <= 0) return true;
  }
  return false;
}

/* ---------------- raster ---------------- */

const TOP = [59, 130, 246]; // #3b82f6
const BOTTOM = [29, 78, 216]; // #1d4ed8
const HALF = SIZE / 2;
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));

for (let y = 0; y < SIZE; y++) {
  const row = y * (SIZE * 4 + 1);
  raw[row] = 0; // PNG filter type: none
  const rowSpans = [];
  for (let sy = 0; sy < SS; sy++) rowSpans.push(spansAt(y + (sy + 0.5) / SS));
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, cover = 0;
    for (let sy = 0; sy < SS; sy++) {
      const py = y + (sy + 0.5) / SS;
      for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS;
        if (sdRoundBox(px, py, HALF, HALF, SIZE * 0.47, SIZE * 0.47, SIZE * 0.11) > 0) continue;
        const v = py / SIZE;
        let c = TOP.map((t0, i) => t0 + (BOTTOM[i] - t0) * v);
        const glyph = rowSpans[sy].some(([a, e]) => px >= a && px < e) || inWaves(px, py);
        if (glyph) c = [255, 255, 255];
        r += c[0]; g += c[1]; b += c[2]; cover++;
      }
    }
    const o = row + 1 + x * 4;
    if (cover) {
      raw[o] = Math.round(r / cover);
      raw[o + 1] = Math.round(g / cover);
      raw[o + 2] = Math.round(b / cover);
    }
    raw[o + 3] = Math.round((cover / (SS * SS)) * 255);
  }
}

/* ---------------- PNG encoding ---------------- */

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type: RGBA
// bytes 10-12: compression, filter, interlace = 0

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`Wrote ${out} (${SIZE}x${SIZE}, ${png.length} bytes)`);
