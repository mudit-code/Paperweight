import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize2,
  Minimize2,
  Grid,
  FileImage,
  Download,
  Plus,
  Trash2,
  Crop,
  ArrowRightLeft,
  FlipHorizontal,
  Copy,
  Maximize,
  Image as ImageIcon,
  Check,
} from 'lucide-react';
import { formatBytes } from '../../core/files/validation';
import { downloadBlob } from '../../core/processors/download';
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
  const [showFilmstrip, setShowFilmstrip] = useState<boolean>(true);

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

  // Dimensions cache
  const [dimensionsMap, setDimensionsMap] = useState<Record<string, { width: number; height: number }>>({});

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

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
  const filmstripRef = useRef<HTMLDivElement>(null);
  const stageContainerRef = useRef<HTMLDivElement>(null);

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

  // Smooth touch swipe carousel + pinch-to-zoom + double-tap + zoomed pan for Android/Mobile
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
    let pinchStartDist = 0;
    let pinchStartScale = 1.0;
    let lastTapTime = 0;
    let lastTapPos = { x: 0, y: 0 };
    let movedSinceStart = false;

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

    const onTouchStart = (e: TouchEvent) => {
      flushPendingSwipe();
      setIsTouchActive(true);
      movedSinceStart = false;

      if (e.touches.length >= 2) {
        if (e.cancelable) e.preventDefault();
        gestureLock = 'pinch';
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        pinchStartDist = Math.max(10, Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY));
        pinchStartScale = scaleRef.current;
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
        gestureLock = scaleRef.current > 1.05 ? 'pan' : 'none';
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        if (e.cancelable) e.preventDefault();
        gestureLock = 'pinch';
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const nextScale = Math.max(0.5, Math.min(6.0, Number((pinchStartScale * (dist / pinchStartDist)).toFixed(3))));
        setScale(nextScale);
        if (nextScale <= 1.05) {
          setPan({ x: 0, y: 0 });
        }
        return;
      }

      if (e.touches.length !== 1 || gestureLock === 'pinch') return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (Math.hypot(dx, dy) > 6) {
        movedSinceStart = true;
      }

      if (gestureLock === 'pan' || scaleRef.current > 1.05) {
        if (e.cancelable) e.preventDefault();
        gestureLock = 'pan';
        setPan({
          x: startPan.x + dx,
          y: startPan.y + dy,
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

      if (gestureLock === 'swipe') {
        gestureLock = 'none';
        const curIdx = currentIndexRef.current;
        const len = itemsLengthRef.current;
        const offset = swipeOffsetXRef.current;
        const stageW = el.clientWidth || window.innerWidth || 360;
        const stride = stageW + 16;
        const threshold = Math.min(95, stageW * 0.2);

        const goNext = curIdx < len - 1 && (offset < -threshold || velocityX < -0.32);
        const goPrev = curIdx > 0 && (offset > threshold || velocityX > 0.32);

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
          }, 220);
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
          }, 220);
        } else {
          pendingSwipeTargetRef.current = null;
          setSwipeTransitioning(true);
          setSwipeOffsetX(0);
          swipeCommitTimerRef.current = setTimeout(() => {
            swipeCommitTimerRef.current = null;
            setSwipeTransitioning(false);
          }, 200);
        }
        return;
      }

      // Single-finger quick double-tap to zoom / fit
      if (!movedSinceStart && gestureLock !== 'pinch') {
        const now = performance.now();
        const t = e.changedTouches[0];
        if (t && now - lastTapTime < 300 && Math.hypot(t.clientX - lastTapPos.x, t.clientY - lastTapPos.y) < 40) {
          lastTapTime = 0;
          if (scaleRef.current > 1.05) {
            setScale(1.0);
            setPan({ x: 0, y: 0 });
          } else {
            setScale(2.5);
          }
        } else if (t) {
          lastTapTime = now;
          lastTapPos = { x: t.clientX, y: t.clientY };
        }
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

  // Scroll active thumbnail into view in filmstrip
  useEffect(() => {
    if (viewMode === 'stage' && filmstripRef.current) {
      const activeEl = filmstripRef.current.querySelector(`[data-index="${currentIndex}"]`) as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [currentIndex, viewMode, showFilmstrip]);

  // Navigation handlers
  const handlePrev = useCallback(() => {
    if (items.length <= 1) return;
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
  }, [items.length]);

  const handleNext = useCallback(() => {
    if (items.length <= 1) return;
    setCurrentIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
  }, [items.length]);

  // Zoom handlers (clamped 0.25x to 8.0x)
  const handleZoomIn = () => setScale((s) => Math.min(Number((s * 1.25).toFixed(2)), 8.0));
  const handleZoomOut = () => setScale((s) => Math.max(Number((s / 1.25).toFixed(2)), 0.25));
  const handleFit = () => resetTransform();
  const handleActualSize = () => {
    setScale(1.0);
    setPan({ x: 0, y: 0 });
  };

  // Rotation & Flip
  const handleRotate = () => setRotation((r) => (r + 90) % 360);
  const handleFlipH = () => setIsFlippedH((f) => !f);

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      setScale((s) => Math.min(Number((s * 1.15).toFixed(2)), 8.0));
    } else {
      setScale((s) => Math.max(Number((s / 1.15).toFixed(2)), 0.25));
    }
  };

  // Drag to pan when zoomed
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only primary mouse button
    if (scale <= 1.0) return;
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...pan };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({
      x: panStartRef.current.x + dx,
      y: panStartRef.current.y + dy,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Double click toggles between fit and 2x zoom
  const handleDoubleClick = () => {
    if (scale > 1.05) {
      resetTransform();
    } else {
      setScale(2.0);
    }
  };

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

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

  return (
    <div
      role="dialog"
      aria-label="Image Gallery Viewer"
      className="fixed inset-0 z-50 flex flex-col select-none overflow-hidden animate-in fade-in duration-150 bg-surface-bg text-text-main"
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
      <div className="shrink-0 w-full bg-surface-panel border-b border-surface-border text-text-main z-30 select-none shadow-xs pt-[var(--safe-area-top)] pl-[var(--safe-area-left)] pr-[var(--safe-area-right)] transition-[padding] duration-150">
        <header className="h-12 sm:h-13 px-3 sm:px-4 flex items-center justify-between">
        {/* Left Side: Actions (Compress, Resize, Rotate, Delete, Info) */}
        <div className="flex items-center gap-1 sm:gap-1.5 min-w-0">
          {/* Compress with Paperweight (Replaces Edit icon) */}
          {currentItem && onCompressImage && (
            <button
              type="button"
              onClick={() => {
                if (currentItem.blob) {
                  onCompressImage(currentItem.blob, currentItem.name);
                }
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-surface-panel border border-surface-border text-text-main hover:border-accent hover:text-accent hover:bg-surface-subtle transition-all cursor-pointer shadow-2xs"
              title="Compress image with Paperweight"
            >
              <Minimize2 className="w-3.5 h-3.5 text-accent" />
              <span className="hidden sm:inline font-semibold">Compress</span>
            </button>
          )}

          {/* Resize with Paperweight (Replaces Edit icon) */}
          {currentItem && onResizeImage && (
            <button
              type="button"
              onClick={() => {
                if (currentItem.blob) {
                  onResizeImage(currentItem.blob, currentItem.name);
                }
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-surface-panel border border-surface-border text-text-main hover:border-accent hover:text-accent hover:bg-surface-subtle transition-all cursor-pointer shadow-2xs"
              title="Resize image with Paperweight"
            >
              <Crop className="w-3.5 h-3.5 text-accent" />
              <span className="hidden sm:inline font-semibold">Resize</span>
            </button>
          )}

          <div className="w-px h-4.5 bg-surface-border mx-1 hidden sm:block" />

          {/* Rotate Button */}
          {currentItem && (
            <button
              type="button"
              onClick={handleRotate}
              className="p-1.5 sm:p-2 rounded-md text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer"
              title="Rotate 90° clockwise (R)"
              aria-label="Rotate image"
            >
              <RotateCw className="w-4 h-4" />
            </button>
          )}

          {/* Delete Button */}
          {currentItem && (
            <button
              type="button"
              onClick={() => handleDeleteItem()}
              className="p-1.5 sm:p-2 rounded-md text-text-muted hover:text-status-error hover:bg-surface-subtle transition-colors cursor-pointer"
              title="Delete from gallery (Del)"
              aria-label="Delete image"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          {/* Merge to PDF (if available) */}
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
              className="hidden md:flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-surface-panel border border-surface-border text-text-main hover:border-accent hover:text-accent hover:bg-surface-subtle transition-all cursor-pointer"
              title="Merge all gallery images to PDF"
            >
              <ArrowRightLeft className="w-3.5 h-3.5 text-accent" />
              <span>To PDF</span>
            </button>
          )}
        </div>

        {/* Center: Image Name & Counter */}
        <div className="flex items-center gap-2 max-w-[30%] sm:max-w-[45%] truncate text-center">
          <span
            className="text-xs sm:text-sm font-semibold text-text-main truncate"
            title={currentItem?.name || 'Image Gallery'}
          >
            {currentItem?.name || 'Image Gallery'}
          </span>
          {items.length > 1 && (
            <span className="hidden sm:inline-block text-[11px] font-mono text-text-muted shrink-0">
              ({currentIndex + 1} of {items.length})
            </span>
          )}
        </div>

        {/* Right Side: View Mode, Add Photos, Download, Fullscreen, Close */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          {/* Add Photos Button */}
          <button
            type="button"
            onClick={() => addFileInputRef.current?.click()}
            className="p-1.5 sm:p-2 rounded-md text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer"
            title="Add more photos"
            aria-label="Add photos"
          >
            <Plus className="w-4 h-4" />
          </button>

          {/* Grid Overview Toggle */}
          <button
            type="button"
            onClick={() => setViewMode((m) => (m === 'stage' ? 'grid' : 'stage'))}
            className={`p-1.5 sm:p-2 rounded-md transition-colors cursor-pointer ${
              viewMode === 'grid'
                ? 'bg-surface-subtle border border-accent text-accent font-semibold shadow-2xs'
                : 'text-text-muted hover:text-text-main hover:bg-surface-subtle'
            }`}
            title={viewMode === 'stage' ? 'Grid Overview (G)' : 'Back to Single View (G)'}
            aria-label="Toggle grid overview"
          >
            <Grid className="w-4 h-4" />
          </button>

          {/* Download / Save Image */}
          {currentItem && (
            <button
              type="button"
              onClick={() => handleDownloadCurrent()}
              className="p-1.5 sm:p-2 rounded-md text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer"
              title="Save image copy (Download)"
              aria-label="Download image"
            >
              <Download className="w-4 h-4" />
            </button>
          )}

          {/* Fullscreen Button */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="hidden sm:inline-flex p-1.5 sm:p-2 rounded-md text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer"
            title={isFullscreen ? 'Exit Fullscreen (F)' : 'Toggle Fullscreen (F)'}
            aria-label="Fullscreen"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          <div className="w-px h-4.5 bg-surface-border mx-1" />

          {/* Close Window (X) */}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 sm:p-2 rounded-md text-text-muted hover:text-status-error hover:bg-surface-subtle transition-colors cursor-pointer"
            title="Close Gallery (Esc)"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
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
            className={`flex-1 relative flex items-center justify-center overflow-hidden select-none bg-surface-subtle/35 ${
              scale > 1.05 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
            }`}
          >
            {currentItem ? (() => {
              const stageW = stageContainerRef.current?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 360);
              const slideStride = stageW + 16;
              const showNeighbors = items.length > 1 && (Math.abs(swipeOffsetX) > 0.5 || swipeTransitioning);
              const prevItem = currentIndex > 0 ? items[currentIndex - 1] : null;
              const nextItem = currentIndex < items.length - 1 ? items[currentIndex + 1] : null;

              return (
                <div
                  style={{
                    transform: `translate3d(${swipeOffsetX}px, 0, 0)`,
                    transition: swipeTransitioning ? 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
                    willChange: showNeighbors ? 'transform' : 'auto',
                  }}
                  className="w-full h-full relative flex items-center justify-center"
                >
                  {/* Previous Slide */}
                  {showNeighbors && prevItem && (
                    <div
                      style={{ transform: `translate3d(-${slideStride}px, 0, 0)` }}
                      className="absolute inset-0 flex items-center justify-center pointer-events-none"
                    >
                      <img
                        src={prevItem.url}
                        alt={prevItem.name}
                        draggable={false}
                        className="max-h-[75vh] max-w-[88vw] object-contain shadow-2xl rounded-none pointer-events-none select-none"
                      />
                    </div>
                  )}

                  {/* Active Slide */}
                  <div
                    style={{
                      transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale}) rotate(${rotation}deg) scaleX(${isFlippedH ? -1 : 1})`,
                      transition: isDragging || isTouchActive ? 'none' : 'transform 140ms cubic-bezier(0.22, 1, 0.36, 1)',
                    }}
                    className="max-w-[94%] max-h-[88%] flex items-center justify-center"
                  >
                    <img
                      src={currentItem.url}
                      alt={currentItem.name}
                      onLoad={(e) => handleImageLoad(currentItem.id, e)}
                      draggable={false}
                      className="max-h-[75vh] max-w-[88vw] object-contain shadow-2xl rounded-none pointer-events-none select-none transition-shadow"
                    />
                  </div>

                  {/* Next Slide */}
                  {showNeighbors && nextItem && (
                    <div
                      style={{ transform: `translate3d(${slideStride}px, 0, 0)` }}
                      className="absolute inset-0 flex items-center justify-center pointer-events-none"
                    >
                      <img
                        src={nextItem.url}
                        alt={nextItem.name}
                        draggable={false}
                        className="max-h-[75vh] max-w-[88vw] object-contain shadow-2xl rounded-none pointer-events-none select-none"
                      />
                    </div>
                  )}
                </div>
              );
            })() : (
              /* Solid, elegant Empty State (No images) */
              <div className="flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 border border-surface-border bg-surface-panel shadow-xs">
                  <FileImage className="w-8 h-8 text-text-muted" />
                </div>
                <h3 className="text-base font-semibold text-text-main mb-1">No Images in Gallery</h3>
                <p className="text-xs text-text-muted mb-5 leading-relaxed">
                  Open an image with Paperweight, drag and drop photos here, or click below to browse files.
                </p>
                <button
                  type="button"
                  onClick={() => addFileInputRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-accent text-white hover:bg-accent-hover shadow-sm transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Images</span>
                </button>
              </div>
            )}

            {/* Floating Left Navigation Arrow (Desktop) */}
            {items.length > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePrev();
                }}
                className="hidden sm:flex absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-surface-panel/85 hover:bg-surface-panel border border-surface-border text-text-main hover:text-accent items-center justify-center backdrop-blur-md shadow-lg transition-all hover:scale-105 active:scale-95 cursor-pointer z-20"
                aria-label="Previous Image"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}

            {/* Floating Right Navigation Arrow (Desktop) */}
            {items.length > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleNext();
                }}
                className="hidden sm:flex absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-surface-panel/85 hover:bg-surface-panel border border-surface-border text-text-main hover:text-accent items-center justify-center backdrop-blur-md shadow-lg transition-all hover:scale-105 active:scale-95 cursor-pointer z-20"
                aria-label="Next Image"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}

            {/* Feedback Toast for Copy to Clipboard */}
            {copiedSuccess && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-full bg-surface-panel border border-surface-border shadow-xl flex items-center gap-2 text-xs font-semibold text-status-offline z-30 animate-in fade-in">
                <Check className="w-4 h-4" />
                <span>Image copied to clipboard</span>
              </div>
            )}
          </div>

          {/* ─────────────────────────────────────────────────────────────
              BOTTOM FILMSTRIP CAROUSEL (Optional Ribbon)
          ───────────────────────────────────────────────────────────── */}
          {showFilmstrip && items.length > 1 && (
            <div className="h-16 shrink-0 px-4 pl-[max(1rem,var(--safe-area-left))] pr-[max(1rem,var(--safe-area-right))] flex items-center justify-between gap-3 z-20 select-none overflow-hidden bg-surface-panel border-t border-surface-border">
              <div
                ref={filmstripRef}
                className="flex-1 flex items-center gap-2 overflow-x-auto py-1 no-scrollbar"
              >
                {items.map((item, idx) => {
                  const isActive = idx === currentIndex;
                  return (
                    <button
                      key={item.id}
                      data-index={idx}
                      type="button"
                      onClick={() => setCurrentIndex(idx)}
                      onContextMenu={(e) => handleContextMenu(e, item)}
                      className={`relative shrink-0 h-12 aspect-square rounded-none overflow-hidden border transition-all cursor-pointer group ${
                        isActive
                          ? 'border-accent ring-2 ring-accent/60 scale-105 shadow-md z-10'
                          : 'border-surface-border opacity-70 hover:opacity-100 hover:border-accent/50 bg-surface-subtle'
                      }`}
                    >
                      <img
                        src={item.url}
                        alt={item.name}
                        className="w-full h-full object-cover rounded-none"
                      />
                      <span className="absolute bottom-0.5 right-0.5 px-1 rounded bg-surface-panel/90 text-[9px] font-mono text-text-main border border-surface-border/50">
                        {idx + 1}
                      </span>
                    </button>
                  );
                })}

                {/* Add Images Button in Ribbon */}
                <button
                  type="button"
                  onClick={() => addFileInputRef.current?.click()}
                  className="shrink-0 h-12 aspect-square rounded-md border border-dashed border-surface-border hover:border-accent bg-surface-subtle/30 text-text-muted hover:text-accent flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer"
                  title="Add more images"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="text-[9px] font-semibold">Add</span>
                </button>
              </div>
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────────
              BOTTOM STATUS & CONTROL BAR (with Android Safe-Area Bottom)
          ───────────────────────────────────────────────────────────── */}
          <div className="shrink-0 w-full bg-surface-panel border-t border-surface-border text-text-muted z-30 select-none pb-[var(--safe-area-bottom)] pl-[var(--safe-area-left)] pr-[var(--safe-area-right)]">
            <footer className="h-10 sm:h-11 px-3 sm:px-4 flex items-center justify-between text-xs">
            {/* Left: Filmstrip toggle & File Metadata badge */}
            <div className="flex items-center gap-2.5 min-w-0">
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => setShowFilmstrip((s) => !s)}
                  className={`p-1 rounded text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer ${
                    showFilmstrip ? 'text-accent' : ''
                  }`}
                  title={showFilmstrip ? 'Hide filmstrip' : 'Show filmstrip'}
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                </button>
              )}

              {currentItem && (
                <div className="flex items-center gap-2 font-mono text-[11px] text-text-muted truncate">
                  <span className="font-semibold text-text-main">{currentFormat}</span>
                  <span className="text-surface-border">|</span>
                  <span>
                    {currentDims ? `${currentDims.width} × ${currentDims.height}` : '—'}
                  </span>
                  {currentItem.size ? (
                    <>
                      <span className="text-surface-border">|</span>
                      <span>{formatBytes(currentItem.size)}</span>
                    </>
                  ) : null}
                </div>
              )}
            </div>

            {/* Center: Stage quick tools (Rotate, Fit/1:1) */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleRotate}
                className="p-1 sm:p-1.5 rounded text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer"
                title="Rotate (R)"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleFit}
                className="p-1 sm:p-1.5 rounded text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer"
                title="Fit to screen (0)"
              >
                <Maximize className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleFlipH}
                className="p-1 sm:p-1.5 rounded text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer"
                title="Flip horizontally"
              >
                <FlipHorizontal className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Right: Zoom controls with percentage and slider */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleZoomOut}
                className="p-1 rounded text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer"
                title="Zoom out (-)"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={handleFit}
                className="text-[11px] font-mono text-text-muted hover:text-text-main hover:bg-surface-subtle px-1 py-0.5 rounded cursor-pointer min-w-[40px] text-center"
                title="Reset zoom to 100% (1)"
              >
                {Math.round(scale * 100)}%
              </button>

              <button
                type="button"
                onClick={handleZoomIn}
                className="p-1 rounded text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer"
                title="Zoom in (+)"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>

              {/* Slider for smooth zoom level control */}
              <input
                type="range"
                min="25"
                max="600"
                step="5"
                value={Math.round(scale * 100)}
                onChange={(e) => setScale(Number(e.target.value) / 100)}
                aria-label="Zoom Level"
                className="w-16 sm:w-24 h-1 accent-accent bg-surface-subtle rounded-lg cursor-pointer hidden xs:inline-block"
              />

              <button
                type="button"
                onClick={toggleFullscreen}
                className="p-1 rounded text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer"
                title="Fullscreen (F)"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
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
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent hover:bg-accent-hover text-white shadow-xs transition-colors cursor-pointer"
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
                    className="group relative aspect-square rounded-none overflow-hidden border border-surface-border hover:border-accent bg-surface-panel cursor-pointer shadow-xs hover:shadow-md transition-all hover:scale-[1.02]"
                  >
                    <img
                      src={item.url}
                      alt={item.name}
                      onLoad={(e) => handleImageLoad(item.id, e)}
                      className="w-full h-full object-cover rounded-none transition-transform duration-300 group-hover:scale-105"
                    />

                    {/* Card Overlay with dynamic theme support */}
                    <div className="absolute inset-0 flex flex-col justify-between p-2 pointer-events-none">
                      <div className="flex justify-between items-start pointer-events-auto">
                        <span className="px-1.5 py-0.5 rounded bg-surface-panel/90 backdrop-blur-xs text-[10px] font-mono text-text-muted border border-surface-border/60 shadow-xs">
                          #{idx + 1}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteItem(item);
                          }}
                          className="p-1 rounded bg-surface-panel/90 hover:bg-status-error hover:text-white text-text-muted transition-colors cursor-pointer border border-surface-border/60 shadow-xs opacity-0 group-hover:opacity-100"
                          title="Remove image"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="bg-surface-panel/95 backdrop-blur-xs rounded-lg p-2 border border-surface-border/70 shadow-xs text-text-main pointer-events-auto">
                        <p className="text-xs font-semibold text-text-main truncate" title={item.name}>
                          {item.name}
                        </p>
                        <div className="flex items-center justify-between text-[10px] font-mono text-text-muted mt-0.5">
                          <span>{item.size ? formatBytes(item.size) : ''}</span>
                          <span>{dims ? `${dims.width}×${dims.height}` : ''}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Add card in grid */}
              <div
                onClick={() => addFileInputRef.current?.click()}
                className="aspect-square rounded-xl border-2 border-dashed border-surface-border hover:border-accent bg-surface-subtle/30 hover:bg-surface-subtle/60 flex flex-col items-center justify-center gap-2 p-4 text-text-muted hover:text-accent cursor-pointer transition-all"
              >
                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-panel border border-surface-border text-accent shadow-xs">
                  <Plus className="w-5 h-5" />
                </div>
                <span className="text-xs font-semibold text-center">Add Photos</span>
              </div>
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
          className="w-56 rounded-xl border border-surface-border bg-surface-panel shadow-panel py-1.5 text-xs text-text-main select-none animate-in fade-in zoom-in-95 duration-100"
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
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-status-error/15 text-status-error transition-colors cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span>Delete</span>
          </button>
        </div>
      )}
    </div>
  );
};
