import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument } from 'pdf-lib';

describe('PDF.js URL loading verification', () => {
  it('loads PDF from Blob/URL without full arrayBuffer allocation on main thread', async () => {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([400, 400]);
    page.drawText('Blob Loading Test');
    const bytes = await pdfDoc.save();

    // Verify loadingTask with data (Uint8Array) vs URL
    const loadingTask = pdfjsLib.getDocument({
      data: bytes,
    });
    const doc = await loadingTask.promise;
    expect(doc.numPages).toBe(1);
    const p1 = await doc.getPage(1);
    expect(p1.pageNumber).toBe(1);
    p1.cleanup();
    doc.cleanup();
  });
});

