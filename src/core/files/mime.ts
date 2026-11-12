/**
 * File MIME and magic number detection
 * Pure byte-level verification so renamed/spoofed files are detected.
 */

export interface MagicNumberCheck {
  mime: string;
  extension: string;
  check: (header: Uint8Array) => boolean;
}

export const MAGIC_SIGNATURES: MagicNumberCheck[] = [
  // PDF: %PDF-
  {
    mime: 'application/pdf',
    extension: '.pdf',
    check: (h) =>
      h.length >= 5 &&
      h[0] === 0x25 && // %
      h[1] === 0x50 && // P
      h[2] === 0x44 && // D
      h[3] === 0x46 && // F
      h[4] === 0x2d, // -
  },
  // PNG: \x89PNG\r\n\x1a\n
  {
    mime: 'image/png',
    extension: '.png',
    check: (h) =>
      h.length >= 8 &&
      h[0] === 0x89 &&
      h[1] === 0x50 &&
      h[2] === 0x4e &&
      h[3] === 0x47 &&
      h[4] === 0x0d &&
      h[5] === 0x0a &&
      h[6] === 0x1a &&
      h[7] === 0x0a,
  },
  // JPEG: \xFF\xD8\xFF
  {
    mime: 'image/jpeg',
    extension: '.jpg',
    check: (h) => h.length >= 3 && h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff,
  },
  // WebP: RIFF....WEBP
  {
    mime: 'image/webp',
    extension: '.webp',
    check: (h) =>
      h.length >= 12 &&
      h[0] === 0x52 && // R
      h[1] === 0x49 && // I
      h[2] === 0x46 && // F
      h[3] === 0x46 && // F
      h[8] === 0x57 && // W
      h[9] === 0x45 && // E
      h[10] === 0x42 && // B
      h[11] === 0x50, // P
  },
  // DOCX / ZIP: PK\x03\x04
  {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extension: '.docx',
    check: (h) =>
      h.length >= 4 &&
      h[0] === 0x50 && // P
      h[1] === 0x4b && // K
      h[2] === 0x03 &&
      h[3] === 0x04,
  },
];

export function detectMimeFromBytes(buffer: ArrayBuffer): string | null {
  const header = new Uint8Array(buffer.slice(0, 32));
  for (const sig of MAGIC_SIGNATURES) {
    if (sig.check(header)) {
      return sig.mime;
    }
  }
  return null;
}
