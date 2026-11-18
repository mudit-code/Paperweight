import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  RotateCw,
  Minimize2,
  Download,
  Plus,
  Trash2,
  Crop,
  ArrowLeft,
  ArrowRightLeft,
  FlipHorizontal,
  Copy,
  Maximize,
  Check,
} from 'lucide-react';
import { formatBytes } from '../../core/files/validation';
import { downloadBlob, isMobileApp } from '../../core/processors/download';
import { registerBackHandler } from '../../core/navigation/backButton';

export interface GalleryItem {
  id: string;
  name: string;
  url: string;
  blob?: Blob;
  size?: number;
  type?: string;
  dimensions?: { width: number; height: number };
}

export interface ImageGalleryModalProps {
  isOpen: boolean;
  onClose: () => void;
  images: GalleryItem[];
  initialIndex?: number;
  onCompressImage?: (blob: Blob, name: string) => void;
  onResizeImage?: (blob: Blob, name: string) => void;
  onConvertImagesToPdf?: (images: Array<{ blob: Blob; name: string }>) => void;
  onAddImages?: (newImages: GalleryItem[]) => void;
  onRemoveImage?: (id: string) => void;
}

interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  item: GalleryItem | null;
}

const getAspectRatioString = (width?: number, height?: number): string => {
  if (!width || !height || width <= 0 || height <= 0) return '';
  const gcd = (a: number, b: number): number => {
    let x = Math.round(Math.abs(a));
    let y = Math.round(Math.abs(b));
    while (y) {
      const t = y;
      y = x % y;
      x = t;
    }
    return x;
  };
  const divisor = gcd(width, height);
  const wTerm = Math.round(width / divisor);
  const hTerm = Math.round(height / divisor);

  if (wTerm <= 32 && hTerm <= 32) {
    return `${wTerm}:${hTerm}`;
  }
  const ratio = (width / height).toFixed(2).replace(/\.00$/, '');
  return `${ratio}:1`;
};

export const ImageGalleryModal: React.FC<ImageGalleryModalProps> = ({
  isOpen,
  onClose,
  images: initialImages,
  initialIndex = 0,
  onCompressImage,
  onResizeImage,
  onConvertImagesToPdf,
  onAddImages,
  onRemoveImage,
}) => {
  const [items, setItems] = useState<GalleryItem[]>(initialImages);
  const [currentIndex, setCurrentIndex] = useState<number>(initialIndex);
  const [viewMode, setViewMode] = useState<'stage' | 'grid'>('stage');
  const isMobile = isMobileApp();

  // Stage transform & touch swipe carousel state
  const [scale, setScale] = useState<number>(1.0);
  const [rotation, setRotation] = useState<number>(0);
  const [isFlippedH, setIsFlippedH] = useState<boolean>(false);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isTouchActive, setIsTouchActive] = useState<boolean>(false);
  const [swipeOffsetX, setSwipeOffsetX] = useState<number>(0);
  const [swipeTransitioning, setSwipeTransitioning] = useState<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const swipeCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSwipeTargetRef = useRef<number | null>(null);
  const isMouseSwipingRef = useRef(false);
  const mouseStartXRef = useRef(0);
  const mouseLastXRef = useRef(0);
  const mouseLastTimeRef = useRef(0);
  const mouseVelocityXRef = useRef(0);

  // Dimensions cache
  const [dimensionsMap, setDimensionsMap] = useState<Record<string, { width: number; height: number }>>({});

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    item: null,
  });

  // Refs synced for native touch/back listeners
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const panRef = useRef(pan);
  panRef.current = pan;
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;
  const itemsLengthRef = useRef(items.length);
  itemsLengthRef.current = items.length;
  const swipeOffsetXRef = useRef(swipeOffsetX);
  swipeOffsetXRef.current = swipeOffsetX;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const contextMenuOpenRef = useRef(contextMenu.isOpen);
  contextMenuOpenRef.current = contextMenu.isOpen;

  // Mobile hardware back button synchronization (ContextMenu -> Grid -> Stage -> Close)
  useEffect(() => {
    if (!isOpen) return;
    const unregister = registerBackHandler(() => {
      if (contextMenuOpenRef.current) {
        setContextMenu((prev) => ({ ...prev, isOpen: false }));
        return true;
      }
      if (viewModeRef.current === 'grid') {
        setViewMode('stage');
        return true;
      }
      onClose();
      return true;
    });
    return unregister;
  }, [isOpen, onClose]);

  // Copied feedback
  const [copiedSuccess, setCopiedSuccess] = useState<boolean>(false);

  // Hidden file input for adding more images
  const addFileInputRef = useRef<HTMLInputElement>(null);
  const stageContainerRef = useRef<HTMLDivElement>(null);
  const activeImageRef = useRef<HTMLImageElement>(null);

  // Keep items in sync with prop updates
  useEffect(() => {
    setItems(initialImages);
    if (initialIndex >= 0 && initialIndex < initialImages.length) {
      setCurrentIndex(initialIndex);
    }
  }, [initialImages, initialIndex]);

  // Reset transform when changing image
  const resetTransform = useCallback(() => {
    setScale(1.0);
    setRotation(0);
    setIsFlippedH(false);
    setPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    resetTransform();
  }, [currentIndex, resetTransform]);

  // Smooth touch swipe carousel + multi-touch pinch-to-zoom + double-tap & drag + zoomed pan for Android/Mobile
  useEffect(() => {
    if (!isOpen || viewMode !== 'stage') return;
    const el = stageContainerRef.current;
    if (!el) return;

    let gestureLock: 'none' | 'swipe' | 'pan' | 'pinch' = 'none';
    let startX = 0;
    let startY = 0;
    let startPan = { x: 0, y: 0 };
    let lastX = 0;
    let lastTime = 0;
    let velocityX = 0;

    // Multi-touch Pinch state (with focal point tracking)
    let pinchStartDist = 0;
    let pinchStartScale = 1.0;
    let pinchCenterX = 0;
    let pinchCenterY = 0;
    let pinchInitialFocalX = 0;
    let pinchInitialFocalY = 0;
    let pinchStartPan = { x: 0, y: 0 };

    // Double-tap & One-handed drag zoom state
    let lastTapTime = 0;
    let lastTapPos = { x: 0, y: 0 };
    let movedSinceStart = false;
    let isDoubleTapCandidate = false;
    let isDoubleTapDragging = false;
    let doubleTapStartY = 0;
    let doubleTapStartScale = 1.0;
    let doubleTapFocalX = 0;
    let doubleTapFocalY = 0;
    let doubleTapStartPan = { x: 0, y: 0 };

    const flushPendingSwipe = () => {
      if (swipeCommitTimerRef.current !== null) {
        clearTimeout(swipeCommitTimerRef.current);
        swipeCommitTimerRef.current = null;
      }
      if (pendingSwipeTargetRef.current !== null) {
        const targetIdx = pendingSwipeTargetRef.current;
        pendingSwipeTargetRef.current = null;
        setSwipeTransitioning(false);
        setSwipeOffsetX(0);
        setCurrentIndex(targetIdx);
        currentIndexRef.current = targetIdx;
      } else {
        setSwipeTransitioning(false);
        setSwipeOffsetX(0);
      }
    };

    const isTouchOnImage = (touch: Touch) => {
      if (!activeImageRef.current) return true;
      const rect = activeImageRef.current.getBoundingClientRect();
      return (
        touch.clientX >= rect.left &&
        touch.clientX <= rect.right &&
        touch.clientY >= rect.top &&
        touch.clientY <= rect.bottom
      );
    };

    const onTouchStart = (e: TouchEvent) => {
      flushPendingSwipe();
      setIsTouchActive(true);
      movedSinceStart = false;

      if (e.touches.length >= 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        // Do not allow pinch zoom if touches are initiated outside the image area
        if (!isTouchOnImage(t1) && !isTouchOnImage(t2)) {
          return;
        }
        if (e.cancelable) e.preventDefault();
        gestureLock = 'pinch';
        isDoubleTapCandidate = false;
        isDoubleTapDragging = false;
        pinchStartDist = Math.max(10, Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY));
        pinchStartScale = scaleRef.current;
        const rect = el.getBoundingClientRect();
        pinchCenterX = rect.width / 2;
        pinchCenterY = rect.height / 2;
        pinchInitialFocalX = (t1.clientX + t2.clientX) / 2 - rect.left - pinchCenterX;
        pinchInitialFocalY = (t1.clientY + t2.clientY) / 2 - rect.top - pinchCenterY;
        pinchStartPan = { ...panRef.current };
        setSwipeOffsetX(0);
        return;
      }

      if (e.touches.length === 1) {
        const t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        lastX = t.clientX;
        lastTime = performance.now();
        velocityX = 0;
        startPan = { ...panRef.current };

        const now = performance.now();
        const distFromLast = Math.hypot(t.clientX - lastTapPos.x, t.clientY - lastTapPos.y);

        if (now - lastTapTime < 350 && distFromLast < 45 && isTouchOnImage(t)) {
          if (e.cancelable) e.preventDefault();
          isDoubleTapCandidate = true;
          isDoubleTapDragging = false;
          doubleTapStartY = t.clientY;
          doubleTapStartScale = scaleRef.current;
          const rect = el.getBoundingClientRect();
          doubleTapFocalX = t.clientX - rect.left - rect.width / 2;
          doubleTapFocalY = t.clientY - rect.top - rect.height / 2;
          doubleTapStartPan = { ...panRef.current };
          lastTapTime = 0;
          gestureLock = 'none';
        } else {
          lastTapTime = now;
          lastTapPos = { x: t.clientX, y: t.clientY };
          isDoubleTapCandidate = false;
          isDoubleTapDragging = false;
          gestureLock = scaleRef.current > 1.05 ? 'pan' : 'none';
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        if (e.cancelable) e.preventDefault();
        gestureLock = 'pinch';
        isDoubleTapCandidate = false;
        isDoubleTapDragging = false;
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const scaleRatio = dist / pinchStartDist;
        const nextScale = Math.max(1.0, Math.min(8.0, Number((pinchStartScale * scaleRatio).toFixed(3))));
        if (nextScale <= 1.05) {
          setScale(1.0);
          setPan({ x: 0, y: 0 });
          return;
        }
        const rect = el.getBoundingClientRect();
        const curScreenFocalX = (t1.clientX + t2.clientX) / 2 - rect.left - pinchCenterX;
        const curScreenFocalY = (t1.clientY + t2.clientY) / 2 - rect.top - pinchCenterY;
        const panDeltaRatio = nextScale / pinchStartScale;
        const nextPanX = curScreenFocalX - (pinchInitialFocalX - pinchStartPan.x) * panDeltaRatio;
        const nextPanY = curScreenFocalY - (pinchInitialFocalY - pinchStartPan.y) * panDeltaRatio;
        setScale(nextScale);
        setPan({ x: nextPanX, y: nextPanY });
        return;
      }

      if (e.touches.length !== 1 || gestureLock === 'pinch') return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (Math.hypot(dx, dy) > 6) {
        movedSinceStart = true;
      }

      // Check double-tap drag (one-handed zoom)
      if (isDoubleTapCandidate) {
        const deltaY = t.clientY - doubleTapStartY;
        if (!isDoubleTapDragging && Math.abs(deltaY) > 6) {
          isDoubleTapDragging = true;
        }
        if (isDoubleTapDragging) {
          if (e.cancelable) e.preventDefault();
          const scaleFactor = Math.pow(2, deltaY / 80);
          const rawScale = doubleTapStartScale * scaleFactor;
          const clampedScale = Math.max(0.5, Math.min(8.0, Number(rawScale.toFixed(3))));
          const panDeltaRatio = clampedScale / doubleTapStartScale;
          const nextPanX = doubleTapFocalX - (doubleTapFocalX - doubleTapStartPan.x) * panDeltaRatio;
          const nextPanY = doubleTapFocalY - (doubleTapFocalY - doubleTapStartPan.y) * panDeltaRatio;
          setScale(clampedScale);
          setPan({ x: nextPanX, y: nextPanY });
          return;
        }
      }

      if (!isDoubleTapCandidate && lastTapTime > 0 && Math.hypot(dx, dy) > 10) {
        lastTapTime = 0;
      }

      if (gestureLock === 'pan' || scaleRef.current > 1.05) {
        if (e.cancelable) e.preventDefault();
        gestureLock = 'pan';
        const rect = el.getBoundingClientRect();
        const curScale = scaleRef.current;
        const maxPanX = Math.max(0, (rect.width * curScale - rect.width) / 2 + 100);
        const maxPanY = Math.max(0, (rect.height * curScale - rect.height) / 2 + 100);
        setPan({
          x: Math.max(-maxPanX, Math.min(maxPanX, startPan.x + dx)),
          y: Math.max(-maxPanY, Math.min(maxPanY, startPan.y + dy)),
        });
        return;
      }

      if (gestureLock === 'none' && movedSinceStart && itemsLengthRef.current > 1) {
        if (Math.abs(dx) >= Math.abs(dy) * 0.75) {
          gestureLock = 'swipe';
        }
      }

      if (gestureLock === 'swipe') {
        if (e.cancelable) e.preventDefault();
        const now = performance.now();
        const dt = Math.max(1, now - lastTime);
        const instVx = (t.clientX - lastX) / dt;
        velocityX = velocityX * 0.4 + instVx * 0.6;
        lastX = t.clientX;
        lastTime = now;

        const curIdx = currentIndexRef.current;
        const len = itemsLengthRef.current;
        const isAtStartEdge = curIdx === 0 && dx > 0;
        const isAtEndEdge = curIdx >= len - 1 && dx < 0;
        const offset = isAtStartEdge || isAtEndEdge ? dx * 0.28 : dx;
        setSwipeOffsetX(offset);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        if (e.touches.length === 1 && gestureLock === 'pinch') {
          gestureLock = 'pan';
          startX = e.touches[0].clientX;
          startY = e.touches[0].clientY;
          startPan = { ...panRef.current };
        }
        return;
      }

      setIsTouchActive(false);

      if (gestureLock === 'pinch') {
        gestureLock = 'none';
        if (scaleRef.current <= 1.05) {
          setScale(1.0);
          setPan({ x: 0, y: 0 });
        }
        return;
      }

      if (isDoubleTapCandidate) {
        isDoubleTapCandidate = false;
        if (isDoubleTapDragging) {
          isDoubleTapDragging = false;
          if (scaleRef.current <= 1.05) {
            setScale(1.0);
            setPan({ x: 0, y: 0 });
          }
          return;
        }

        // Quick Double-Tap
        if (scaleRef.current > 1.05) {
          setScale(1.0);
          setPan({ x: 0, y: 0 });
        } else {
          const targetScale = 2.5;
          const rect = el.getBoundingClientRect();
          const maxPanX = Math.max(0, (rect.width * targetScale - rect.width) / 2);
          const maxPanY = Math.max(0, (rect.height * targetScale - rect.height) / 2);
          const targetPanX = Math.max(-maxPanX, Math.min(maxPanX, -doubleTapFocalX * (targetScale - 1)));
          const targetPanY = Math.max(-maxPanY, Math.min(maxPanY, -doubleTapFocalY * (targetScale - 1)));
          setScale(targetScale);
          setPan({ x: targetPanX, y: targetPanY });
        }
        return;
      }

      if (gestureLock === 'swipe') {
        gestureLock = 'none';
        const curIdx = currentIndexRef.current;
        const len = itemsLengthRef.current;
        const offset = swipeOffsetXRef.current;
        const stageW = el.clientWidth || window.innerWidth || 360;
        const stride = stageW + 24;

        // Velocity & displacement evaluation
        const isFlickLeft = velocityX < -0.25;
        const isFlickRight = velocityX > 0.25;
        const isPastMidpointLeft = offset < -stageW * 0.40;
        const isPastMidpointRight = offset > stageW * 0.40;
        const isCounterFlickCancel = (offset < 0 && isFlickRight) || (offset > 0 && isFlickLeft);

        const canGoNext = curIdx < len - 1;
        const canGoPrev = curIdx > 0;

        let goNext = false;
        let goPrev = false;

        if (!isCounterFlickCancel) {
          if (canGoNext && (isFlickLeft || isPastMidpointLeft)) {
            goNext = true;
          } else if (canGoPrev && (isFlickRight || isPastMidpointRight)) {
            goPrev = true;
          }
        }

        if (goNext) {
          const targetIdx = curIdx + 1;
          pendingSwipeTargetRef.current = targetIdx;
          setSwipeTransitioning(true);
          setSwipeOffsetX(-stride);
          swipeCommitTimerRef.current = setTimeout(() => {
            swipeCommitTimerRef.current = null;
            pendingSwipeTargetRef.current = null;
            setSwipeTransitioning(false);
            setSwipeOffsetX(0);
            setCurrentIndex(targetIdx);
          }, 260);
        } else if (goPrev) {
          const targetIdx = curIdx - 1;
          pendingSwipeTargetRef.current = targetIdx;
          setSwipeTransitioning(true);
          setSwipeOffsetX(stride);
          swipeCommitTimerRef.current = setTimeout(() => {
            swipeCommitTimerRef.current = null;
            pendingSwipeTargetRef.current = null;
            setSwipeTransitioning(false);
            setSwipeOffsetX(0);
            setCurrentIndex(targetIdx);
          }, 260);
        } else {
          pendingSwipeTargetRef.current = null;
          setSwipeTransitioning(true);
          setSwipeOffsetX(0);
          swipeCommitTimerRef.current = setTimeout(() => {
            swipeCommitTimerRef.current = null;
            setSwipeTransitioning(false);
          }, 240);
        }
        return;
      }

      gestureLock = 'none';
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      if (swipeCommitTimerRef.current !== null) {
        clearTimeout(swipeCommitTimerRef.current);
        swipeCommitTimerRef.current = null;
      }
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [isOpen, viewMode]);

  const currentItem = items[currentIndex] || null;

  // Measure natural dimensions of images
  const handleImageLoad = (id: string, e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth && img.naturalHeight) {
      setDimensionsMap((prev) => ({
        ...prev,
        [id]: { width: img.naturalWidth, height: img.naturalHeight },
      }));
    }
  };

  // Navigation handlers
  const handlePrev = useCallback(() => {
    if (items.length <= 1) return;
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
  }, [items.length]);

  const handleNext = useCallback(() => {
    if (items.length <= 1) return;
    setCurrentIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
  }, [items.length]);

  // Zoom handlers (clamped 1.0x to 8.0x: never zoom out smaller than original fit)
  const handleZoomIn = () => setScale((s) => Math.min(Number((s * 1.25).toFixed(2)), 8.0));
  const handleZoomOut = () => {
    setScale((s) => {
      const next = Math.max(Number((s / 1.25).toFixed(2)), 1.0);
      if (next <= 1.05) setPan({ x: 0, y: 0 });
      return next;
    });
  };
  const handleFit = () => resetTransform();
  const handleActualSize = () => {
    setScale(1.0);
    setPan({ x: 0, y: 0 });
  };

  // Rotation & Flip
  const handleRotate = () => setRotation((r) => (r + 90) % 360);
  const handleFlipH = () => setIsFlippedH((f) => !f);

  // Desktop Wheel zoom with focal point tracking (never zooms out smaller than 1.0)
  const handleWheel = (e: React.WheelEvent) => {
    // Do not allow zoom gestures outside the image area
    if (activeImageRef.current) {
      const imgRect = activeImageRef.current.getBoundingClientRect();
      const isInside =
        e.clientX >= imgRect.left &&
        e.clientX <= imgRect.right &&
        e.clientY >= imgRect.top &&
        e.clientY <= imgRect.bottom;
      if (!isInside) return;
    }

    e.preventDefault();
    const el = stageContainerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const fx = e.clientX - rect.left - centerX;
    const fy = e.clientY - rect.top - centerY;
    const factor = e.deltaY < 0 ? 1.2 : 0.833;
    const curScale = scale;
    const nextScale = Math.max(1.0, Math.min(8.0, Number((curScale * factor).toFixed(2))));
    if (nextScale <= 1.05) {
      setScale(1.0);
      setPan({ x: 0, y: 0 });
    } else {
      const ratio = nextScale / curScale;
      const nextPanX = fx - (fx - pan.x) * ratio;
      const nextPanY = fy - (fy - pan.y) * ratio;
      setScale(nextScale);
      setPan({ x: nextPanX, y: nextPanY });
    }
  };

  // Drag to pan when zoomed, or slide carousel when at fit scale
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only primary mouse button
    if (scale > 1.05) {
      e.preventDefault();
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      panStartRef.current = { ...pan };
    } else if (items.length > 1) {
      e.preventDefault();
      isMouseSwipingRef.current = true;
      mouseStartXRef.current = e.clientX;
      mouseLastXRef.current = e.clientX;
      mouseLastTimeRef.current = performance.now();
      mouseVelocityXRef.current = 0;
      setIsTouchActive(true);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && scale > 1.05) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      const el = stageContainerRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const maxPanX = Math.max(0, (rect.width * scale - rect.width) / 2 + 100);
        const maxPanY = Math.max(0, (rect.height * scale - rect.height) / 2 + 100);
        setPan({
          x: Math.max(-maxPanX, Math.min(maxPanX, panStartRef.current.x + dx)),
          y: Math.max(-maxPanY, Math.min(maxPanY, panStartRef.current.y + dy)),
        });
      } else {
        setPan({
          x: panStartRef.current.x + dx,
          y: panStartRef.current.y + dy,
        });
      }
    } else if (isMouseSwipingRef.current && scale <= 1.05) {
      const now = performance.now();
      const dt = Math.max(1, now - mouseLastTimeRef.current);
      const instVx = (e.clientX - mouseLastXRef.current) / dt;
      mouseVelocityXRef.current = mouseVelocityXRef.current * 0.4 + instVx * 0.6;
      mouseLastXRef.current = e.clientX;
      mouseLastTimeRef.current = now;

      const dx = e.clientX - mouseStartXRef.current;
      const curIdx = currentIndex;
      const len = items.length;
      const isAtStartEdge = curIdx === 0 && dx > 0;
      const isAtEndEdge = curIdx >= len - 1 && dx < 0;
      const offset = isAtStartEdge || isAtEndEdge ? dx * 0.28 : dx;
      setSwipeOffsetX(offset);
    }
  };

  const handleMouseUp = () => {
    if (isDragging) {
      setIsDragging(false);
    }
    if (isMouseSwipingRef.current) {
      isMouseSwipingRef.current = false;
      setIsTouchActive(false);

      const curIdx = currentIndex;
      const len = items.length;
      const offset = swipeOffsetX;
      const stageW = stageContainerRef.current?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 360);
      const stride = stageW + 24;
      const vx = mouseVelocityXRef.current;

      const isFlickLeft = vx < -0.25;
      const isFlickRight = vx > 0.25;
      const isPastMidpointLeft = offset < -stageW * 0.40;
      const isPastMidpointRight = offset > stageW * 0.40;
      const isCounterFlickCancel = (offset < 0 && isFlickRight) || (offset > 0 && isFlickLeft);

      const canGoNext = curIdx < len - 1;
      const canGoPrev = curIdx > 0;

      let goNext = false;
      let goPrev = false;

      if (!isCounterFlickCancel) {
        if (canGoNext && (isFlickLeft || isPastMidpointLeft)) {
          goNext = true;
        } else if (canGoPrev && (isFlickRight || isPastMidpointRight)) {
          goPrev = true;
        }
      }

      if (goNext) {
        const targetIdx = curIdx + 1;
        setSwipeTransitioning(true);
        setSwipeOffsetX(-stride);
        setTimeout(() => {
          setSwipeTransitioning(false);
          setSwipeOffsetX(0);
          setCurrentIndex(targetIdx);
        }, 260);
      } else if (goPrev) {
        const targetIdx = curIdx - 1;
        setSwipeTransitioning(true);
        setSwipeOffsetX(stride);
        setTimeout(() => {
          setSwipeTransitioning(false);
          setSwipeOffsetX(0);
          setCurrentIndex(targetIdx);
        }, 260);
      } else {
        setSwipeTransitioning(true);
        setSwipeOffsetX(0);
        setTimeout(() => {
          setSwipeTransitioning(false);
        }, 240);
      }
    }
  };

  // Double click toggles between fit and 2.5x focal zoom
  const handleDoubleClick = (e: React.MouseEvent) => {
    // Do not allow zoom gestures outside the image area
    if (activeImageRef.current) {
      const imgRect = activeImageRef.current.getBoundingClientRect();
      const isInside =
        e.clientX >= imgRect.left &&
        e.clientX <= imgRect.right &&
        e.clientY >= imgRect.top &&
        e.clientY <= imgRect.bottom;
      if (!isInside) return;
    }

    if (scale > 1.05) {
      resetTransform();
    } else {
      const el = stageContainerRef.current;
      if (!el) {
        setScale(2.5);
        return;
      }
      const rect = el.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const fx = e.clientX - rect.left - centerX;
      const fy = e.clientY - rect.top - centerY;
      const targetScale = 2.5;
      const maxPanX = Math.max(0, (rect.width * targetScale - rect.width) / 2);
      const maxPanY = Math.max(0, (rect.height * targetScale - rect.height) / 2);
      const targetPanX = Math.max(-maxPanX, Math.min(maxPanX, -fx * (targetScale - 1)));
      const targetPanY = Math.max(-maxPanY, Math.min(maxPanY, -fy * (targetScale - 1)));
      setScale(targetScale);
      setPan({ x: targetPanX, y: targetPanY });
    }
  };

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Download current image
  const handleDownloadCurrent = async (targetItem: GalleryItem | null = currentItem) => {
    if (!targetItem) return;
    if (targetItem.blob) {
      downloadBlob(targetItem.blob, targetItem.name);
    } else if (targetItem.url) {
      try {
        const resp = await fetch(targetItem.url);
        const blob = await resp.blob();
        downloadBlob(blob, targetItem.name);
      } catch (err) {
        console.error('Failed to download image:', err);
      }
    }
  };

  // Delete current image
  const handleDeleteItem = (targetItem: GalleryItem | null = currentItem) => {
    if (!targetItem) return;
    const id = targetItem.id;
    if (onRemoveImage) {
      onRemoveImage(id);
    }
    const nextItems = items.filter((it) => it.id !== id);
    setItems(nextItems);
    if (nextItems.length === 0) {
      setCurrentIndex(0);
    } else if (currentIndex >= nextItems.length) {
      setCurrentIndex(nextItems.length - 1);
    }
    setContextMenu((prev) => ({ ...prev, isOpen: false }));
  };

  // Copy Image to Clipboard
  const handleCopyImage = async (targetItem: GalleryItem | null = currentItem) => {
    if (!targetItem) return;
    try {
      let blob = targetItem.blob;
      if (!blob && targetItem.url) {
        const resp = await fetch(targetItem.url);
        blob = await resp.blob();
      }

      if (blob && window.ClipboardItem && navigator.clipboard?.write) {
        if (blob.type === 'image/png') {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        } else {
          // Render to canvas to create PNG blob for system clipboard
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.src = targetItem.url;
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
          });
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || 800;
          canvas.height = img.naturalHeight || 600;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0);
          canvas.toBlob(async (pngBlob) => {
            if (pngBlob) {
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
            }
          }, 'image/png');
        }
        setCopiedSuccess(true);
        setTimeout(() => setCopiedSuccess(false), 2000);
      }
    } catch (err) {
      console.warn('Failed to copy image to clipboard:', err);
    }
    setContextMenu((prev) => ({ ...prev, isOpen: false }));
  };

  // Add more images handler
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newItems: GalleryItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      newItems.push({
        id: `img_added_${Date.now()}_${i}`,
        name: file.name,
        size: file.size,
        type: file.type,
        blob,
        url,
      });
    }

    if (newItems.length > 0) {
      setItems((prev) => {
        const updated = [...prev, ...newItems];
        if (prev.length === 0) setCurrentIndex(0);
        return updated;
      });
      if (onAddImages) {
        onAddImages(newItems);
      }
    }
    e.target.value = '';
  };

  // Context menu handler
  const handleContextMenu = (e: React.MouseEvent, item: GalleryItem | null = currentItem) => {
    e.preventDefault();
    e.stopPropagation();
    if (!item) return;

    // Keep context menu within viewport bounds
    const menuWidth = 230;
    const menuHeight = 280;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8);

    setContextMenu({
      isOpen: true,
      x: Math.max(8, x),
      y: Math.max(8, y),
      item,
    });
  };

  // Close context menu when clicking anywhere else
  useEffect(() => {
    const closeMenu = () => {
      if (contextMenu.isOpen) {
        setContextMenu((prev) => ({ ...prev, isOpen: false }));
      }
    };
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [contextMenu.isOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      if (e.key === 'Escape') {
        e.preventDefault();
        if (contextMenu.isOpen) {
          setContextMenu((prev) => ({ ...prev, isOpen: false }));
        } else if (viewMode === 'grid') {
          setViewMode('stage');
        } else {
          onClose();
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        handleNext();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        handleZoomIn();
      } else if (e.key === '-') {
        e.preventDefault();
        handleZoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        handleFit();
      } else if (e.key === '1') {
        e.preventDefault();
        handleActualSize();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        handleRotate();
      } else if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        setViewMode((m) => (m === 'stage' ? 'grid' : 'stage'));
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDeleteItem();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, viewMode, contextMenu.isOpen, handlePrev, handleNext]);

  if (!isOpen) return null;

  const currentDims = currentItem ? dimensionsMap[currentItem.id] || currentItem.dimensions : null;
  const currentFormat = currentItem?.type
    ? currentItem.type.replace('image/', '').toUpperCase()
    : currentItem?.name.split('.').pop()?.toUpperCase() || 'IMAGE';
  const aspectRatioStr = currentDims ? getAspectRatioString(currentDims.width, currentDims.height) : '';

  return (
    <div
      role="dialog"
      aria-label="Image Gallery Viewer"
      className="fixed inset-0 z-[100] flex flex-col select-none overflow-hidden animate-in fade-in duration-150 bg-surface-bg text-text-main"
    >
      {/* Hidden File Input for Adding Images */}
      <input
        ref={addFileInputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/avif,image/bmp,image/gif,image/tiff,image/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* ─────────────────────────────────────────────────────────────
          TOP TOOLBAR (Windows 11 Photos Style with Android Safe-Area Clearance)
      ───────────────────────────────────────────────────────────── */}
      <div className="shrink-0 w-full bg-surface-panel border-b border-surface-border text-text-main z-30 select-none shadow-xs pt-[var(--safe-area-top)] pl-[var(--safe-area-left)] pr-[var(--safe-area-right)] transition-[padding] duration-150 relative">
        <header className="h-14 px-3 sm:px-6 flex items-center justify-between gap-2 relative">
          {/* Left Action: Back Button */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 z-10">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 h-9 sm:h-[38px] px-3 rounded-control border border-surface-border bg-surface-bg hover:bg-surface-subtle hover:border-surface-border-focus text-xs font-semibold text-text-main transition-colors duration-fast ease-out cursor-pointer shrink-0"
              title="Back"
              aria-label="Back"
            >
              <ArrowLeft className="w-4 h-4 text-text-muted shrink-0" />
              <span>Back</span>
            </button>
          </div>

          {/* Center: Image Name (DESKTOP ONLY - on mobile APK, moved to bottom status bar) */}
          {!isMobile && (
            <div className="absolute inset-x-0 inset-y-0 flex items-center justify-center pointer-events-none px-28">
              <span
                className="text-sm sm:text-base font-semibold text-text-main truncate text-center"
                title={currentItem?.name || 'Image'}
              >
                {currentItem?.name || 'Image'}
              </span>
            </div>
          )}

          {/* Right Actions: Compress and Resize buttons together in the right-most side */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 z-10 pr-1">
            {currentItem && onCompressImage && (
              <button
                type="button"
                onClick={() => {
                  if (currentItem.blob) {
                    onCompressImage(currentItem.blob, currentItem.name);
                  }
                }}
                className="inline-flex items-center gap-1.5 h-9 sm:h-[38px] px-3 rounded-control border border-surface-border bg-surface-bg hover:bg-surface-subtle hover:border-accent hover:text-accent text-text-main text-xs font-semibold transition-colors duration-fast ease-out cursor-pointer shrink-0 shadow-2xs"
                title="Compress image"
              >
                <Minimize2 className="w-3.5 h-3.5 text-accent shrink-0" />
                <span>Compress</span>
              </button>
            )}

            {currentItem && onResizeImage && (
              <button
                type="button"
                onClick={() => {
                  if (currentItem.blob) {
                    onResizeImage(currentItem.blob, currentItem.name);
                  }
                }}
                className="inline-flex items-center gap-1.5 h-9 sm:h-[38px] px-3 rounded-control border border-surface-border bg-surface-bg hover:bg-surface-subtle hover:border-accent hover:text-accent text-text-main text-xs font-semibold transition-colors duration-fast ease-out cursor-pointer shrink-0 shadow-2xs"
                title="Resize image"
              >
                <Crop className="w-3.5 h-3.5 text-accent shrink-0" />
                <span>Resize</span>
              </button>
            )}
          </div>
        </header>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          MAIN CONTENT AREA (Stage View or Grid View)
      ───────────────────────────────────────────────────────────── */}
      {viewMode === 'stage' ? (
        <div className="flex-1 flex flex-col min-h-0 relative overflow-hidden select-none bg-surface-bg">
          {/* Center Image Canvas Stage (supports 60 FPS Android horizontal swipe carousel, pinch zoom, double-tap & pan) */}
          <div
            ref={stageContainerRef}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onDoubleClick={handleDoubleClick}
            onContextMenu={(e) => handleContextMenu(e, currentItem)}
            style={{ touchAction: 'none' }}
            className={`flex-1 relative flex items-center justify-center overflow-hidden select-none bg-surface-subtle ${
              scale > 1.05
                ? isDragging
                  ? 'cursor-grabbing'
                  : 'cursor-grab'
                : items.length > 1
                ? 'cursor-grab active:cursor-grabbing'
                : 'cursor-default'
            }`}
          >
            {currentItem ? (() => {
              const stageW = stageContainerRef.current?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 360);
              const slideStride = stageW + 24;
              const showNeighbors = items.length > 1;
              const prevItem = currentIndex > 0 ? items[currentIndex - 1] : null;
              const nextItem = currentIndex < items.length - 1 ? items[currentIndex + 1] : null;

              return (
                <div
                  style={{
                    transform: `translate3d(${swipeOffsetX}px, 0, 0)`,
                    transition: swipeTransitioning ? 'transform 260ms cubic-bezier(0.2, 0.9, 0.3, 1)' : 'none',
                    willChange: showNeighbors ? 'transform' : 'auto',
                  }}
                  className="w-full h-full relative flex items-center justify-center"
                >
                  {/* Previous Slide (always mounted for zero-latency instant swipe response) */}
                  {showNeighbors && prevItem && (
                    <div
                      style={{ transform: `translate3d(-${slideStride}px, 0, 0)` }}
                      className="absolute inset-0 p-2 sm:p-4 flex items-center justify-center pointer-events-none select-none"
                    >
                      <img
                        src={prevItem.url}
                        alt={prevItem.name}
                        loading="eager"
                        decoding="async"
                        draggable={false}
                        className="max-h-full max-w-full object-contain shadow-2xl rounded-none pointer-events-none select-none"
                      />
                    </div>
                  )}

                  {/* Active Slide */}
                  <div
                    style={{
                      transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale}) rotate(${rotation}deg) scaleX(${isFlippedH ? -1 : 1})`,
                      transition: isDragging || isTouchActive ? 'none' : 'transform 140ms cubic-bezier(0.22, 1, 0.36, 1)',
                    }}
                    className="w-full h-full p-2 sm:p-4 flex items-center justify-center"
                  >
                    <img
                      ref={activeImageRef}
                      src={currentItem.url}
                      alt={currentItem.name}
                      onLoad={(e) => handleImageLoad(currentItem.id, e)}
                      loading="eager"
                      decoding="async"
                      draggable={false}
                      className="max-h-full max-w-full object-contain shadow-2xl rounded-none pointer-events-none select-none transition-shadow"
                    />
                  </div>

                  {/* Next Slide (always mounted for zero-latency instant swipe response) */}
                  {showNeighbors && nextItem && (
                    <div
                      style={{ transform: `translate3d(${slideStride}px, 0, 0)` }}
                      className="absolute inset-0 p-2 sm:p-4 flex items-center justify-center pointer-events-none select-none"
                    >
                      <img
                        src={nextItem.url}
                        alt={nextItem.name}
                        loading="eager"
                        decoding="async"
                        draggable={false}
                        className="max-h-full max-w-full object-contain shadow-2xl rounded-none pointer-events-none select-none"
                      />
                    </div>
                  )}
                </div>
              );
            })() : (
              /* Empty State: one plain line, one primary action */
              <div className="flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto gap-3">
                <p className="text-sm text-text-muted">
                  Choose images from your device to view.
                </p>
                <button
                  type="button"
                  onClick={() => addFileInputRef.current?.click()}
                  className="min-h-[44px] flex items-center gap-2 px-5 rounded-control text-sm font-semibold bg-accent text-accent-contrast hover:bg-accent-hover transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Choose files</span>
                </button>
              </div>
            )}

            {/* Feedback Toast for Copy to Clipboard */}
            {copiedSuccess && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 px-3.5 py-2 rounded-sheet bg-surface-panel border border-status-success-border shadow-lifted flex items-center gap-2 text-xs font-semibold text-status-success z-30">
                <Check className="w-4 h-4" />
                <span>Image copied to clipboard</span>
              </div>
            )}
          </div>

          {/* ─────────────────────────────────────────────────────────────
              BOTTOM STATUS & METADATA BAR (with Android Safe-Area Clearance)
          ───────────────────────────────────────────────────────────── */}
          <div className="shrink-0 w-full bg-surface-panel border-t border-surface-border text-text-muted z-30 select-none pb-[var(--safe-area-bottom)] pl-[var(--safe-area-left)] pr-[var(--safe-area-right)] transition-[padding] duration-150">
            <footer className="h-11 sm:h-12 px-3 sm:px-4 flex items-center justify-center text-xs">
              {currentItem ? (
                isMobile ? (
                  /* APK / Mobile status layout: name shifted to bottom in fixed width area, no duplicate ratio, clean monospace */
                  <div className="flex items-center gap-1.5 sm:gap-2 font-mono text-[11px] sm:text-xs text-text-muted truncate max-w-full">
                    {/* Fixed area for image name so it doesn't mess with anything else */}
                    <span
                      className="font-medium text-text-main truncate max-w-[90px] xs:max-w-[130px] sm:max-w-[160px] shrink-0"
                      title={currentItem.name}
                    >
                      {currentItem.name}
                    </span>
                    <span className="text-surface-border shrink-0">|</span>
                    <span className="font-semibold text-text-main shrink-0">{currentFormat}</span>
                    <span className="text-surface-border shrink-0">|</span>
                    {/* Plain dimensions only (e.g. 100 × 1200), ratio description removed */}
                    <span className="text-text-main shrink-0">
                      {currentDims ? `${currentDims.width} × ${currentDims.height}` : '—'}
                    </span>
                    {currentItem.size ? (
                      <>
                        <span className="text-surface-border shrink-0">|</span>
                        <span className="shrink-0">{formatBytes(currentItem.size)}</span>
                      </>
                    ) : null}
                    {items.length > 1 && (
                      <>
                        <span className="text-surface-border shrink-0">|</span>
                        <span className="text-text-muted font-sans font-medium shrink-0">{currentIndex + 1} / {items.length}</span>
                      </>
                    )}
                  </div>
                ) : (
                  /* Desktop / EXE layout: exactly preserved */
                  <div className="flex items-center gap-2 sm:gap-3 font-mono text-[11px] sm:text-xs text-text-muted truncate">
                    <span className="font-semibold text-text-main">{currentFormat}</span>
                    <span className="text-surface-border">|</span>
                    <span className="text-text-main">
                      {currentDims ? `${currentDims.width} × ${currentDims.height}${aspectRatioStr ? ` (${aspectRatioStr})` : ''}` : '—'}
                    </span>
                    {currentItem.size ? (
                      <>
                        <span className="text-surface-border">|</span>
                        <span>{formatBytes(currentItem.size)}</span>
                      </>
                    ) : null}
                    {items.length > 1 && (
                      <>
                        <span className="text-surface-border">|</span>
                        <span className="text-text-muted font-sans font-medium">{currentIndex + 1} / {items.length}</span>
                      </>
                    )}
                  </div>
                )
              ) : null}
            </footer>
          </div>
        </div>
      ) : (
        /* ─────────────────────────────────────────────────────────────
            GRID OVERVIEW MODE
        ───────────────────────────────────────────────────────────── */
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-[calc(1.5rem+var(--safe-area-bottom))] pl-[max(1rem,var(--safe-area-left))] pr-[max(1rem,var(--safe-area-right))] bg-surface-bg">
          <div className="max-w-7xl mx-auto space-y-4">
            {/* Header info & action bar */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-surface-border">
              <div>
                <h2 className="text-sm sm:text-base font-semibold text-text-main">All Images</h2>
                <p className="text-xs text-text-muted">
                  {items.length} {items.length === 1 ? 'image' : 'images'} •{' '}
                  {formatBytes(items.reduce((acc, it) => acc + (it.size || 0), 0))} total • Right-click any photo for options
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => addFileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-panel border border-surface-border text-text-main hover:bg-surface-subtle hover:border-accent hover:text-accent transition-colors cursor-pointer shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5 text-accent" />
                  <span>Add Photos</span>
                </button>

                {items.length > 0 && onConvertImagesToPdf && (
                  <button
                    type="button"
                    onClick={() => {
                      const readyItems = items
                        .filter((it) => Boolean(it.blob))
                        .map((it) => ({ blob: it.blob as Blob, name: it.name }));
                      if (readyItems.length > 0) {
                        onConvertImagesToPdf(readyItems);
                      }
                    }}
                    className="min-h-[44px] flex items-center gap-1.5 px-3.5 rounded-control text-xs font-semibold bg-accent hover:bg-accent-hover text-accent-contrast transition-colors cursor-pointer"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                    <span>Merge to PDF</span>
                  </button>
                )}
              </div>
            </div>

            {/* Grid of Image Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5">
              {items.map((item, idx) => {
                const dims = dimensionsMap[item.id] || item.dimensions;
                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      setCurrentIndex(idx);
                      setViewMode('stage');
                    }}
                    onContextMenu={(e) => handleContextMenu(e, item)}
                    className="paper-sheet group relative aspect-square overflow-hidden cursor-pointer transition-colors"
                  >
                    <img
                      src={item.url}
                      alt={item.name}
                      onLoad={(e) => handleImageLoad(item.id, e)}
                      className="w-full h-full object-cover"
                    />

                    {/* Card Overlay with dynamic theme support */}
                    <div className="absolute inset-0 flex flex-col justify-between p-2 pointer-events-none">
                      <div className="flex justify-between items-start pointer-events-auto">
                        <span className="px-2 py-0.5 rounded-chip bg-surface-panel text-xs font-mono text-text-muted border border-surface-border shadow-xs">
                          #{idx + 1}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteItem(item);
                          }}
                          className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-control bg-surface-panel hover:bg-status-error hover:text-white text-text-muted transition-colors cursor-pointer border border-surface-border shadow-xs opacity-0 group-hover:opacity-100"
                          title="Remove image"
                          aria-label={`Remove ${item.name}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="bg-surface-panel rounded-control p-2 border border-surface-border shadow-xs text-text-main pointer-events-auto">
                        <p className="text-xs font-mono font-semibold text-text-main truncate" title={item.name}>
                          {item.name}
                        </p>
                        <div className="flex items-center justify-between text-xs font-mono text-text-muted mt-0.5">
                          <span>{item.size ? formatBytes(item.size) : ''}</span>
                          <span>{dims ? `${dims.width}×${dims.height}` : ''}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Add card in grid */}
              <button
                type="button"
                onClick={() => addFileInputRef.current?.click()}
                className="aspect-square rounded-sheet border border-surface-border hover:border-surface-border-strong bg-surface-panel hover:bg-surface-hover flex flex-col items-center justify-center gap-2 p-4 text-text-muted hover:text-text-main cursor-pointer transition-colors"
              >
                <Plus className="w-5 h-5" />
                <span className="text-xs font-semibold text-center">Choose files</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          CUSTOM RIGHT-CLICK CONTEXT MENU ON IMAGE
      ───────────────────────────────────────────────────────────── */}
      {contextMenu.isOpen && contextMenu.item && (
        <div
          style={{
            position: 'fixed',
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            zIndex: 100,
          }}
          className="w-56 rounded-sheet border border-surface-border bg-surface-panel shadow-lifted p-1.5 text-xs text-text-main select-none space-y-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header with image name */}
          <div className="px-3 py-1.5 border-b border-surface-border mb-1">
            <p className="font-semibold text-text-main truncate text-[11px]" title={contextMenu.item.name}>
              {contextMenu.item.name}
            </p>
            <p className="text-[10px] text-text-muted font-mono">
              {contextMenu.item.size ? formatBytes(contextMenu.item.size) : ''}
            </p>
          </div>

          {/* Resize with Paperweight */}
          {onResizeImage && (
            <button
              type="button"
              onClick={() => {
                if (contextMenu.item?.blob) {
                  onResizeImage(contextMenu.item.blob, contextMenu.item.name);
                }
                setContextMenu((prev) => ({ ...prev, isOpen: false }));
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-subtle hover:text-accent transition-colors cursor-pointer"
            >
              <Crop className="w-4 h-4 text-accent" />
              <span className="font-medium">Resize with Paperweight</span>
            </button>
          )}

          {/* Compress with Paperweight */}
          {onCompressImage && (
            <button
              type="button"
              onClick={() => {
                if (contextMenu.item?.blob) {
                  onCompressImage(contextMenu.item.blob, contextMenu.item.name);
                }
                setContextMenu((prev) => ({ ...prev, isOpen: false }));
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-subtle hover:text-accent transition-colors cursor-pointer"
            >
              <Minimize2 className="w-4 h-4 text-accent" />
              <span className="font-medium">Compress with Paperweight</span>
            </button>
          )}

          <div className="h-px bg-surface-border my-1 mx-1" />

          {/* Rotate Clockwise */}
          <button
            type="button"
            onClick={() => {
              handleRotate();
              setContextMenu((prev) => ({ ...prev, isOpen: false }));
            }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-surface-subtle hover:text-accent transition-colors cursor-pointer"
          >
            <RotateCw className="w-4 h-4 text-text-muted" />
            <span>Rotate Clockwise</span>
          </button>

          {/* Flip Horizontally */}
          <button
            type="button"
            onClick={() => {
              handleFlipH();
              setContextMenu((prev) => ({ ...prev, isOpen: false }));
            }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-surface-subtle hover:text-accent transition-colors cursor-pointer"
          >
            <FlipHorizontal className="w-4 h-4 text-text-muted" />
            <span>Flip Horizontally</span>
          </button>

          {/* Fit to Screen */}
          <button
            type="button"
            onClick={() => {
              handleFit();
              setContextMenu((prev) => ({ ...prev, isOpen: false }));
            }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-surface-subtle hover:text-accent transition-colors cursor-pointer"
          >
            <Maximize className="w-4 h-4 text-text-muted" />
            <span>Fit to Window</span>
          </button>

          <div className="h-px bg-surface-border my-1 mx-1" />

          {/* Copy Image */}
          <button
            type="button"
            onClick={() => handleCopyImage(contextMenu.item)}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-surface-subtle hover:text-accent transition-colors cursor-pointer"
          >
            <Copy className="w-4 h-4 text-text-muted" />
            <span>Copy Image</span>
          </button>

          {/* Download Image */}
          <button
            type="button"
            onClick={() => {
              handleDownloadCurrent(contextMenu.item);
              setContextMenu((prev) => ({ ...prev, isOpen: false }));
            }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-surface-subtle hover:text-accent transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4 text-text-muted" />
            <span>Save Image As...</span>
          </button>

          <div className="h-px bg-surface-border my-1 mx-1" />

          {/* Delete Image */}
          <button
            type="button"
            onClick={() => handleDeleteItem(contextMenu.item)}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-status-error-bg text-status-error transition-colors cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span>Delete</span>
          </button>
        </div>
      )}
    </div>
  );
};
