import { describe, it, expect } from 'vitest';
import { generateUniqueScanTitle, deduplicateScanTitles, type StoredScanDoc } from '../src/tools/scanner/scans-db';
import { formatDocTitleFromFilename } from '../src/tools/scanner/DocumentEditorModal';

describe('Scanned Document Unique Naming and Deduplication', () => {
  it('generates unique titles for scans on the same day', () => {
    const existing = [
      'Paperweight Scan 18 Nov 2026',
      'Paperweight Scan 18 Nov 2026 (2)',
    ];

    const nextTitle = generateUniqueScanTitle('Paperweight Scan 18 Nov 2026', existing);
    expect(nextTitle).toBe('Paperweight Scan 18 Nov 2026 (3)');

    const uniqueOther = generateUniqueScanTitle('Paperweight Scan 19 Nov 2026', existing);
    expect(uniqueOther).toBe('Paperweight Scan 19 Nov 2026');
  });

  it('deduplicates a list of existing scans with identical titles chronologically', () => {
    const scans: StoredScanDoc[] = [
      {
        id: 'scan_3',
        title: 'Paperweight Scan 18 Nov 2026',
        createdAt: 3000,
        thumbnailUrl: '',
        pageCount: 50,
        pages: [],
      },
      {
        id: 'scan_1',
        title: 'Paperweight Scan 18 Nov 2026',
        createdAt: 1000,
        thumbnailUrl: '',
        pageCount: 1,
        pages: [],
      },
      {
        id: 'scan_2',
        title: 'Paperweight Scan 18 Nov 2026',
        createdAt: 2000,
        thumbnailUrl: '',
        pageCount: 1,
        pages: [],
      },
    ];

    const deduplicated = deduplicateScanTitles(scans);
    // Oldest (createdAt: 1000) keeps original title
    expect(deduplicated.find((s) => s.id === 'scan_1')?.title).toBe('Paperweight Scan 18 Nov 2026');
    // Second (createdAt: 2000) gets (2)
    expect(deduplicated.find((s) => s.id === 'scan_2')?.title).toBe('Paperweight Scan 18 Nov 2026 (2)');
    // Third (createdAt: 3000) gets (3)
    expect(deduplicated.find((s) => s.id === 'scan_3')?.title).toBe('Paperweight Scan 18 Nov 2026 (3)');
  });

  it('formats clean document titles from imported filenames', () => {
    expect(formatDocTitleFromFilename('Lecture_Notes.pdf')).toBe('Lecture_Notes');
    expect(formatDocTitleFromFilename('Physics_Assignment_p1.jpg')).toBe('Physics_Assignment');
    expect(formatDocTitleFromFilename('Annual-Report-page12.jpg')).toBe('Annual-Report');
    expect(formatDocTitleFromFilename('C:\\Documents\\Tax_Return_2026.pdf')).toBe('Tax_Return_2026');
    // Ignores generic camera / blob captures
    expect(formatDocTitleFromFilename('scan_raw_1.jpg')).toBe('');
    expect(formatDocTitleFromFilename('blob')).toBe('');
    expect(formatDocTitleFromFilename('raw_capture_99.png')).toBe('');
  });
});
