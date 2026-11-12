import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'path';

describe('PDF Viewer Pipeline & Offline Assets Verification', () => {
  it('loads standard fonts and CMaps locally without network or warnings', async () => {
    const fontsPath = path.resolve('./public/standard_fonts').replace(/\\/g, '/') + '/';
    const cmapsPath = path.resolve('./public/cmaps').replace(/\\/g, '/') + '/';

    console.log('Standard font local path:', fontsPath);
    console.log('CMap local path:', cmapsPath);

    // Create a PDF using all standard fonts (Helvetica, Times, Courier)
    const pdfDoc = await PDFDocument.create();
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const times = await pdfDoc.embedFont(StandardFonts.TimesRoman);
    const courier = await pdfDoc.embedFont(StandardFonts.Courier);

    const page = pdfDoc.addPage([595, 842]);
    page.drawText('Helvetica Standard Font Test', { x: 50, y: 700, font: helvetica, size: 14 });
    page.drawText('Times Roman Standard Font Test', { x: 50, y: 650, font: times, size: 14 });
    page.drawText('Courier Standard Font Test', { x: 50, y: 600, font: courier, size: 14 });

    const pdfBytes = await pdfDoc.save();

    // Intercept console.warn to assert ZERO missing-font warnings
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => {
      warnings.push(args.join(' '));
      origWarn(...args);
    };

    try {
      const loadingTask = pdfjsLib.getDocument({
        data: pdfBytes,
        standardFontDataUrl: fontsPath,
        cMapUrl: cmapsPath,
        cMapPacked: true,
      });

      const loadedDoc = await loadingTask.promise;
      expect(loadedDoc.numPages).toBe(1);

      const p1 = await loadedDoc.getPage(1);
      const opList = await p1.getOperatorList();
      expect(opList.fnArray.length).toBeGreaterThan(0);

      // Verify that no standardFontDataUrl warning occurred
      const fontWarnings = warnings.filter((w) =>
        w.includes('standardFontDataUrl') || w.includes('Unable to load font data')
      );
      expect(fontWarnings.length).toBe(0);

      p1.cleanup();
    } finally {
      console.warn = origWarn;
    }
  });

  it('measures 200-page document baseline: un-evicted memory retention vs virtualized eviction', async () => {
    // Generate synthetic 200-page PDF
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    for (let i = 1; i <= 200; i++) {
      const page = pdfDoc.addPage([595.28, 841.89]);
      page.drawText(`Paperweight Baseline - Page ${i} of 200`, { x: 50, y: 750, font, size: 12 });
      page.drawText('Testing layout rendering performance, memory allocation, and worker load across multiple pages.', {
        x: 50,
        y: 720,
        font,
        size: 10,
      });
    }
    const pdfBytes = await pdfDoc.save();

    const fontsPath = path.resolve('./public/standard_fonts').replace(/\\/g, '/') + '/';
    const cmapsPath = path.resolve('./public/cmaps').replace(/\\/g, '/') + '/';

    // 1. Measure Un-evicted Baseline (scrolling all 200 pages without eviction/cleanup)
    if (global.gc) global.gc();
    const heapBeforeUnEvicted = process.memoryUsage().heapUsed;

    const taskUnEvicted = pdfjsLib.getDocument({
      data: pdfBytes.slice(0),
      standardFontDataUrl: fontsPath,
      cMapUrl: cmapsPath,
      cMapPacked: true,
    });
    const docUnEvicted = await taskUnEvicted.promise;

    const retainedPages: any[] = [];
    for (let i = 1; i <= 200; i++) {
      const page = await docUnEvicted.getPage(i);
      await page.getOperatorList();
      retainedPages.push(page); // NO cleanup, all 200 pages retained in memory!
    }
    const heapPeakUnEvicted = process.memoryUsage().heapUsed;
    const unEvictedDeltaMB = (heapPeakUnEvicted - heapBeforeUnEvicted) / (1024 * 1024);

    console.log(`\n=== 200-PAGE BASELINE (NO EVICTION / NO CLEANUP) === [MEASURED]`);
    console.log(`Retained Pages: ${retainedPages.length}`);
    console.log(`Peak Heap Used: ${(heapPeakUnEvicted / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Heap Delta: ${unEvictedDeltaMB.toFixed(2)} MB`);

    // Clean up unevicted references
    retainedPages.length = 0;

    // 2. Measure Virtualized + Eviction Pipeline (viewport: 3 active pages max, page.cleanup() on exit)
    if (global.gc) global.gc();
    const heapBeforeEvicted = process.memoryUsage().heapUsed;

    const taskEvicted = pdfjsLib.getDocument({
      data: pdfBytes.slice(0),
      standardFontDataUrl: fontsPath,
      cMapUrl: cmapsPath,
      cMapPacked: true,
    });
    const docEvicted = await taskEvicted.promise;

    const activeWindow: any[] = [];
    let maxLivePages = 0;

    for (let i = 1; i <= 200; i++) {
      const page = await docEvicted.getPage(i);
      await page.getOperatorList();
      activeWindow.push(page);

      // Evict pages outside buffer (active page +- 1 = 3 pages max)
      while (activeWindow.length > 3) {
        const evicted = activeWindow.shift();
        evicted.cleanup();
      }
      maxLivePages = Math.max(maxLivePages, activeWindow.length);
    }

    const heapPeakEvicted = process.memoryUsage().heapUsed;
    const evictedDeltaMB = (heapPeakEvicted - heapBeforeEvicted) / (1024 * 1024);

    console.log(`\n=== 200-PAGE VIRTUALIZED PIPELINE (STRICT 3-PAGE WINDOW + CLEANUP) === [MEASURED]`);
    console.log(`Max Live Pages: ${maxLivePages}`);
    console.log(`Peak Heap Used: ${(heapPeakEvicted / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Heap Delta: ${evictedDeltaMB.toFixed(2)} MB`);
    console.log(`Memory Delta vs Non-Evicted: -${Math.max(0, unEvictedDeltaMB - evictedDeltaMB).toFixed(2)} MB`);

    expect(maxLivePages).toBeLessThanOrEqual(3);
    for (const p of activeWindow) p.cleanup();
  }, 30000);
});
