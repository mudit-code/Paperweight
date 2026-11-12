import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CanvasPool,
  MAX_PAGE_DPR,
  MAX_CANVAS_PIXELS,
  TOTAL_CANVAS_PIXEL_BUDGET,
} from '../src/core/pdf/canvasPool';

describe('CanvasPool & Render Budget Pipeline', () => {
  beforeEach(() => {
    CanvasPool.clearAll();
  });

  it('caps devicePixelRatio at MAX_PAGE_DPR (3.0) for full-page renders', () => {
    expect(CanvasPool.getSafeDpr(1.0)).toBe(1.0);
    expect(CanvasPool.getSafeDpr(2.0)).toBe(2.0);
    expect(CanvasPool.getSafeDpr(2.5)).toBe(2.5);
    expect(CanvasPool.getSafeDpr(3.0)).toBe(MAX_PAGE_DPR);
    expect(CanvasPool.getSafeDpr(4.0)).toBe(MAX_PAGE_DPR);
  });

  it('clamps canvas dimensions strictly within MAX_CANVAS_PIXELS', () => {
    // Normal mobile page: 360 x 509 at 2.0 DPR = 720 x 1018 = 0.73 MP
    const normal = CanvasPool.calculateSafeDimensions(360, 509, 2.0);
    expect(normal.pixelWidth * normal.pixelHeight).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);

    // Enormous unscaled dimensions: 4000 x 6000 at 2.0 DPR = 96 MP
    const huge = CanvasPool.calculateSafeDimensions(4000, 6000, 2.0);
    const totalPixels = huge.pixelWidth * huge.pixelHeight;
    expect(totalPixels).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(huge.pixelWidth).toBeLessThanOrEqual(3840);
    expect(huge.pixelHeight).toBeLessThanOrEqual(3840);
    expect(huge.effectiveDpr).toBeLessThan(2.0);
  });

  it('evicts least recently used canvases when TOTAL_CANVAS_PIXEL_BUDGET is exceeded', () => {
    const mockCanvases: HTMLCanvasElement[] = [];
    const mockCleanups: Array<() => void> = [];

    // Create 9 canvases of 12 MP each (Total 108 MP > 96 MP budget)
    const pixelsPerCanvas = 12 * 1024 * 1024;

    for (let i = 1; i <= 9; i++) {
      const canvas = {
        width: 2000,
        height: 4000,
      } as unknown as HTMLCanvasElement;
      mockCanvases.push(canvas);

      const cleanupFn = vi.fn();
      mockCleanups.push(cleanupFn);

      const mockPage = {
        cleanup: cleanupFn,
      } as any;

      CanvasPool.registerCanvas(i, canvas, pixelsPerCanvas, mockPage);
    }

    const stats = CanvasPool.getStats();
    // 96 MP / 12 MP = max 8 canvases allowed in memory at once!
    expect(stats.liveCanvases).toBeLessThanOrEqual(8);
    expect(stats.totalPixels).toBeLessThanOrEqual(TOTAL_CANVAS_PIXEL_BUDGET);

    // First canvas should have been evicted and deallocated!
    expect(mockCanvases[0].width).toBe(0);
    expect(mockCanvases[0].height).toBe(0);
    expect(mockCleanups[0]).toHaveBeenCalled();
  });

  it('never evicts or blanks out pages inside protectedRange even if budget is exceeded', () => {
    // Protect active window pages [1, 3]
    CanvasPool.setProtectedWindow(1, 3);

    const mockCanvases: HTMLCanvasElement[] = [];
    const pixelsPerCanvas = 12 * 1024 * 1024;

    for (let i = 1; i <= 9; i++) {
      const canvas = { width: 2000, height: 4000 } as unknown as HTMLCanvasElement;
      mockCanvases.push(canvas);
      CanvasPool.registerCanvas(i, canvas, pixelsPerCanvas, { cleanup: vi.fn() } as any);
    }

    // Active pages 1, 2, 3 must NEVER be wiped to width=0!
    expect(mockCanvases[0].width).toBe(2000);
    expect(mockCanvases[1].width).toBe(2000);
    expect(mockCanvases[2].width).toBe(2000);
  });

  it('cancels all pending render tasks when cancelAllPendingTasks is called', () => {
    const cancel1 = vi.fn();
    const cancel2 = vi.fn();

    const task1 = { cancel: cancel1 } as any;
    const task2 = { cancel: cancel2 } as any;

    CanvasPool.registerRenderTask(task1);
    CanvasPool.registerRenderTask(task2);

    CanvasPool.cancelAllPendingTasks();

    expect(cancel1).toHaveBeenCalled();
    expect(cancel2).toHaveBeenCalled();
  });

  it('deallocates canvas dimensions and triggers page cleanup on unregister', () => {
    const canvas = { width: 1000, height: 1500 } as unknown as HTMLCanvasElement;
    const cleanupFn = vi.fn();
    const mockPage = { cleanup: cleanupFn } as any;

    CanvasPool.registerCanvas(1, canvas, 1000 * 1500, mockPage);
    expect(CanvasPool.getStats().liveCanvases).toBe(1);

    CanvasPool.unregisterPage(1);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(cleanupFn).toHaveBeenCalled();
    expect(CanvasPool.getStats().liveCanvases).toBe(0);
  });

  it('retrieves live canvas entries and updates canvas element references', () => {
    const canvas1 = { width: 800, height: 1200 } as unknown as HTMLCanvasElement;
    CanvasPool.registerCanvas(5, canvas1, 800 * 1200, undefined, 2.0);

    expect(CanvasPool.hasLiveCanvas(5)).toBe(true);
    expect(CanvasPool.getLiveCanvas(5)).toBe(canvas1);

    const entry = CanvasPool.getLiveCanvasEntry(5);
    expect(entry).not.toBeNull();
    expect(entry?.scale).toBe(2.0);
    expect(entry?.canvas).toBe(canvas1);

    const canvas2 = { width: 800, height: 1200 } as unknown as HTMLCanvasElement;
    CanvasPool.updateCanvasElement(5, canvas2);
    expect(CanvasPool.getLiveCanvas(5)).toBe(canvas2);
  });
});
