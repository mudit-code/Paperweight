import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GestureStateMachine,
  MIN_SCALE,
  MAX_SCALE,
  SETTLE_DELAY_MS,
} from '../src/core/pdf/gestureStateMachine';

describe('GestureStateMachine (Phase 3 Pure Module)', () => {
  let gsm: GestureStateMachine;
  const viewport = { width: 400, height: 800 };
  const content = { width: 400, height: 1600 };

  beforeEach(() => {
    vi.useFakeTimers();
    gsm = new GestureStateMachine({ tx: 0, ty: 0, scale: 1.0 }, viewport, content);
  });

  it('initializes with default camera and clamps within bounds', () => {
    const cam = gsm.getCamera();
    expect(cam.scale).toBe(1.0);
    expect(cam.tx).toBe(0);
    expect(cam.ty).toBe(0);
  });

  it('handles 1-pointer vertical and horizontal pan', () => {
    const changes: any[] = [];
    gsm.setCallbacks({ onStateChange: (c) => changes.push(c) });

    gsm.onPointerDown(1, 200, 300, 1000);
    expect(gsm.getIsGesturing()).toBe(true);

    // Pan up by 50px (content scrolls up, ty becomes -50)
    gsm.onPointerMove(1, 200, 250, 1016);
    expect(changes.length).toBe(1);
    expect(changes[0].ty).toBe(-50);
    expect(changes[0].tx).toBe(0); // content width matches viewport, centered at 0

    gsm.onPointerUp(1, 1032);
    expect(gsm.getIsGesturing()).toBe(false);
  });

  it('anchors pinch zoom around the focal midpoint', () => {
    // Zoom in from 1.0x at focal point (200, 300)
    gsm.onPointerDown(1, 150, 300, 1000);
    gsm.onPointerDown(2, 250, 300, 1000);
    // Initial focal point = (200, 300), initial distance = 100px

    const initialFocalX = 200;
    const initialFocalY = 300;
    const initialCam = gsm.getCamera();
    const contentFocalX = (initialFocalX - initialCam.tx) / initialCam.scale;
    const contentFocalY = (initialFocalY - initialCam.ty) / initialCam.scale;

    // Double distance to 200px (pointers at 100 and 300) -> scale should become 2.0
    gsm.onPointerMove(1, 100, 300, 1016);
    gsm.onPointerMove(2, 300, 300, 1016);

    const newCam = gsm.getCamera();
    expect(newCam.scale).toBeCloseTo(2.0, 4);

    // Verify Anchored Math Invariant:
    // Screen point of contentFocal under new scale must match current focal point (200, 300)
    const newScreenX = newCam.tx + contentFocalX * newCam.scale;
    const newScreenY = newCam.ty + contentFocalY * newCam.scale;
    expect(newScreenX).toBeCloseTo(initialFocalX, 3);
    expect(newScreenY).toBeCloseTo(initialFocalY, 3);
  });

  it('supports pinch with simultaneous pan', () => {
    // Pointers start around (200, 300) with dist = 100
    gsm.onPointerDown(1, 150, 300, 1000);
    gsm.onPointerDown(2, 250, 300, 1000);

    // Expand distance to 150 (scale = 1.5) AND shift midpoint right by 40px and down by 20px
    // New focal point = (240, 320)
    gsm.onPointerMove(1, 165, 320, 1016);
    gsm.onPointerMove(2, 315, 320, 1016);

    const cam = gsm.getCamera();
    expect(cam.scale).toBeCloseTo(1.5, 4);
    // Anchored point from original (200, 300) should now be at (240, 320)
    const originalContentX = 200; // since scale=1, tx=0
    const originalContentY = 300; // since scale=1, ty=0
    const currentScreenX = cam.tx + originalContentX * cam.scale;
    const currentScreenY = cam.ty + originalContentY * cam.scale;

    expect(currentScreenX).toBeCloseTo(240, 3);
    expect(currentScreenY).toBeCloseTo(320, 3);
  });

  it('clamps zoom scale strictly at MIN_SCALE and MAX_SCALE', () => {
    // Attempt to pinch shrink below 1.0x
    gsm.onPointerDown(1, 150, 300, 1000);
    gsm.onPointerDown(2, 250, 300, 1000);
    // Shrink distance by 10x
    gsm.onPointerMove(1, 195, 300, 1016);
    gsm.onPointerMove(2, 205, 300, 1016);

    expect(gsm.getCamera().scale).toBe(MIN_SCALE);

    // Expand distance by 20x (above MAX_SCALE 4.0)
    gsm.onPointerMove(1, -500, 300, 1032);
    gsm.onPointerMove(2, 900, 300, 1032);

    expect(gsm.getCamera().scale).toBe(MAX_SCALE);
  });

  it('clamps pan boundaries correctly to prevent content flying off-screen', () => {
    // Set scale to 2.0x -> scaledW = 800, scaledH = 3200
    // Viewport: 400 x 800
    gsm.setCamera({ scale: 2.0, tx: 0, ty: 0 });

    const cam = gsm.getCamera();
    // Maximum tx is 0, minimum tx is 400 - 800 = -400
    expect(cam.tx).toBe(0);

    // Pan past left edge
    gsm.setCamera({ tx: 100 });
    expect(gsm.getCamera().tx).toBe(0);

    // Pan past right edge
    gsm.setCamera({ tx: -600 });
    expect(gsm.getCamera().tx).toBe(-400);

    // Pan past bottom edge
    // minTy = 800 - 3200 = -2400
    gsm.setCamera({ ty: -3000 });
    expect(gsm.getCamera().ty).toBe(-2400);

    // Pan past top edge
    gsm.setCamera({ ty: 100 });
    expect(gsm.getCamera().ty).toBe(0);
  });

  it('handles desktop ctrl+wheel zoom anchored at cursor', () => {
    const cursorX = 150;
    const cursorY = 250;
    // Zoom in using wheel with ctrlKey
    gsm.onWheel(-100, cursorX, cursorY, true);

    const cam = gsm.getCamera();
    expect(cam.scale).toBeGreaterThan(1.0);

    // Cursor position in content space must remain unchanged
    const contentX = (cursorX - 0) / 1.0;
    const newScreenX = cam.tx + contentX * cam.scale;
    expect(newScreenX).toBeCloseTo(cursorX, 3);
  });

  it('handles desktop keyboard shortcuts (+, -, 0)', () => {
    gsm.onKeyZoom('in');
    expect(gsm.getCamera().scale).toBe(1.25);

    gsm.onKeyZoom('in');
    expect(gsm.getCamera().scale).toBeCloseTo(1.5625, 4);

    gsm.onKeyZoom('out');
    expect(gsm.getCamera().scale).toBeCloseTo(1.25, 4);

    gsm.onKeyZoom('reset');
    expect(gsm.getCamera().scale).toBe(MIN_SCALE);
  });

  it('fires onSettle exactly after SETTLE_DELAY_MS (150ms) debounce', () => {
    const settleSpy = vi.fn();
    gsm.setCallbacks({ onSettle: settleSpy });

    gsm.onPointerDown(1, 200, 300, 1000);
    gsm.onPointerMove(1, 200, 280, 1016);
    gsm.onPointerUp(1, 1032);

    expect(settleSpy).not.toHaveBeenCalled();

    // Advance 100ms: should not have settled yet
    vi.advanceTimersByTime(100);
    expect(settleSpy).not.toHaveBeenCalled();

    // Advance remaining 50ms: total 150ms -> settle fires
    vi.advanceTimersByTime(50);
    expect(settleSpy).toHaveBeenCalledTimes(1);
    expect(settleSpy).toHaveBeenCalledWith(expect.objectContaining({ scale: 1.0 }));
  });

  it('cancels pending settle if a new gesture starts before timeout', () => {
    const settleSpy = vi.fn();
    gsm.setCallbacks({ onSettle: settleSpy });

    gsm.onPointerDown(1, 200, 300, 1000);
    gsm.onPointerUp(1, 1016);

    // 100ms later, new pointer arrives
    vi.advanceTimersByTime(100);
    gsm.onPointerDown(1, 200, 300, 1116);

    // Advance 60ms (160ms from first up)
    vi.advanceTimersByTime(60);
    expect(settleSpy).not.toHaveBeenCalled();

    // Lift second pointer
    gsm.onPointerUp(1, 1176);
    vi.advanceTimersByTime(SETTLE_DELAY_MS);
    expect(settleSpy).toHaveBeenCalledTimes(1);
  });

  it('avoids NaN and Infinity when two pointers overlap at same coordinate', () => {
    gsm.onPointerDown(1, 200, 300, 1000);
    gsm.onPointerDown(2, 200, 300, 1000); // 0 distance

    // Move pointers still overlapping
    gsm.onPointerMove(1, 200, 300, 1016);
    gsm.onPointerMove(2, 200, 300, 1016);

    const cam = gsm.getCamera();
    expect(Number.isFinite(cam.scale)).toBe(true);
    expect(Number.isFinite(cam.tx)).toBe(true);
    expect(Number.isFinite(cam.ty)).toBe(true);
  });
});

