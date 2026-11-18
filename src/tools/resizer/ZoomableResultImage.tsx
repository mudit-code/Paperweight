import React, { useRef, useState, useEffect, useCallback } from 'react';
import { RotateCcw } from 'lucide-react';

export interface ZoomableResultImageProps {
  src: string;
  alt?: string;
  className?: string;
}

export const ZoomableResultImage: React.FC<ZoomableResultImageProps> = ({
  src,
  alt = 'Resized image',
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const [scale, setScale] = useState<number>(1.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Sync refs for event handlers
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const panRef = useRef(pan);
  panRef.current = pan;

  // Reset zoom & pan when image source changes
  useEffect(() => {
    setScale(1.0);
    setPan({ x: 0, y: 0 });
  }, [src]);

  // Check if a screen coordinate is inside the rendered image bounding box
  const isInsideImage = useCallback((clientX: number, clientY: number): boolean => {
    if (!imgRef.current) return true;
    const rect = imgRef.current.getBoundingClientRect();
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  }, []);

  // Compute maximum allowable pan bounds
  const getPanBounds = useCallback((targetScale: number) => {
    const container = containerRef.current;
    const img = imgRef.current;
    if (!container) return { maxPanX: 0, maxPanY: 0 };
    const cRect = container.getBoundingClientRect();
    const baseW = img?.offsetWidth || cRect.width;
    const baseH = img?.offsetHeight || cRect.height;
    const maxPanX = Math.max(0, (baseW * targetScale - baseW) / 2 + 80);
    const maxPanY = Math.max(0, (baseH * targetScale - baseH) / 2 + 80);
    return { maxPanX, maxPanY };
  }, []);

  // Reset to initial fit
  const handleResetFit = useCallback(() => {
    setScale(1.0);
    setPan({ x: 0, y: 0 });
  }, []);

  // Mouse wheel zoom (minimum scale is 1.0 = fit the page)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      // Do not allow zoom gestures outside the image area
      if (!isInsideImage(e.clientX, e.clientY)) {
        return;
      }

      e.preventDefault();
      const cRect = container.getBoundingClientRect();
      const cX = cRect.width / 2;
      const cY = cRect.height / 2;
      const fx = e.clientX - cRect.left - cX;
      const fy = e.clientY - cRect.top - cY;

      const factor = e.deltaY < 0 ? 1.15 : 0.85;
      const curScale = scaleRef.current;
      // Minimum zoom out is 1.0 (fit the page), maximum is 8.0
      const nextScale = Math.max(1.0, Math.min(8.0, Number((curScale * factor).toFixed(2))));

      if (nextScale <= 1.03) {
        setScale(1.0);
        setPan({ x: 0, y: 0 });
      } else {
        const ratio = nextScale / curScale;
        const curPan = panRef.current;
        const nextPanX = fx - (fx - curPan.x) * ratio;
        const nextPanY = fy - (fy - curPan.y) * ratio;

        const { maxPanX, maxPanY } = getPanBounds(nextScale);
        setScale(nextScale);
        setPan({
          x: Math.max(-maxPanX, Math.min(maxPanX, nextPanX)),
          y: Math.max(-maxPanY, Math.min(maxPanY, nextPanY)),
        });
      }
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', onWheel);
    };
  }, [isInsideImage, getPanBounds]);

  // Mouse drag to pan when zoomed
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (scaleRef.current <= 1.03) return;

    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...panRef.current };
  };

  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      const { maxPanX, maxPanY } = getPanBounds(scaleRef.current);
      setPan({
        x: Math.max(-maxPanX, Math.min(maxPanX, panStartRef.current.x + dx)),
        y: Math.max(-maxPanY, Math.min(maxPanY, panStartRef.current.y + dy)),
      });
    };

    const onMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging, getPanBounds]);

  // Double click to zoom in (2.5x) or reset to fit (1.0x)
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (!isInsideImage(e.clientX, e.clientY)) return;

    if (scaleRef.current > 1.05) {
      handleResetFit();
    } else {
      const container = containerRef.current;
      if (!container) return;
      const cRect = container.getBoundingClientRect();
      const fx = e.clientX - cRect.left - cRect.width / 2;
      const fy = e.clientY - cRect.top - cRect.height / 2;
      const targetScale = 2.5;
      const { maxPanX, maxPanY } = getPanBounds(targetScale);
      setScale(targetScale);
      setPan({
        x: Math.max(-maxPanX, Math.min(maxPanX, -fx * (targetScale - 1))),
        y: Math.max(-maxPanY, Math.min(maxPanY, -fy * (targetScale - 1))),
      });
    }
  };

  // Touch pinch-to-zoom and pan for mobile/tablets
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let gesture: 'none' | 'pinch' | 'pan' = 'none';
    let pinchStartDist = 0;
    let pinchStartScale = 1.0;
    let pinchStartPan = { x: 0, y: 0 };
    let pinchFocalX = 0;
    let pinchFocalY = 0;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartPan = { x: 0, y: 0 };
    let lastTapTime = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        if (!isInsideImage(t1.clientX, t1.clientY) && !isInsideImage(t2.clientX, t2.clientY)) {
          return;
        }
        if (e.cancelable) e.preventDefault();
        gesture = 'pinch';
        pinchStartDist = Math.max(10, Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY));
        pinchStartScale = scaleRef.current;
        pinchStartPan = { ...panRef.current };
        const cRect = container.getBoundingClientRect();
        pinchFocalX = (t1.clientX + t2.clientX) / 2 - cRect.left - cRect.width / 2;
        pinchFocalY = (t1.clientY + t2.clientY) / 2 - cRect.top - cRect.height / 2;
        return;
      }

      if (e.touches.length === 1) {
        const t = e.touches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        touchStartPan = { ...panRef.current };

        const now = performance.now();
        if (now - lastTapTime < 300 && isInsideImage(t.clientX, t.clientY)) {
          // Double-tap
          if (e.cancelable) e.preventDefault();
          lastTapTime = 0;
          if (scaleRef.current > 1.05) {
            handleResetFit();
          } else {
            const cRect = container.getBoundingClientRect();
            const fx = t.clientX - cRect.left - cRect.width / 2;
            const fy = t.clientY - cRect.top - cRect.height / 2;
            const targetScale = 2.5;
            const { maxPanX, maxPanY } = getPanBounds(targetScale);
            setScale(targetScale);
            setPan({
              x: Math.max(-maxPanX, Math.min(maxPanX, -fx * (targetScale - 1))),
              y: Math.max(-maxPanY, Math.min(maxPanY, -fy * (targetScale - 1))),
            });
          }
          return;
        }
        lastTapTime = now;

        if (scaleRef.current > 1.05) {
          gesture = 'pan';
        } else {
          gesture = 'none';
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2 && gesture === 'pinch') {
        if (e.cancelable) e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const ratio = dist / pinchStartDist;
        const nextScale = Math.max(1.0, Math.min(8.0, Number((pinchStartScale * ratio).toFixed(2))));

        if (nextScale <= 1.03) {
          setScale(1.0);
          setPan({ x: 0, y: 0 });
        } else {
          const panRatio = nextScale / pinchStartScale;
          const cRect = container.getBoundingClientRect();
          const curFocalX = (t1.clientX + t2.clientX) / 2 - cRect.left - cRect.width / 2;
          const curFocalY = (t1.clientY + t2.clientY) / 2 - cRect.top - cRect.height / 2;
          const nextPanX = curFocalX - (pinchFocalX - pinchStartPan.x) * panRatio;
          const nextPanY = curFocalY - (pinchFocalY - pinchStartPan.y) * panRatio;

          const { maxPanX, maxPanY } = getPanBounds(nextScale);
          setScale(nextScale);
          setPan({
            x: Math.max(-maxPanX, Math.min(maxPanX, nextPanX)),
            y: Math.max(-maxPanY, Math.min(maxPanY, nextPanY)),
          });
        }
        return;
      }

      if (e.touches.length === 1 && gesture === 'pan' && scaleRef.current > 1.05) {
        if (e.cancelable) e.preventDefault();
        const t = e.touches[0];
        const dx = t.clientX - touchStartX;
        const dy = t.clientY - touchStartY;
        const { maxPanX, maxPanY } = getPanBounds(scaleRef.current);
        setPan({
          x: Math.max(-maxPanX, Math.min(maxPanX, touchStartPan.x + dx)),
          y: Math.max(-maxPanY, Math.min(maxPanY, touchStartPan.y + dy)),
        });
      }
    };

    const onTouchEnd = () => {
      gesture = 'none';
      if (scaleRef.current <= 1.03) {
        setScale(1.0);
        setPan({ x: 0, y: 0 });
      }
    };

    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: true });
    container.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [isInsideImage, getPanBounds, handleResetFit]);

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      className={`relative w-full h-full flex items-center justify-center overflow-hidden select-none touch-none ${className}`}
      style={{
        cursor: scale > 1.03 ? (isDragging ? 'grabbing' : 'grab') : 'default',
      }}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        className="max-w-full max-h-full object-contain pointer-events-auto select-none rounded-none"
        style={{
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`,
          transformOrigin: 'center center',
          transition: isDragging ? 'none' : 'transform 120ms cubic-bezier(0.2, 0, 0, 1)',
          willChange: 'transform',
        }}
      />

      {/* Subtle zoom indicator & fit reset button when zoomed in */}
      {scale > 1.03 && (
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-panel/90 backdrop-blur-md border border-surface-border text-xs font-mono shadow-sm z-30 animate-in fade-in">
          <span className="text-text-main font-semibold">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleResetFit();
            }}
            className="flex items-center gap-1 ml-1 text-text-muted hover:text-text-main transition-colors cursor-pointer"
            title="Reset to fit page"
          >
            <RotateCcw className="w-3 h-3" />
            <span className="text-[11px] font-sans font-medium">Fit</span>
          </button>
        </div>
      )}
    </div>
  );
};
