import { describe, it, expect } from 'vitest';

describe('Desktop File Associations & Gallery Support', () => {
  const MIME_MAP: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
  };

  const SUPPORTED_EXTS = new Set(Object.keys(MIME_MAP));

  it('correctly identifies all supported PDF and image extensions for desktop file association', () => {
    const testCases = [
      { filename: 'invoice.pdf', expected: 'application/pdf', isSupported: true },
      { filename: 'photo.JPG', expected: 'image/jpeg', isSupported: true },
      { filename: 'graphic.png', expected: 'image/png', isSupported: true },
      { filename: 'banner.webp', expected: 'image/webp', isSupported: true },
      { filename: 'nextgen.avif', expected: 'image/avif', isSupported: true },
      { filename: 'bitmap.bmp', expected: 'image/bmp', isSupported: true },
      { filename: 'animation.gif', expected: 'image/gif', isSupported: true },
      { filename: 'scan.tiff', expected: 'image/tiff', isSupported: true },
      { filename: 'document.txt', expected: undefined, isSupported: false },
      { filename: 'script.exe', expected: undefined, isSupported: false },
    ];

    for (const testCase of testCases) {
      const ext = '.' + testCase.filename.split('.').pop()!.toLowerCase();
      const isSupported = SUPPORTED_EXTS.has(ext);
      expect(isSupported).toBe(testCase.isSupported);
      if (isSupported) {
        expect(MIME_MAP[ext]).toBe(testCase.expected);
      }
    }
  });

  it('filters command-line arguments and ignores flags, runtime executables, and non-supported files', () => {
    const mockArgv = [
      'C:\\Program Files\\Paperweight\\Paperweight.exe',
      '--hidden',
      '--inspect=9222',
      '/prefetch:1',
      '.',
      'C:\\Users\\Desktop\\sample.pdf',
      '"D:\\Photos\\vacation.jpg"',
      'D:\\Projects\\notes.txt',
      'D:\\Photos\\artwork.png',
    ];

    const parsedFiles: string[] = [];
    for (const rawArg of mockArgv) {
      const clean = rawArg.trim().replace(/^"(.*)"$/, '$1');
      if (clean.startsWith('-') || clean.startsWith('/')) continue;
      if (clean === '.' || clean === '..') continue;
      if (clean.toLowerCase().endsWith('.exe') || clean.toLowerCase().endsWith('node')) continue;

      const ext = '.' + clean.split('.').pop()!.toLowerCase();
      if (SUPPORTED_EXTS.has(ext)) {
        parsedFiles.push(clean);
      }
    }

    expect(parsedFiles).toEqual([
      'C:\\Users\\Desktop\\sample.pdf',
      'D:\\Photos\\vacation.jpg',
      'D:\\Photos\\artwork.png',
    ]);
  });

  it('separates incoming desktop files into PDF viewer and Image gallery targets', () => {
    const mockIncomingFiles = [
      { name: 'document.pdf', type: 'application/pdf', size: 102400 },
      { name: 'photo1.jpg', type: 'image/jpeg', size: 204800 },
      { name: 'photo2.png', type: 'image/png', size: 409600 },
    ];

    const pdfFiles = mockIncomingFiles.filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
    const imageFiles = mockIncomingFiles.filter(
      (f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|avif|bmp|gif|tiff?)$/i.test(f.name)
    );

    expect(pdfFiles.length).toBe(1);
    expect(pdfFiles[0].name).toBe('document.pdf');

    expect(imageFiles.length).toBe(2);
    expect(imageFiles.map((i) => i.name)).toEqual(['photo1.jpg', 'photo2.png']);
  });
});
