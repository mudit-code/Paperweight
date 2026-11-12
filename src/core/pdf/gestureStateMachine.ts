/**
 * Paperweight PDF Viewer — Pure Gesture State Machine (Phase 3)
 * 
 * Strict architectural guarantees:
 * 1. Zero React dependencies, zero DOM reads inside gesture loops.
 * 2. Pure TypeScript state machine: pointer events with timestamps in -> { tx, ty, scale } out.
 * 3. Exact anchored-zoom math: the focal point under the pointers stays geometrically invariant.
 * 4. Named constants for min/max scale and debounce timeouts.
 * 5. Physics-free in Phase 3 (Pan & Pinch only; inertia & double-tap reserved for Phase 4).
 */

export const MIN_SCALE = 1.0;
export const MAX_SCALE = 4.0;
export const SETTLE_DELAY_MS = 150;

export interface CameraState {
  tx: number;
  ty: number;
  scale: number;
}

export interface PointerContact {
  id: number;
  x: number;
  y: number;
  timestamp: number;
}

export interface ViewportBounds {
  width: number;
  height: number;
}

export interface ContentBounds {
  width: number;
  height: number;
}

export type GestureStateCallback = (camera: CameraState) => void;
export type GestureSettleCallback = (camera: CameraState) => void;
export type GestureStartCallback = () => void;

export class GestureStateMachine {
  private camera: CameraState = { tx: 0, ty: 0, scale: MIN_SCALE };
  private pointers: Map<number, PointerContact> = new Map();
  private viewport: ViewportBounds = { width: 360, height: 640 };
  private content: ContentBounds = { width: 360, height: 640 };

  // Gesture tracking
  private isGesturing: boolean = false;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  // 2-pointer pinch reference
  private initialPinchDistance: number = 0;
  private initialCameraScale: number = MIN_SCALE;
  private initialCameraTx: number = 0;
  private initialCameraTy: number = 0;
  private initialFocalX: number = 0;
  private initialFocalY: number = 0;

  // 1-pointer pan reference
  private lastPanX: number = 0;
  private lastPanY: number = 0;

  // Callbacks
  private onStateChange: GestureStateCallback | null = null;
  private onSettle: GestureSettleCallback | null = null;
  private onStart: GestureStartCallback | null = null;

  constructor(
    initialCamera?: Partial<CameraState>,
    viewport?: ViewportBounds,
    content?: ContentBounds
  ) {
    if (initialCamera) {
      this.camera = {
        tx: initialCamera.tx ?? 0,
        ty: initialCamera.ty ?? 0,
        scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, initialCamera.scale ?? MIN_SCALE)),
      };
    }
    if (viewport) this.viewport = { ...viewport };
    if (content) this.content = { ...content };
  }

  public setCallbacks(callbacks: {
    onStateChange?: GestureStateCallback;
    onSettle?: GestureSettleCallback;
    onStart?: GestureStartCallback;
  }): void {
    this.onStateChange = callbacks.onStateChange ?? null;
    this.onSettle = callbacks.onSettle ?? null;
    this.onStart = callbacks.onStart ?? null;
  }

  public setViewportSize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.viewport = { width, height };
    this.clampAndEmit(false);
  }

  public setContentSize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.content = { width, height };
    this.clampAndEmit(false);
  }

  public getCamera(): CameraState {
    return { ...this.camera };
  }

  public setCamera(camera: Partial<CameraState>): void {
    if (typeof camera.scale === 'number') {
      this.camera.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, camera.scale));
    }
    if (typeof camera.tx === 'number') this.camera.tx = camera.tx;
    if (typeof camera.ty === 'number') this.camera.ty = camera.ty;
    this.clampAndEmit(false);
  }

  public getIsGesturing(): boolean {
    return this.isGesturing;
  }

  public getActivePointerCount(): number {
    return this.pointers.size;
  }

  // ---------------------------------------------------------------------------
  // Pointer Event Pipeline
  // ---------------------------------------------------------------------------

  public onPointerDown(id: number, x: number, y: number, timestamp: number): void {
    this.cancelSettleTimer();

    this.pointers.set(id, { id, x, y, timestamp });

    if (!this.isGesturing) {
      this.isGesturing = true;
      this.onStart?.();
    }

    if (this.pointers.size === 1) {
      // Begin 1-finger Pan
      this.lastPanX = x;
      this.lastPanY = y;
    } else if (this.pointers.size === 2) {
      // Transition to 2-finger Pinch
      this.setupPinchAnchor();
    }
  }

  public onPointerMove(id: number, x: number, y: number, timestamp: number): void {
    if (!this.pointers.has(id)) return;

    this.pointers.set(id, { id, x, y, timestamp });

    if (this.pointers.size === 1) {
      // 1-pointer Pan
      const dx = x - this.lastPanX;
      const dy = y - this.lastPanY;
      this.lastPanX = x;
      this.lastPanY = y;

      this.camera.tx += dx;
      this.camera.ty += dy;

      this.clampAndEmit(true);
    } else if (this.pointers.size === 2) {
      // 2-pointer Anchored Pinch + Pan
      const [p1, p2] = Array.from(this.pointers.values());
      const currentDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (this.initialPinchDistance <= 0) return;

      const scaleMultiplier = currentDist / this.initialPinchDistance;
      const targetScale = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, this.initialCameraScale * scaleMultiplier)
      );

      // Current midpoint in viewport coordinates
      const currentFocalX = (p1.x + p2.x) / 2;
      const currentFocalY = (p1.y + p2.y) / 2;

      // Anchored Zoom Math:
      // Point under initial focal point must stay under current focal point:
      // focal_viewport = tx + (focal_content) * scale
      // => focal_content = (initialFocal - initialTx) / initialScale
      // => tx = currentFocal - focal_content * targetScale
      const contentX = (this.initialFocalX - this.initialCameraTx) / this.initialCameraScale;
      const contentY = (this.initialFocalY - this.initialCameraTy) / this.initialCameraScale;

      this.camera.scale = targetScale;
      this.camera.tx = currentFocalX - contentX * targetScale;
      this.camera.ty = currentFocalY - contentY * targetScale;

      this.clampAndEmit(true);
    }
  }

  public onPointerUp(id: number, _timestamp: number): void {
    this.pointers.delete(id);

    if (this.pointers.size === 1) {
      // Transitioned from pinch down to 1 finger: resume pan from current finger position
      const remaining = Array.from(this.pointers.values())[0];
      this.lastPanX = remaining.x;
      this.lastPanY = remaining.y;
    } else if (this.pointers.size === 0) {
      // All fingers lifted
      this.isGesturing = false;
      this.scheduleSettle();
    }
  }

  public onPointerCancel(id: number, timestamp: number): void {
    this.onPointerUp(id, timestamp);
  }

  // ---------------------------------------------------------------------------
  // Desktop Wheel & Trackpad Pinch
  // ---------------------------------------------------------------------------

  public onWheel(deltaY: number, cursorX: number, cursorY: number, isCtrlOrPinch: boolean): void {
    this.cancelSettleTimer();

    if (!this.isGesturing) {
      this.isGesturing = true;
      this.onStart?.();
    }

    if (isCtrlOrPinch) {
      // Anchored Pinch Zoom
      const zoomFactor = Math.exp(-deltaY * 0.005);
      const targetScale = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, this.camera.scale * zoomFactor)
      );

      // Content point under cursor
      const contentX = (cursorX - this.camera.tx) / this.camera.scale;
      const contentY = (cursorY - this.camera.ty) / this.camera.scale;

      this.camera.scale = targetScale;
      this.camera.tx = cursorX - contentX * targetScale;
      this.camera.ty = cursorY - contentY * targetScale;
    } else {
      // Regular 2D Pan Wheel
      this.camera.ty -= deltaY;
    }

    this.clampAndEmit(true);
    this.scheduleSettle();
  }

  // ---------------------------------------------------------------------------
  // Desktop Keyboard Shortcuts (+, -, 0)
  // ---------------------------------------------------------------------------

  public onKeyZoom(action: 'in' | 'out' | 'reset'): void {
    this.cancelSettleTimer();

    if (!this.isGesturing) {
      this.isGesturing = true;
      this.onStart?.();
    }

    const centerX = this.viewport.width / 2;
    const centerY = this.viewport.height / 2;

    let targetScale = this.camera.scale;
    if (action === 'in') {
      targetScale = Math.min(MAX_SCALE, this.camera.scale * 1.25);
    } else if (action === 'out') {
      targetScale = Math.max(MIN_SCALE, this.camera.scale / 1.25);
    } else {
      targetScale = MIN_SCALE;
    }

    const contentX = (centerX - this.camera.tx) / this.camera.scale;
    const contentY = (centerY - this.camera.ty) / this.camera.scale;

    this.camera.scale = targetScale;
    this.camera.tx = centerX - contentX * targetScale;
    this.camera.ty = centerY - contentY * targetScale;

    this.clampAndEmit(true);
    this.scheduleSettle();
  }

  // ---------------------------------------------------------------------------
  // Anchored Math & Boundary Clamping
  // ---------------------------------------------------------------------------

  private setupPinchAnchor(): void {
    const [p1, p2] = Array.from(this.pointers.values());
    this.initialPinchDistance = Math.max(1.0, Math.hypot(p2.x - p1.x, p2.y - p1.y));
    this.initialCameraScale = this.camera.scale;
    this.initialCameraTx = this.camera.tx;
    this.initialCameraTy = this.camera.ty;
    this.initialFocalX = (p1.x + p2.x) / 2;
    this.initialFocalY = (p1.y + p2.y) / 2;
  }

  public clampCamera(camera: CameraState): CameraState {
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, camera.scale));
    const W = this.viewport.width;
    const H = this.viewport.height;
    const scaledW = this.content.width * scale;
    const scaledH = this.content.height * scale;

    let minX: number;
    let maxX: number;
    if (scaledW <= W) {
      // Content is narrower than viewport: center horizontally
      minX = (W - scaledW) / 2;
      maxX = minX;
    } else {
      // Content is wider than viewport: allow pan between edges
      minX = W - scaledW;
      maxX = 0;
    }

    let minY: number;
    let maxY: number;
    if (scaledH <= H) {
      // Content is shorter than viewport: top align or center
      minY = 0;
      maxY = 0;
    } else {
      // Content is taller than viewport: allow vertical pan
      minY = H - scaledH;
      maxY = 0;
    }

    const tx = Math.min(maxX, Math.max(minX, camera.tx));
    const ty = Math.min(maxY, Math.max(minY, camera.ty));

    return { tx, ty, scale };
  }

  private clampAndEmit(isGestureEvent: boolean): void {
    this.camera = this.clampCamera(this.camera);
    if (isGestureEvent) {
      this.onStateChange?.({ ...this.camera });
    }
  }

  private scheduleSettle(): void {
    this.cancelSettleTimer();
    this.settleTimer = setTimeout(() => {
      this.isGesturing = false;
      this.settleTimer = null;
      this.onSettle?.({ ...this.camera });
    }, SETTLE_DELAY_MS);
  }

  public cancelSettleTimer(): void {
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
  }

  public destroy(): void {
    this.cancelSettleTimer();
    this.pointers.clear();
    this.onStateChange = null;
    this.onSettle = null;
    this.onStart = null;
  }
}

