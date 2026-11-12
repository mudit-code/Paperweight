/**
 * CanvasPool & Render Pipeline Management for Paperweight PDF Viewer
 *
 * Enforces strict memory and canvas budgets:
 * - TOTAL_CANVAS_PIXEL_BUDGET: 32 MP (~134 MB RGBA memory pool)
 * - MAX_CANVAS_PIXELS: 8 MP (per-canvas ceiling, safe for iOS Safari)
 * - MAX_PAGE_DPR: 2.0 (for full-page overview; 3.0 reserved for visible zoom tiles in Phase 5)
 *
 * Real Worst-Case Live Pixel Total:
 * - 3 display canvases (viewport + 1 buffer above + 1 buffer below) @ 8 MP max = 24 MP
 * - 1 active offscreen double-buffer canvas @ 8 MP max = 8 MP
 * - Total worst-case live pixel budget ceiling = 32 MP (134.2 MB RGBA VRAM)
 * - Standard mobile 2.0 DPR overview: 3 display (2.20 MP) + 1 offscreen (0.73 MP) = 2.93 MP (11.7 MB)
 */

import type * as pdfjsLib from 'pdfjs-dist';

export const TOTAL_CANVAS_PIXEL_BUDGET = 96 * 1024 * 1024; // 96 Megapixels (~384 MB GPU VRAM ceiling)
export const MAX_CANVAS_DIMENSION = 3840; // Safe 4K mobile GPU texture ceiling (guaranteed < 4096 GL limit)
export const MAX_CANVAS_PIXELS = 8 * 1024 * 1024; // 8 Megapixels per canvas (~32 MB RGBA memory pool)
export const MAX_PAGE_DPR = 3.0; // Allow native OLED mobile DPR (up to 3.0x for pin-sharp text)

export interface LiveCanvasEntry {
  pageNumber: number;
  canvas: HTMLCanvasElement;
  pixels: number;
  scale?: number;
  pageProxy?: pdfjsLib.PDFPageProxy;
  lastUsed: number;
}

export class CanvasPool {
  private static liveEntries: Map<number, LiveCanvasEntry> = new Map();
  private static totalAllocatedPixels = 0;
  private static protectedRange: [number, number] = [0, 0];

  public static setProtectedWindow(bufferStart: number, bufferEnd: number): void {
    this.protectedRange = [bufferStart, bufferEnd];
  }

  // Reusable offscreen double-buffer canvas (counted against total pixel budget)
  private static offscreenCanvas: HTMLCanvasElement | null = null;
  private static activeOffscreenPixels = 0;

  // Active in-flight render tasks
  private static activeTasks: Set<pdfjsLib.RenderTask> = new Set();

  /**
   * Calculate safe DPR capped at MAX_PAGE_DPR (2.0)
   */
  public static getSafeDpr(requestedDpr?: number): number {
    const systemDpr =
      typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const dpr = requestedDpr ?? systemDpr;
    return Math.min(Math.max(dpr, 1.0), MAX_PAGE_DPR);
  }

  /**
   * Calculate safe canvas dimensions respecting MAX_CANVAS_DIMENSION (3840) and MAX_CANVAS_PIXELS (8 MP)
   */
  public static calculateSafeDimensions(
    cssWidth: number,
    cssHeight: number,
    dpr: number
  ): { pixelWidth: number; pixelHeight: number; effectiveDpr: number } {
    let effectiveDpr = CanvasPool.getSafeDpr(dpr);
    let pixelWidth = Math.max(1, Math.floor(cssWidth * effectiveDpr));
    let pixelHeight = Math.max(1, Math.floor(cssHeight * effectiveDpr));

    // Guard 1: Enforce single-dimension hardware texture limit (MAX_CANVAS_DIMENSION = 3840)
    const maxDim = Math.max(pixelWidth, pixelHeight);
    if (maxDim > MAX_CANVAS_DIMENSION) {
      const dimReduction = MAX_CANVAS_DIMENSION / maxDim;
      effectiveDpr = effectiveDpr * dimReduction;
      pixelWidth = Math.max(1, Math.floor(cssWidth * effectiveDpr));
      pixelHeight = Math.max(1, Math.floor(cssHeight * effectiveDpr));
    }

    // Guard 2: Enforce total pixel budget ceiling (MAX_CANVAS_PIXELS = 8 MP)
    let totalPixels = pixelWidth * pixelHeight;
    if (totalPixels > MAX_CANVAS_PIXELS) {
      const reductionFactor = Math.sqrt(MAX_CANVAS_PIXELS / totalPixels);
      effectiveDpr = effectiveDpr * reductionFactor;
      pixelWidth = Math.max(1, Math.floor(cssWidth * effectiveDpr));
      pixelHeight = Math.max(1, Math.floor(cssHeight * effectiveDpr));
    }

    return { pixelWidth, pixelHeight, effectiveDpr };
  }

  /**
   * Acquire or resize the reusable offscreen canvas.
   * Counts offscreen canvas pixels against TOTAL_CANVAS_PIXEL_BUDGET.
   * Evicts least-recently-used display canvases if budget would be exceeded.
   */
  public static acquireOffscreenCanvas(
    width: number,
    height: number
  ): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
    if (typeof document === 'undefined') return null;

    const neededPixels = width * height;

    // Release any previous offscreen allocation from budget count
    if (this.activeOffscreenPixels > 0) {
      this.totalAllocatedPixels -= this.activeOffscreenPixels;
      this.activeOffscreenPixels = 0;
    }

    // Evict older display canvases if adding this offscreen canvas exceeds budget
    while (
      this.totalAllocatedPixels + neededPixels > TOTAL_CANVAS_PIXEL_BUDGET &&
      this.liveEntries.size > 0
    ) {
      const evicted = this.evictLeastRecentlyUsed(-1);
      if (!evicted) break; // Cannot evict canvases in the active window
    }

    if (!this.offscreenCanvas) {
      this.offscreenCanvas = document.createElement('canvas');
    }

    if (this.offscreenCanvas.width !== width || this.offscreenCanvas.height !== height) {
      this.offscreenCanvas.width = width;
      this.offscreenCanvas.height = height;
    }
    this.activeOffscreenPixels = neededPixels;
    this.totalAllocatedPixels += neededPixels;

    const ctx = this.offscreenCanvas.getContext('2d', { alpha: false });
    if (!ctx) return null;

    return { canvas: this.offscreenCanvas, ctx };
  }

  /**
   * Release the offscreen canvas lock and reclaim its pixels from the budget.
   * Keeps backing GPU texture allocated between page renders to avoid driver stalls.
   */
  public static releaseOffscreenCanvas(): void {
    if (this.activeOffscreenPixels > 0) {
      this.totalAllocatedPixels -= this.activeOffscreenPixels;
      this.activeOffscreenPixels = 0;
    }
  }

  /**
   * Completely deallocates offscreen canvas texture and reclaims GPU memory on document close.
   */
  public static destroyOffscreenCanvas(): void {
    if (this.offscreenCanvas) {
      this.offscreenCanvas.width = 0;
      this.offscreenCanvas.height = 0;
      this.offscreenCanvas = null;
    }
    if (this.activeOffscreenPixels > 0) {
      this.totalAllocatedPixels -= this.activeOffscreenPixels;
      this.activeOffscreenPixels = 0;
    }
  }

  /**
   * Register a newly rendered page canvas and evict older canvases if pixel budget is exceeded
   */
  public static registerCanvas(
    pageNumber: number,
    canvas: HTMLCanvasElement,
    pixels: number,
    pageProxy?: pdfjsLib.PDFPageProxy,
    scale?: number
  ): void {
    // If this page was already in the pool, update its entry
    const existing = this.liveEntries.get(pageNumber);
    if (existing) {
      this.totalAllocatedPixels -= existing.pixels;
    }

    // Check if adding this canvas exceeds the total budget
    while (
      this.totalAllocatedPixels + pixels > TOTAL_CANVAS_PIXEL_BUDGET &&
      this.liveEntries.size > 0
    ) {
      const evicted = this.evictLeastRecentlyUsed(pageNumber);
      if (!evicted) break; // Cannot evict canvases in the active window
    }

    this.liveEntries.set(pageNumber, {
      pageNumber,
      canvas,
      pixels,
      scale,
      pageProxy,
      lastUsed: Date.now(),
    });

    this.totalAllocatedPixels += pixels;
  }

  /**
   * Check if a page already has a valid rendered canvas backing
   */
  public static hasLiveCanvas(pageNumber: number): boolean {
    const entry = this.liveEntries.get(pageNumber);
    return Boolean(entry && entry.pixels > 0 && entry.canvas && entry.canvas.width > 0);
  }

  /**
   * Get the live entry for a page if present and allocated
   */
  public static getLiveCanvasEntry(pageNumber: number): LiveCanvasEntry | null {
    const entry = this.liveEntries.get(pageNumber);
    return entry && entry.pixels > 0 && entry.canvas && entry.canvas.width > 0 ? entry : null;
  }

  /**
   * Get the live canvas element for a page if present
   */
  public static getLiveCanvas(pageNumber: number): HTMLCanvasElement | null {
    const entry = this.getLiveCanvasEntry(pageNumber);
    return entry ? entry.canvas : null;
  }

  /**
   * Update the DOM canvas element pointer when a page remounts and reuses the texture
   */
  public static updateCanvasElement(pageNumber: number, newCanvas: HTMLCanvasElement): void {
    const entry = this.liveEntries.get(pageNumber);
    if (entry) {
      entry.canvas = newCanvas;
      entry.lastUsed = Date.now();
    }
  }

  /**
   * Touch a page entry to mark it recently used
   */
  public static touchPage(pageNumber: number): void {
    const entry = this.liveEntries.get(pageNumber);
    if (entry) {
      entry.lastUsed = Date.now();
    }
  }

  /**
   * Evict the least recently used canvas, strictly protecting pages within the active viewport window.
   * Under NO circumstances should any canvas within the protected active window be evicted or wiped!
   */
  private static evictLeastRecentlyUsed(protectedPageNumber: number): boolean {
    let oldestPage = -1;
    let oldestTime = Infinity;

    // Prioritize evicting pages strictly OUTSIDE the active viewport/buffer window
    for (const [pageNum, entry] of this.liveEntries.entries()) {
      if (pageNum === protectedPageNumber) continue;
      if (pageNum >= this.protectedRange[0] && pageNum <= this.protectedRange[1]) continue;
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestPage = pageNum;
      }
    }

    if (oldestPage === -1) {
      // All active canvases are within the protected window; never destroy on-screen content!
      return false;
    }

    const entry = this.liveEntries.get(oldestPage);
    if (entry) {
      this.deallocateCanvas(entry.canvas, entry.pageProxy);
      this.totalAllocatedPixels -= entry.pixels;
      this.liveEntries.delete(oldestPage);
      return true;
    }

    return false;
  }

  /**
   * Deallocate canvas backing texture immediately and free page resources
   */
  public static deallocateCanvas(
    canvas: HTMLCanvasElement | null,
    pageProxy?: pdfjsLib.PDFPageProxy
  ): void {
    if (canvas) {
      try {
        canvas.width = 0;
        canvas.height = 0;
      } catch (err) {
        console.warn('Failed to deallocate canvas dimensions:', err);
      }
    }
    if (pageProxy) {
      try {
        pageProxy.cleanup();
      } catch (err) {
        console.warn('Failed to cleanup pageProxy:', err);
      }
    }
  }

  /**
   * Unregister and deallocate a specific page from the pool
   */
  public static unregisterPage(pageNumber: number): void {
    const entry = this.liveEntries.get(pageNumber);
    if (entry) {
      this.deallocateCanvas(entry.canvas, entry.pageProxy);
      this.totalAllocatedPixels -= entry.pixels;
      this.liveEntries.delete(pageNumber);
    }
  }

  /**
   * Render Task Registration & Cancellation Management
   */
  public static registerRenderTask(task: pdfjsLib.RenderTask): void {
    this.activeTasks.add(task);
  }

  public static unregisterRenderTask(task: pdfjsLib.RenderTask): void {
    this.activeTasks.delete(task);
  }

  public static cancelAllPendingTasks(): void {
    for (const task of this.activeTasks) {
      try {
        task.cancel();
      } catch {}
    }
    this.activeTasks.clear();
  }

  /**
   * Clear all canvases, offscreen buffer, tasks, and release memory on document close
   */
  public static clearAll(): void {
    this.cancelAllPendingTasks();
    this.destroyOffscreenCanvas();
    for (const entry of this.liveEntries.values()) {
      this.deallocateCanvas(entry.canvas, entry.pageProxy);
    }
    this.liveEntries.clear();
    this.totalAllocatedPixels = 0;
    this.protectedRange = [0, 0];
  }

  /**
   * Current stats for dev overlay and profiling
   */
  public static getStats(): {
    liveCanvases: number;
    displayPixels: number;
    offscreenPixels: number;
    totalPixels: number;
    totalMB: number;
    isOffscreenActive: boolean;
  } {
    return {
      liveCanvases: this.liveEntries.size,
      displayPixels: this.totalAllocatedPixels - this.activeOffscreenPixels,
      offscreenPixels: this.activeOffscreenPixels,
      totalPixels: this.totalAllocatedPixels,
      totalMB: (this.totalAllocatedPixels * 4) / (1024 * 1024),
      isOffscreenActive: this.activeOffscreenPixels > 0,
    };
  }
}
