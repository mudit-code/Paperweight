import { describe, it } from 'vitest';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

describe('PDF Viewer Diagnostic Profiling', () => {
  it('profiles document loading, page retrieval, and calculates canvas memory footprint', async () => {
    console.log('=== PDF VIEWER DIAGNOSTIC BENCHMARK ===');
    console.log('pdfjs-dist version:', pdfjsLib.version);

    // 1. Generate a synthetic 200-page PDF
    console.log('\nGenerating 200-page test PDF...');
    const t0 = Date.now();
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    
    for (let i = 1; i <= 200; i++) {
      const page = pdfDoc.addPage([595.28, 841.89]); // A4
      page.drawText(`Paperweight Diagnostic Benchmark - Page ${i} of 200`, {
        x: 50,
        y: 800,
        size: 16,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
      for (let j = 0; j < 15; j++) {
        page.drawText(`Paragraph line ${j + 1}: Testing layout rendering performance, memory allocation, and worker load across multiple pages.`, {
          x: 50,
          y: 750 - j * 25,
          size: 11,
          font,
          color: rgb(0.2, 0.2, 0.2),
        });
      }
    }
    const pdfBytes = await pdfDoc.save();
    const tGen = Date.now() - t0;
    console.log(`Generated 200-page PDF: ${(pdfBytes.byteLength / 1024).toFixed(1)} KB in ${tGen}ms`);

    // 2. Measure PDF.js Document Load Time
    const tLoadStart = Date.now();
    const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
    const loadedPdf = await loadingTask.promise;
    const tLoad = Date.now() - tLoadStart;
    console.log(`PDF.js document parse & load: ${tLoad}ms (${loadedPdf.numPages} pages)`);

    // 3. Measure Page Retrieval and Operator List Extraction Time
    const tPagesStart = Date.now();
    for (let p = 1; p <= 10; p++) {
      const page = await loadedPdf.getPage(p);
      const vp = page.getViewport({ scale: 1.0 });
      const opList = await page.getOperatorList();
      if (vp.width <= 0 || opList.fnArray.length === 0) {
        throw new Error('Failed to extract page operators');
      }
    }
    const tPages10 = Date.now() - tPagesStart;
    console.log(`Page getPage() + getOperatorList() for 10 pages: ${tPages10}ms (~${(tPages10 / 10).toFixed(1)}ms per page)`);

    // 4. Theoretical Canvas Memory Footprint Calculations
    console.log('\n=== CANVAS MEMORY FOOTPRINT ANALYSIS ===');
    const dprs = [1.0, 2.0, 2.5, 3.0];
    const scales = [1.0, 1.5, 2.2, 3.0];
    const a4WidthPt = 360; // container fit width
    const a4HeightPt = 360 * 1.414; // 509px

    for (const scale of scales) {
      console.log(`\nScale ${scale}x (CSS display size: ${(a4WidthPt * scale).toFixed(0)} x ${(a4HeightPt * scale).toFixed(0)}):`);
      for (const dpr of dprs) {
        const pixelW = Math.floor(a4WidthPt * scale * dpr);
        const pixelH = Math.floor(a4HeightPt * scale * dpr);
        const pixels = pixelW * pixelH;
        const bytesPerCanvas = pixels * 4; // 4 bytes RGBA
        const mbSingle = bytesPerCanvas / (1024 * 1024);
        const mbDoubleBuffer = mbSingle * 2; // offscreen + display
        const mb200Pages = mbSingle * 200; // non-virtualized 200 pages!
        console.log(`  DPR ${dpr}x -> Canvas: ${pixelW}x${pixelH} (${(pixels / 1e6).toFixed(2)} MP) | Single: ${mbSingle.toFixed(2)} MB | DoubleBuffer: ${mbDoubleBuffer.toFixed(2)} MB | 200 Pages Non-virtualized: ${mb200Pages.toFixed(1)} MB`);
      }
    }

    // 5. Measure memory usage
    const mem = process.memoryUsage();
    console.log('\n=== HEAP USAGE ===');
    console.log(`Heap Used: ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Heap Total: ${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB`);
    console.log(`RSS: ${(mem.rss / 1024 / 1024).toFixed(2)} MB`);
  }, 30000);
});
