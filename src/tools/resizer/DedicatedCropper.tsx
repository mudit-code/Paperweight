import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  RotateCcw,
  RotateCw,
} from 'lucide-react';
import type { EditorCropData } from '../../core/processors/resizer';

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
  rotation?: number;
  onRotationChange?: (rotation: number) => void;
}

type DragMode = 'move' | 'se' | 'sw' | 'ne' | 'nw' | 'panImage';

interface DragState {
  mode: DragMode;
  startPointerX: number;
  startPointerY: number;
  startBoxX: number;
  startBoxY: number;
  startBoxW: number;
  startBoxH: number;
  startPanX: number;
  startPanY: number;
}

export const DedicatedCropper: React.FC<DedicatedCropperProps> = ({
  imageUrl,
  naturalDimensions,
  targetAspectRatio,
  outputFormat,
  cropEnabled = true,
  initialCropData,
  onChange,
  className = '',
  rotation: externalRotation,
  onRotationChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Natural image dimensions
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(
    naturalDimensions || null
  );

  // Viewport dimensions (updated instantly via ResizeObserver)
  const [viewport, setViewport] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  // Quick 90° rotation and flip state
  const [internalRotation, setInternalRotation] = useState<number>(initialCropData?.rotation || 0);
  const rotation = externalRotation !== undefined ? externalRotation : internalRotation;

  const handleRotate = (delta: number) => {
    const next = (rotation + delta + 360) % 360;
    if (onRotationChange) {
      onRotationChange(next);
    } else {
      setInternalRotation(next);
    }
  };

  const flipH = Boolean(initialCropData?.flipH);
  const flipV = Boolean(initialCropData?.flipV);
  const bgColor = initialCropData?.bgColor || (outputFormat === 'jpeg' ? '#FFFFFF' : 'transparent');

  // Image zoom multiplier: 1.0 to 5.0 (Mouse wheel zooms ONLY the image, NOT the cropper)
  const [imageZoom, setImageZoom] = useState<number>(1.0);

  // Pan offset for the image when zoomed in: in screen pixels
  const [imagePan, setImagePan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Crop box explicit screen coordinates (fixed screen size during zoom!)
  const [customBox, setCustomBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  // Active dragging state
  const [dragState, setDragState] = useState<DragState | null>(null);

  // Touch tracking & performance refs
  const touchDistRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const notifyTimerRef = useRef<number | null>(null);

  // Synchronize naturalDimensions prop whenever provided
  useEffect(() => {
    if (naturalDimensions && naturalDimensions.width > 0 && naturalDimensions.height > 0) {
      setNaturalSize(naturalDimensions);
    }
  }, [naturalDimensions]);

  // Actively probe image directly via Image() constructor to ensure immediate dimension resolution
  useEffect(() => {
    if (!imageUrl) return;
    const probe = new Image();
    probe.onload = () => {
      const nw = probe.naturalWidth || probe.width;
      const nh = probe.naturalHeight || probe.height;
      if (nw > 0 && nh > 0) {
        setNaturalSize({ width: nw, height: nh });
      }
    };
    probe.src = imageUrl;
  }, [imageUrl]);

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
    }
  };

  // Dimensions accounting for 90° / 270° rotation transposition
  const isTransposed = Math.abs(rotation) % 180 !== 0;
  const nw = naturalSize ? (isTransposed ? naturalSize.height : naturalSize.width) : 800;
  const nh = naturalSize ? (isTransposed ? naturalSize.width : naturalSize.height) : 600;

  // Reset custom crop box when aspect ratio changes
  useEffect(() => {
    setCustomBox(null);
  }, [targetAspectRatio]);

  // 2. Geometry calculations:
  // - The image scale depends ONLY on viewport and imageZoom.
  // - The cropper box screen dimensions do NOT change when zooming the image!
  const layout = useMemo(() => {
    const vw = viewport.width || 600;
    const vh = viewport.height || 400;

    const margin = 32;
    const availW = Math.max(60, vw - margin * 2);
    const availH = Math.max(60, vh - margin * 2);

    // Fit image comfortably inside the viewport (zoom = 1.0)
    const baseScale = Math.min(availW / nw, availH / nh);

    // Base unzoomed image dimensions (FOR DEFAULT CROP BOX)
    const baseImgW = nw * baseScale;
    const baseImgH = nh * baseScale;
    const baseImgX = (vw - baseImgW) / 2;
    const baseImgY = (vh - baseImgH) / 2;

    // Zoomed image geometry
    const imgScale = baseScale * Math.max(1.0, imageZoom);
    const imgW = nw * imgScale;
    const imgH = nh * imgScale;

    // Center image in viewport with pan offset
    const imgX = (vw - imgW) / 2 + imagePan.x;
    const imgY = (vh - imgH) / 2 + imagePan.y;

    // Default crop box dimensions (fitted to aspect ratio inside unzoomed image)
    // NOTE: This does NOT depend on imageZoom, so zooming the image does NOT scale the crop box!
    const aspect = targetAspectRatio > 0 ? targetAspectRatio : nw / nh;
    let defaultBoxW = baseImgW;
    let defaultBoxH = defaultBoxW / aspect;
    if (defaultBoxH > baseImgH) {
      defaultBoxH = baseImgH;
      defaultBoxW = defaultBoxH * aspect;
    }

    const defaultBoxX = baseImgX + (baseImgW - defaultBoxW) / 2;
    const defaultBoxY = baseImgY + (baseImgH - defaultBoxH) / 2;

    // STRICT CLAMP: The crop box MUST stay 100% within the image bounds [imgX, imgY, imgX + imgW, imgY + imgH]
    const initialW = customBox ? customBox.width : defaultBoxW;
    let safeBoxW = Math.min(initialW, imgW);
    let safeBoxH = safeBoxW / aspect;
    if (safeBoxH > imgH) {
      safeBoxH = imgH;
      safeBoxW = safeBoxH * aspect;
    }

    const minX = imgX;
    const maxX = Math.max(minX, imgX + imgW - safeBoxW);
    const minY = imgY;
    const maxY = Math.max(minY, imgY + imgH - safeBoxH);

    const rawBoxX = customBox ? customBox.x : defaultBoxX;
    const rawBoxY = customBox ? customBox.y : defaultBoxY;

    const boxX = Math.max(minX, Math.min(maxX, rawBoxX));
    const boxY = Math.max(minY, Math.min(maxY, rawBoxY));
    const boxW = safeBoxW;
    const boxH = safeBoxH;

    return {
      vw,
      vh,
      imgX,
      imgY,
      imgW,
      imgH,
      imgScale,
      boxX,
      boxY,
      boxW,
      boxH,
      baseScale,
    };
  }, [viewport, nw, nh, targetAspectRatio, imageZoom, imagePan, customBox]);

  // 3. Throttled notification to parent processor (ZERO lag during rapid movement/zoom)
  const emitChange = useCallback(
    (immediate = false) => {
      const { boxW, boxH, imgW, imgH, imgX, boxX, imgY, boxY } = layout;
      if (boxW <= 0 || boxH <= 0) return;

      const relW = imgW / boxW;
      const relH = imgH / boxH;
      const relX = (imgX - boxX) / boxW;
      const relY = (imgY - boxY) / boxH;

      const trigger = () => {
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
      };

      if (immediate) {
        if (notifyTimerRef.current) {
          window.clearTimeout(notifyTimerRef.current);
          notifyTimerRef.current = null;
        }
        trigger();
        return;
      }

      if (notifyTimerRef.current) return;
      notifyTimerRef.current = window.setTimeout(() => {
        notifyTimerRef.current = null;
        trigger();
      }, 100);
    },
    [layout, onChange, rotation, flipH, flipV, bgColor]
  );

  // Initial and rotation synchronization
  useEffect(() => {
    if (naturalSize) {
      emitChange(true);
    }
  }, [rotation, naturalSize, layout.boxW, layout.boxH]);

  // 4. Mouse Wheel Zoom: ZOOMS ONLY THE IMAGE, THE CROPPER REMAINS AT ITS FIXED SCREEN SIZE!
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const factor = e.deltaY < 0 ? 1.10 : 0.90;
    const oldZoom = imageZoom;

    const { vw, vh, baseScale, boxX, boxY, boxW, boxH } = layout;
    const minRequiredScale = Math.max(boxW / nw, boxH / nh);
    const minRequiredZoom = Math.max(1.0, minRequiredScale / baseScale);
    const newZoom = Math.max(minRequiredZoom, Math.min(5.0, oldZoom * factor));
    if (newZoom === oldZoom && factor < 1.0) return;

    const rect = containerRef.current?.getBoundingClientRect();
    const cursorX = rect ? e.clientX - rect.left : vw / 2;
    const cursorY = rect ? e.clientY - rect.top : vh / 2;

    const oldScale = baseScale * oldZoom;
    const newScale = baseScale * newZoom;
    const scaleRatio = newScale / oldScale;

    // Anchor zoom smoothly around cursor
    const oldImgW = nw * oldScale;
    const oldImgH = nh * oldScale;
    const oldImgX = (vw - oldImgW) / 2 + imagePan.x;
    const oldImgY = (vh - oldImgH) / 2 + imagePan.y;

    const newImgW = nw * newScale;
    const newImgH = nh * newScale;
    const newBaseX = (vw - newImgW) / 2;
    const newBaseY = (vh - newImgH) / 2;

    const targetImgX = cursorX - (cursorX - oldImgX) * scaleRatio;
    const targetImgY = cursorY - (cursorY - oldImgY) * scaleRatio;

    const rawPanX = newZoom <= 1.0 ? 0 : targetImgX - newBaseX;
    const rawPanY = newZoom <= 1.0 ? 0 : targetImgY - newBaseY;

    // Strict clamp: ensure image always encloses crop box
    const minImgX = boxX + boxW - newImgW;
    const maxImgX = boxX;
    const nextPanX = Math.max(minImgX - newBaseX, Math.min(maxImgX - newBaseX, rawPanX));

    const minImgY = boxY + boxH - newImgH;
    const maxImgY = boxY;
    const nextPanY = Math.max(minImgY - newBaseY, Math.min(maxImgY - newBaseY, rawPanY));

    setImageZoom(newZoom);
    setImagePan({ x: nextPanX, y: nextPanY });
    emitChange(false);

    // NOTICE: customBox (the cropper) is NOT modified!
    // The cropper retains its exact screen dimensions while the image magnifies/contracts under it!
    setImageZoom(newZoom);
    setImagePan({ x: nextPanX, y: nextPanY });
    emitChange(false);
  };

  // 5. Touch Pinch Zoom Handling (ZOOMS ONLY THE IMAGE)
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

      const newZoom = Math.max(1.0, Math.min(5.0, imageZoom * factor));
      setImageZoom(newZoom);
      emitChange(false);
    }
  };

  const handleTouchEnd = () => {
    touchDistRef.current = null;
  };

  // 6. Pointer Drag Handling:
  // - Mode 'move': Moves ONLY the crop box across the picture (picture is NOT moved or resized)
  // - Corner modes ('nw', 'ne', 'se', 'sw'): Resizes ONLY the crop box (picture is NOT moved or resized)
  // - Mode 'panImage': Panning the background image when zoomed in
  const handlePointerDown = (e: React.PointerEvent, mode: DragMode) => {
    e.preventDefault();
    e.stopPropagation();

    setDragState({
      mode,
      startPointerX: e.clientX,
      startPointerY: e.clientY,
      startBoxX: layout.boxX,
      startBoxY: layout.boxY,
      startBoxW: layout.boxW,
      startBoxH: layout.boxH,
      startPanX: imagePan.x,
      startPanY: imagePan.y,
    });

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragState || !naturalSize) return;
    e.preventDefault();
    e.stopPropagation();

    const clientX = e.clientX;
    const clientY = e.clientY;

    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
    }

    rafIdRef.current = requestAnimationFrame(() => {
      if (!dragState) return;
      const { mode, startPointerX, startPointerY, startBoxX, startBoxY, startBoxW, startBoxH, startPanX, startPanY } = dragState;
      const dx = clientX - startPointerX;
      const dy = clientY - startPointerY;

      if (mode === 'panImage') {
        const { vw, vh, imgW, imgH, boxX, boxY, boxW, boxH } = layout;
        const newBaseX = (vw - imgW) / 2;
        const newBaseY = (vh - imgH) / 2;

        const desiredPanX = startPanX + dx;
        const desiredPanY = startPanY + dy;

        // Ensure image always covers crop box
        const minImgX = boxX + boxW - imgW;
        const maxImgX = boxX;
        const minPanX = minImgX - newBaseX;
        const maxPanX = maxImgX - newBaseX;
        const clampedPanX = Math.max(minPanX, Math.min(maxPanX, desiredPanX));

        const minImgY = boxY + boxH - imgH;
        const maxImgY = boxY;
        const minPanY = minImgY - newBaseY;
        const maxPanY = maxImgY - newBaseY;
        const clampedPanY = Math.max(minPanY, Math.min(maxPanY, desiredPanY));

        setImagePan({
          x: clampedPanX,
          y: clampedPanY,
        });
        emitChange(false);
        return;
      }

      if (mode === 'move') {
        // STRICT CLAMP: Crop box CANNOT move outside the image area
        const { imgX, imgY, imgW, imgH } = layout;
        const minX = imgX;
        const maxX = Math.max(minX, imgX + imgW - startBoxW);
        const minY = imgY;
        const maxY = Math.max(minY, imgY + imgH - startBoxH);

        const newX = Math.max(minX, Math.min(maxX, startBoxX + dx));
        const newY = Math.max(minY, Math.min(maxY, startBoxY + dy));

        setCustomBox({
          x: newX,
          y: newY,
          width: startBoxW,
          height: startBoxH,
        });
        emitChange(false);
      } else {
        // Resizing ONLY the crop box via corner handles (STRICTLY CLAMPED INSIDE IMAGE)
        const { imgX, imgY, imgW, imgH } = layout;
        const aspect = targetAspectRatio > 0 ? targetAspectRatio : nw / nh;
        const minW = 40;

        if (mode === 'se') {
          // Bottom-Right handle
          const availW = Math.max(minW, imgX + imgW - startBoxX);
          const availH = Math.max(minW / aspect, imgY + imgH - startBoxY);
          const maxAllowedW = Math.min(availW, availH * aspect);

          const targetW = Math.max(minW, Math.min(maxAllowedW, startBoxW + dx));
          const targetH = targetW / aspect;
          setCustomBox({
            x: startBoxX,
            y: startBoxY,
            width: targetW,
            height: targetH,
          });
        } else if (mode === 'sw') {
          // Bottom-Left handle
          const fixedRight = startBoxX + startBoxW;
          const availW = Math.max(minW, fixedRight - imgX);
          const availH = Math.max(minW / aspect, imgY + imgH - startBoxY);
          const maxAllowedW = Math.min(availW, availH * aspect);

          const targetW = Math.max(minW, Math.min(maxAllowedW, startBoxW - dx));
          const targetH = targetW / aspect;
          setCustomBox({
            x: fixedRight - targetW,
            y: startBoxY,
            width: targetW,
            height: targetH,
          });
        } else if (mode === 'ne') {
          // Top-Right handle
          const fixedBottom = startBoxY + startBoxH;
          const availW = Math.max(minW, imgX + imgW - startBoxX);
          const availH = Math.max(minW / aspect, fixedBottom - imgY);
          const maxAllowedW = Math.min(availW, availH * aspect);

          const targetW = Math.max(minW, Math.min(maxAllowedW, startBoxW + dx));
          const targetH = targetW / aspect;
          setCustomBox({
            x: startBoxX,
            y: fixedBottom - targetH,
            width: targetW,
            height: targetH,
          });
        } else if (mode === 'nw') {
          // Top-Left handle
          const fixedRight = startBoxX + startBoxW;
          const fixedBottom = startBoxY + startBoxH;
          const availW = Math.max(minW, fixedRight - imgX);
          const availH = Math.max(minW / aspect, fixedBottom - imgY);
          const maxAllowedW = Math.min(availW, availH * aspect);

          const targetW = Math.max(minW, Math.min(maxAllowedW, startBoxW - dx));
          const targetH = targetW / aspect;
          setCustomBox({
            x: fixedRight - targetW,
            y: fixedBottom - targetH,
            width: targetW,
            height: targetH,
          });
        }
        emitChange(false);
      }
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (dragState) {
      setDragState(null);
      emitChange(true);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Fallback
      }
    }
  };

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
        {/* Background pan catcher when image is zoomed */}
        {imageZoom > 1.0 && (
          <div
            onPointerDown={(e) => handlePointerDown(e, 'panImage')}
            className="absolute inset-0 cursor-grab active:cursor-grabbing z-0"
            title="Drag to pan image"
          />
        )}

        {/* The Full Image: rendered in position, scales when wheel is scrolled */}
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
            className="select-none transition-none rounded-none shadow-md"
          />
        )}

        {/* ─────────────────────────────────────────────────────────────
            THE CROP BOX: PROMINENT, CRISP GRID & HIGH-CONTRAST HANDLES
            Does NOT zoom with image; stays at its fixed screen size!
        ───────────────────────────────────────────────────────────── */}
        {layout.boxW > 0 && layout.boxH > 0 && (
          <div
            style={{
              position: 'absolute',
              left: `${Math.round(layout.boxX)}px`,
              top: `${Math.round(layout.boxY)}px`,
              width: `${Math.round(layout.boxW)}px`,
              height: `${Math.round(layout.boxH)}px`,
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.50)', // Semi-translucent dark mask outside crop box
            }}
            className={`shrink-0 ${
              cropEnabled
                ? 'border-2 border-accent shadow-[0_0_0_1px_rgba(0,0,0,0.7)]'
                : 'border-2 border-accent opacity-80'
            } rounded-none z-10 transition-none`}
          >
            {/* Movable Surface (drag inside to move ONLY the crop box across the picture) */}
            <div
              onPointerDown={(e) => handlePointerDown(e, 'move')}
              className="absolute inset-0 cursor-move z-10"
              title="Drag inside to position crop area"
            />

            {/* Rule-of-Thirds Gridlines: Crisp high-visibility lines with subtle shadow */}
            {cropEnabled && (
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none z-20">
                <div className="border-r border-b border-white/50 drop-shadow-[0_1px_1px_rgba(0,0,0,0.7)]" />
                <div className="border-r border-b border-white/50 drop-shadow-[0_1px_1px_rgba(0,0,0,0.7)]" />
                <div className="border-b border-white/50 drop-shadow-[0_1px_1px_rgba(0,0,0,0.7)]" />
                <div className="border-r border-b border-white/50 drop-shadow-[0_1px_1px_rgba(0,0,0,0.7)]" />
                <div className="border-r border-b border-white/50 drop-shadow-[0_1px_1px_rgba(0,0,0,0.7)]" />
                <div className="border-b border-white/50 drop-shadow-[0_1px_1px_rgba(0,0,0,0.7)]" />
                <div className="border-r border-b border-white/50 drop-shadow-[0_1px_1px_rgba(0,0,0,0.7)]" />
                <div className="border-r border-b border-white/50 drop-shadow-[0_1px_1px_rgba(0,0,0,0.7)]" />
                <div />
              </div>
            )}

            {/* Corner Viewfinder Brackets */}
            <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-accent z-30 pointer-events-none" />
            <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-accent z-30 pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-accent z-30 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-accent z-30 pointer-events-none" />

            {/* Interactive Corner Resize Handles: Large, tactile, high contrast */}
            {cropEnabled && (
              <>
                <div
                  onPointerDown={(e) => handlePointerDown(e, 'nw')}
                  title="Resize crop area"
                  className="absolute -top-2.5 -left-2.5 w-5 h-5 bg-accent border-2 border-black/80 rounded-xs cursor-nwse-resize z-40 hover:scale-110 shadow-md transition-transform"
                />
                <div
                  onPointerDown={(e) => handlePointerDown(e, 'ne')}
                  title="Resize crop area"
                  className="absolute -top-2.5 -right-2.5 w-5 h-5 bg-accent border-2 border-black/80 rounded-xs cursor-nesw-resize z-40 hover:scale-110 shadow-md transition-transform"
                />
                <div
                  onPointerDown={(e) => handlePointerDown(e, 'se')}
                  title="Resize crop area"
                  className="absolute -bottom-2.5 -right-2.5 w-5 h-5 bg-accent border-2 border-black/80 rounded-xs cursor-nwse-resize z-40 hover:scale-110 shadow-md transition-transform"
                />
                <div
                  onPointerDown={(e) => handlePointerDown(e, 'sw')}
                  title="Resize crop area"
                  className="absolute -bottom-2.5 -left-2.5 w-5 h-5 bg-accent border-2 border-black/80 rounded-xs cursor-nesw-resize z-40 hover:scale-110 shadow-md transition-transform"
                />
              </>
            )}
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────
          BOTTOM GALLERY STATUS BAR (Only shown when not provided by parent)
      ───────────────────────────────────────────────────────────── */}
      {onRotationChange === undefined && (
        <div className="shrink-0 min-h-[44px] px-4 py-1.5 bg-surface-panel border-t border-surface-border z-10 flex items-center justify-end gap-1.5 text-xs select-none">
          {/* Rotate CCW 90° */}
          <button
            type="button"
            onClick={() => handleRotate(-90)}
            title="Rotate 90° counter-clockwise"
            aria-label="Rotate 90 degrees counter-clockwise"
            className="min-h-[36px] px-2.5 rounded-control border border-surface-border bg-surface-bg hover:bg-surface-subtle text-text-muted hover:text-text-main inline-flex items-center justify-center gap-1.5 text-xs font-semibold font-mono transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span className="hidden sm:inline">Rotate -90°</span>
          </button>

          {/* Rotate CW 90° */}
          <button
            type="button"
            onClick={() => handleRotate(90)}
            title="Rotate 90° clockwise"
            aria-label="Rotate 90 degrees clockwise"
            className="min-h-[36px] px-2.5 rounded-control border border-surface-border bg-surface-bg hover:bg-surface-subtle text-text-muted hover:text-text-main inline-flex items-center justify-center gap-1.5 text-xs font-semibold font-mono transition-colors cursor-pointer"
          >
            <RotateCw className="w-4 h-4" />
            <span className="hidden sm:inline">Rotate +90°</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default DedicatedCropper;
