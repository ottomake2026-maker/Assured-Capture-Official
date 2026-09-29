const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Parse PNG to get raw RGBA pixels
function parsePNG(filePath) {
  const buf = fs.readFileSync(filePath);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  let pos = 8;
  const idatParts = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IDAT') idatParts.push(buf.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const decompressed = zlib.inflateSync(Buffer.concat(idatParts));
  const rowLen = w * 4 + 1;
  const pixels = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const filter = decompressed[y * rowLen];
    const prevRowOffset = (y - 1) * w * 4;
    const curRowOffset = y * w * 4;
    for (let x = 0; x < w * 4; x++) {
      let val = decompressed[y * rowLen + 1 + x];
      const a = x >= 4 ? pixels[curRowOffset + x - 4] : 0;
      const b = y > 0 ? pixels[prevRowOffset + x] : 0;
      const c = x >= 4 && y > 0 ? pixels[prevRowOffset + x - 4] : 0;
      if (filter === 1) val = (val + a) & 0xff;
      else if (filter === 2) val = (val + b) & 0xff;
      else if (filter === 3) val = (val + Math.floor((a + b) / 2)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        let pr = c;
        if (pa <= pb && pa <= pc) pr = a;
        else if (pb <= pc) pr = b;
        val = (val + pr) & 0xff;
      }
      pixels[curRowOffset + x] = val;
    }
  }
  return { w, h, pixels };
}

// Encode raw RGBA pixels to valid PNG
function encodePNG(width, height, getPixel) {
  const rowLen = width * 4 + 1;
  const raw = Buffer.alloc(rowLen * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowLen;
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(x, y, width, height);
      const pxOffset = rowOffset + 1 + x * 4;
      raw[pxOffset] = r;
      raw[pxOffset + 1] = g;
      raw[pxOffset + 2] = b;
      raw[pxOffset + 3] = a;
    }
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });

  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type, data) {
    const len = data.length;
    const buf = Buffer.alloc(12 + len);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4, 4, 'ascii');
    data.copy(buf, 8);
    const toCrc = buf.subarray(4, 8 + len);
    buf.writeUInt32BE(crc32(toCrc), 8 + len);
    return buf;
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdrData),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

// 1. Load exact official "a" from assured-logo.png
const logoPath = path.join(__dirname, '..', 'public', 'assured-logo.png');
const { w: logoW, h: logoH, pixels: logoPx } = parsePNG(logoPath);

// Precise bounds of "a" in assured-logo.png:
// minX: 0, maxX: 202 (width: 203)
// minY: 61, maxY: 216 (height: 156)
const A_MIN_X = 0;
const A_MAX_X = 202;
const A_WIDTH = A_MAX_X - A_MIN_X + 1; // 203
const A_MIN_Y = 61;
const A_MAX_Y = 216;
const A_HEIGHT = A_MAX_Y - A_MIN_Y + 1; // 156

// Precompute high-res mask for "a"
const aMask = new Float32Array(A_WIDTH * A_HEIGHT);
for (let y = 0; y < A_HEIGHT; y++) {
  for (let x = 0; x < A_WIDTH; x++) {
    const srcX = A_MIN_X + x;
    const srcY = A_MIN_Y + y;
    const alpha = logoPx[(srcY * logoW + srcX) * 4 + 3];
    aMask[y * A_WIDTH + x] = alpha / 255.0;
  }
}

// Sample bilinear from "a" mask
function sampleA(normX, normY) {
  if (normX < 0 || normX >= 1 || normY < 0 || normY >= 1) return 0;
  const gx = normX * (A_WIDTH - 1);
  const gy = normY * (A_HEIGHT - 1);
  const x0 = Math.floor(gx);
  const x1 = Math.min(x0 + 1, A_WIDTH - 1);
  const y0 = Math.floor(gy);
  const y1 = Math.min(y0 + 1, A_HEIGHT - 1);
  const fx = gx - x0;
  const fy = gy - y0;

  const v00 = aMask[y0 * A_WIDTH + x0];
  const v10 = aMask[y0 * A_WIDTH + x1];
  const v01 = aMask[y1 * A_WIDTH + x0];
  const v11 = aMask[y1 * A_WIDTH + x1];

  const top = v00 * (1 - fx) + v10 * fx;
  const bot = v01 * (1 - fx) + v11 * fx;
  return top * (1 - fy) + bot * fy;
}

// Exact colors from artwork:
// Bright Vibrant Cyan: #6DE4FF (R: 109, G: 228, B: 255)
const CYAN = [109, 228, 255, 255];
// Dark Navy: #071822 (R: 7, G: 24, B: 34)
const NAVY = [7, 24, 34, 255];

/**
 * Render the complete Assured Capture app icon artwork:
 * - Solid bright cyan background
 * - Navy "a" logo mark
 * - Two navy horizontal waves directly below
 * - Comfortably centered with generous safe margin for maskable icon compliance
 */
function renderIconPixel(px, py, size, isMaskable) {
  // Scale & layout parameters
  // Target width of "a" in fraction of icon size
  // For maskable icon: scale = 0.50 (guarantees 100% inside 80% circle safe zone)
  // For standard icon: scale = 0.54 (generous margins, prominent mark)
  const targetAWidth = isMaskable ? size * 0.48 : size * 0.52;
  const aScale = targetAWidth / A_WIDTH;
  const markWidth = targetAWidth;
  const aHeight = A_HEIGHT * aScale;

  // Wave parameters (proportional to "a")
  const waveGapFromA = 16 * aScale; // gap between bottom of "a" and center of Wave 1
  const waveAmplitude = 6.2 * aScale; // peak-to-trough amplitude
  const waveThickness = 14.5 * aScale; // stroke width of the wave
  const waveGapBetween = 18 * aScale; // vertical distance between Wave 1 center and Wave 2 center

  const wave1CenterY = aHeight + waveGapFromA;
  const wave2CenterY = wave1CenterY + waveGapBetween;
  const totalMarkHeight = wave2CenterY + waveThickness / 2 + waveAmplitude;

  // Center mark inside square canvas
  const markStartX = (size - markWidth) / 2;
  const markStartY = (size - totalMarkHeight) / 2;

  // Relative coordinate inside the mark bounding box
  const relX = px - markStartX;
  const relY = py - markStartY;

  let navyAlpha = 0;

  // 1. Check letter "a"
  if (relX >= -1 && relX <= markWidth + 1 && relY >= -1 && relY <= aHeight + 1) {
    const normX = relX / markWidth;
    const normY = relY / aHeight;
    const aVal = sampleA(normX, normY);
    if (aVal > navyAlpha) navyAlpha = aVal;
  }

  // 2. Check the two waves
  if (relX >= 0 && relX <= markWidth) {
    const normX = relX / markWidth;
    // Wave center formula: -cos(4 * pi * x) has 2 crests, starts & ends at trough
    // Crest at 0.25 and 0.75, trough at 0, 0.5, 1.0
    const waveOffset = -Math.cos(normX * 4 * Math.PI) * waveAmplitude;

    // Wave 1
    const dist1 = Math.abs(relY - (wave1CenterY + waveOffset));
    const halfThick = waveThickness / 2;
    if (dist1 <= halfThick + 1.2) {
      // Smooth anti-aliased edge
      const edge = halfThick + 0.5 - dist1;
      const wAlpha1 = Math.max(0, Math.min(1, edge));
      if (wAlpha1 > navyAlpha) navyAlpha = wAlpha1;
    }

    // Wave 2
    const dist2 = Math.abs(relY - (wave2CenterY + waveOffset));
    if (dist2 <= halfThick + 1.2) {
      const edge = halfThick + 0.5 - dist2;
      const wAlpha2 = Math.max(0, Math.min(1, edge));
      if (wAlpha2 > navyAlpha) navyAlpha = wAlpha2;
    }
  }

  // Blend Navy mark over Cyan background
  if (navyAlpha <= 0) return CYAN;
  if (navyAlpha >= 1) return NAVY;

  const r = Math.round(CYAN[0] * (1 - navyAlpha) + NAVY[0] * navyAlpha);
  const g = Math.round(CYAN[1] * (1 - navyAlpha) + NAVY[1] * navyAlpha);
  const b = Math.round(CYAN[2] * (1 - navyAlpha) + NAVY[2] * navyAlpha);
  return [r, g, b, 255];
}

// Generate all required sizes
const publicDir = path.join(__dirname, '..', 'public');
const distDir = path.join(__dirname, '..', 'dist');

console.log('Generating Assured Capture PWA icon assets...');

// 1. pwa-192x192.png
const png192 = encodePNG(192, 192, (x, y, w, h) => renderIconPixel(x, y, 192, false));
fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), png192);
console.log('✔ pwa-192x192.png (', png192.length, 'bytes)');

// 2. pwa-512x512.png
const png512 = encodePNG(512, 512, (x, y, w, h) => renderIconPixel(x, y, 512, false));
fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), png512);
console.log('✔ pwa-512x512.png (', png512.length, 'bytes)');

// 3. pwa-maskable-512x512.png (sufficient safe zone padding)
const pngMaskable = encodePNG(512, 512, (x, y, w, h) => renderIconPixel(x, y, 512, true));
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), pngMaskable);
console.log('✔ pwa-maskable-512x512.png (', pngMaskable.length, 'bytes)');

// 4. apple-touch-icon.png (180x180)
const pngApple = encodePNG(180, 180, (x, y, w, h) => renderIconPixel(x, y, 180, false));
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), pngApple);
console.log('✔ apple-touch-icon.png (', pngApple.length, 'bytes)');

// Also sync to dist if dist exists
if (fs.existsSync(distDir)) {
  fs.writeFileSync(path.join(distDir, 'pwa-192x192.png'), png192);
  fs.writeFileSync(path.join(distDir, 'pwa-512x512.png'), png512);
  fs.writeFileSync(path.join(distDir, 'pwa-maskable-512x512.png'), pngMaskable);
  fs.writeFileSync(path.join(distDir, 'apple-touch-icon.png'), pngApple);
  console.log('✔ Synced icons to dist/ directory');
}

console.log('All PWA icon assets generated successfully.');
