import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, StandardFonts } from 'pdf-lib';

describe('PDF Viewer TTFP Bisect Benchmark (Phase 2 vs Phase 3)', () => {
  it('measures Time-To-First-Page with and without probing worker congestion on 256-page PDF', async () => {
    // Generate a 256-page PDF with realistic text content
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 256; i++) {
      const page = pdfDoc.addPage([595.28, 841.89]);
      page.drawText(`Benchmark Page ${i} / 256`, { x: 50, y: 800, font, size: 14 });
      for (let j = 0; j < 10; j++) {
        page.drawText(`Sample body line ${j + 1} with standard document content for measuring parsing overhead.`, {
          x: 50,
          y: 750 - j * 20,
          font,
          size: 10,
        });
      }
    }
    const pdfBytes = await pdfDoc.save();
    const fileSizeMB = (pdfBytes.byteLength / (1024 * 1024)).toFixed(2);
    console.log(`Generated 256-page benchmark PDF: ${fileSizeMB} MB`);

    // -------------------------------------------------------------
    // RUN 1: Phase 3 Pipeline (Immediate Prober flooding Worker IPC queue)
    // -------------------------------------------------------------
    const startPhase3 = performance.now();
    const docP3 = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;
    
    // Simulate Phase 3: Immediate background probing of 256 pages launched right at doc open
    let proberCount = 0;
    const probePromise = (async () => {
      for (let i = 1; i <= 256; i++) {
        const p = await docP3.getPage(i);
        proberCount++;
        p.cleanup();
      }
    })();

    // In Phase 3, Page 1 render is requested concurrently while prober has flooded the queue
    const p1Promise = (async () => {
      // Small tick delay as in React useEffect mount
      await new Promise(r => setTimeout(r, 5));
      const p1 = await docP3.getPage(1);
      const opList = await p1.getOperatorList();
      p1.cleanup();
      return opList;
    })();

    await p1Promise;
    const ttfpPhase3 = performance.now() - startPhase3;
    console.log(`[MEASURED - Vitest/Node] Phase 3 TTFP (Worker Queue Flooded by Prober): ${ttfpPhase3.toFixed(1)} ms`);

    await probePromise;
    docP3.cleanup();

    // -------------------------------------------------------------
    // RUN 2: Target Fix Pipeline (Page 1 Priority - Zero Probing until Page 1 rendered)
    // -------------------------------------------------------------
    const startPriority = performance.now();
    const docPriority = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;

    // Direct Page 1 render with ZERO worker queue contention
    const p1Priority = await docPriority.getPage(1);
    const _opListPriority = await p1Priority.getOperatorList();
    expect(_opListPriority.fnArray.length).toBeGreaterThan(0);
    p1Priority.cleanup();

    const ttfpPriority = performance.now() - startPriority;
    console.log(`[MEASURED - Vitest/Node] Priority Queue TTFP (Page 1 Rendered First, Zero Contention): ${ttfpPriority.toFixed(1)} ms`);
    console.log(`[MEASURED - Vitest/Node] Contention Overhead in Phase 3: +${(ttfpPhase3 - ttfpPriority).toFixed(1)} ms (${(ttfpPhase3 / ttfpPriority).toFixed(2)}x slower)`);

    docPriority.cleanup();

    expect(ttfpPriority).toBeLessThan(ttfpPhase3);
  });
});
