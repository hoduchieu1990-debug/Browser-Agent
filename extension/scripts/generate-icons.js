const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

let crcTable;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// --- geometry helpers (all coordinates normalized to the 0..1 icon box) ---

function roundedRectSDF(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - (halfW - r);
  const qy = Math.abs(py - cy) - (halfH - r);
  const outsideX = Math.max(qx, 0);
  const outsideY = Math.max(qy, 0);
  const outsideDist = Math.sqrt(outsideX * outsideX + outsideY * outsideY);
  const insideDist = Math.min(Math.max(qx, qy), 0);
  return outsideDist + insideDist - r; // <= 0 means inside
}

function pointInPolygon(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// 4-point "AI sparkle" — the glyph most AI products (Copilot, Gemini, etc.)
// use as shorthand for "AI happened here". Alternating outer/inner radius
// around a center, like a puffy asterisk.
function sparklePolygon(cx, cy, outerR, innerR) {
  const points = [];
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    const radius = i % 2 === 0 ? outerR : innerR;
    points.push([cx + radius * Math.sin(angle), cy - radius * Math.cos(angle)]);
  }
  return points;
}

const VIOLET = [124, 58, 237]; // #7C3AED
const CYAN = [34, 211, 238]; // #22D3EE
const TITLEBAR = [91, 33, 182]; // #5B21B6
const WINDOW_BODY = [248, 250, 255]; // #F8FAFF
const WHITE = [255, 255, 255];

const WINDOW = { cx: 0.46, cy: 0.42, halfW: 0.34, halfH: 0.26, r: 0.07 };
const SPARKLE = { cx: 0.68, cy: 0.56, outerR: 0.16, innerR: 0.05 };
const SPARKLE_SMALL = { cx: 0.28, cy: 0.74, outerR: 0.055, innerR: 0.018 };

function sceneAt(nx, ny) {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;

  const over = (color, srcA) => {
    if (srcA <= 0) return;
    const outA = srcA + a * (1 - srcA);
    if (outA <= 0) {
      a = 0;
      return;
    }
    r = (color[0] * srcA + r * a * (1 - srcA)) / outA;
    g = (color[1] * srcA + g * a * (1 - srcA)) / outA;
    b = (color[2] * srcA + b * a * (1 - srcA)) / outA;
    a = outA;
  };

  // background: rounded squircle, diagonal violet -> cyan gradient (the
  // purple-to-cyan glow is the closest thing the "AI product" aesthetic has
  // to a universal signature — Copilot, Gemini, most AI SaaS logos use it)
  if (roundedRectSDF(nx, ny, 0.5, 0.5, 0.5, 0.5, 0.22) <= 0) {
    const t = (nx + ny) / 2;
    over(
      [
        VIOLET[0] + (CYAN[0] - VIOLET[0]) * t,
        VIOLET[1] + (CYAN[1] - VIOLET[1]) * t,
        VIOLET[2] + (CYAN[2] - VIOLET[2]) * t,
      ],
      1,
    );
  }

  // soft glow halo behind the sparkle
  const glowDx = nx - SPARKLE.cx;
  const glowDy = ny - SPARKLE.cy;
  if (Math.sqrt(glowDx * glowDx + glowDy * glowDy) <= SPARKLE.outerR * 1.7) {
    over(WHITE, 0.35);
  }

  // browser window
  const winSDF = roundedRectSDF(nx, ny, WINDOW.cx, WINDOW.cy, WINDOW.halfW, WINDOW.halfH, WINDOW.r);
  if (winSDF <= 0) {
    const winTop = WINDOW.cy - WINDOW.halfH;
    const titleBarBottom = winTop + WINDOW.halfH * 2 * 0.24;
    over(ny <= titleBarBottom ? TITLEBAR : WINDOW_BODY, 1);
  }

  // AI sparkle "clicking" the window — outline then white fill, tiny companion twinkle
  if (pointInPolygon(nx, ny, sparklePolygon(SPARKLE.cx, SPARKLE.cy, SPARKLE.outerR * 1.22, SPARKLE.innerR * 1.35))) {
    over(TITLEBAR, 1);
  }
  if (pointInPolygon(nx, ny, sparklePolygon(SPARKLE.cx, SPARKLE.cy, SPARKLE.outerR, SPARKLE.innerR))) {
    over(WHITE, 1);
  }
  if (pointInPolygon(nx, ny, sparklePolygon(SPARKLE_SMALL.cx, SPARKLE_SMALL.cy, SPARKLE_SMALL.outerR, SPARKLE_SMALL.innerR))) {
    over(WHITE, 0.9);
  }

  return { r, g, b, a };
}

function renderIcon(size) {
  const SS = 4; // supersample factor for anti-aliasing
  const rowSize = size * 4;
  const raw = Buffer.alloc((rowSize + 1) * size);

  for (let y = 0; y < size; y++) {
    const rowStart = y * (rowSize + 1);
    raw[rowStart] = 0; // filter: none

    for (let x = 0; x < size; x++) {
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumA = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const nx = (x + (sx + 0.5) / SS) / size;
          const ny = (y + (sy + 0.5) / SS) / size;
          const { r, g, b, a } = sceneAt(nx, ny);
          sumR += r * a;
          sumG += g * a;
          sumB += b * a;
          sumA += a;
        }
      }

      const avgA = sumA / (SS * SS);
      const avgR = sumA > 0 ? sumR / sumA : 0;
      const avgG = sumA > 0 ? sumG / sumA : 0;
      const avgB = sumA > 0 ? sumB / sumA : 0;

      const px = rowStart + 1 + x * 4;
      raw[px] = Math.round(avgR);
      raw[px + 1] = Math.round(avgG);
      raw[px + 2] = Math.round(avgB);
      raw[px + 3] = Math.round(avgA * 255);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type: RGBA
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  const idat = zlib.deflateSync(raw);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), renderIcon(size));
}

console.log('Icons generated in', outDir);
