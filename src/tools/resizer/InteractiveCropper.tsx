import React, { useRef, useState, useEffect, useCallback } from 'react';
import type { CropRect } from '../../core/processors/resizer';

export interface InteractiveCropperProps {
  imageUrl: string;
  targetAspectRatio: number; // width / height
  cropRect: CropRect;
  onChange: (crop: CropRect) => void;
  outputWidth?: number;
  outputHeight?: number;
  unit?: string;
  className?: string;
}

type DragMode = 'move' | 'nw' | 'ne' | 'se' | 'sw' | 'n' | 's' | 'e' | 'w' | null;

export const InteractiveCropper: React.FC<InteractiveCropperProps> = ({
  imageUrl,
  targetAspectRatio,
  cropRect,
  onChange,
  outputWidth,
  outputHeight,
  unit = 'px',
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const dragStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    startCrop: CropRect;
    containerWidth: number;
    containerHeight: number;
  } | null>(null);

  // When image loads or target aspect ratio changes, ensure crop is initialized within bounds
  const initializeCropForRatio = useCallback(
    (ratio: number) => {
      let w = 0.9;
      let h = w / ratio;

      if (h > 0.9) {
        h = 0.9;
        w = h * ratio;
      }

      w = Math.min(0.98, Math.max(0.1, w));
      h = Math.min(0.98, Math.max(0.1, h));

      const x = (1 - w) / 2;
      const y = (1 - h) / 2;

      onChange({
        x: Math.max(0, Math.min(1 - w, Number(x.toFixed(4)))),
        y: Math.max(0, Math.min(1 - h, Number(y.toFixed(4)))),
        width: Number(w.toFixed(4)),
        height: Number(h.toFixed(4)),
      });
    },
    [onChange]
  );

  // If aspect ratio changes, re-adjust current crop height or width
  useEffect(() => {
    if (!targetAspectRatio || targetAspectRatio <= 0) return;

    // Check if current ratio matches target ratio within tolerance
    const currentRatio = cropRect.width / cropRect.height;
    if (Math.abs(currentRatio - targetAspectRatio) > 0.02) {
      let newW = cropRect.width;
      let newH = newW / targetAspectRatio;

      if (cropRect.y + newH > 1 || newH > 0.98) {
        newH = Math.min(0.95, 1 - cropRect.y);
        newW = newH * targetAspectRatio;
      }
      if (cropRect.x + newW > 1) {
        newW = 1 - cropRect.x;
        newH = newW / targetAspectRatio;
      }

      onChange({
        x: cropRect.x,
        y: cropRect.y,
        width: Math.max(0.1, Math.min(1, Number(newW.toFixed(4)))),
        height: Math.max(0.1, Math.min(1, Number(newH.toFixed(4)))),
      });
    }
  }, [targetAspectRatio]);

  const handlePointerDown = (e: React.PointerEvent, mode: DragMode) => {
    e.preventDefault();
    e.stopPropagation();
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    setDragMode(mode);
    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      startCrop: { ...cropRect },
      containerWidth: rect.width,
      containerHeight: rect.height,
    };

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragMode || !dragStartRef.current) return;
    e.preventDefault();
    e.stopPropagation();

    const { pointerX, pointerY, startCrop, containerWidth, containerHeight } = dragStartRef.current;
    if (containerWidth <= 0 || containerHeight <= 0) return;

    const deltaX = (e.clientX - pointerX) / containerWidth;
    const deltaY = (e.clientY - pointerY) / containerHeight;

    let { x, y, width, height } = startCrop;

    if (dragMode === 'move') {
      // Reposition crop box inside boundaries [0, 1]
      const maxX = 1 - width;
      const maxY = 1 - height;
      x = Math.max(0, Math.min(maxX, startCrop.x + deltaX));
      y = Math.max(0, Math.min(maxY, startCrop.y + deltaY));
    } else {
      // Resizing with locked target aspect ratio
      const ratio = targetAspectRatio > 0 ? targetAspectRatio : 1;

      if (dragMode === 'se') {
        let newW = Math.max(0.1, Math.min(1 - startCrop.x, startCrop.width + deltaX));
        let newH = newW / ratio;
        if (startCrop.y + newH > 1) {
          newH = 1 - startCrop.y;
          newW = newH * ratio;
        }
        width = newW;
        height = newH;
      } else if (dragMode === 'sw') {
        let newW = Math.max(0.1, Math.min(startCrop.x + startCrop.width, startCrop.width - deltaX));
        let newH = newW / ratio;
        if (startCrop.y + newH > 1) {
          newH = 1 - startCrop.y;
          newW = newH * ratio;
        }
        x = startCrop.x + (startCrop.width - newW);
        width = newW;
        height = newH;
      } else if (dragMode === 'ne') {
        let newW = Math.max(0.1, Math.min(1 - startCrop.x, startCrop.width + deltaX));
        let newH = newW / ratio;
        if (startCrop.y + startCrop.height - newH < 0) {
          newH = startCrop.y + startCrop.height;
          newW = newH * ratio;
        }
        y = startCrop.y + (startCrop.height - newH);
        width = newW;
        height = newH;
      } else if (dragMode === 'nw') {
        let newW = Math.max(0.1, Math.min(startCrop.x + startCrop.width, startCrop.width - deltaX));
        let newH = newW / ratio;
        if (startCrop.y + startCrop.height - newH < 0) {
          newH = startCrop.y + startCrop.height;
          newW = newH * ratio;
        }
        x = startCrop.x + (startCrop.width - newW);
        y = startCrop.y + (startCrop.height - newH);
        width = newW;
        height = newH;
      }
    }

    onChange({
      x: Number(Math.max(0, Math.min(1 - width, x)).toFixed(4)),
      y: Number(Math.max(0, Math.min(1 - height, y)).toFixed(4)),
      width: Number(Math.max(0.05, Math.min(1, width)).toFixed(4)),
      height: Number(Math.max(0.05, Math.min(1, height)).toFixed(4)),
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragMode) {
      setDragMode(null);
      dragStartRef.current = null;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Safe fallback
      }
    }
  };

  return (
    <div className={`relative flex items-center justify-center select-none overflow-hidden ${className}`}>
      {/* Outer framing container */}
      <div
        ref={containerRef}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative inline-block max-h-[580px] max-w-full overflow-hidden shadow-lg rounded-none border border-surface-border bg-surface-subtle dark:bg-black/40 touch-none"
      >
        {/* Source Subject Image */}
        <img
          ref={imgRef}
          src={imageUrl}
          alt="Subject to crop"
          onLoad={() => {
            if (cropRect.width === 1 && cropRect.height === 1) {
              initializeCropForRatio(targetAspectRatio);
            }
          }}
          className="block max-h-[560px] max-w-full w-auto h-auto object-contain pointer-events-none rounded-none"
        />

        {/* Shaded backdrop & Crop Viewport */}
        <div
          onPointerDown={(e) => handlePointerDown(e, 'move')}
          style={{
            left: `${cropRect.x * 100}%`,
            top: `${cropRect.y * 100}%`,
            width: `${cropRect.width * 100}%`,
            height: `${cropRect.height * 100}%`,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.58)',
          }}
          className="absolute border-2 border-white cursor-move z-10 transition-shadow"
        >
          {/* Rule of Thirds Gridlines */}
          <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-40">
            <div className="border-r border-b border-white" />
            <div className="border-r border-b border-white" />
            <div className="border-b border-white" />
            <div className="border-r border-b border-white" />
            <div className="border-r border-b border-white" />
            <div className="border-b border-white" />
            <div className="border-r border-white" />
            <div className="border-r border-white" />
            <div />
          </div>

          {/* Size & Aspect Ratio Pill Badge */}
          <div className="absolute top-2 left-2 z-20 pointer-events-none">
            <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface-panel/90 text-text-main border border-surface-border dark:bg-black/75 dark:text-white dark:border-white/20 backdrop-blur-xs shadow-xs">
              {outputWidth && outputHeight
                ? `${outputWidth} × ${outputHeight} ${unit}`
                : `${(targetAspectRatio).toFixed(2)}:1`}
            </span>
          </div>

          {/* Corner Resize Handles */}
          {/* Top-Left */}
          <div
            onPointerDown={(e) => handlePointerDown(e, 'nw')}
            className="absolute -top-2 -left-2 w-4 h-4 bg-white border-2 border-accent rounded-sm shadow-md cursor-nwse-resize z-20 hover:scale-125 transition-transform"
          />
          {/* Top-Right */}
          <div
            onPointerDown={(e) => handlePointerDown(e, 'ne')}
            className="absolute -top-2 -right-2 w-4 h-4 bg-white border-2 border-accent rounded-sm shadow-md cursor-nesw-resize z-20 hover:scale-125 transition-transform"
          />
          {/* Bottom-Right */}
          <div
            onPointerDown={(e) => handlePointerDown(e, 'se')}
            className="absolute -bottom-2 -right-2 w-4 h-4 bg-white border-2 border-accent rounded-sm shadow-md cursor-nwse-resize z-20 hover:scale-125 transition-transform"
          />
          {/* Bottom-Left */}
          <div
            onPointerDown={(e) => handlePointerDown(e, 'sw')}
            className="absolute -bottom-2 -left-2 w-4 h-4 bg-white border-2 border-accent rounded-sm shadow-md cursor-nesw-resize z-20 hover:scale-125 transition-transform"
          />
        </div>
      </div>
    </div>
  );
};

