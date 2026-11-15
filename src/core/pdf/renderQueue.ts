/**
 * Paperweight PDF Viewer — Centralized Priority Render Queue (Phase 3 Fix)
 *
 * Guarantees:
 * 1. Exactly ONE render active at a time to prevent worker queue contention.
 * 2. Strict Priority Queue: Visible pages rendered first, then buffer pages.
 * 3. Explicit 5-state lifecycle: idle -> queued -> rendering -> done | failed.
 * 4. Preemption & Cancellation: Cancelled tasks automatically return to queued
 *    and retry without getting stuck on spinners.
 * 5. Window Eviction: Only cancels renders for pages that left the viewport window
 *    or whose target scale changed. Touch and minor pan never cancel renders!
 * 6. Watchdog: Stuck renders (> 4s) are logged to the dev overlay and retried.
 * 7. Prober Coordination: Provides isBusy() so background prober never blocks
 *    visible page renders.
 */

import * as pdfjsLib from 'pdfjs-dist';
import { CanvasPool } from './canvasPool';

export type PageRenderState = 'idle' | 'queued' | 'rendering' | 'done' | 'failed';

export interface RenderTaskRequest {
  pageNumber: number;
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  canvas: HTMLCanvasElement;
  containerWidth: number;
  settledScale: number;
  defaultAspectRatio: number;
  isHighPriority: boolean; // true for visible, false for buffer
  priorityDistance?: number; // distance to visible viewport center (0 = closest)
  onSuccess?: () => void;
  onError?: (err: any) => void;
  onAspectRatioLoaded?: (pageNum: number, ratio: number) => void;
}

export interface RenderQueueStats {
  queued: number;
  rendering: number;
  done: number;
  failed: number;
  currentRenderingPage: number | null;
  watchdogLogs: string[];
}

export class RenderQueue {
  private static instance: RenderQueue | null = null;

  private queue = new Map<number, RenderTaskRequest>();
  private pageStates = new Map<number, PageRenderState>();
  private currentRenderingPage: number | null = null;
  private currentRenderingScale: number | null = null;
  private currentRenderingIsHighPriority: boolean = false;
  private currentRenderingCancelledForScale: boolean = false;
  private activeRenderTask: pdfjsLib.RenderTask | null = null;
  private renderStartTime: number = 0;

  // Window bounds tracking
  private activeWindow: {
    bufferStart: number;
    bufferEnd: number;
    settledScale: number;
    centerPage?: number;
  } = {
    bufferStart: 1,
    bufferEnd: 1,
    settledScale: 1.0,
    centerPage: 1,
  };

  // Watchdog & Logging
  private watchdogInterval: ReturnType<typeof setInterval> | null = null;
  private watchdogLogs: string[] = [];
  private listeners = new Set<() => void>();

  private constructor() {
    this.startWatchdog();
  }

  public static getInstance(): RenderQueue {
    if (!RenderQueue.instance) {
      RenderQueue.instance = new RenderQueue();
    }
    return RenderQueue.instance;
  }

  public static resetInstance(): void {
    if (RenderQueue.instance) {
      RenderQueue.instance.destroy();
      RenderQueue.instance = null;
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {}
    }
  }

  public getPageState(pageNumber: number): PageRenderState {
    return this.pageStates.get(pageNumber) || 'idle';
  }

  public isBusy(): boolean {
    return this.currentRenderingPage !== null || this.queue.size > 0;
  }

  public getStats(): RenderQueueStats {
    let queued = 0;
    let rendering = 0;
    let done = 0;
    let failed = 0;

    for (const state of this.pageStates.values()) {
      if (state === 'queued') queued++;
      else if (state === 'rendering') rendering++;
      else if (state === 'done') done++;
      else if (state === 'failed') failed++;
    }

    return {
      queued,
      rendering,
      done,
      failed,
      currentRenderingPage: this.currentRenderingPage,
      watchdogLogs: [...this.watchdogLogs.slice(-10)],
    };
  }

  /**
   * Updates current viewport window. Evicts pages outside buffer range.
   * Cancels in-flight render ONLY if the page left window or scale changed.
   */
  public updateWindow(
    bufferStart: number,
    bufferEnd: number,
    settledScale: number,
    centerPage?: number
  ): void {
    this.activeWindow = {
      bufferStart,
      bufferEnd,
      settledScale,
      centerPage: centerPage ?? this.activeWindow.centerPage ?? 1,
    };
    CanvasPool.setProtectedWindow(bufferStart, bufferEnd);

    // Evict queued tasks that are no longer within the buffer window
    for (const [pageNum] of this.queue) {
      if (pageNum < bufferStart || pageNum > bufferEnd) {
        this.queue.delete(pageNum);
        this.pageStates.set(pageNum, 'idle');
      }
    }

    // Check currently rendering page: cancel only if outside window or scale changed
    if (this.currentRenderingPage !== null) {
      const pageNum = this.currentRenderingPage;
      const outside = pageNum < bufferStart || pageNum > bufferEnd;
      if (outside && this.activeRenderTask) {
        try {
          this.activeRenderTask.cancel();
        } catch {}
      }
    }

    this.notify();
  }

  /**
   * Enqueues a page render request.
   */
  public enqueue(req: RenderTaskRequest): void {
    const pageNum = req.pageNumber;
    const currentState = this.pageStates.get(pageNum);

    // If currently rendering this exact page AND exact scale (and not cancelled for scale change), let it finish
    if (
      this.currentRenderingPage === pageNum &&
      currentState === 'rendering' &&
      !this.currentRenderingCancelledForScale &&
      this.currentRenderingScale !== null &&
      Math.abs(this.currentRenderingScale - req.settledScale) < 0.001
    ) {
      return;
    }

    // If currently rendering this page with a DIFFERENT scale, cancel in-flight render and queue the newer scale
    if (this.currentRenderingPage === pageNum && this.activeRenderTask) {
      this.currentRenderingCancelledForScale = true;
      try {
        this.activeRenderTask.cancel();
      } catch {}
    }

    // Instant Preemption: If currently rendering a buffer page (low priority) and a visible
    // page (high priority) arrives, cancel the buffer task immediately so the visible page renders without waiting!
    if (
      req.isHighPriority &&
      this.currentRenderingPage !== null &&
      this.currentRenderingPage !== pageNum &&
      !this.currentRenderingIsHighPriority &&
      this.activeRenderTask
    ) {
      try {
        this.activeRenderTask.cancel();
      } catch {}
    }

    this.queue.set(pageNum, req);
    this.pageStates.set(pageNum, 'queued');
    this.notify();

    // Trigger queue processing
    this.processNext();
  }

  /**
   * Processes the next highest priority item in the queue.
   * Enforces: Exactly ONE render active at a time!
   */
  private async processNext(): Promise<void> {
    if (this.currentRenderingPage !== null) {
      // Worker is actively rendering another page
      return;
    }

    if (this.queue.size === 0) {
      this.notify();
      return;
    }

    // Priority Sort:
    // 1. High priority (visible) first
    // 2. Lowest distance to visible viewport center (0 = closest)
    const center = this.activeWindow.centerPage ?? 1;
    const items = Array.from(this.queue.values());
    items.sort((a, b) => {
      if (a.isHighPriority !== b.isHighPriority) {
        return a.isHighPriority ? -1 : 1;
      }
      const distA = Math.abs(a.pageNumber - center);
      const distB = Math.abs(b.pageNumber - center);
      if (distA !== distB) {
        return distA - distB;
      }
      return (a.priorityDistance ?? 0) - (b.priorityDistance ?? 0);
    });

    const nextReq = items[0];
    const pageNum = nextReq.pageNumber;
    this.queue.delete(pageNum);

    this.currentRenderingPage = pageNum;
    this.currentRenderingScale = nextReq.settledScale;
    this.currentRenderingCancelledForScale = false;
    this.currentRenderingIsHighPriority = nextReq.isHighPriority;
    this.pageStates.set(pageNum, 'rendering');
    this.renderStartTime = performance.now();
    this.notify();

    let pageProxy: pdfjsLib.PDFPageProxy | null = null;
    let isCancelled = false;

    try {
      pageProxy = await nextReq.pdfDoc.getPage(pageNum);

      // Check if task was cancelled while awaiting page proxy, scale changed, or evicted from window
      const isStillNeeded =
        pageNum >= this.activeWindow.bufferStart &&
        pageNum <= this.activeWindow.bufferEnd;

      if (
        !isStillNeeded ||
        this.currentRenderingPage !== pageNum ||
        this.currentRenderingCancelledForScale
      ) {
        if (!this.queue.has(pageNum)) {
          this.pageStates.set(pageNum, 'idle');
        }
        pageProxy.cleanup();
        this.currentRenderingPage = null;
        this.currentRenderingScale = null;
        this.currentRenderingCancelledForScale = false;
        this.activeRenderTask = null;
        this.notify();
        this.processNext();
        return;
      }

      const unscaledViewport = pageProxy.getViewport({ scale: 1.0 });
      if (unscaledViewport.width > 0 && unscaledViewport.height > 0) {
        const ratio = unscaledViewport.height / unscaledViewport.width;
        nextReq.onAspectRatioLoaded?.(pageNum, ratio);
      }
      const targetMaxWidth = Math.min(Math.max(nextReq.containerWidth - 32, 280), 800);
      const fitScale = targetMaxWidth / unscaledViewport.width;
      // Cap full-page backing raster scale at 2.0x so high zoom (>= 1.35x) never wastes VRAM/time;
      // visible regions above 1.25x are rendered 1:1 native DPR by the viewport detail layer.
      const backingScale = Math.min(nextReq.settledScale, 2.0);
      const finalScale = fitScale * backingScale;

      const viewport = pageProxy.getViewport({ scale: finalScale });
      const systemDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      // Cap overview targetDpr at 2.0x (plenty sharp for 320-400+ PPI mobile displays, prevents 35MB multi-megapixel canvas thrashing)
      const targetDpr = Math.min(systemDpr, 2.0);
      const { pixelWidth, pixelHeight, effectiveDpr } =
        CanvasPool.calculateSafeDimensions(viewport.width, viewport.height, targetDpr);

      // Acquire offscreen canvas
      const offscreenObj = CanvasPool.acquireOffscreenCanvas(pixelWidth, pixelHeight);
      if (!offscreenObj) {
        throw new Error('Failed to acquire offscreen buffer from CanvasPool');
      }
      const { canvas: offscreen, ctx: offCtx } = offscreenObj;

      offCtx.imageSmoothingEnabled = true;
      offCtx.imageSmoothingQuality = 'high';
      offCtx.setTransform(1, 0, 0, 1, 0, 0);

      offCtx.fillStyle = '#ffffff';
      offCtx.fillRect(0, 0, pixelWidth, pixelHeight);

      const renderTransform = effectiveDpr !== 1
        ? [effectiveDpr, 0, 0, effectiveDpr, 0, 0]
        : null;

      const renderTask = pageProxy.render({
        canvasContext: offCtx,
        viewport,
        transform: renderTransform,
      } as unknown as Parameters<typeof pageProxy.render>[0]);

      this.activeRenderTask = renderTask;
      CanvasPool.registerRenderTask(renderTask);

      await renderTask.promise;
      CanvasPool.unregisterRenderTask(renderTask);

      // Instant synchronous blit to live display canvas
      const canvas = nextReq.canvas;
      if (canvas) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        const ctx = canvas.getContext('2d', { alpha: false });
        if (ctx) {
          ctx.drawImage(offscreen, 0, 0);
        }
      }

      CanvasPool.releaseOffscreenCanvas();
      CanvasPool.registerCanvas(pageNum, canvas, pixelWidth * pixelHeight, pageProxy, nextReq.settledScale);

      this.pageStates.set(pageNum, 'done');
      this.currentRenderingPage = null;
      this.currentRenderingScale = null;
      this.currentRenderingCancelledForScale = false;
      this.activeRenderTask = null;
      nextReq.onSuccess?.();
    } catch (err: any) {
      CanvasPool.releaseOffscreenCanvas();
      if (pageProxy) {
        pageProxy.cleanup();
      }

      if (err?.name === 'RenderingCancelledException') {
        isCancelled = true;
      }

      const cancelledForScale = this.currentRenderingCancelledForScale;
      this.currentRenderingPage = null;
      this.currentRenderingScale = null;
      this.currentRenderingCancelledForScale = false;
      this.activeRenderTask = null;

      if (isCancelled) {
        // Re-queue ONLY if a newer request isn't already waiting and this scale still matches the active window
        if (
          !this.queue.has(pageNum) &&
          !cancelledForScale &&
          Math.abs(nextReq.settledScale - this.activeWindow.settledScale) < 0.001 &&
          pageNum >= this.activeWindow.bufferStart &&
          pageNum <= this.activeWindow.bufferEnd
        ) {
          this.pageStates.set(pageNum, 'queued');
          this.queue.set(pageNum, nextReq);
        } else if (!this.queue.has(pageNum)) {
          this.pageStates.set(pageNum, 'idle');
        }
      } else {
        console.error(`RenderQueue: Page ${pageNum} render failed:`, err);
        this.pageStates.set(pageNum, 'failed');
        nextReq.onError?.(err);
      }
    }

    this.notify();
    // Continue processing remaining queued requests
    this.processNext();
  }

  /**
   * Cancels in-flight render and clears stale-scale queue entries when scale changes.
   */
  public cancelForScaleChange(newScale: number): void {
    this.activeWindow.settledScale = newScale;

    // Clear queued items whose scale differs from newScale (preserve newer matching requests)
    for (const [pageNum, queuedReq] of this.queue) {
      if (Math.abs(queuedReq.settledScale - newScale) >= 0.001) {
        this.queue.delete(pageNum);
        this.pageStates.set(pageNum, 'idle');
      }
    }

    if (
      this.currentRenderingPage !== null &&
      (this.currentRenderingScale === null || Math.abs(this.currentRenderingScale - newScale) >= 0.001)
    ) {
      this.currentRenderingCancelledForScale = true;
      if (this.activeRenderTask) {
        try {
          this.activeRenderTask.cancel();
        } catch {}
      }
    }
    this.notify();
  }

  public clear(): void {
    this.queue.clear();
    this.pageStates.clear();
    if (this.activeRenderTask) {
      try {
        this.activeRenderTask.cancel();
      } catch {}
    }
    this.currentRenderingPage = null;
    this.currentRenderingScale = null;
    this.currentRenderingCancelledForScale = false;
    this.activeRenderTask = null;
    this.notify();
  }

  private startWatchdog(): void {
    if (this.watchdogInterval) return;
    this.watchdogInterval = setInterval(() => {
      if (this.currentRenderingPage !== null) {
        const elapsed = performance.now() - this.renderStartTime;
        if (elapsed > 4000) {
          const stuckPage = this.currentRenderingPage;
          const logMsg = `[Watchdog] Page ${stuckPage} stuck rendering for ${(elapsed / 1000).toFixed(1)}s — retrying`;
          console.warn(logMsg);
          this.watchdogLogs.push(logMsg);
          if (this.watchdogLogs.length > 20) this.watchdogLogs.shift();

          if (this.activeRenderTask) {
            try {
              this.activeRenderTask.cancel();
            } catch {}
          }
          this.notify();
        }
      }
    }, 1000);
  }

  public destroy(): void {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
    this.clear();
    this.listeners.clear();
  }
}
