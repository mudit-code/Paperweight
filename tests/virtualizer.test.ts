import { describe, it, expect, vi } from 'vitest';
import {
  computeVisiblePageRange,
  getPageDimensions,
  getScrollOffsetForPage,
  calculateFocalScrollOffsets,
  probeAllPageDimensions,
} from '../src/core/pdf/virtualizer';

describe('PDF Virtualizer', () => {
  const containerWidth = 360;
  const defaultAspect = 1.414; // A4 aspect ratio

  it('calculates page dimensions with responsive fit-to-width bounds', () => {
    const dims = getPageDimensions(1, containerWidth, defaultAspect);
    expect(dims.width).toBe(328); // 360 - 32
    expect(dims.height).toBeCloseTo(328 * 1.414, 2);
    expect(dims.itemHeight).toBeGreaterThan(dims.height);
  });

  it('computes initial page 1 window with 5-page forward buffer below', () => {
    const range = computeVisiblePageRange(0, 700, 200, containerWidth, defaultAspect);

    expect(range.firstVisible).toBe(1);
    expect(range.displayFirst).toBe(1);
    expect(range.centerPage).toBe(1);
    expect(range.bufferStart).toBe(1); // can't go below page 1
    expect(range.bufferEnd).toBe(range.lastVisible + 5);
    expect(range.bufferEnd).toBeLessThanOrEqual(8);
  });

  it('computes middle-page scroll window with buffer pages above and below', () => {
    const { itemHeight } = getPageDimensions(1, containerWidth, defaultAspect);
    // Scroll to page 50
    const scrollTop = itemHeight * 49;
    const range = computeVisiblePageRange(
      scrollTop,
      700,
      200,
      containerWidth,
      defaultAspect
    );

    expect(range.firstVisible).toBe(50);
    expect(range.centerPage).toBe(50);
    expect(range.bufferStart).toBe(48); // 2 pages above
    expect(range.bufferEnd).toBe(range.lastVisible + 5); // 5 pages below
  });

  it('computes end-of-document window clamped to totalPages', () => {
    const { itemHeight } = getPageDimensions(1, containerWidth, defaultAspect);
    const scrollTop = itemHeight * 200;
    const range = computeVisiblePageRange(
      scrollTop,
      700,
      200,
      containerWidth,
      defaultAspect
    );

    expect(range.bufferEnd).toBe(200);
    expect(range.bufferStart).toBeGreaterThanOrEqual(198);
  });

  it('calculates exact scroll offset to jump to any page', () => {
    const { itemHeight } = getPageDimensions(1, containerWidth, defaultAspect);
    const offset1 = getScrollOffsetForPage(1, containerWidth, defaultAspect);
    expect(offset1).toBe(0);

    const offset10 = getScrollOffsetForPage(10, containerWidth, defaultAspect);
    expect(offset10).toBe(itemHeight * 9);
  });

  it('probes page dimensions in idle batches and cleans up pages', async () => {
    const mockCleanups: Array<() => void> = [];
    const mockPages = [
      { view: [0, 0, 595, 842], rotate: 0 }, // Portrait ~1.415
      { view: [0, 0, 842, 595], rotate: 0 }, // Landscape ~0.706
      { view: [0, 0, 595, 842], rotate: 90 }, // Portrait rotated 90 = Landscape ~0.706
    ];

    const mockDoc = {
      getPage: async (i: number) => {
        const cleanup = vi.fn();
        mockCleanups.push(cleanup);
        return {
          view: mockPages[i - 1].view,
          rotate: mockPages[i - 1].rotate,
          cleanup,
        };
      },
    };

    let receivedBatch: Map<number, number> | null = null;
    const handle = probeAllPageDimensions(
      mockDoc,
      3,
      (batch) => {
        receivedBatch = batch;
      },
      2
    );

    await new Promise((r) => setTimeout(r, 60));

    expect(receivedBatch).not.toBeNull();
    expect(receivedBatch!.size).toBe(3);
    expect(receivedBatch!.get(1)).toBeCloseTo(842 / 595, 2);
    expect(receivedBatch!.get(2)).toBeCloseTo(595 / 842, 2);
    expect(receivedBatch!.get(3)).toBeCloseTo(595 / 842, 2);
    expect(mockCleanups.length).toBe(3);
    mockCleanups.forEach((c) => expect(c).toHaveBeenCalled());
    handle.cancel();
  });

  it('calculates page-accurate focal scroll offsets during zoom to prevent virtualizer offset drift', () => {
    // Page 181 at scale 1.0
    const startScrollTop = getScrollOffsetForPage(181, containerWidth, defaultAspect, undefined, 1.0);
    const focalY = 300; // Touch point 300px from viewport top

    const { scrollTop: newScrollTop } = calculateFocalScrollOffsets(
      0,
      focalY,
      0,
      startScrollTop,
      1.0,
      2.5,
      containerWidth,
      defaultAspect,
      undefined,
      256
    );

    // Compute range at new scale and new scroll position: Page 181 MUST be visible!
    const range = computeVisiblePageRange(newScrollTop, 700, 256, containerWidth, defaultAspect, undefined, 2.5);
    expect(range.firstVisible).toBeLessThanOrEqual(181);
    expect(range.lastVisible).toBeGreaterThanOrEqual(181);
  });

  it('accurately pins horizontal focal point on double-tap zoom to prevent left-side shifting', () => {
    // containerWidth = 360, at scale 1.0 page canvas is 328px wide with 16px margins on each side
    // Double tap on the right side of the page (focalX = 300)
    const rightZoom = calculateFocalScrollOffsets(
      300,
      200,
      0,
      0,
      1.0,
      2.5,
      containerWidth,
      defaultAspect,
      undefined,
      10
    );

    // At 2.5x, wrapper is 868px (820px + 48px padding), pageLeft is 24px
    // Tapped point (touchDocX = 300, withinPageX = 284 / 328 = 0.8658) maps to 24 + 0.8658*820 = 734px
    // To keep it at focalX = 300, scrollLeft must be ~434px (not 0!)
    expect(rightZoom.scrollLeft).toBeGreaterThan(400);
    expect(rightZoom.scrollLeft).toBeLessThanOrEqual(508); // Clamped within maxScroll (868 - 360 = 508)

    // Double tap on the left side of the page (focalX = 50)
    const leftZoom = calculateFocalScrollOffsets(
      50,
      200,
      0,
      0,
      1.0,
      2.5,
      containerWidth,
      defaultAspect,
      undefined,
      10
    );
    expect(leftZoom.scrollLeft).toBeGreaterThan(25);
    expect(leftZoom.scrollLeft).toBeLessThan(120);

    // Zooming out to fit-to-page (scale <= 1.02) resets scrollLeft to 0
    const zoomOut = calculateFocalScrollOffsets(
      300,
      200,
      rightZoom.scrollLeft,
      rightZoom.scrollTop,
      2.5,
      1.0,
      containerWidth,
      defaultAspect,
      undefined,
      10
    );
    expect(zoomOut.scrollLeft).toBe(0);
  });

  it('handles simultaneous pinch and pan without jitter using current focal points', () => {
    const focalX = 180;
    const focalY = 300;
    // User moves two fingers 40px right and 30px down while pinching
    const currentFocalX = 220;
    const currentFocalY = 330;

    const res = calculateFocalScrollOffsets(
      focalX,
      focalY,
      0,
      100,
      1.0,
      2.0,
      containerWidth,
      defaultAspect,
      undefined,
      10,
      currentFocalX,
      currentFocalY
    );

    expect(Number.isFinite(res.scrollLeft)).toBe(true);
    expect(Number.isFinite(res.scrollTop)).toBe(true);
  });
});
