import { describe, it, expect } from 'vitest';
import {
  formatBytes,
  validateFile,
  validateBatchLimits,
} from '../src/core/files/validation';
import { detectMimeFromBytes } from '../src/core/files/mime';
import { FileValidationError, MemoryLimitError } from '../src/core/errors';

describe('File Validation & Formatting', () => {
  it('formats byte numbers accurately', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1024 * 1024 * 3.5)).toBe('3.5 MB');
    expect(formatBytes(1024 * 1024 * 1024 * 1.2)).toBe('1.2 GB');
  });

  it('detects magic bytes for PDF files', () => {
    // %PDF-
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    expect(detectMimeFromBytes(pdfBytes.buffer)).toBe('application/pdf');
  });

  it('detects magic bytes for PNG files', () => {
    // \x89PNG\r\n\x1a\n
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectMimeFromBytes(pngBytes.buffer)).toBe('image/png');
  });

  it('detects magic bytes for JPEG files', () => {
    // \xFF\xD8\xFF
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    expect(detectMimeFromBytes(jpegBytes.buffer)).toBe('image/jpeg');
  });

  it('detects magic bytes for WebP files', () => {
    // RIFF....WEBP
    const webpBytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(detectMimeFromBytes(webpBytes.buffer)).toBe('image/webp');
  });

  it('detects magic bytes for DOCX files', () => {
    // PK\x03\x04
    const docxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    expect(detectMimeFromBytes(docxBytes.buffer)).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
  });

  it('rejects empty 0-byte files with FileValidationError', async () => {
    const emptyFile = new File([], 'empty.png', { type: 'image/png' });
    await expect(validateFile(emptyFile)).rejects.toThrow(FileValidationError);
    await expect(validateFile(emptyFile)).rejects.toThrow(
      'is completely empty (0 bytes)'
    );
  });

  it('rejects files exceeding single file limit', async () => {
    const bigFile = new File(['x'.repeat(100)], 'huge.pdf', {
      type: 'application/pdf',
    });
    // Set rule max to 50 bytes for test
    await expect(validateFile(bigFile, { maxFileSize: 50 })).rejects.toThrow(
      FileValidationError
    );
  });

  it('rejects batches exceeding maximum file count', () => {
    const files = Array.from(
      { length: 251 },
      (_, i) => new File(['data'], `f_${i}.png`, { type: 'image/png' })
    );

    expect(() => validateBatchLimits(files, { maxBatchCount: 250 })).toThrow(
      FileValidationError
    );
  });

  it('rejects batches exceeding memory ceiling with MemoryLimitError', () => {
    // 10 files of 100MB each
    const files = Array.from({ length: 10 }, (_, i) => ({
      name: `file_${i}.pdf`,
      size: 100 * 1024 * 1024,
    })) as File[];

    expect(() =>
      validateBatchLimits(files, { maxBatchBytes: 500 * 1024 * 1024 })
    ).toThrow(MemoryLimitError);
  });
});
