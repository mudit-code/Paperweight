import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument } from 'pdf-lib';
import { RenderQueue } from '../src/core/pdf/renderQueue';

describe('RenderQueue Priority and State Machine', () => {
  let doc: pdfjsLib.PDFDocumentProxy;
  const originalDoc = globalThis.document;

  beforeEach(async () => {
    // Standard mock for Node environment with Canvas 2D Context Proxy
    globalThis.document = {
      createElement: () => {
        const mockCanvas: any = {
          width: 400,
          height: 600,
          style: {},
        };
        const mockCtx: any = new Proxy(
          {
            canvas: mockCanvas,
            getTransform: () => ({
              a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
              invertSelf: () => {},
              multiply: () => {},
            }),
            measureText: () => ({ width: 10 }),
          },
          {
            get(target, prop) {
              if (prop in target) return (target as any)[prop];
              return () => {};
            },
            set(target, prop, val) {
              (target as any)[prop] = val;
              return true;
            },
          }
        );
        mockCanvas.getContext = () => mockCtx;
        return mockCanvas;
      },
    } as any;

    RenderQueue.resetInstance();
    const pdfDoc = await PDFDocument.create();
    for (let i = 1; i <= 5; i++) {
      const page = pdfDoc.addPage([400, 600]);
      page.drawText(`Page ${i}`);
    }
    const bytes = await pdfDoc.save();
    doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  });

  afterEach(() => {
    RenderQueue.resetInstance();
    if (doc) doc.cleanup();
    globalThis.document = originalDoc;
  });

  it('manages 5-state lifecycle and prioritizes visible pages over buffer pages', async () => {
    const rq = RenderQueue.getInstance();
    expect(rq.getPageState(1)).toBe('idle');

    let p1Finished = false;
    let p3Finished = false;

    // Set active window to include pages 1 to 3
    rq.updateWindow(1, 3, 1.0);

    // Enqueue buffer page (Page 3, low priority)
    rq.enqueue({
      pageNumber: 3,
      pdfDoc: doc,
      canvas: document.createElement('canvas'),
      containerWidth: 400,
      settledScale: 1.0,
      defaultAspectRatio: 1.414,
      isHighPriority: false,
      priorityDistance: 2,
      onSuccess: () => {
        p3Finished = true;
      },
    });

    // Enqueue visible page (Page 1, high priority)
    rq.enqueue({
      pageNumber: 1,
      pdfDoc: doc,
      canvas: document.createElement('canvas'),
      containerWidth: 400,
      settledScale: 1.0,
      defaultAspectRatio: 1.414,
      isHighPriority: true,
      priorityDistance: 0,
      onSuccess: () => {
        p1Finished = true;
      },
    });

    expect(rq.isBusy()).toBe(true);

    // Wait for queue to process both pages
    const startTime = Date.now();
    while ((!p1Finished || !p3Finished) && Date.now() - startTime < 4000) {
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(rq.getPageState(1)).toBe('done');
    expect(rq.getPageState(3)).toBe('done');
    expect(p1Finished).toBe(true);
    expect(p3Finished).toBe(true);
    expect(rq.isBusy()).toBe(false);
  });

  it('evicts queued pages outside buffer range on window update', () => {
    const rq = RenderQueue.getInstance();

    // Fill queue with page 1 (visible) and page 5 (queued behind page 1)
    rq.updateWindow(1, 5, 1.0);

    rq.enqueue({
      pageNumber: 1,
      pdfDoc: doc,
      canvas: document.createElement('canvas'),
      containerWidth: 400,
      settledScale: 1.0,
      defaultAspectRatio: 1.414,
      isHighPriority: true,
      priorityDistance: 0,
    });

    // Page 5 is low priority in queue
    rq.enqueue({
      pageNumber: 5,
      pdfDoc: doc,
      canvas: document.createElement('canvas'),
      containerWidth: 400,
      settledScale: 1.0,
      defaultAspectRatio: 1.414,
      isHighPriority: false,
      priorityDistance: 4,
    });

    expect(rq.getPageState(5)).toBe('queued');

    // User scrolled away before page 5 started rendering: window is now 1-2
    rq.updateWindow(1, 2, 1.0);

    // Page 5 must be evicted to idle
    expect(rq.getPageState(5)).toBe('idle');
  });

  it('replaces in-flight render with newer scale without reverting to stale scale', async () => {
    const rq = RenderQueue.getInstance();
    let finalRenderedWidth = 0;
    let p1DoneCount = 0;

    rq.updateWindow(1, 3, 1.0);
    const canvas = document.createElement('canvas');

    rq.enqueue({
      pageNumber: 1,
      pdfDoc: doc,
      canvas,
      containerWidth: 400,
      settledScale: 1.0,
      defaultAspectRatio: 1.5,
      isHighPriority: true,
      priorityDistance: 0,
      onSuccess: () => {
        p1DoneCount++;
        finalRenderedWidth = canvas.width;
      },
    });

    // Immediately change scale while Page 1 @ 1.0x is rendering (simulates dynamic pinch-to-zoom)
    rq.cancelForScaleChange(2.0);
    rq.enqueue({
      pageNumber: 1,
      pdfDoc: doc,
      canvas,
      containerWidth: 400,
      settledScale: 2.0,
      defaultAspectRatio: 1.5,
      isHighPriority: true,
      priorityDistance: 0,
      onSuccess: () => {
        p1DoneCount++;
        finalRenderedWidth = canvas.width;
      },
    });

    const startTime = Date.now();
    while (rq.isBusy() && Date.now() - startTime < 4000) {
      await new Promise((r) => setTimeout(r, 30));
    }

    expect(rq.getPageState(1)).toBe('done');
    expect(p1DoneCount).toBeGreaterThanOrEqual(1);
    // Width at scale=2.0 (368 * 2 * effectiveDpr) must be significantly wider than scale=1.0
    expect(finalRenderedWidth).toBeGreaterThan(700);
  });
});
