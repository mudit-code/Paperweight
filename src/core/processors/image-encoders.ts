/**
 * Fast, pure-JavaScript client-side image encoders for BMP and TIFF.
 * 100% offline with zero external dependencies.
 */

/**
 * Encodes Canvas ImageData into a standard 24-bit uncompressed Windows BMP file.
 */
export function encodeBmp(width: number, height: number, rgbaData: Uint8ClampedArray | Uint8Array): Uint8Array {
  // Each row in BMP must be padded to a multiple of 4 bytes
  const bytesPerPixel = 3;
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelArraySize = rowSize * height;
  const fileSize = 54 + pixelArraySize; // 14 bytes BITMAPFILEHEADER + 40 bytes BITMAPINFOHEADER

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // BITMAPFILEHEADER (14 bytes)
  view.setUint16(0, 0x4d42, true); // 'BM'
  view.setUint32(2, fileSize, true); // Total file size
  view.setUint16(6, 0, true); // Reserved 1
  view.setUint16(8, 0, true); // Reserved 2
  view.setUint32(10, 54, true); // Offset to start of pixel data

  // BITMAPINFOHEADER (40 bytes)
  view.setUint32(14, 40, true); // Header size
  view.setInt32(18, width, true); // Image width
  view.setInt32(22, height, true); // Image height (positive = bottom-to-top)
  view.setUint16(26, 1, true); // Planes = 1
  view.setUint16(28, 24, true); // 24 bits per pixel (BGR)
  view.setUint32(30, 0, true); // Compression = 0 (BI_RGB, uncompressed)
  view.setUint32(34, pixelArraySize, true); // Image size
  view.setInt32(38, 2835, true); // Horizontal resolution (72 DPI ~ 2835 ppm)
  view.setInt32(42, 2835, true); // Vertical resolution
  view.setUint32(46, 0, true); // Colors in color table
  view.setUint32(50, 0, true); // Important color count

  // BMP stores pixel rows from bottom to top, in BGR order
  let offset = 54;
  const padding = rowSize - width * bytesPerPixel;

  for (let y = height - 1; y >= 0; y--) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x++) {
      const idx = rowStart + x * 4;
      bytes[offset++] = rgbaData[idx + 2]; // Blue
      bytes[offset++] = rgbaData[idx + 1]; // Green
      bytes[offset++] = rgbaData[idx];     // Red
    }
    for (let p = 0; p < padding; p++) {
      bytes[offset++] = 0;
    }
  }

  return bytes;
}

/**
 * Encodes Canvas ImageData into a standard baseline uncompressed TIFF file.
 * Compatible with all desktop OS image viewers, Photoshop, and printing services.
 */
export function encodeTiff(
  width: number,
  height: number,
  rgbaData: Uint8ClampedArray | Uint8Array,
  dpi = 150
): Uint8Array {
  const pixelBytes = width * height * 3;
  const pixelOffset = 8;
  const afterPixels = pixelOffset + pixelBytes;
  const extraOffset = afterPixels % 2 === 0 ? afterPixels : afterPixels + 1;

  // Extra offsets for multi-byte values (BitsPerSample [8, 8, 8] and Resolution rationals)
  const bitsPerSampleOffset = extraOffset;
  const xResOffset = bitsPerSampleOffset + 6;
  const yResOffset = xResOffset + 8;
  const ifdOffset = yResOffset + 8;

  const numEntries = 12;
  const totalSize = ifdOffset + 2 + numEntries * 12 + 4;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // TIFF Header (8 bytes, Little-Endian 'II')
  bytes[0] = 0x49;
  bytes[1] = 0x49;
  view.setUint16(2, 42, true); // Magic 42
  view.setUint32(4, ifdOffset, true); // Offset to 0th IFD

  // Pixel Data (RGB)
  let dst = pixelOffset;
  for (let i = 0; i < width * height; i++) {
    const src = i * 4;
    bytes[dst++] = rgbaData[src];     // Red
    bytes[dst++] = rgbaData[src + 1]; // Green
    bytes[dst++] = rgbaData[src + 2]; // Blue
  }

  // BitsPerSample values [8, 8, 8]
  view.setUint16(bitsPerSampleOffset, 8, true);
  view.setUint16(bitsPerSampleOffset + 2, 8, true);
  view.setUint16(bitsPerSampleOffset + 4, 8, true);

  // XResolution & YResolution rationals: [dpi, 1]
  const validDpi = Math.max(72, Math.min(1200, Math.round(dpi)));
  view.setUint32(xResOffset, validDpi, true);
  view.setUint32(xResOffset + 4, 1, true);
  view.setUint32(yResOffset, validDpi, true);
  view.setUint32(yResOffset + 4, 1, true);

  // IFD (Directory Entries)
  let ifd = ifdOffset;
  view.setUint16(ifd, numEntries, true);
  ifd += 2;

  function writeEntry(tag: number, type: number, count: number, valOrOffset: number) {
    view.setUint16(ifd, tag, true);
    view.setUint16(ifd + 2, type, true);
    view.setUint32(ifd + 4, count, true);
    view.setUint32(ifd + 8, valOrOffset, true);
    ifd += 12;
  }

  // Tags MUST be sorted in ascending order per TIFF 6.0 specification
  writeEntry(256, 4, 1, width); // ImageWidth (LONG)
  writeEntry(257, 4, 1, height); // ImageLength (LONG)
  writeEntry(258, 3, 3, bitsPerSampleOffset); // BitsPerSample (SHORT[3])
  writeEntry(259, 3, 1, 1); // Compression (1 = uncompressed)
  writeEntry(262, 3, 1, 2); // PhotometricInterpretation (2 = RGB)
  writeEntry(273, 4, 1, pixelOffset); // StripOffsets (LONG)
  writeEntry(277, 3, 1, 3); // SamplesPerPixel (SHORT = 3)
  writeEntry(278, 4, 1, height); // RowsPerStrip (LONG)
  writeEntry(279, 4, 1, pixelBytes); // StripByteCounts (LONG)
  writeEntry(282, 5, 1, xResOffset); // XResolution (RATIONAL)
  writeEntry(283, 5, 1, yResOffset); // YResolution (RATIONAL)
  writeEntry(296, 3, 1, 2); // ResolutionUnit (2 = inch)

  view.setUint32(ifd, 0, true); // Next IFD offset = 0 (no more IFDs)
  return bytes;
}

/**
 * Applies grayscale transformation in-place on RGBA pixel buffer.
 */
export function applyGrayscale(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }
}

/**
 * Applies high-contrast 1-bit monochrome (B&W) transformation in-place on RGBA pixel buffer.
 */
export function applyMonochrome(data: Uint8ClampedArray, threshold = 160): void {
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const val = gray >= threshold ? 255 : 0;
    data[i] = val;
    data[i + 1] = val;
    data[i + 2] = val;
  }
}

/**
 * Parses user-specified page range strings such as "1-3, 5, 7" into a list of 1-based page indices.
 */
export function parsePageRange(rangeStr: string, totalPages: number): number[] {
  if (!rangeStr || !rangeStr.trim()) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages = new Set<number>();
  const parts = rangeStr.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-');
      const start = parseInt(startStr.trim(), 10);
      const end = parseInt(endStr.trim(), 10);

      if (!isNaN(start) && !isNaN(end)) {
        const min = Math.max(1, Math.min(start, end));
        const max = Math.min(totalPages, Math.max(start, end));
        for (let p = min; p <= max; p++) {
          pages.add(p);
        }
      }
    } else {
      const p = parseInt(trimmed, 10);
      if (!isNaN(p) && p >= 1 && p <= totalPages) {
        pages.add(p);
      }
    }
  }

  const result = Array.from(pages).sort((a, b) => a - b);
  return result.length > 0 ? result : Array.from({ length: totalPages }, (_, i) => i + 1);
}

