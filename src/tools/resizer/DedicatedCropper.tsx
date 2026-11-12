import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  Maximize2,
  Crop,
  RotateCcw,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { EditorCropData } from '../../core/processors/resizer';
import { formatBytes } from '../../core/files/validation';

export interface DedicatedCropperProps {
  imageUrl: string;
  naturalDimensions?: { width: number; height: number } | null;
  targetAspectRatio: number; // targetWidth / targetHeight
  outputFormat: string;
  dimensionLabel?: string;
  fileSize?: number;
  cropEnabled?: boolean;
  initialCropData?: EditorCropData;
  onChange: (cropData: EditorCropData) => void;
  className?: string;
}

type DragMode = 'move' | 'se' | 'sw' | 'ne' | 'nw';

interface CropNorm {
  x: number; // 0 to 1 normalized
  y: number; // 0 to 1 normalized
  width: number; // 0 to 1 normalized
  height: number; // 0 to 1 normalized
}

interface DragState {
  mode: DragMode;
  startPointerX: number;
  startPointerY: number;
  startCropNorm: CropNorm;
  tempCropNorm: CropNorm;
  baseImgScale: number;
  baseImgX: number;
  baseImgY: number;
}

export const DedicatedCropper: React.FC<DedicatedCropperProps> = ({
  imageUrl,
  naturalDimensions,
  targetAspectRatio,
  outputFormat,
  dimensionLabel,
  fileSize,
  cropEnabled = true,
  initialCropData,
  onChange,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Natural image dimensions
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(
    naturalDimensions || null
  );

  // Viewport dimensions (updated instantly via ResizeObserver on maximize/minimize/resize)
  const [viewport, setViewport] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  // Normalized crop area within the natural image (STRICTLY within [0, 1] x [0, 1])
  const [cropNorm, setCropNorm] = useState<CropNorm>({
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  });

  // Active dragging state (moving the crop area or resizing corners)
  const [dragState, setDragState] = useState<DragState | null>(null);

  // User manual zoom multiplier (min 1.0: cropper NEVER shrinks below image bounds)
  const [userZoom, setUserZoom] = useState<number>(1.0);

  // Quick 90° rotation and flip state
  const [rotation, setRotation] = useState<number>(initialCropData?.rotation || 0);
  const [flipH, setFlipH] = useState<boolean>(Boolean(initialCropData?.flipH));
  const [flipV, setFlipV] = useState<boolean>(Boolean(initialCropData?.flipV));

  const [bgColor] = useState<string>(
    initialCropData?.bgColor || (outputFormat === 'jpeg' ? '#FFFFFF' : 'transparent')
  );

  // Mobile pinch-to-zoom tracking
  const touchDistRef = useRef<number | null>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // CRITICAL INVARIANT: Compute normalized crop locked to aspect ratio that
  // is GUARANTEED to be 100% INSIDE the image:
  // cropNorm.x >= 0, cropNorm.y >= 0, cropNorm.x + width <= 1, cropNorm.y + height <= 1
  // The crop box NEVER covers the background.
  // ─────────────────────────────────────────────────────────────────────────
  const computeFittedCropNorm = useCallback(
    (ratio: number, nw: number, nh: number, current?: CropNorm): CropNorm => {
      if (nw <= 0 || nh <= 0) return { x: 0, y: 0, width: 1, height: 1 };

      const effectiveRatio = ratio > 0 ? ratio : nw / nh;
      // K = (height in norm units) / (width in norm units)
      // Since widthPx = normW * nw, heightPx = normH * nh:
      // widthPx / heightPx = (normW * nw) / (normH * nh) = effectiveRatio
      // => normH = normW * (nw / (nh * effectiveRatio))
      const K = nw / (nh * effectiveRatio);

      let maxW = 1.0;
      let maxH = 1.0;

      if (K <= 1.0) {
        // Image is taller than target ratio: width is limited to 1.0
        maxW = 1.0;
        maxH = K;
      } else {
        // Image is wider than target ratio: height is limited to 1.0
        maxH = 1.0;
        maxW = 1.0 / K;
      }

      // Safe clamp
      const w = Math.max(0.05, Math.min(1.0, maxW));
      const h = Math.max(0.05, Math.min(1.0, maxH));

      // Keep centered or preserve center of current crop
      const cx = current ? current.x + current.width / 2 : 0.5;
      const cy = current ? current.y + current.height / 2 : 0.5;

      const x = Math.max(0, Math.min(1.0 - w, cx - w / 2));
      const y = Math.max(0, Math.min(1.0 - h, cy - h / 2));

      return { x, y, width: w, height: h };
    },
    []
  );

  // Synchronize naturalDimensions prop whenever provided
  useEffect(() => {
    if (naturalDimensions && naturalDimensions.width > 0 && naturalDimensions.height > 0) {
      setNaturalSize(naturalDimensions);
      setCropNorm((prev) =>
        computeFittedCropNorm(targetAspectRatio, naturalDimensions.width, naturalDimensions.height, prev)
      );
    }
  }, [naturalDimensions, targetAspectRatio, computeFittedCropNorm]);

  // Actively probe image directly via Image() constructor to ensure immediate dimension resolution
  useEffect(() => {
    if (!imageUrl) return;
    const probe = new Image();
    probe.onload = () => {
      const nw = probe.naturalWidth || probe.width;
      const nh = probe.naturalHeight || probe.height;
      if (nw > 0 && nh > 0) {
        setNaturalSize({ width: nw, height: nh });
        setCropNorm((prev) => computeFittedCropNorm(targetAspectRatio, nw, nh, prev));
      }
    };
    probe.src = imageUrl;
  }, [imageUrl, targetAspectRatio, computeFittedCropNorm]);

  // 1. Instant Viewport Tracking via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) {
        setViewport((prev) => {
          if (prev.width === w && prev.height === h) return prev;
          return { width: w, height: h };
        });
      }
    };

    measure();

    const ro = new ResizeObserver(() => {
      measure();
    });
    ro.observe(el);

    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // When image loads via DOM element onLoad
  const handleImageLoaded = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const nw = img.naturalWidth || img.width;
    const nh = img.naturalHeight || img.height;
    if (nw > 0 && nh > 0) {
      setNaturalSize({ width: nw, height: nh });
      setCropNorm((prev) => computeFittedCropNorm(targetAspectRatio, nw, nh, prev));
    }
  };

  // When targetAspectRatio changes: re-fit cropNorm strictly within image bounds
  useEffect(() => {
    if (!naturalSize || targetAspectRatio <= 0) return;
    setCropNorm((prev) => computeFittedCropNorm(targetAspectRatio, naturalSize.width, naturalSize.height, prev));
  }, [targetAspectRatio, naturalSize, computeFittedCropNorm]);

  // Current active crop (temporary during handle drag, or settled cropNorm)
  const activeCrop = dragState ? dragState.tempCropNorm : cropNorm;

  // 2. Synchronize Normalized Crop to Parent Processor
  useEffect(() => {
    if (!naturalSize || activeCrop.width <= 0 || activeCrop.height <= 0) return;

    const relW = 1 / activeCrop.width;
    const relH = 1 / activeCrop.height;
    const relX = -activeCrop.x / activeCrop.width;
    const relY = -activeCrop.y / activeCrop.height;

    onChange({
      relX: Number(relX.toFixed(5)),
      relY: Number(relY.toFixed(5)),
      relW: Number(relW.toFixed(5)),
      relH: Number(relH.toFixed(5)),
      rotation: Math.round(rotation),
      flipH,
      flipV,
      bgColor,
    });
  }, [activeCrop, rotation, flipH, flipV, bgColor, naturalSize, onChange]);

  // 3. Dynamic Screen Coordinate Calculations
  // Guarantees: CropBox is 100% SUBSET of Image at all times
  const layout = useMemo(() => {
    const vw = viewport.width || 600;
    const vh = viewport.height || 400;

    const nw = naturalSize?.width || 800;
    const nh = naturalSize?.height || 600;

    const margin = 40;
    const availW = Math.max(60, vw - margin * 2);
    const availH = Math.max(60, vh - margin * 2);

    // Compute aspect ratio of current crop
    const cropAspect =
      targetAspectRatio > 0
        ? targetAspectRatio
        : (activeCrop.width * nw) / (activeCrop.height * nh || 1);

    // Fit crop frame comfortably centered in the available viewport
    let frameW = availW;
    let frameH = frameW / cropAspect;
    if (frameH > availH) {
      frameH = availH;
      frameW = frameH * cropAspect;
    }

    const frameX = (vw - frameW) / 2;
    const frameY = (vh - frameH) / 2;

    // When actively dragging a corner handle, keep base image position steady
    if (dragState && dragState.mode !== 'move') {
      const imgScale = dragState.baseImgScale;
      const imgX = dragState.baseImgX;
      const imgY = dragState.baseImgY;
      const imgW = nw * imgScale;
      const imgH = nh * imgScale;

      const boxX = imgX + activeCrop.x * imgW;
      const boxY = imgY + activeCrop.y * imgH;
      const boxW = activeCrop.width * imgW;
      const boxH = activeCrop.height * imgH;

      return {
        frameX,
        frameY,
        frameW,
        frameH,
        imgX,
        imgY,
        imgW,
        imgH,
        imgScale,
        boxX,
        boxY,
        boxW,
        boxH,
      };
    }

    // Default / Settled state:
    // Auto-zoom: userZoom is clamped >= 1.0 so image is NEVER smaller than crop box
    const effectiveZoom = Math.max(1.0, userZoom);
    const imgScale = (frameW / (activeCrop.width * nw)) * effectiveZoom;
    const imgW = nw * imgScale;
    const imgH = nh * imgScale;

    // Image top-left so that activeCrop aligns with frame
    const imgX = frameX - activeCrop.x * nw * imgScale;
    const imgY = frameY - activeCrop.y * nh * imgScale;

    return {
      frameX,
      frameY,
      frameW,
      frameH,
      imgX,
      imgY,
      imgW,
      imgH,
      imgScale,
      boxX: frameX,
      boxY: frameY,
      boxW: frameW,
      boxH: frameH,
    };
  }, [viewport, naturalSize, targetAspectRatio, activeCrop, userZoom, dragState]);

  // 4. Pointer Drag Handling (Panning Image & Corner Resizing)
  // ALL operations strictly enforce: crop box NEVER exceeds image boundaries [0, 1]
  const handlePointerDown = (e: React.PointerEvent, mode: DragMode) => {
    e.preventDefault();
    e.stopPropagation();

    setDragState({
      mode,
      startPointerX: e.clientX,
      startPointerY: e.clientY,
      startCropNorm: { ...cropNorm },
      tempCropNorm: { ...cropNorm },
      baseImgScale: layout.imgScale,
      baseImgX: layout.imgX,
      baseImgY: layout.imgY,
    });

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragState || !naturalSize) return;
    e.preventDefault();
    e.stopPropagation();

    const nw = naturalSize.width;
    const nh = naturalSize.height;
    const dx = e.clientX - dragState.startPointerX;
    const dy = e.clientY - dragState.startPointerY;
    const { mode, startCropNorm, baseImgScale } = dragState;
    const imgW = nw * baseImgScale;
    const imgH = nh * baseImgScale;

    if (imgW <= 0 || imgH <= 0) return;

    if (mode === 'move') {
      // Panning crop area across the image: strictly clamped inside [0, 1]
      const dNormX = -dx / imgW;
      const dNormY = -dy / imgH;

      const newX = Math.max(0, Math.min(1.0 - startCropNorm.width, startCropNorm.x + dNormX));
      const newY = Math.max(0, Math.min(1.0 - startCropNorm.height, startCropNorm.y + dNormY));

      const updated: CropNorm = {
        ...startCropNorm,
        x: newX,
        y: newY,
      };

      setCropNorm(updated);
      setDragState((prev) => (prev ? { ...prev, tempCropNorm: updated } : null));
    } else {
      // Corner handle resizing with aspect ratio locking and ZERO BOUNDARY OVERFLOW
      const effectiveRatio =
        targetAspectRatio > 0 ? targetAspectRatio : (startCropNorm.width * nw) / (startCropNorm.height * nh);
      const K = nw / (nh * effectiveRatio);

      if (mode === 'se') {
        // Bottom-Right handle: top-left (startCropNorm.x, startCropNorm.y) is anchored
        const maxAvailableW = 1.0 - startCropNorm.x;
        const maxAvailableH = 1.0 - startCropNorm.y;
        const maxAllowedW = Math.min(maxAvailableW, maxAvailableH / K);
        const minAllowedW = Math.min(0.05, maxAllowedW);

        const targetW = startCropNorm.width + dx / imgW;
        const newW = Math.max(minAllowedW, Math.min(maxAllowedW, targetW));
        const newH = newW * K;

        setDragState((prev) =>
          prev
            ? {
                ...prev,
                tempCropNorm: {
                  x: startCropNorm.x,
                  y: startCropNorm.y,
                  width: newW,
                  height: newH,
                },
              }
            : null
        );
      } else if (mode === 'sw') {
        // Bottom-Left handle: top-right (startRight, startCropNorm.y) is anchored
        const startRight = startCropNorm.x + startCropNorm.width;
        const maxAvailableW = startRight;
        const maxAvailableH = 1.0 - startCropNorm.y;
        const maxAllowedW = Math.min(maxAvailableW, maxAvailableH / K);
        const minAllowedW = Math.min(0.05, maxAllowedW);

        const targetW = startCropNorm.width - dx / imgW;
        const newW = Math.max(minAllowedW, Math.min(maxAllowedW, targetW));
        const newH = newW * K;
        const newX = startRight - newW;

        setDragState((prev) =>
          prev
            ? {
                ...prev,
                tempCropNorm: {
                  x: Math.max(0, newX),
                  y: startCropNorm.y,
                  width: newW,
                  height: newH,
                },
              }
            : null
        );
      } else if (mode === 'ne') {
        // Top-Right handle: bottom-left (startCropNorm.x, startBottom) is anchored
        const startBottom = startCropNorm.y + startCropNorm.height;
        const maxAvailableW = 1.0 - startCropNorm.x;
        const maxAvailableH = startBottom;
        const maxAllowedW = Math.min(maxAvailableW, maxAvailableH / K);
        const minAllowedW = Math.min(0.05, maxAllowedW);

        const targetW = startCropNorm.width + dx / imgW;
        const newW = Math.max(minAllowedW, Math.min(maxAllowedW, targetW));
        const newH = newW * K;
        const newY = startBottom - newH;

        setDragState((prev) =>
          prev
            ? {
                ...prev,
                tempCropNorm: {
                  x: startCropNorm.x,
                  y: Math.max(0, newY),
                  width: newW,
                  height: newH,
                },
              }
            : null
        );
      } else if (mode === 'nw') {
        // Top-Left handle: bottom-right (startRight, startBottom) is anchored
        const startRight = startCropNorm.x + startCropNorm.width;
        const startBottom = startCropNorm.y + startCropNorm.height;
        const maxAvailableW = startRight;
        const maxAvailableH = startBottom;
        const maxAllowedW = Math.min(maxAvailableW, maxAvailableH / K);
        const minAllowedW = Math.min(0.05, maxAllowedW);

        const targetW = startCropNorm.width - dx / imgW;
        const newW = Math.max(minAllowedW, Math.min(maxAllowedW, targetW));
        const newH = newW * K;
        const newX = startRight - newW;
        const newY = startBottom - newH;

        setDragState((prev) =>
          prev
            ? {
                ...prev,
                tempCropNorm: {
                  x: Math.max(0, newX),
                  y: Math.max(0, newY),
                  width: newW,
                  height: newH,
                },
              }
            : null
        );
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragState) {
      // Commit temporary crop and auto-zoom to the selected area
      setCropNorm(dragState.tempCropNorm);
      setDragState(null);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Fallback
      }
    }
  };

  // 5. Mouse Wheel & Touch Zoom Controls (Clamped >= 1.0 so cropper never covers bg)
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 0.92;
    setUserZoom((z) => Math.min(5.0, Math.max(1.0, z * factor)));
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      touchDistRef.current = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchDistRef.current) {
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const factor = currentDist / touchDistRef.current;
      touchDistRef.current = currentDist;
      setUserZoom((z) => Math.min(5.0, Math.max(1.0, z * factor)));
    }
  };

  const handleTouchEnd = () => {
    touchDistRef.current = null;
  };

  const handleResetToFit = () => {
    setUserZoom(1.0);
    if (naturalSize) {
      setCropNorm(computeFittedCropNorm(targetAspectRatio, naturalSize.width, naturalSize.height));
    }
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
  };

  const currentZoomPercent = Math.round(userZoom * 100);

  return (
    <div className={`relative flex flex-col w-full h-full min-h-0 overflow-hidden select-none bg-surface-subtle dark:bg-black ${className}`}>
      {/* ─────────────────────────────────────────────────────────────
          CANVAS AREA: THEME-SYNCED BACKGROUND, INSTANT RESIZE ADJUSTMENT
      ───────────────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative flex-1 min-h-0 w-full bg-surface-subtle dark:bg-black overflow-hidden select-none cursor-default"
        style={{
          touchAction: 'none',
        }}
      >
        {/* The Full Image: always rendered when imageUrl exists */}
        {imageUrl && (
          <img
            src={imageUrl}
            alt="Crop subject"
            onLoad={handleImageLoaded}
            draggable={false}
            style={{
              position: 'absolute',
              left: `${Math.round(layout.imgX)}px`,
              top: `${Math.round(layout.imgY)}px`,
              width: `${Math.round(layout.imgW)}px`,
              height: `${Math.round(layout.imgH)}px`,
              maxWidth: 'none',
              maxHeight: 'none',
              transform: `rotate(${rotation}deg) scale(${flipH ? -1 : 1}, ${flipV ? -1 : 1})`,
              transformOrigin: 'center center',
              pointerEvents: 'none',
            }}
            className="select-none transition-none rounded-none"
          />
        )}

        {/* ─────────────────────────────────────────────────────────────
            THE CROP BOX: GUARANTEED 100% WITHIN THE IMAGE AREA
            Zero pixels outside the image, never covers the background
        ───────────────────────────────────────────────────────────── */}
        {layout.boxW > 0 && layout.boxH > 0 && (
          <div
            style={{
              position: 'absolute',
              left: `${Math.round(layout.boxX)}px`,
              top: `${Math.round(layout.boxY)}px`,
              width: `${Math.round(layout.boxW)}px`,
              height: `${Math.round(layout.boxH)}px`,
              boxShadow: 'none', // NO dark overlay mask outside crop box!
            }}
            className={`shrink-0 ${
              cropEnabled
                ? 'border-2 border-accent dark:border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)] shadow-xl'
                : 'border-2 border-dashed border-accent/70 dark:border-white/60 shadow-lg'
            } rounded-none z-10 transition-none`}
          >
            {/* Movable Surface (drag inside to pan the image) */}
            <div
              onPointerDown={(e) => handlePointerDown(e, 'move')}
              className="absolute inset-0 cursor-move z-10"
              title="Drag inside to position crop area"
            />

            {/* Dimension Label Badge inside Crop Frame */}
            {dimensionLabel && (
              <div className="absolute top-2 left-2 z-30 pointer-events-none px-2 py-0.5 rounded-md bg-surface-panel/95 text-text-main border border-surface-border dark:bg-black/80 dark:text-white dark:border-white/20 text-[11px] font-mono font-medium shadow-sm backdrop-blur-xs flex items-center gap-1.5 select-none">
                <Crop className="w-3 h-3 text-accent shrink-0" />
                <span>{dimensionLabel}</span>
              </div>
            )}

            {/* Rule-of-Thirds Gridlines */}
            {cropEnabled && (
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none z-20 opacity-30">
                <div className="border-r border-b border-neutral-700/40 dark:border-white" />
                <div className="border-r border-b border-neutral-700/40 dark:border-white" />
                <div className="border-b border-neutral-700/40 dark:border-white" />
                <div className="border-r border-b border-neutral-700/40 dark:border-white" />
                <div className="border-r border-b border-neutral-700/40 dark:border-white" />
                <div className="border-b border-neutral-700/40 dark:border-white" />
                <div className="border-r border-b border-neutral-700/40 dark:border-white" />
                <div className="border-r border-b border-neutral-700/40 dark:border-white" />
                <div />
              </div>
            )}

            {/* Corner Viewfinder Brackets */}
            <div className="absolute top-0 left-0 w-3.5 h-3.5 border-t-2 border-l-2 border-accent dark:border-white z-30 pointer-events-none" />
            <div className="absolute top-0 right-0 w-3.5 h-3.5 border-t-2 border-r-2 border-accent dark:border-white z-30 pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-3.5 h-3.5 border-b-2 border-r-2 border-accent dark:border-white z-30 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-3.5 h-3.5 border-b-2 border-l-2 border-accent dark:border-white z-30 pointer-events-none" />

            {/* Interactive Corner Resize Handles */}
            {cropEnabled && (
              <>
                <div
                  onPointerDown={(e) => handlePointerDown(e, 'nw')}
                  title="Resize crop area"
                  className="absolute -top-1.5 -left-1.5 w-4 h-4 bg-white border-2 border-neutral-900 rounded-none shadow-md cursor-nwse-resize z-40 hover:scale-125 transition-transform"
                />
                <div
                  onPointerDown={(e) => handlePointerDown(e, 'ne')}
                  title="Resize crop area"
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-white border-2 border-neutral-900 rounded-none shadow-md cursor-nesw-resize z-40 hover:scale-125 transition-transform"
                />
                <div
                  onPointerDown={(e) => handlePointerDown(e, 'se')}
                  title="Resize crop area"
                  className="absolute -bottom-1.5 -right-1.5 w-4 h-4 bg-white border-2 border-neutral-900 rounded-none shadow-md cursor-nwse-resize z-40 hover:scale-125 transition-transform"
                />
                <div
                  onPointerDown={(e) => handlePointerDown(e, 'sw')}
                  title="Resize crop area"
                  className="absolute -bottom-1.5 -left-1.5 w-4 h-4 bg-white border-2 border-neutral-900 rounded-none shadow-md cursor-nesw-resize z-40 hover:scale-125 transition-transform"
                />
              </>
            )}
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────
          BOTTOM GALLERY STATUS BAR
          Rotator dial track removed; clean rotation & flip tools + zoom
      ───────────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 py-2.5 bg-surface-panel/95 border-t border-surface-border z-20 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Left: Format, dimensions, file size */}
        <div className="flex items-center gap-2.5 font-mono text-[11px] text-text-muted shrink-0">
          <span className="font-bold text-text-main uppercase tracking-wider">
            {outputFormat.toUpperCase()}
          </span>
          {naturalSize ? (
            <span>
              {naturalSize.width} &times; {naturalSize.height}
            </span>
          ) : (
            <span>Loading...</span>
          )}
          {fileSize ? (
            <span>{formatBytes(fileSize)}</span>
          ) : null}
        </div>

        {/* Center: Clean Quick Rotation & Flip Controls */}
        <div className="flex items-center justify-center gap-1.5 sm:gap-2 text-xs text-text-main mx-auto">
          {/* Rotate CCW 90° */}
          <button
            type="button"
            onClick={() => setRotation((r) => (r - 90 + 360) % 360)}
            title="Rotate 90° counter-clockwise"
            className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Rotate CW 90° */}
          <button
            type="button"
            onClick={() => setRotation((r) => (r + 90) % 360)}
            title="Rotate 90° clockwise"
            className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer"
          >
            <RotateCw className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-surface-border" />

          {/* Flip Horizontal */}
          <button
            type="button"
            onClick={() => setFlipH((f) => !f)}
            title="Flip horizontally"
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              flipH
                ? 'bg-accent/20 text-accent font-bold'
                : 'text-text-muted hover:text-text-main hover:bg-surface-subtle'
            }`}
          >
            <FlipHorizontal className="w-4 h-4" />
          </button>

          {/* Flip Vertical */}
          <button
            type="button"
            onClick={() => setFlipV((f) => !f)}
            title="Flip vertically"
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              flipV
                ? 'bg-accent/20 text-accent font-bold'
                : 'text-text-muted hover:text-text-main hover:bg-surface-subtle'
            }`}
          >
            <FlipVertical className="w-4 h-4" />
          </button>

          {/* Reset angle / flips if modified */}
          {(rotation !== 0 || flipH || flipV) && (
            <button
              type="button"
              onClick={() => {
                setRotation(0);
                setFlipH(false);
                setFlipV(false);
              }}
              title="Reset rotation & flip to 0°"
              className="px-2 py-0.5 rounded text-[10px] font-mono font-medium text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer border border-surface-border ml-1"
            >
              Reset 0°
            </button>
          )}
        </div>

        {/* Right: Gallery Zoom Controls */}
        <div className="flex items-center gap-1.5 text-text-muted shrink-0">
          <button
            type="button"
            onClick={() => setUserZoom((z) => Math.max(1.0, z * 0.8))}
            title="Zoom out"
            className="p-1 rounded-md hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          <span className="text-[11px] font-mono w-10 text-center select-none text-text-main font-medium">
            {currentZoomPercent}%
          </span>

          <button
            type="button"
            onClick={() => setUserZoom((z) => Math.min(5.0, z * 1.25))}
            title="Zoom in"
            className="p-1 rounded-md hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleResetToFit}
            title="Fit to screen"
            className="p-1 rounded-md hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer ml-1"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default DedicatedCropper;
