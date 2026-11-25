/**
 * Generates minimal deterministic PNG test textures for FE-000 using Node built-in zlib.
 * No third-party packages or network downloads required.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(__dirname, '..');

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodeRgbaPng(width, height, pixelFn) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter type 0
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y, width, height);
      const offset = rowStart + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function writeAsset(relPath, buffer) {
  const fullPath = path.join(clientRoot, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, buffer);
  console.log(`Generated ${relPath} (${buffer.length} bytes)`);
}

// 1. 4x4 white pixel for Code First panels/buttons/bars
writeAsset(
  'assets/resources/textures/white_pixel.png',
  encodeRgbaPng(4, 4, () => [255, 255, 255, 255])
);

// 2. 64x64 spike_badge.png (deep blue circular badge with teal wave & golden fish emblem)
writeAsset(
  'assets/resources/textures/spike_badge.png',
  encodeRgbaPng(64, 64, (x, y) => {
    const dx = x - 31.5;
    const dy = y - 31.5;
    const r = Math.hypot(dx, dy);
    if (r > 30) return [0, 0, 0, 0];
    if (r > 27) return [92, 214, 240, 255];
    // Simple fish silhouette in center
    const fishBody = ((dx + 3) / 14) ** 2 + (dy / 8) ** 2 <= 1;
    const fishTail = dx >= 9 && dx <= 19 && Math.abs(dy) <= (dx - 9) * 0.9;
    if (fishBody || fishTail) {
      if (Math.hypot(dx + 9, dy + 2) < 2.2) return [18, 31, 46, 255];
      return [246, 196, 83, 255];
    }
    // Subtle wave stripe
    const wave = Math.sin(x * 0.22) * 3 + 44;
    if (y > wave) return [28, 92, 130, 255];
    return [24, 54, 84, 255];
  })
);

// 3. 64x64 subpack_icon.png (subpackage bundle emerald diamond emblem for T10)
writeAsset(
  'assets/subpackages/spike-pack/subpack_icon.png',
  encodeRgbaPng(64, 64, (x, y) => {
    const dx = Math.abs(x - 31.5);
    const dy = Math.abs(y - 31.5);
    const manhattan = dx + dy;
    if (manhattan > 29) return [0, 0, 0, 0];
    if (manhattan > 25) return [110, 231, 183, 255];
    if (manhattan < 11) return [251, 191, 36, 255];
    return [16, 118, 96, 255];
  })
);
