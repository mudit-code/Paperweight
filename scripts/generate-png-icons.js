import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');

// Generates an RGBA PNG with given width, height, and pixel generator callback
function createPNG(width, height, isMaskable = false) {
  // RGBA buffer: 4 bytes per pixel + 1 filter byte per row
  const rowStride = 1 + width * 4;
  const rawData = Buffer.alloc(height * rowStride);

  const cx = width / 2;
  const cy = height / 2;
  // If maskable, safe zone radius is 0.4 * size; if regular, 0.45 * size
  const maxR = isMaskable ? width * 0.38 : width * 0.44;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowStride;
    rawData[rowOffset] = 0; // Filter type 0 (None)

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Background
      let r = 20, g = 19, b = 18, a = 255; // #141312

      // Geometric faceted paperweight shape
      // Polygon vertices scaled to size
      const scale = width / 64;
      // Check if inside polygon: (32, 12), (48, 25), (42, 50), (22, 50), (16, 25)
      const nx = x / scale;
      const ny = y / scale;

      // Distance from center for diamond/faceted gem
      const inGem = (Math.abs(nx - 32) * 1.5 + Math.abs(ny - 31)) < 24 && ny >= 12 && ny <= 50;

      if (inGem) {
        // Facet shading
        if (nx >= 32 && ny <= 30) {
          // Amber highlight facet
          r = 217; g = 119; b = 6;
        } else if (nx < 32 && ny <= 30) {
          r = 42; g = 39; b = 36;
        } else if (nx >= 32 && ny > 30) {
          r = 51; g = 48; b = 44;
        } else {
          r = 34; g = 32; b = 29;
        }

        // Inner ridge
        if (Math.abs(nx - 32) < 1 || Math.abs(ny - 30) < 1) {
          r = Math.min(255, r + 40);
          g = Math.min(255, g + 40);
          b = Math.min(255, b + 40);
        }
      } else if (!isMaskable) {
        // Rounded card boundary for standard icon
        const cornerDist = Math.max(Math.abs(dx), Math.abs(dy));
        if (cornerDist > maxR) {
          a = 0; // Transparent outside
        }
      }

      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  const deflated = zlib.deflateSync(rawData);

  // Helper for CRC32
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[i] = c;
  }

  function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
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

  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // Bit depth
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // Compression
  ihdrData[11] = 0; // Filter
  ihdrData[12] = 0; // Interlace

  const ihdrChunk = makeChunk('IHDR', ihdrData);
  const idatChunk = makeChunk('IDAT', deflated);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

fs.writeFileSync(path.join(publicDir, 'icon-192.png'), createPNG(192, 192, false));
fs.writeFileSync(path.join(publicDir, 'icon-512.png'), createPNG(512, 512, false));
fs.writeFileSync(path.join(publicDir, 'icon-maskable-512.png'), createPNG(512, 512, true));

console.log('Successfully generated PNG icons: icon-192.png, icon-512.png, icon-maskable-512.png');
