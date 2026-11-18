import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Crop as CropIcon,
  RotateCw,
  RotateCcw,
  Sparkles,
  Sliders,
  Eraser,
  Layers,
  Maximize2,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Pipette,
  Camera,
  FileDown,
  Edit2,
  Undo2,
  Redo2,
  Check,
  FolderPlus,
  Loader2,
  Plus,
  Minus,
} from 'lucide-react';
import { isMobileApp } from '../../core/processors/download';
import {
  type DocumentFilterType,
  type PageFormatType,
  type ImageAdjustments,
  applyFilterToImageData,
  formatPageSize,
  loadImage,
  rotateImage,
} from './document-filters';
import { cropPerspectiveQuad, type QuadCorners } from './perspective-crop';
import {
  saveScan,
  getAllScans,
  generateUniqueScanTitle,
  type StoredScanDoc,
} from './scans-db';
import type { CapturedScanItem } from './CameraViewfinder';
import { convertFilesToImagePages } from './convert-pdf-pages';
import { PDFDocument } from 'pdf-lib';
import { downloadBlob } from '../../core/processors';

/**
 * Extracts a clean document title from a filename (removing extension, page suffixes, and ignoring generic names).
 */
export function formatDocTitleFromFilename(fileName?: string): string {
  if (!fileName) return '';
  const baseOnly = fileName.split(/[/\\]/).pop() || fileName;
  let base = baseOnly.replace(/\.[^/.]+$/, '');
  base = base.replace(/[-_]p(?:age)?\d+$/i, '');
  if (!base || /^(scan|scan_raw|raw_capture|blob|image|photo)([-_]\d+)?$/i.test(base)) {
    return '';
  }
  return base.trim();
}

export interface EditablePage {
  id: string;
  file?: File;
  originalUrl: string; // Full raw uncropped photo from camera (never modified)
  croppedUrl?: string; // Base perspective-cropped document
  displayUrl: string; // Enhanced, rotated preview & export document
  rotation: number;
  filter: DocumentFilterType;
  adjustments: ImageAdjustments;
  format: PageFormatType;
  cropCorners?: QuadCorners;
}

export interface HistorySnapshot {
  pages: EditablePage[];
  activeIndex: number;
}

export interface DocumentEditorModalProps {
  isOpen: boolean;
  pages?: File[];
  scanItems?: CapturedScanItem[];
  initialScan?: StoredScanDoc | null;
  onClose: () => void;
  onKeepScanning: () => void;
  onRetakePage: (pageIndex: number) => void;
  onSavePdf: (pdfBlob: Blob, filename: string) => void;
  onScanSaved?: (scan: StoredScanDoc) => void;
}

export type ActiveToolMode =
  | 'none'
  | 'crop'
  | 'filters'
  | 'adjust'
  | 'cleanup'
  | 'reorder'
  | 'resize';

export const DocumentEditorModal: React.FC<DocumentEditorModalProps> = ({
  isOpen,
  pages: initialPages,
  scanItems,
  initialScan,
  onClose,
  onKeepScanning,
  onRetakePage,
  onSavePdf,
  onScanSaved,
}) => {
  const [docName, setDocName] = useState(() => {
    if (initialScan) return initialScan.title;
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    return `Paperweight Scan ${dateStr}`;
  });
  const [isEditingName, setIsEditingName] = useState(false);
  const isMobile = isMobileApp();

  // Editable pages state
  const [pages, setPages] = useState<EditablePage[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const pagesLengthRef = useRef(pages.length);
  pagesLengthRef.current = pages.length;
  const lastTouchTimeRef = useRef<number>(0);

  // Master safeguard: clamp activeIndex to valid page bounds [0, pages.length - 1] whenever pages changes
  useEffect(() => {
    if (pages.length > 0 && activeIndex >= pages.length) {
      setActiveIndex(Math.max(0, pages.length - 1));
    }
  }, [pages.length, activeIndex]);

  const [activeTool, setActiveTool] = useState<ActiveToolMode>('none');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRotating, setIsRotating] = useState(false);

  // Undo / Redo Document History (Requirement 2)
  const historyRef = useRef<HistorySnapshot[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const [canUndo, setCanUndo] = useState<boolean>(false);
  const [canRedo, setCanRedo] = useState<boolean>(false);

  const updateUndoRedoAvailability = useCallback(() => {
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }, []);

  const pushHistory = useCallback(
    (newPages: EditablePage[], newActiveIndex?: number) => {
      const targetIdx = newActiveIndex !== undefined ? newActiveIndex : activeIndex;
      const nextIdx = historyIndexRef.current + 1;
      const snapshot: HistorySnapshot = {
        pages: newPages.map((p) => ({ ...p })),
        activeIndex: targetIdx,
      };
      historyRef.current = [...historyRef.current.slice(0, nextIdx), snapshot];
      historyIndexRef.current = nextIdx;
      setCanUndo(nextIdx > 0);
      setCanRedo(false);
    },
    [activeIndex]
  );

  const handleUndo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const snapshot = historyRef.current[historyIndexRef.current];
    setPages(snapshot.pages.map((p) => ({ ...p })));
    setActiveIndex(Math.min(snapshot.activeIndex, snapshot.pages.length - 1));
    updateUndoRedoAvailability();
  }, [updateUndoRedoAvailability]);

  const handleRedo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const snapshot = historyRef.current[historyIndexRef.current];
    setPages(snapshot.pages.map((p) => ({ ...p })));
    setActiveIndex(Math.min(snapshot.activeIndex, snapshot.pages.length - 1));
    updateUndoRedoAvailability();
  }, [updateUndoRedoAvailability]);

  // Desktop direct file import / replace refs and handlers
  const desktopAddFilesInputRef = useRef<HTMLInputElement>(null);
  const desktopReplaceInputRef = useRef<HTMLInputElement>(null);

  const handleTriggerAddFiles = () => {
    if (isMobile) {
      onKeepScanning();
    } else {
      desktopAddFilesInputRef.current?.click();
    }
  };

  const handleTriggerReplace = () => {
    if (isMobile) {
      onRetakePage(activeIndex);
    } else {
      desktopReplaceInputRef.current?.click();
    }
  };

  const handleDesktopAddFilesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selected = Array.from(e.target.files);
      const converted = await convertFilesToImagePages(selected);
      if (converted.length === 0) return;

      const newItems: EditablePage[] = converted.map((file, idx) => {
        const url = URL.createObjectURL(file);
        return {
          id: `page_${Date.now()}_${pages.length + idx}`,
          file,
          originalUrl: url,
          croppedUrl: url,
          displayUrl: url,
          rotation: 0,
          filter: 'original',
          adjustments: { brightness: 0, contrast: 0 },
          format: 'fit',
          cropCorners: {
            topLeft: { x: 0.05, y: 0.05 },
            topRight: { x: 0.95, y: 0.05 },
            bottomRight: { x: 0.95, y: 0.95 },
            bottomLeft: { x: 0.05, y: 0.95 },
          },
        };
      });

      const updated = [...pages, ...newItems];
      const nextIdx = updated.length - 1;
      setPages(updated);
      setActiveIndex(nextIdx);
      pushHistory(updated, nextIdx);
    }
    e.target.value = '';
  };

  const handleDesktopReplaceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0 && pages[activeIndex]) {
      const replacement = e.target.files[0];
      const url = URL.createObjectURL(replacement);
      const updated = [...pages];
      updated[activeIndex] = {
        ...updated[activeIndex],
        file: replacement,
        originalUrl: url,
        croppedUrl: url,
        displayUrl: url,
        rotation: 0,
        filter: 'original',
        adjustments: { brightness: 0, contrast: 0 },
        format: 'fit',
        cropCorners: {
          topLeft: { x: 0.05, y: 0.05 },
          topRight: { x: 0.95, y: 0.05 },
          bottomRight: { x: 0.95, y: 0.95 },
          bottomLeft: { x: 0.05, y: 0.95 },
        },
      };
      setPages(updated);
      pushHistory(updated, activeIndex);
    }
    e.target.value = '';
  };

  // Format / Resize state (Requirement 3: Live preview with Confirm/Cancel)
  const [selectedFormat, setSelectedFormat] = useState<PageFormatType>('fit');
  const [resizeBackupPage, setResizeBackupPage] = useState<EditablePage | null>(null);
  const [applyFilterToAll, setApplyFilterToAll] = useState<boolean>(false);
  const [applyFormatToAll, setApplyFormatToAll] = useState<boolean>(false);

  useEffect(() => {
    setApplyFilterToAll(false);
    setApplyFormatToAll(false);
  }, [activeTool, activeIndex]);

  // 1. FREE 4-CORNER CROPPER STATE (Adobe Scan style free quadrilateral)
  type CropHandleType =
    | 'tl'
    | 'tr'
    | 'br'
    | 'bl'
    | 'edge-top'
    | 'edge-right'
    | 'edge-bottom'
    | 'edge-left'
    | null;

  const [cropCorners, setCropCorners] = useState<QuadCorners>({
    topLeft: { x: 0.05, y: 0.05 },
    topRight: { x: 0.95, y: 0.05 },
    bottomRight: { x: 0.95, y: 0.95 },
    bottomLeft: { x: 0.05, y: 0.95 },
  });
  const cropRafRef = useRef<number | null>(null);
  const activeCornersRef = useRef<QuadCorners>({
    topLeft: { x: 0.05, y: 0.05 },
    topRight: { x: 0.95, y: 0.05 },
    bottomRight: { x: 0.95, y: 0.95 },
    bottomLeft: { x: 0.05, y: 0.95 },
  });
  const [draggingHandle, setDraggingHandle] = useState<CropHandleType>(null);
  const cropDragStartRef = useRef<{
    clientX: number;
    clientY: number;
    corners: QuadCorners;
  } | null>(null);
  const [containerDims, setContainerDims] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const cropContainerRef = useRef<HTMLDivElement>(null);
  const imageElementRef = useRef<HTMLImageElement>(null);

  // Keep crop container dimensions tracked for angle and loupe calculations
  useEffect(() => {
    if (activeTool !== 'crop' || !cropContainerRef.current) return;
    const updateDims = () => {
      if (cropContainerRef.current) {
        const rect = cropContainerRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setContainerDims({ width: rect.width, height: rect.height });
        }
      }
    };
    updateDims();
    const ro = new ResizeObserver(updateDims);
    ro.observe(cropContainerRef.current);
    return () => ro.disconnect();
  }, [activeTool, activeIndex]);

  // 2. Adjust State
  const [adjustments, setAdjustments] = useState<ImageAdjustments>({ brightness: 0, contrast: 0 });

  // 3. Cleanup State
  const cleanupCanvasRef = useRef<HTMLCanvasElement>(null);
  const [brushSize, setBrushSize] = useState<number>(24);
  const [isAdjustingBrushSize, setIsAdjustingBrushSize] = useState<boolean>(false);
  const brushHideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [cleanupColor, setCleanupColor] = useState<string>('#FFFFFF');
  const [isEyedropperActive, setIsEyedropperActive] = useState<boolean>(false);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [cleanupHistory, setCleanupHistory] = useState<ImageData[]>([]);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState<boolean>(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [pageAspectRatios, setPageAspectRatios] = useState<Record<string, number>>({});

  // Reorder state (Requirement 1: 2-column full screen layout matching Image 1)
  const [reorderPages, setReorderPages] = useState<EditablePage[]>([]);
  const [selectedSwapIndex, setSelectedSwapIndex] = useState<number | null>(null);
  const [draggedPageIndex, setDraggedPageIndex] = useState<number | null>(null);
  const [dragOverPageIndex, setDragOverPageIndex] = useState<number | null>(null);
  const [touchDragPos, setTouchDragPos] = useState<{ x: number; y: number } | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number; index: number } | null>(null);
  const touchHoldTimerRef = useRef<NodeJS.Timeout | null>(null);
  const touchDragIndexRef = useRef<number | null>(null);
  const isTouchDraggingRef = useRef<boolean>(false);

  const handleMoveReorderPage = useCallback((from: number, to: number) => {
    if (to < 0 || from === to) return;
    setReorderPages((prev) => {
      if (to >= prev.length || from >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }, []);

  const handleConfirmReorder = useCallback(() => {
    setPages(reorderPages);
    const newIdx = Math.min(activeIndex, reorderPages.length - 1);
    setActiveIndex(newIdx);
    pushHistory(reorderPages, newIdx);
    setSelectedSwapIndex(null);
    setActiveTool('none');
  }, [activeIndex, pushHistory, reorderPages]);

  const handleCancelReorder = useCallback(() => {
    setSelectedSwapIndex(null);
    setActiveTool('none');
  }, []);

  const startTouchHold = (idx: number, e: React.TouchEvent) => {
    const t = e.touches[0];
    touchDragIndexRef.current = idx;
    touchStartPosRef.current = { x: t.clientX, y: t.clientY, index: idx };
    if (touchHoldTimerRef.current) clearTimeout(touchHoldTimerRef.current);
    touchHoldTimerRef.current = setTimeout(() => {
      isTouchDraggingRef.current = true;
      setDraggedPageIndex(idx);
      setDragOverPageIndex(idx);
      setTouchDragPos({ x: t.clientX, y: t.clientY });
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate(25);
        } catch {
          // ignore
        }
      }
    }, 100);
  };

  const moveTouchDrag = (e: React.TouchEvent) => {
    if (touchDragIndexRef.current === null) return;
    const touch = e.touches[0];

    // If moved noticeably before hold timer fired, activate drag immediately
    if (!isTouchDraggingRef.current && touchStartPosRef.current) {
      const dx = touch.clientX - touchStartPosRef.current.x;
      const dy = touch.clientY - touchStartPosRef.current.y;
      if (Math.hypot(dx, dy) > 8) {
        if (touchHoldTimerRef.current) clearTimeout(touchHoldTimerRef.current);
        isTouchDraggingRef.current = true;
        setDraggedPageIndex(touchStartPosRef.current.index);
        setDragOverPageIndex(touchStartPosRef.current.index);
      } else {
        return;
      }
    }

    if (e.cancelable) {
      e.preventDefault();
    }

    setTouchDragPos({ x: touch.clientX, y: touch.clientY });

    // Find closest slot geometrically using bounding boxes of all cards
    const cards = document.querySelectorAll('[data-reorder-index]');
    let closestIdx = -1;
    let minDistance = Infinity;
    cards.forEach((card) => {
      const r = card.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dist = (touch.clientX - cx) ** 2 + (touch.clientY - cy) ** 2;
      if (dist < minDistance) {
        minDistance = dist;
        closestIdx = parseInt((card as HTMLElement).dataset.reorderIndex || '0', 10);
      }
    });

    if (closestIdx !== -1 && closestIdx < reorderPages.length) {
      setDragOverPageIndex(closestIdx);
    }
  };

  const endTouchDrag = () => {
    if (touchHoldTimerRef.current) {
      clearTimeout(touchHoldTimerRef.current);
      touchHoldTimerRef.current = null;
    }
    const from = touchDragIndexRef.current;
    const to = dragOverPageIndex;
    if (
      isTouchDraggingRef.current &&
      from !== null &&
      to !== null &&
      from !== to &&
      from >= 0 &&
      to >= 0 &&
      from < reorderPages.length &&
      to < reorderPages.length
    ) {
      // Reorder array: dragging page 1 to slot 4 makes 4 owned by 1, and shifts 4->3, 3->2, 2->1
      handleMoveReorderPage(from, to);
    }
    isTouchDraggingRef.current = false;
    touchDragIndexRef.current = null;
    touchStartPosRef.current = null;
    setDraggedPageIndex(null);
    setDragOverPageIndex(null);
    setTouchDragPos(null);
  };

  const galleryContainerRef = useRef<HTMLDivElement>(null);

  // Zoom & Pan state for document preview (matching ImageGalleryModal rules)
  const [scale, setScale] = useState<number>(1.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const panDragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const panRef = useRef(pan);
  panRef.current = pan;

  // Carousel slide state at 1.0x
  const [dragOffset, setDragOffset] = useState<number>(0);
  const isMouseSwipingRef = useRef<boolean>(false);
  const mouseStartXRef = useRef<number>(0);
  const mouseLastXRef = useRef<number>(0);
  const mouseLastTimeRef = useRef<number>(0);
  const mouseVelocityXRef = useRef<number>(0);

  const resetTransform = useCallback(() => {
    setScale(1.0);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleResetFit = useCallback(() => {
    resetTransform();
  }, [resetTransform]);

  const handleZoomIn = useCallback(() => {
    setScale((cur) => {
      const next = Math.min(8.0, Number((cur * 1.25).toFixed(2)));
      return next;
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale((cur) => {
      const next = Math.max(1.0, Number((cur / 1.25).toFixed(2)));
      if (next <= 1.05) {
        setPan({ x: 0, y: 0 });
        return 1.0;
      }
      return next;
    });
  }, []);

  // Reset zoom & pan when switching pages or entering perspective crop / reorder
  useEffect(() => {
    resetTransform();
  }, [activeIndex, resetTransform]);

  useEffect(() => {
    if (activeTool === 'crop' || activeTool === 'reorder') {
      resetTransform();
    }
  }, [activeTool, resetTransform]);

  // Desktop Wheel zoom with focal point tracking (matching ImageGalleryModal rules)
  const handleWheel = (e: React.WheelEvent) => {
    if (activeTool === 'crop' || activeTool === 'reorder') return;
    e.preventDefault();
    const el = galleryContainerRef.current;
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
    if (e.button !== 0) return;
    if (activeTool === 'crop' || activeTool === 'reorder') return;
    if (activeTool === 'cleanup' && scale <= 1.05) return;
    // Discard synthetic mouse events fired right after touch gestures
    if (performance.now() - lastTouchTimeRef.current < 600) return;

    if (scale > 1.05) {
      e.preventDefault();
      setIsDragging(true);
      panDragStartRef.current = { x: e.clientX, y: e.clientY };
      panStartRef.current = { ...pan };
    } else if (pages.length > 1) {
      e.preventDefault();
      isMouseSwipingRef.current = true;
      mouseStartXRef.current = e.clientX;
      mouseLastXRef.current = e.clientX;
      mouseLastTimeRef.current = performance.now();
      mouseVelocityXRef.current = 0;
      setDragOffset(0);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (performance.now() - lastTouchTimeRef.current < 600) return;

    if (isDragging && scale > 1.05) {
      const dx = e.clientX - panDragStartRef.current.x;
      const dy = e.clientY - panDragStartRef.current.y;
      const el = galleryContainerRef.current;
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
      const curIdx = activeIndexRef.current;
      const len = pagesLengthRef.current;
      const isAtStartEdge = curIdx <= 0 && dx > 0;
      const isAtEndEdge = curIdx >= len - 1 && dx < 0;
      const offset = isAtStartEdge || isAtEndEdge ? dx * 0.25 : dx;
      setDragOffset(offset);
    }
  };

  const handleMouseUp = () => {
    if (performance.now() - lastTouchTimeRef.current < 600) return;

    if (isDragging) {
      setIsDragging(false);
    }
    if (isMouseSwipingRef.current) {
      isMouseSwipingRef.current = false;
      const vx = mouseVelocityXRef.current;
      const containerWidth = galleryContainerRef.current?.clientWidth || window.innerWidth;
      const isFlickLeft = vx < -0.25;
      const isFlickRight = vx > 0.25;
      const isPastMidpointLeft = dragOffset < -containerWidth * 0.22;
      const isPastMidpointRight = dragOffset > containerWidth * 0.22;
      const isCounterFlickCancel = (dragOffset < 0 && isFlickRight) || (dragOffset > 0 && isFlickLeft);

      const curIdx = activeIndexRef.current;
      const len = pagesLengthRef.current;
      const canGoNext = curIdx < len - 1;
      const canGoPrev = curIdx > 0;

      if (!isCounterFlickCancel) {
        if (canGoNext && (isFlickLeft || isPastMidpointLeft)) {
          setActiveIndex((prev) => Math.min(len - 1, prev + 1));
        } else if (canGoPrev && (isFlickRight || isPastMidpointRight)) {
          setActiveIndex((prev) => Math.max(0, prev - 1));
        }
      }
      setDragOffset(0);
    }
  };

  // Double click toggles between fit and 2.5x focal zoom
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (activeTool === 'crop' || activeTool === 'reorder') return;

    if (scale > 1.05) {
      resetTransform();
    } else {
      const el = galleryContainerRef.current;
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

  // Native non-passive Wheel & Touch gestures (matching ImageGalleryModal rules)
  // Handles desktop scroll wheel zoom, laptop touchpad pinch-to-zoom (ctrl+wheel), and mobile multi-touch pinch
  useEffect(() => {
    const el = galleryContainerRef.current;
    if (!el) return;

    // Desktop mouse wheel & laptop touchpad pinch gesture
    const onWheel = (e: WheelEvent) => {
      if (activeTool === 'crop' || activeTool === 'reorder') return;
      e.preventDefault();

      const rect = el.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const fx = e.clientX - rect.left - centerX;
      const fy = e.clientY - rect.top - centerY;

      let factor = 1;
      if (e.ctrlKey) {
        // Laptop touchpad pinch gesture in Chromium/Electron
        factor = Math.exp(-e.deltaY * 0.01);
      } else {
        // Normal mouse scroll wheel
        factor = e.deltaY < 0 ? 1.2 : 0.833;
      }

      const curScale = scaleRef.current;
      const curPan = panRef.current;
      const nextScale = Math.max(1.0, Math.min(8.0, Number((curScale * factor).toFixed(2))));

      if (nextScale <= 1.05) {
        setScale(1.0);
        setPan({ x: 0, y: 0 });
      } else {
        const ratio = nextScale / curScale;
        const nextPanX = fx - (fx - curPan.x) * ratio;
        const nextPanY = fy - (fy - curPan.y) * ratio;
        setScale(nextScale);
        setPan({ x: nextPanX, y: nextPanY });
      }
    };

    let touchStartDist = 0;
    let touchStartScale = 1;
    let touchStartPan = { x: 0, y: 0 };
    let touchFocalX = 0;
    let touchFocalY = 0;
    let isPinching = false;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchLastX = 0;
    let touchLastTime = 0;
    let touchVelocityX = 0;
    let isTouchSwiping = false;
    let lastTapTime = 0;
    let lastTapPos = { x: 0, y: 0 };

    const onTouchStart = (e: TouchEvent) => {
      lastTouchTimeRef.current = performance.now();
      if (activeTool === 'crop' || activeTool === 'reorder') return;

      if (e.touches.length >= 2) {
        if (e.cancelable) e.preventDefault();
        isPinching = true;
        isTouchSwiping = false;
        lastTapTime = 0;
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        touchStartDist = Math.max(10, Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY));
        touchStartScale = scaleRef.current;
        touchStartPan = { ...panRef.current };
        const rect = el.getBoundingClientRect();
        touchFocalX = (t1.clientX + t2.clientX) / 2 - rect.left - rect.width / 2;
        touchFocalY = (t1.clientY + t2.clientY) / 2 - rect.top - rect.height / 2;
        return;
      }

      if (e.touches.length === 1) {
        const t = e.touches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        touchLastX = t.clientX;
        touchLastTime = performance.now();
        touchVelocityX = 0;

        const now = performance.now();
        const distFromLast = Math.hypot(t.clientX - lastTapPos.x, t.clientY - lastTapPos.y);

        if (now - lastTapTime < 350 && distFromLast < 45) {
          if (e.cancelable) e.preventDefault();
          lastTapTime = 0;
          isTouchSwiping = false;
          isPinching = false;

          // Double tap action: toggle between fit and 2.5x focal zoom
          if (scaleRef.current > 1.05) {
            setScale(1.0);
            setPan({ x: 0, y: 0 });
          } else {
            const targetScale = 2.5;
            const rect = el.getBoundingClientRect();
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            const tapX = t.clientX - rect.left - centerX;
            const tapY = t.clientY - rect.top - centerY;
            const maxPanX = Math.max(0, (rect.width * targetScale - rect.width) / 2);
            const maxPanY = Math.max(0, (rect.height * targetScale - rect.height) / 2);
            const targetPanX = Math.max(-maxPanX, Math.min(maxPanX, -tapX * (targetScale - 1)));
            const targetPanY = Math.max(-maxPanY, Math.min(maxPanY, -tapY * (targetScale - 1)));
            setScale(targetScale);
            setPan({ x: targetPanX, y: targetPanY });
          }
          return;
        }

        lastTapTime = now;
        lastTapPos = { x: t.clientX, y: t.clientY };

        if (scaleRef.current > 1.05) {
          isPinching = false;
          touchStartPan = { ...panRef.current };
        } else if (pagesLengthRef.current > 1) {
          isTouchSwiping = true;
          setDragOffset(0);
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      lastTouchTimeRef.current = performance.now();
      if (activeTool === 'crop' || activeTool === 'reorder') return;

      if (e.touches.length >= 2) {
        if (e.cancelable) e.preventDefault();
        lastTapTime = 0;
        const t1 = e.touches[0];
        const t2 = e.touches[1];

        if (!isPinching) {
          isPinching = true;
          isTouchSwiping = false;
          touchStartDist = Math.max(10, Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY));
          touchStartScale = scaleRef.current;
          touchStartPan = { ...panRef.current };
          const rect = el.getBoundingClientRect();
          touchFocalX = (t1.clientX + t2.clientX) / 2 - rect.left - rect.width / 2;
          touchFocalY = (t1.clientY + t2.clientY) / 2 - rect.top - rect.height / 2;
          return;
        }

        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const scaleRatio = dist / (touchStartDist || 1);
        const nextScale = Math.max(1.0, Math.min(8.0, Number((touchStartScale * scaleRatio).toFixed(2))));

        if (nextScale <= 1.05) {
          setScale(1.0);
          setPan({ x: 0, y: 0 });
        } else {
          const panRatio = nextScale / touchStartScale;
          const nextPanX = touchFocalX - (touchFocalX - touchStartPan.x) * panRatio;
          const nextPanY = touchFocalY - (touchFocalY - touchStartPan.y) * panRatio;
          setScale(nextScale);
          setPan({ x: nextPanX, y: nextPanY });
        }
        return;
      }

      if (e.touches.length === 1 && !isPinching) {
        const t = e.touches[0];
        const dx = t.clientX - touchStartX;
        const dy = t.clientY - touchStartY;

        if (Math.hypot(dx, dy) > 10) {
          lastTapTime = 0;
        }

        if (scaleRef.current > 1.05) {
          if (e.cancelable) e.preventDefault();
          const rect = el.getBoundingClientRect();
          const maxPanX = Math.max(0, (rect.width * scaleRef.current - rect.width) / 2 + 100);
          const maxPanY = Math.max(0, (rect.height * scaleRef.current - rect.height) / 2 + 100);
          setPan({
            x: Math.max(-maxPanX, Math.min(maxPanX, touchStartPan.x + dx)),
            y: Math.max(-maxPanY, Math.min(maxPanY, touchStartPan.y + dy)),
          });
        } else if (isTouchSwiping && pagesLengthRef.current > 1) {
          if (e.cancelable) e.preventDefault();
          const now = performance.now();
          const dt = Math.max(1, now - touchLastTime);
          const instVx = (t.clientX - touchLastX) / dt;
          touchVelocityX = touchVelocityX * 0.4 + instVx * 0.6;
          touchLastX = t.clientX;
          touchLastTime = now;

          const curIdx = activeIndexRef.current;
          const len = pagesLengthRef.current;
          const isAtStartEdge = curIdx <= 0 && dx > 0;
          const isAtEndEdge = curIdx >= len - 1 && dx < 0;
          const offset = isAtStartEdge || isAtEndEdge ? dx * 0.25 : dx;
          setDragOffset(offset);
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      lastTouchTimeRef.current = performance.now();
      if (isPinching) {
        if (e.touches.length < 2) {
          isPinching = false;
          if (e.touches.length === 1) {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchLastX = e.touches[0].clientX;
            touchLastTime = performance.now();
            touchVelocityX = 0;
            touchStartPan = { ...panRef.current };
          }
        }
      }
      if (isTouchSwiping && e.touches.length === 0) {
        isTouchSwiping = false;
        const curIdx = activeIndexRef.current;
        const len = pagesLengthRef.current;
        const dx = touchLastX - touchStartX;
        const containerWidth = el.clientWidth || window.innerWidth;
        const isFlickLeft = touchVelocityX < -0.25;
        const isFlickRight = touchVelocityX > 0.25;
        const isPastMidpointLeft = dx < -containerWidth * 0.22;
        const isPastMidpointRight = dx > containerWidth * 0.22;
        const isCounterFlickCancel = (dx < 0 && isFlickRight) || (dx > 0 && isFlickLeft);

        const canGoNext = curIdx < len - 1;
        const canGoPrev = curIdx > 0;

        if (!isCounterFlickCancel) {
          if (canGoNext && (isFlickLeft || isPastMidpointLeft)) {
            setActiveIndex((prev) => Math.min(len - 1, prev + 1));
          } else if (canGoPrev && (isFlickRight || isPastMidpointRight)) {
            setActiveIndex((prev) => Math.max(0, prev - 1));
          }
        }
        setDragOffset(0);
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [activeTool]);

  // Keyboard navigation & zoom shortcuts (+, -, 0, Arrow keys)
  useEffect(() => {
    if (!isOpen || activeTool === 'reorder') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement &&
        (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')
      ) {
        return;
      }

      // Zoom Shortcuts: Ctrl + / -, or + / -, or 0
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        handleZoomIn();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        handleZoomOut();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        handleResetFit();
        return;
      }
      if (!e.ctrlKey && !e.metaKey) {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          handleZoomIn();
          return;
        }
        if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          handleZoomOut();
          return;
        }
        if (e.key === '0') {
          e.preventDefault();
          handleResetFit();
          return;
        }
      }

      // Left / Right arrow navigation
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(pagesLengthRef.current - 1, prev + 1));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, activeTool, pages.length, handleZoomIn, handleZoomOut, handleResetFit]);

  // Backup references for consistent Cancel / Discard behavior across tools
  const filterBackupRef = useRef<DocumentFilterType>('original');
  const adjustBackupRef = useRef<ImageAdjustments>({ brightness: 0, contrast: 0 });

  const handleCancelFilters = async () => {
    if (activePage && activePage.filter !== filterBackupRef.current) {
      await updateActivePage((p) => ({ ...p, filter: filterBackupRef.current }));
    }
    setActiveTool('none');
  };

  const handleCancelAdjust = () => {
    setAdjustments(adjustBackupRef.current);
    setActiveTool('none');
  };

  const handleCancelCrop = () => {
    handleResetCrop();
    setActiveTool('none');
  };

  const handleCancelCleanup = () => {
    if (cleanupCanvasRef.current && cleanupHistory.length > 0) {
      const ctx = cleanupCanvasRef.current.getContext('2d');
      if (ctx) {
        ctx.putImageData(cleanupHistory[0], 0, 0);
      }
    }
    setCleanupHistory([]);
    setActiveTool('none');
  };

  // Determine if there are genuine unsaved edits to prompt discard confirmation for
  const hasChanges = Boolean(
    !initialScan ||
    canUndo ||
    historyIndexRef.current > 0 ||
    (initialScan && docName.trim() !== initialScan.title.trim())
  );

  const handleBack = useCallback(() => {
    if (activeTool !== 'none') {
      if (activeTool === 'resize' && resizeBackupPage) {
        setPages((prev) => {
          const next = [...prev];
          next[activeIndex] = resizeBackupPage;
          return next;
        });
        setResizeBackupPage(null);
      } else if (activeTool === 'filters') {
        handleCancelFilters();
        return;
      } else if (activeTool === 'adjust') {
        handleCancelAdjust();
        return;
      } else if (activeTool === 'cleanup') {
        handleCancelCleanup();
        return;
      } else if (activeTool === 'crop') {
        handleCancelCrop();
        return;
      }
      setActiveTool('none');
      return;
    }

    // Only prompt discard confirmation if there are genuine unsaved changes
    if (hasChanges) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  }, [activeTool, resizeBackupPage, activeIndex, hasChanges, onClose]);

  // Hardware Back Button & Gesture Navigation Interception
  useEffect(() => {
    const handleHardwareBack = (e: Event) => {
      if (!isOpen || pages.length === 0) return;
      e.preventDefault();
      if (showDiscardConfirm) {
        setShowDiscardConfirm(false);
      } else if (showDeleteConfirm) {
        setShowDeleteConfirm(false);
      } else if (activeTool !== 'none') {
        if (activeTool === 'resize' && resizeBackupPage) {
          setPages((prev) => {
            const next = [...prev];
            next[activeIndex] = resizeBackupPage;
            return next;
          });
          setResizeBackupPage(null);
        } else if (activeTool === 'filters') {
          handleCancelFilters();
          return;
        } else if (activeTool === 'adjust') {
          handleCancelAdjust();
          return;
        } else if (activeTool === 'cleanup') {
          handleCancelCleanup();
          return;
        } else if (activeTool === 'crop') {
          handleCancelCrop();
          return;
        }
        setActiveTool('none');
      } else if (hasChanges) {
        setShowDiscardConfirm(true);
      } else {
        onClose();
      }
    };

    window.addEventListener('hardwareBackPress', handleHardwareBack);
    return () => window.removeEventListener('hardwareBackPress', handleHardwareBack);
  }, [isOpen, showDiscardConfirm, showDeleteConfirm, activeTool, pages.length, hasChanges, resizeBackupPage, activeIndex, onClose]);

  // Initialize pages and title when opened
  useEffect(() => {
    if (!isOpen) return;

    if (initialScan && initialScan.pages.length > 0) {
      setDocName(initialScan.title);
      const items: EditablePage[] = initialScan.pages.map((p) => ({
        id: p.id,
        originalUrl: p.originalDataUrl || p.dataUrl,
        croppedUrl: p.dataUrl,
        displayUrl: p.dataUrl,
        rotation: p.rotation || 0,
        filter: (p.filter as DocumentFilterType) || 'original',
        adjustments: p.adjustments || { brightness: 0, contrast: 0 },
        format: (p.format as PageFormatType) || 'fit',
        cropCorners: p.cropCorners,
      }));
      setPages(items);
      const startIdx = 0;
      setActiveIndex(startIdx);
      historyRef.current = [{
        pages: items.map((p) => ({ ...p })),
        activeIndex: startIdx,
      }];
      historyIndexRef.current = 0;
      setCanUndo(false);
      setCanRedo(false);
    } else {
      // New scan session (camera capture or imported document):
      // Derive a meaningful base name from the first imported file if available,
      // otherwise fall back to a localized scan name.
      let suggestedBase = '';
      if (initialPages && initialPages.length > 0) {
        suggestedBase = formatDocTitleFromFilename(initialPages[0].name);
      } else if (scanItems && scanItems.length > 0 && scanItems[0].file) {
        suggestedBase = formatDocTitleFromFilename(scanItems[0].file.name);
      }

      if (!suggestedBase) {
        const today = new Date();
        const dateStr = today.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });
        suggestedBase = `Paperweight Scan ${dateStr}`;
      }

      // Query database to ensure the assigned title is distinct from any existing scan
      getAllScans().then((existing) => {
        const existingTitles = existing.map((s) => s.title);
        const uniqueTitle = generateUniqueScanTitle(suggestedBase, existingTitles);
        setDocName(uniqueTitle);
      }).catch(() => {
        setDocName(suggestedBase);
      });

      if (scanItems && scanItems.length > 0) {
        const items: EditablePage[] = scanItems.map((item, idx) => ({
          id: `page_${Date.now()}_${idx}`,
          file: item.file,
          originalUrl: item.rawUrl,
          croppedUrl: item.displayUrl,
          displayUrl: item.displayUrl,
          rotation: 0,
          filter: 'original',
          adjustments: { brightness: 0, contrast: 0 },
          format: 'fit',
          cropCorners: item.cropCorners || {
            topLeft: { x: 0.05, y: 0.05 },
            topRight: { x: 0.95, y: 0.05 },
            bottomRight: { x: 0.95, y: 0.95 },
            bottomLeft: { x: 0.05, y: 0.95 },
          },
        }));
        setPages(items);
        const startIdx = 0;
        setActiveIndex(startIdx);
        historyRef.current = [{
          pages: items.map((p) => ({ ...p })),
          activeIndex: startIdx,
        }];
        historyIndexRef.current = 0;
        setCanUndo(false);
        setCanRedo(false);
      } else if (initialPages && initialPages.length > 0) {
        const items: EditablePage[] = initialPages.map((file, idx) => {
          const url = URL.createObjectURL(file);
          return {
            id: `page_${Date.now()}_${idx}`,
            file,
            originalUrl: url,
            croppedUrl: url,
            displayUrl: url,
            rotation: 0,
            filter: 'original', // Natural true-color photo mode by default
            adjustments: { brightness: 0, contrast: 0 },
            format: 'fit',
            cropCorners: {
              topLeft: { x: 0.05, y: 0.05 },
              topRight: { x: 0.95, y: 0.05 },
              bottomRight: { x: 0.95, y: 0.95 },
              bottomLeft: { x: 0.05, y: 0.95 },
            },
          };
        });
        setPages(items);
        const startIdx = 0;
        setActiveIndex(startIdx);
        historyRef.current = [{
          pages: items.map((p) => ({ ...p })),
          activeIndex: startIdx,
        }];
        historyIndexRef.current = 0;
        setCanUndo(false);
        setCanRedo(false);
      }
    }
  }, [isOpen, initialPages, initialScan, scanItems]);

  const activePage = pages[activeIndex];

  // Synchronize adjustment sliders when entering Adjust mode
  useEffect(() => {
    if (activeTool === 'adjust' && activePage) {
      setAdjustments(activePage.adjustments || { brightness: 0, contrast: 0 });
    }
  }, [activeTool, activePage]);

  // Synchronize crop corners when entering Crop mode
  useEffect(() => {
    if (activeTool === 'crop' && activePage) {
      const initialCorners: QuadCorners = activePage.cropCorners
        ? { ...activePage.cropCorners }
        : {
            topLeft: { x: 0.05, y: 0.05 },
            topRight: { x: 0.95, y: 0.05 },
            bottomRight: { x: 0.95, y: 0.95 },
            bottomLeft: { x: 0.05, y: 0.95 },
          };
      activeCornersRef.current = initialCorners;
      setCropCorners(initialCorners);
    }
  }, [activeTool, activeIndex, activePage]);

  // Synchronize format selection and snapshot backup when entering Resize mode
  useEffect(() => {
    if (activeTool === 'resize' && activePage) {
      setSelectedFormat(activePage.format || 'fit');
      setResizeBackupPage({ ...activePage });
    }
  }, [activeTool]);

  // Synchronize reorder list when entering Reorder mode
  useEffect(() => {
    if (activeTool === 'reorder') {
      setReorderPages([...pages]);
      setSelectedSwapIndex(null);
    }
  }, [activeTool, pages]);

  // Re-render active page with applied filter & adjustments & page format
  const renderPageWithEnhancements = useCallback(
    async (page: EditablePage): Promise<string> => {
      // 1. Clean document source (never contaminated by previous page format white borders)
      const baseSource = page.croppedUrl || page.originalUrl;

      // Fast path: When natural photo mode with no filter/adjustments, avoid redundant double canvas processing
      const hasFilterOrAdjust =
        page.filter !== 'original' ||
        (page.adjustments && (page.adjustments.brightness !== 0 || page.adjustments.contrast !== 0));

      if (!hasFilterOrAdjust) {
        if (page.format && page.format !== 'fit') {
          const formattedBlob = await formatPageSize(baseSource, page.format);
          return URL.createObjectURL(formattedBlob);
        }
        return baseSource;
      }

      // 2. Format page size if requested (fit, a4, letter, a5)
      let sourceToEnhance = baseSource;
      if (page.format && page.format !== 'fit') {
        const formattedBlob = await formatPageSize(baseSource, page.format);
        sourceToEnhance = URL.createObjectURL(formattedBlob);
      }

      let width = 0;
      let height = 0;
      let drawable: CanvasImageSource;
      let bitmapToClose: ImageBitmap | null = null;

      try {
        if (typeof createImageBitmap !== 'undefined') {
          const resp = await fetch(sourceToEnhance);
          const blob = await resp.blob();
          const bmp = await createImageBitmap(blob);
          width = bmp.width;
          height = bmp.height;
          drawable = bmp;
          bitmapToClose = bmp;
        } else {
          const img = await loadImage(sourceToEnhance);
          width = img.width;
          height = img.height;
          drawable = img;
        }
      } catch {
        const img = await loadImage(sourceToEnhance);
        width = img.width;
        height = img.height;
        drawable = img;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        if (bitmapToClose) bitmapToClose.close();
        return sourceToEnhance;
      }

      ctx.drawImage(drawable, 0, 0);
      if (bitmapToClose) bitmapToClose.close();

      // 3. Apply accurate document filter & adjustments
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      applyFilterToImageData(imgData, page.filter, page.adjustments);
      ctx.putImageData(imgData, 0, 0);

      return new Promise((resolve) => {
        canvas.toBlob((b) => {
          if (b) resolve(URL.createObjectURL(b));
          else resolve(sourceToEnhance);
        }, 'image/jpeg', 0.88);
      });
    },
    []
  );

  // Update active page enhancement
  const updateActivePage = useCallback(
    async (updater: (prev: EditablePage) => EditablePage) => {
      if (!activePage) return;
      setIsProcessing(true);
      try {
        const updated = updater(activePage);
        const newUrl = await renderPageWithEnhancements(updated);
        updated.displayUrl = newUrl;
        setPages((prev) => {
          const next = [...prev];
          next[activeIndex] = updated;
          pushHistory(next, activeIndex);
          return next;
        });
      } finally {
        setIsProcessing(false);
      }
    },
    [activeIndex, activePage, pushHistory, renderPageWithEnhancements]
  );

  // Helper to rotate QuadCorners 90° Clockwise in normalized [0, 1] space
  const rotateQuad90CW = (quad: QuadCorners): QuadCorners => {
    const clamp = (v: number) => Math.max(0.01, Math.min(0.99, Number(v.toFixed(4))));
    return {
      topLeft: { x: clamp(1 - quad.bottomLeft.y), y: clamp(quad.bottomLeft.x) },
      topRight: { x: clamp(1 - quad.topLeft.y), y: clamp(quad.topLeft.x) },
      bottomRight: { x: clamp(1 - quad.topRight.y), y: clamp(quad.topRight.x) },
      bottomLeft: { x: clamp(1 - quad.bottomRight.y), y: clamp(quad.bottomRight.x) },
    };
  };

  // Rotate Current Page 90° Clockwise:
  // - Instant active UI feedback (prevents feeling dead/unresponsive)
  // - Works seamlessly BOTH in normal document view AND inside the Cropper
  // - Physically rotates originalUrl, croppedUrl, and displayUrl in parallel
  // - Rotates crop quad corners so perspective unwarping stays perfectly pinned
  const handleRotate = async () => {
    if (!activePage || isRotating || isProcessing) return;
    setIsRotating(true);
    try {
      const nextRot = (activePage.rotation + 90) % 360;

      // 1. Calculate rotated quad corners
      const currentQuad =
        activeTool === 'crop' && activeCornersRef.current
          ? activeCornersRef.current
          : activePage.cropCorners || {
              topLeft: { x: 0.05, y: 0.05 },
              topRight: { x: 0.95, y: 0.05 },
              bottomRight: { x: 0.95, y: 0.95 },
              bottomLeft: { x: 0.05, y: 0.95 },
            };
      const nextCorners = rotateQuad90CW(currentQuad);
      activeCornersRef.current = nextCorners;
      setCropCorners(nextCorners);

      // 2. Identify all distinct image URLs that need physical rotation
      const urlList: string[] = [];
      const addUrl = (u?: string) => {
        if (u && !urlList.includes(u)) urlList.push(u);
      };
      addUrl(activePage.displayUrl);
      addUrl(activePage.croppedUrl);
      addUrl(activePage.originalUrl);

      // 3. Fast parallel rotation via hardware-accelerated canvas
      const rotatedBlobs = await Promise.all(urlList.map((url) => rotateImage(url, 90)));
      const urlMap = new Map<string, string>();
      urlList.forEach((url, i) => {
        urlMap.set(url, URL.createObjectURL(rotatedBlobs[i]));
      });

      const rotatedDisplayUrl = urlMap.get(activePage.displayUrl) || activePage.displayUrl;
      const rotatedCroppedUrl = activePage.croppedUrl
        ? urlMap.get(activePage.croppedUrl) || rotatedDisplayUrl
        : rotatedDisplayUrl;
      const rotatedOriginalUrl = activePage.originalUrl
        ? urlMap.get(activePage.originalUrl) || rotatedDisplayUrl
        : rotatedDisplayUrl;

      const updated: EditablePage = {
        ...activePage,
        rotation: nextRot,
        displayUrl: rotatedDisplayUrl,
        croppedUrl: rotatedCroppedUrl,
        originalUrl: rotatedOriginalUrl,
        cropCorners: nextCorners,
      };

      setPages((prev) => {
        const next = [...prev];
        next[activeIndex] = updated;
        pushHistory(next, activeIndex);
        return next;
      });
    } catch (err) {
      console.error('Failed to rotate page:', err);
    } finally {
      setIsRotating(false);
    }
  };

  // Filter Selection
  const handleSelectFilter = async (filter: DocumentFilterType) => {
    await updateActivePage((p) => ({ ...p, filter }));
  };

  // Adjustments Apply
  const handleApplyAdjustments = async () => {
    await updateActivePage((p) => ({
      ...p,
      filter: p.filter === 'bw' ? 'original' : p.filter,
      adjustments,
    }));
    setActiveTool('none');
  };

  // 1. Apply Filter to All Pages
  const handleApplyFilterToAll = async () => {
    if (pages.length === 0 || isProcessing) return;
    const currentFilter = activePage?.filter || 'original';
    setIsProcessing(true);
    try {
      const updatedPages = await Promise.all(
        pages.map(async (p) => {
          const updated = { ...p, filter: currentFilter };
          const newUrl = await renderPageWithEnhancements(updated);
          return { ...updated, displayUrl: newUrl };
        })
      );
      setPages(updatedPages);
      pushHistory(updatedPages, activeIndex);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDoneFilters = async () => {
    if (applyFilterToAll && pages.length > 1) {
      await handleApplyFilterToAll();
    }
    setActiveTool('none');
  };

  // 2. Apply Format / Preset to All Pages
  const handleApplyFormatToAll = async () => {
    if (pages.length === 0 || isProcessing) return;
    setIsProcessing(true);
    try {
      const updatedPages = await Promise.all(
        pages.map(async (p) => {
          const updated = { ...p, format: selectedFormat };
          const newUrl = await renderPageWithEnhancements(updated);
          return { ...updated, displayUrl: newUrl };
        })
      );
      setPages(updatedPages);
      pushHistory(updatedPages, activeIndex);
      setResizeBackupPage(null);
      setActiveTool('none');
    } finally {
      setIsProcessing(false);
    }
  };



  // Free 4-Corner Cropper Pointer Handlers (Adobe Scan style)
  const handleHandlePointerDown = (handle: CropHandleType, e: React.PointerEvent) => {
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    cropDragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      corners: { ...cropCorners },
    };
    setDraggingHandle(handle);
  };

  const handleCropPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingHandle || !cropContainerRef.current || !cropDragStartRef.current) return;
    const rect = cropContainerRef.current.getBoundingClientRect();
    const init = cropDragStartRef.current.corners;
    const dx = (e.clientX - cropDragStartRef.current.clientX) / rect.width;
    const dy = (e.clientY - cropDragStartRef.current.clientY) / rect.height;
    const clamp = (v: number) => Math.max(0.01, Math.min(0.99, v));

    let nextCorners = { ...init };
    if (draggingHandle === 'tl') {
      nextCorners.topLeft = { x: clamp(init.topLeft.x + dx), y: clamp(init.topLeft.y + dy) };
    } else if (draggingHandle === 'tr') {
      nextCorners.topRight = { x: clamp(init.topRight.x + dx), y: clamp(init.topRight.y + dy) };
    } else if (draggingHandle === 'br') {
      nextCorners.bottomRight = { x: clamp(init.bottomRight.x + dx), y: clamp(init.bottomRight.y + dy) };
    } else if (draggingHandle === 'bl') {
      nextCorners.bottomLeft = { x: clamp(init.bottomLeft.x + dx), y: clamp(init.bottomLeft.y + dy) };
    } else if (draggingHandle === 'edge-top') {
      nextCorners.topLeft = { x: clamp(init.topLeft.x + dx), y: clamp(init.topLeft.y + dy) };
      nextCorners.topRight = { x: clamp(init.topRight.x + dx), y: clamp(init.topRight.y + dy) };
    } else if (draggingHandle === 'edge-bottom') {
      nextCorners.bottomLeft = { x: clamp(init.bottomLeft.x + dx), y: clamp(init.bottomLeft.y + dy) };
      nextCorners.bottomRight = { x: clamp(init.bottomRight.x + dx), y: clamp(init.bottomRight.y + dy) };
    } else if (draggingHandle === 'edge-left') {
      nextCorners.topLeft = { x: clamp(init.topLeft.x + dx), y: clamp(init.topLeft.y + dy) };
      nextCorners.bottomLeft = { x: clamp(init.bottomLeft.x + dx), y: clamp(init.bottomLeft.y + dy) };
    } else if (draggingHandle === 'edge-right') {
      nextCorners.topRight = { x: clamp(init.topRight.x + dx), y: clamp(init.topRight.y + dy) };
      nextCorners.bottomRight = { x: clamp(init.bottomRight.x + dx), y: clamp(init.bottomRight.y + dy) };
    }

    activeCornersRef.current = nextCorners;

    // Throttle React renders to display animation frame (60-120fps) to eliminate dragging lag
    if (cropRafRef.current === null) {
      cropRafRef.current = requestAnimationFrame(() => {
        cropRafRef.current = null;
        setCropCorners({ ...activeCornersRef.current });
      });
    }
  };

  const handleCropPointerUp = (e?: React.PointerEvent) => {
    if (e && draggingHandle) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
    if (cropRafRef.current !== null) {
      cancelAnimationFrame(cropRafRef.current);
      cropRafRef.current = null;
    }
    if (activeCornersRef.current) {
      setCropCorners({ ...activeCornersRef.current });
    }
    setDraggingHandle(null);
    cropDragStartRef.current = null;
  };

  // Undo / Reset crop corners back to detected or initial document boundary
  const handleResetCrop = () => {
    const targetCorners = activePage?.cropCorners || {
      topLeft: { x: 0.05, y: 0.05 },
      topRight: { x: 0.95, y: 0.05 },
      bottomRight: { x: 0.95, y: 0.95 },
      bottomLeft: { x: 0.05, y: 0.95 },
    };
    activeCornersRef.current = targetCorners;
    setCropCorners(targetCorners);
  };

  // Apply Perspective 4-Corner Crop (Unwarps document while strictly preserving originalUrl for future recrops)
  const handleApplyCrop = async () => {
    if (!activePage || !imageElementRef.current) return;
    setIsProcessing(true);
    try {
      const croppedBlob = await cropPerspectiveQuad(imageElementRef.current, cropCorners);
      const newCroppedUrl = URL.createObjectURL(croppedBlob);
      const updatedPage: EditablePage = {
        ...activePage,
        croppedUrl: newCroppedUrl,
        cropCorners: { ...cropCorners },
        // originalUrl is preserved untouched!
      };
      const finalDisplayUrl = await renderPageWithEnhancements(updatedPage);
      updatedPage.displayUrl = finalDisplayUrl;

      const next = [...pages];
      next[activeIndex] = updatedPage;
      setPages(next);
      pushHistory(next, activeIndex);
      setActiveTool('none');
    } finally {
      setIsProcessing(false);
    }
  };

  // Format / Resize Handlers: Live preview on preset tap, confirmed via Done or reverted via Cancel
  const handleSelectFormatPreset = async (format: PageFormatType) => {
    if (!activePage) return;
    setSelectedFormat(format);
    setIsProcessing(true);
    try {
      const previewCandidate: EditablePage = {
        ...activePage,
        format,
      };
      const formattedUrl = await renderPageWithEnhancements(previewCandidate);
      previewCandidate.displayUrl = formattedUrl;

      // Instant aspect ratio update so layout adjusts immediately
      if (format !== 'fit') {
        const isLandscape = (pageAspectRatios[activePage.id] || 1) > 1;
        let targetAspect = 210 / 297;
        if (format === 'letter') targetAspect = 8.5 / 11;
        else if (format === 'a5') targetAspect = 148 / 210;
        setPageAspectRatios((prev) => ({
          ...prev,
          [activePage.id]: isLandscape ? 1 / targetAspect : targetAspect,
        }));
      }

      setPages((prev) => {
        const next = [...prev];
        next[activeIndex] = previewCandidate;
        return next;
      });
    } catch (err) {
      console.error('Failed to preview page format:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDoneResize = async () => {
    if (applyFormatToAll && pages.length > 1) {
      await handleApplyFormatToAll();
      return;
    }
    if (activePage && resizeBackupPage && activePage.format !== resizeBackupPage.format) {
      pushHistory(pages, activeIndex);
    }
    setResizeBackupPage(null);
    setActiveTool('none');
  };

  const handleCancelResize = () => {
    if (resizeBackupPage) {
      setPages((prev) => {
        const next = [...prev];
        next[activeIndex] = resizeBackupPage;
        return next;
      });
    }
    setResizeBackupPage(null);
    setActiveTool('none');
  };

  // Cleanup: Initialize interactive canvas overlay
  useEffect(() => {
    if (activeTool === 'cleanup' && cleanupCanvasRef.current && activePage) {
      const canvas = cleanupCanvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        const initialSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
        setCleanupHistory([initialSnapshot]);
      };
      img.src = activePage.displayUrl;
    }
  }, [activeTool, activePage]);

  // Cleanup: Handle touch/pointer painting
  const handleCleanupPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = cleanupCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    if (isEyedropperActive) {
      const pixel = ctx.getImageData(x, y, 1, 1).data;
      const hex = `#${((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1)}`;
      setCleanupColor(hex);
      setIsEyedropperActive(false);
      return;
    }

    setIsDrawing(true);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = cleanupColor;
    ctx.fillStyle = cleanupColor;
    ctx.lineWidth = brushSize * scaleX;

    ctx.beginPath();
    ctx.arc(x, y, (brushSize * scaleX) / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const handleCleanupPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || isEyedropperActive) return;
    const canvas = cleanupCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handleCleanupPointerUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = cleanupCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setCleanupHistory((prev) => [...prev, snapshot]);
  };

  const handleCleanupUndo = () => {
    if (cleanupHistory.length <= 1) return;
    const canvas = cleanupCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const nextHistory = cleanupHistory.slice(0, -1);
    const lastSnapshot = nextHistory[nextHistory.length - 1];
    ctx.putImageData(lastSnapshot, 0, 0);
    setCleanupHistory(nextHistory);
  };

  const handleApplyCleanup = async () => {
    const canvas = cleanupCanvasRef.current;
    if (!canvas || !activePage) return;
    setIsProcessing(true);
    try {
      const blob: Blob = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b || new Blob()), 'image/jpeg', 0.95)
      );
      const newUrl = URL.createObjectURL(blob);
      const next = [...pages];
      next[activeIndex] = {
        ...next[activeIndex],
        originalUrl: newUrl,
        croppedUrl: newUrl,
        displayUrl: newUrl,
      };
      setPages(next);
      pushHistory(next, activeIndex);
      setActiveTool('none');
    } finally {
      setIsProcessing(false);
    }
  };

  // Delete Current Page
  const handleDeletePage = (index: number) => {
    if (pages.length <= 1) {
      onClose();
      return;
    }
    const nextPages = pages.filter((_, i) => i !== index);
    const nextIndex = Math.min(activeIndex, nextPages.length - 1);
    setPages(nextPages);
    setActiveIndex(nextIndex);
    pushHistory(nextPages, nextIndex);
  };

  // Helper to convert blob/url to base64 for persistent IndexedDB storage
  const urlToDataUrl = async (url: string): Promise<string> => {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  };

  // Helper to compile pages into a PDF Blob
  const generatePdfBlob = async (): Promise<Blob> => {
    const pdfDoc = await PDFDocument.create();

    for (const page of pages) {
      const response = await fetch(page.displayUrl);
      const imgBytes = await response.arrayBuffer();

      const embeddedImg = await pdfDoc.embedJpg(imgBytes).catch(async () => {
        return await pdfDoc.embedPng(imgBytes);
      });

      const imgWidth = embeddedImg.width;
      const imgHeight = embeddedImg.height;
      const isLandscape = imgWidth > imgHeight;

      let pdfPageWidth = imgWidth;
      let pdfPageHeight = imgHeight;

      if (page.format === 'a4') {
        pdfPageWidth = isLandscape ? 841.89 : 595.28;
        pdfPageHeight = isLandscape ? 595.28 : 841.89;
      } else if (page.format === 'letter') {
        pdfPageWidth = isLandscape ? 792.0 : 612.0;
        pdfPageHeight = isLandscape ? 612.0 : 792.0;
      } else if (page.format === 'a5') {
        pdfPageWidth = isLandscape ? 595.28 : 419.53;
        pdfPageHeight = isLandscape ? 419.53 : 595.28;
      }

      const pdfPage = pdfDoc.addPage([pdfPageWidth, pdfPageHeight]);
      pdfPage.drawImage(embeddedImg, {
        x: 0,
        y: 0,
        width: pdfPageWidth,
        height: pdfPageHeight,
      });
    }

    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
  };

  // Helper to persist to IndexedDB
  const persistScanToDb = async (): Promise<string> => {
    try {
      const thumbDataUrl = await urlToDataUrl(pages[0].displayUrl);
      const storedPages = await Promise.all(
        pages.map(async (p) => ({
          id: p.id,
          dataUrl: await urlToDataUrl(p.displayUrl),
          originalDataUrl: await urlToDataUrl(p.originalUrl),
          rotation: p.rotation,
          filter: p.filter,
          adjustments: p.adjustments,
          format: p.format,
          cropCorners: p.cropCorners,
        }))
      );

      // Ensure docName is unique across other scans in the database
      const existing = await getAllScans();
      const otherTitles = existing
        .filter((s) => s.id !== (initialScan?.id || ''))
        .map((s) => s.title);
      const uniqueTitle = generateUniqueScanTitle(docName.trim(), otherTitles);
      setDocName(uniqueTitle);

      const savedScan: StoredScanDoc = {
        id: initialScan?.id || `scan_${Date.now()}`,
        title: uniqueTitle,
        createdAt: initialScan?.createdAt || Date.now(),
        thumbnailUrl: thumbDataUrl,
        pageCount: pages.length,
        pages: storedPages,
      };

      await saveScan(savedScan);
      if (onScanSaved) onScanSaved(savedScan);
      return uniqueTitle;
    } catch (e) {
      console.warn('Storage save warning:', e);
      return docName;
    }
  };

  // Save High-Resolution PDF & Persist to Scanned Documents List
  const handleSavePdf = async () => {
    if (pages.length === 0) return;
    setIsProcessing(true);
    try {
      const savedTitle = await persistScanToDb();
      const pdfBlob = await generatePdfBlob();
      const filename = `${savedTitle.replace(/\s+/g, '_')}.pdf`;
      await downloadBlob(pdfBlob, filename);
      onSavePdf(pdfBlob, filename);
    } catch (err) {
      console.error('Failed to create PDF:', err);
    } finally {
      setIsProcessing(false);
    }
  };



  if (!isOpen || pages.length === 0) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-surface-bg text-text-main flex flex-col justify-between overflow-hidden select-none">
      {/* 1. TOP HEADER (Theme-aligned with safe-area status bar spacing) */}
      <div className="relative z-30 px-3 sm:px-4 py-2 pt-[max(0.5rem,var(--safe-area-top))] pl-[max(0.75rem,var(--safe-area-left))] pr-[max(0.75rem,var(--safe-area-right))] flex items-center justify-between border-b border-surface-border bg-surface-panel text-text-main shrink-0">
        {/* Back Button with Text as everywhere else */}
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-1.5 h-9 sm:h-[38px] px-3 rounded-control border border-surface-border bg-surface-bg hover:bg-surface-subtle text-xs font-semibold text-text-main transition-colors duration-fast ease-out cursor-pointer shrink-0 shadow-2xs"
          title="Back"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4 text-text-muted shrink-0" />
          <span>Back</span>
        </button>

        {/* Centered Document Title (centered to content area excluding desktop right toolbar) */}
        <div className="absolute inset-y-0 left-0 right-0 lg:right-72 xl:right-80 flex items-center justify-center pointer-events-none px-20 sm:px-28">
          <div className="pointer-events-auto flex items-center gap-1.5 max-w-[280px] sm:max-w-md min-w-0">
            {isEditingName ? (
              <input
                type="text"
                value={docName}
                autoFocus
                onBlur={() => setIsEditingName(false)}
                onKeyDown={(e) => e.key === 'Enter' && setIsEditingName(false)}
                onChange={(e) => setDocName(e.target.value)}
                className="bg-surface-subtle text-text-main font-semibold text-sm px-2.5 h-9 rounded-control border border-accent focus:outline-none w-full text-center"
              />
            ) : (
              <button
                type="button"
                onClick={() => setIsEditingName(true)}
                className="h-9 px-2.5 rounded-control flex items-center justify-center gap-1.5 text-sm font-semibold truncate hover:bg-surface-hover cursor-pointer text-text-main"
                title="Click to rename document"
              >
                <span className="truncate">{docName}</span>
                <Edit2 className="w-3.5 h-3.5 text-text-muted shrink-0" />
              </button>
            )}
          </div>
        </div>

        {/* Right Header: Mobile Undo/Redo & Desktop Balance Spacer */}
        <div className="flex items-center gap-1.5 shrink-0 z-10">
          {activeTool === 'none' && (
            <div className="flex items-center gap-1 lg:hidden">
              <button
                type="button"
                onClick={handleUndo}
                disabled={!canUndo}
                style={{ touchAction: 'manipulation' }}
                className="w-8 h-8 inline-flex items-center justify-center rounded-control border border-surface-border bg-surface-bg hover:bg-surface-subtle text-text-main disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors shadow-2xs"
                aria-label="Undo"
                title="Undo"
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={!canRedo}
                style={{ touchAction: 'manipulation' }}
                className="w-8 h-8 inline-flex items-center justify-center rounded-control border border-surface-border bg-surface-bg hover:bg-surface-subtle text-text-main disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors shadow-2xs"
                aria-label="Redo"
                title="Redo"
              >
                <Redo2 className="w-4 h-4" />
              </button>
            </div>
          )}
          <div className="w-20 hidden lg:block" />
        </div>
      </div>

      {/* MAIN WORKSPACE: Left Document Canvas & Sub-panels + Desktop Right Options Bar */}
      <div className="flex-1 min-h-0 w-full flex flex-col lg:flex-row overflow-hidden relative">
        {/* Left / Center Document Desk */}
        <div className="flex-1 min-h-0 min-w-0 flex flex-col justify-between overflow-hidden bg-surface-bg transition-colors duration-150 relative">
        {/* Smooth Gallery Track Container with Image Viewer Zoom, Pan, and Slide (matching ImageGalleryModal) */}
        <div
          ref={galleryContainerRef}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDoubleClick={handleDoubleClick}
          style={{ touchAction: 'none' }}
          className={`relative flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden select-none bg-surface-bg ${
            scale > 1.05
              ? isDragging
                ? 'cursor-grabbing'
                : 'cursor-grab'
              : pages.length > 1
              ? 'cursor-grab active:cursor-grabbing'
              : 'cursor-default'
          }`}
        >
          <div
            className="flex h-full w-full items-center"
            style={{
              transform: `translateX(calc(-${Math.min(Math.max(0, pages.length - 1), activeIndex) * 100}% + ${dragOffset}px))`,
              transition: isDragging || dragOffset !== 0 ? 'none' : 'transform 260ms cubic-bezier(0.16, 1, 0.3, 1)',
              willChange: 'transform',
            }}
          >
            {pages.map((page, idx) => (
              <div
                key={page.id}
                className="w-full h-full shrink-0 flex items-center justify-center p-2 sm:p-4 overflow-hidden"
              >
                <div
                  className="relative max-w-full max-h-full flex items-center justify-center shadow-2xl rounded-none border border-black/15 bg-white"
                  style={{
                    aspectRatio: pageAspectRatios[page.id] ? `${pageAspectRatios[page.id]}` : undefined,
                    transform:
                      idx === activeIndex && scale > 1.0
                        ? `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`
                        : undefined,
                    transformOrigin: 'center center',
                    transition: isDragging
                      ? 'none'
                      : 'transform 140ms cubic-bezier(0.22, 1, 0.36, 1)',
                    willChange: 'transform',
                  }}
                >
                  <img
                    ref={idx === activeIndex ? imageElementRef : undefined}
                    src={idx === activeIndex && activeTool === 'crop' ? page.originalUrl : page.displayUrl}
                    alt={`Page ${idx + 1}`}
                    onLoad={(e) => {
                      const target = e.currentTarget;
                      if (target.naturalWidth && target.naturalHeight) {
                        const aspect = target.naturalWidth / target.naturalHeight;
                        setPageAspectRatios((prev) =>
                          prev[page.id] === aspect ? prev : { ...prev, [page.id]: aspect }
                        );
                      }
                      if (idx === activeIndex && cropContainerRef.current) {
                        const rect = cropContainerRef.current.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                          setContainerDims({ width: rect.width, height: rect.height });
                        }
                      }
                    }}
                    style={{
                      filter:
                        idx === activeIndex && activeTool === 'adjust'
                          ? `brightness(${1 + adjustments.brightness / 50}) contrast(${1 + adjustments.contrast / 50})`
                          : undefined,
                    }}
                    className="max-w-full max-h-full object-contain block bg-white transition-opacity duration-150 select-none pointer-events-none"
                    draggable={false}
                  />

                  {/* Visible processing overlay (for Rotate, Filters, Resize, Adjustments) */}
                  {idx === activeIndex && (isRotating || isProcessing) && (
                    <div className="absolute inset-0 bg-black/20 backdrop-blur-[1px] flex items-center justify-center z-30 pointer-events-none animate-in fade-in duration-100">
                      <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-surface-panel text-text-main shadow-lg border border-surface-border text-xs font-semibold">
                        <RotateCw className="w-3.5 h-3.5 animate-spin text-accent" />
                        <span>{isRotating ? 'Rotating…' : 'Applying…'}</span>
                      </div>
                    </div>
                  )}

                  {/* OVERLAY 1: Free Quadrilateral Cropper (Adobe Scan Style) */}
                  {idx === activeIndex && activeTool === 'crop' && (() => {
                    const w = containerDims.width || 300;
                    const h = containerDims.height || 400;

                    // Midpoints of the 4 edges
                    const midTop = {
                      x: (cropCorners.topLeft.x + cropCorners.topRight.x) / 2,
                      y: (cropCorners.topLeft.y + cropCorners.topRight.y) / 2,
                    };
                    const midBottom = {
                      x: (cropCorners.bottomLeft.x + cropCorners.bottomRight.x) / 2,
                      y: (cropCorners.bottomLeft.y + cropCorners.bottomRight.y) / 2,
                    };
                    const midLeft = {
                      x: (cropCorners.topLeft.x + cropCorners.bottomLeft.x) / 2,
                      y: (cropCorners.topLeft.y + cropCorners.bottomLeft.y) / 2,
                    };
                    const midRight = {
                      x: (cropCorners.topRight.x + cropCorners.bottomRight.x) / 2,
                      y: (cropCorners.topRight.y + cropCorners.bottomRight.y) / 2,
                    };

                    // Tangent angles for edge midpoint pill handles
                    const angleTop =
                      Math.atan2(
                        (cropCorners.topRight.y - cropCorners.topLeft.y) * h,
                        (cropCorners.topRight.x - cropCorners.topLeft.x) * w
                      ) * (180 / Math.PI);
                    const angleBottom =
                      Math.atan2(
                        (cropCorners.bottomRight.y - cropCorners.bottomLeft.y) * h,
                        (cropCorners.bottomRight.x - cropCorners.bottomLeft.x) * w
                      ) * (180 / Math.PI);
                    const angleLeft =
                      Math.atan2(
                        (cropCorners.bottomLeft.y - cropCorners.topLeft.y) * h,
                        (cropCorners.bottomLeft.x - cropCorners.topLeft.x) * w
                      ) * (180 / Math.PI);
                    const angleRight =
                      Math.atan2(
                        (cropCorners.bottomRight.y - cropCorners.topRight.y) * h,
                        (cropCorners.bottomRight.x - cropCorners.topRight.x) * w
                      ) * (180 / Math.PI);

                    // Target point currently being adjusted for the floating loupe
                    let activeTargetPoint: { x: number; y: number } | null = null;
                    if (draggingHandle === 'tl') activeTargetPoint = cropCorners.topLeft;
                    else if (draggingHandle === 'tr') activeTargetPoint = cropCorners.topRight;
                    else if (draggingHandle === 'br') activeTargetPoint = cropCorners.bottomRight;
                    else if (draggingHandle === 'bl') activeTargetPoint = cropCorners.bottomLeft;
                    else if (draggingHandle === 'edge-top') activeTargetPoint = midTop;
                    else if (draggingHandle === 'edge-bottom') activeTargetPoint = midBottom;
                    else if (draggingHandle === 'edge-left') activeTargetPoint = midLeft;
                    else if (draggingHandle === 'edge-right') activeTargetPoint = midRight;

                    const loupeSize = 88;
                    const loupeRadius = loupeSize / 2;
                    const zoom = 2.2;
                    const targetPxX = activeTargetPoint ? activeTargetPoint.x * w : 0;
                    const targetPxY = activeTargetPoint ? activeTargetPoint.y * h : 0;

                    let loupeCenterY = targetPxY - 74;
                    if (loupeCenterY < loupeRadius + 12) {
                      loupeCenterY = targetPxY + 74;
                    }
                    const loupeCenterX = Math.max(loupeRadius + 10, Math.min(w - loupeRadius - 10, targetPxX));

                    return (
                      <div
                        ref={cropContainerRef}
                        onPointerMove={handleCropPointerMove}
                        onPointerUp={handleCropPointerUp}
                        onPointerCancel={handleCropPointerUp}
                        className="absolute inset-0 touch-none select-none pointer-events-auto"
                      >
                        {/* SVG Quadrilateral Polygon + Outside Dark Mask */}
                        <svg
                          className="absolute inset-0 w-full h-full pointer-events-none z-10"
                          viewBox="0 0 100 100"
                          preserveAspectRatio="none"
                        >
                          {/* Dark mask covering everything outside the quad */}
                          <path
                            d={`M 0 0 L 100 0 L 100 100 L 0 100 Z M ${cropCorners.topLeft.x * 100} ${cropCorners.topLeft.y * 100} L ${cropCorners.topRight.x * 100} ${cropCorners.topRight.y * 100} L ${cropCorners.bottomRight.x * 100} ${cropCorners.bottomRight.y * 100} L ${cropCorners.bottomLeft.x * 100} ${cropCorners.bottomLeft.y * 100} Z`}
                            fill="rgba(0, 0, 0, 0.48)"
                            fillRule="evenodd"
                          />

                          {/* Accent Quad Polygon */}
                          <polygon
                            points={`
                              ${cropCorners.topLeft.x * 100},${cropCorners.topLeft.y * 100}
                              ${cropCorners.topRight.x * 100},${cropCorners.topRight.y * 100}
                              ${cropCorners.bottomRight.x * 100},${cropCorners.bottomRight.y * 100}
                              ${cropCorners.bottomLeft.x * 100},${cropCorners.bottomLeft.y * 100}
                            `}
                            fill="rgba(242, 209, 75, 0.14)"
                            stroke="var(--accent)"
                            strokeWidth="2.5"
                            vectorEffect="non-scaling-stroke"
                          />
                        </svg>

                        {/* 4 Edge Midpoint Pill Handles */}
                        {[
                          { key: 'edge-top' as const, point: midTop, angle: angleTop, label: 'Top Edge' },
                          { key: 'edge-bottom' as const, point: midBottom, angle: angleBottom, label: 'Bottom Edge' },
                          { key: 'edge-left' as const, point: midLeft, angle: angleLeft, label: 'Left Edge' },
                          { key: 'edge-right' as const, point: midRight, angle: angleRight, label: 'Right Edge' },
                        ].map(({ key, point, angle, label }) => (
                          <div
                            key={key}
                            style={{
                              left: `${point.x * 100}%`,
                              top: `${point.y * 100}%`,
                              transform: `translate(-50%, -50%) rotate(${angle}deg)`,
                            }}
                            onPointerDown={(e) => handleHandlePointerDown(key, e)}
                            onPointerUp={handleCropPointerUp}
                            onPointerCancel={handleCropPointerUp}
                            aria-label={label}
                            className="absolute w-11 h-11 flex items-center justify-center cursor-move touch-none z-30"
                          >
                            <div
                              className={`w-7 h-2.5 rounded-chip border-[2px] border-accent bg-surface-panel shadow-lifted transition-transform ${
                                draggingHandle === key ? 'scale-125 ring-2 ring-accent' : 'hover:scale-110'
                              }`}
                            />
                          </div>
                        ))}

                        {/* 4 Corner Handles */}
                        {[
                          { key: 'tl' as const, point: cropCorners.topLeft, label: 'Top Left Corner' },
                          { key: 'tr' as const, point: cropCorners.topRight, label: 'Top Right Corner' },
                          { key: 'br' as const, point: cropCorners.bottomRight, label: 'Bottom Right Corner' },
                          { key: 'bl' as const, point: cropCorners.bottomLeft, label: 'Bottom Left Corner' },
                        ].map(({ key, point, label }) => (
                          <div
                            key={key}
                            style={{
                              left: `${point.x * 100}%`,
                              top: `${point.y * 100}%`,
                            }}
                            onPointerDown={(e) => handleHandlePointerDown(key, e)}
                            onPointerUp={handleCropPointerUp}
                            onPointerCancel={handleCropPointerUp}
                            aria-label={label}
                            className="absolute -translate-x-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center cursor-move touch-none z-30"
                          >
                            <div
                              className={`w-7 h-7 rounded-full border-[2.5px] border-accent bg-surface-panel opacity-90 shadow-lifted flex items-center justify-center transition-transform ${
                                draggingHandle === key
                                  ? 'scale-125 ring-4 ring-accent bg-accent'
                                  : 'hover:scale-110'
                              }`}
                            >
                              <div className="w-1.5 h-1.5 rounded-full bg-surface-panel" />
                            </div>
                          </div>
                        ))}

                        {/* Floating Magnifying Loupe with Crosshair Reticle */}
                        {activeTargetPoint && (
                          <div
                            style={{
                              left: `${loupeCenterX}px`,
                              top: `${loupeCenterY}px`,
                              width: `${loupeSize}px`,
                              height: `${loupeSize}px`,
                              transform: 'translate(-50%, -50%)',
                            }}
                            className="absolute rounded-full overflow-hidden border-[2.5px] border-accent shadow-lifted bg-surface-bg pointer-events-none z-40"
                          >
                            {/* 2.2x Zoomed Image Section */}
                            <img
                              src={page.originalUrl || page.displayUrl}
                              alt="Magnifier preview"
                              style={{
                                width: `${w * zoom}px`,
                                height: `${h * zoom}px`,
                                transform: `translate(${loupeRadius - targetPxX * zoom}px, ${loupeRadius - targetPxY * zoom}px)`,
                              }}
                              className="max-w-none block pointer-events-none select-none"
                            />

                            {/* Full-width and full-height Reticle Crosshairs */}
                            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[1.5px] bg-accent opacity-90" />
                            <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[1.5px] bg-accent opacity-90" />
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full border border-accent opacity-75" />
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* OVERLAY 2: Interactive Cleanup Drawing Canvas (On Active Page) */}
                  {idx === activeIndex && activeTool === 'cleanup' && (
                    <canvas
                      ref={cleanupCanvasRef}
                      onPointerDown={handleCleanupPointerDown}
                      onPointerMove={handleCleanupPointerMove}
                      onPointerUp={handleCleanupPointerUp}
                      className="absolute inset-0 w-full h-full touch-none z-20 cursor-crosshair pointer-events-auto"
                    />
                  )}

                  {/* OVERLAY 3: Floating Real-time Brush Size Circle Indicator */}
                  {idx === activeIndex && activeTool === 'cleanup' && isAdjustingBrushSize && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30 animate-in fade-in duration-75">
                      <div className="relative flex items-center justify-center">
                        <div
                          style={{
                            width: `${brushSize}px`,
                            height: `${brushSize}px`,
                          }}
                          className="rounded-full border-2 border-accent bg-accent/25 shadow-lg backdrop-blur-[1px]"
                        />
                        <div className="absolute -bottom-6 px-2 py-0.5 rounded-chip bg-surface-panel/95 border border-surface-border text-[11px] font-mono font-bold text-text-main shadow-md whitespace-nowrap">
                          {brushSize}px
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Android / Mobile Redesigned Page Indicator Floating Pill */}
          {pages.length > 0 && activeTool === 'none' && (
            <div className="lg:hidden absolute bottom-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none select-none animate-in fade-in duration-150">
              <div className="pointer-events-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-panel/95 backdrop-blur-md border border-surface-border shadow-lifted text-text-main text-xs font-mono">
                {pages.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setActiveIndex((prev) => Math.max(0, prev - 1))}
                    disabled={activeIndex <= 0}
                    style={{ touchAction: 'manipulation' }}
                    className="w-7 h-7 inline-flex items-center justify-center rounded-full hover:bg-surface-hover text-text-muted hover:text-text-main disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer transition-colors"
                    aria-label="Previous page"
                    title="Previous page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                )}
                <span className="px-1.5 text-xs font-mono select-none">
                  Page <span className="font-bold text-text-main">{Math.min(pages.length, Math.max(1, activeIndex + 1))}</span>
                  <span className="text-text-muted font-normal mx-1">/</span>
                  <span className="text-text-muted">{pages.length}</span>
                </span>
                {pages.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setActiveIndex((prev) => Math.min(pages.length - 1, prev + 1))}
                    disabled={activeIndex >= pages.length - 1}
                    style={{ touchAction: 'manipulation' }}
                    className="w-7 h-7 inline-flex items-center justify-center rounded-full hover:bg-surface-hover text-text-muted hover:text-text-main disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer transition-colors"
                    aria-label="Next page"
                    title="Next page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 3. DEDICATED BOTTOM SUB-OPTIONS SHELF
            Has a permanent, fixed height on desktop (h-28 shrink-0) so the document area above it never resizes or shifts.
            When a tool is active, its sub-panel is rendered here.
            When activeTool === 'none', rendered on desktop only (hidden on mobile to maximize viewport area).
        */}
        <div className={`${activeTool === 'none' ? 'hidden lg:flex' : 'flex'} h-28 shrink-0 w-full border-t border-surface-border bg-surface-panel flex-col justify-center px-3 sm:px-4 py-2 relative z-30`}>
          {/* A. CROP SUB-PANEL */}
          {activeTool === 'crop' && (
            <div className="w-full max-w-2xl mx-auto space-y-2">
              <div className="flex items-center justify-between w-full">
                <button
                  type="button"
                  onClick={handleCancelCrop}
                  className="h-8 px-3 rounded-control text-xs font-medium text-text-muted hover:text-text-main bg-surface-subtle hover:bg-surface-hover border border-surface-border transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  Cancel
                </button>

                <div className="flex items-center gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    onClick={handleRotate}
                    disabled={isRotating}
                    className="h-8 px-2.5 rounded-control text-xs font-medium text-text-main bg-surface-subtle hover:bg-surface-hover border border-surface-border transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                    title="Rotate 90° Clockwise"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${isRotating ? 'animate-spin text-accent' : ''}`} />
                    <span>Rotate</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleResetCrop}
                    className="h-8 px-2.5 rounded-control text-xs font-medium text-text-muted hover:text-text-main bg-surface-subtle hover:bg-surface-hover border border-surface-border transition-colors cursor-pointer flex items-center gap-1.5"
                    title="Reset crop boundary"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    <span>Reset</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleApplyCrop}
                  className="h-8 px-4 rounded-control text-xs font-bold text-accent-contrast bg-accent hover:bg-accent-hover shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Done</span>
                </button>
              </div>
            </div>
          )}

          {/* B. FILTERS SUB-PANEL */}
          {activeTool === 'filters' && (
            <div className="w-full max-w-2xl mx-auto space-y-2">
              <div className="flex items-center justify-between w-full">
                <button
                  type="button"
                  onClick={handleCancelFilters}
                  className="h-8 px-3 rounded-control text-xs font-medium text-text-muted hover:text-text-main bg-surface-subtle hover:bg-surface-hover border border-surface-border transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  Cancel
                </button>

                <div className="flex items-center gap-2 sm:gap-3">
                  {pages.length > 1 && (
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-text-muted hover:text-text-main select-none">
                      <input
                        type="checkbox"
                        checked={applyFilterToAll}
                        onChange={(e) => setApplyFilterToAll(e.target.checked)}
                        className="w-3.5 h-3.5 rounded accent-accent cursor-pointer"
                      />
                      <span>Apply to all</span>
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={handleDoneFilters}
                    disabled={isProcessing}
                    className="h-8 px-4 rounded-control text-xs font-bold text-accent-contrast bg-accent hover:bg-accent-hover shadow-xs transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isProcessing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    <span>Done</span>
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
                {[
                  { id: 'original', label: 'Original' },
                  { id: 'color', label: 'Color' },
                  { id: 'bw', label: 'B&W' },
                  { id: 'grayscale', label: 'Gray' },
                  { id: 'light_text', label: 'Light' },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => handleSelectFilter(f.id as DocumentFilterType)}
                    className={`h-9 px-1 rounded-control text-xs font-medium border text-center transition-colors cursor-pointer ${
                      activePage?.filter === f.id
                        ? 'bg-accent text-accent-contrast border-accent font-semibold shadow-2xs'
                        : 'bg-surface-subtle border-surface-border text-text-main hover:bg-surface-hover'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* C. ADJUST SUB-PANEL */}
          {activeTool === 'adjust' && (
            <div className="w-full max-w-2xl mx-auto space-y-1.5">
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    onClick={handleCancelAdjust}
                    className="h-8 px-3 rounded-control text-xs font-medium text-text-muted hover:text-text-main bg-surface-subtle hover:bg-surface-hover border border-surface-border transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustments({ brightness: 0, contrast: 0 })}
                    className="h-8 px-2.5 rounded-control text-xs font-medium text-text-muted hover:text-text-main bg-surface-subtle hover:bg-surface-hover border border-surface-border transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    Reset
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleApplyAdjustments}
                  className="h-8 px-4 rounded-control text-xs font-bold text-accent-contrast bg-accent hover:bg-accent-hover shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Done</span>
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-16 text-text-muted font-medium shrink-0">Brightness</span>
                  <input
                    type="range"
                    min="-50"
                    max="50"
                    value={adjustments.brightness}
                    onChange={(e) =>
                      setAdjustments((prev) => ({ ...prev, brightness: Number(e.target.value) }))
                    }
                    className="flex-1 accent-accent"
                  />
                  <span className="w-8 text-right font-mono text-text-muted text-[11px]">
                    {adjustments.brightness}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-16 text-text-muted font-medium shrink-0">Contrast</span>
                  <input
                    type="range"
                    min="-50"
                    max="50"
                    value={adjustments.contrast}
                    onChange={(e) =>
                      setAdjustments((prev) => ({ ...prev, contrast: Number(e.target.value) }))
                    }
                    className="flex-1 accent-accent"
                  />
                  <span className="w-8 text-right font-mono text-text-muted text-[11px]">
                    {adjustments.contrast}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* D. CLEANUP SUB-PANEL */}
          {activeTool === 'cleanup' && (
            <div className="w-full max-w-2xl mx-auto space-y-1.5">
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    onClick={handleCancelCleanup}
                    className="h-8 px-3 rounded-control text-xs font-medium text-text-muted hover:text-text-main bg-surface-subtle hover:bg-surface-hover border border-surface-border transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCleanupUndo}
                    disabled={cleanupHistory.length <= 1}
                    className="h-8 px-2.5 rounded-control text-xs font-medium text-text-muted hover:text-text-main bg-surface-subtle hover:bg-surface-hover border border-surface-border transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-40"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    <span>Undo</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleApplyCleanup}
                  className="h-8 px-4 rounded-control text-xs font-bold text-accent-contrast bg-accent hover:bg-accent-hover shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Done</span>
                </button>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-xs text-text-muted font-medium shrink-0">Size</span>
                  <input
                    type="range"
                    min="6"
                    max="80"
                    value={brushSize}
                    onPointerDown={() => {
                      if (brushHideTimerRef.current) clearTimeout(brushHideTimerRef.current);
                      setIsAdjustingBrushSize(true);
                    }}
                    onPointerUp={() => {
                      setIsAdjustingBrushSize(false);
                    }}
                    onTouchStart={() => {
                      if (brushHideTimerRef.current) clearTimeout(brushHideTimerRef.current);
                      setIsAdjustingBrushSize(true);
                    }}
                    onTouchEnd={() => {
                      setIsAdjustingBrushSize(false);
                    }}
                    onChange={(e) => {
                      setBrushSize(Number(e.target.value));
                      setIsAdjustingBrushSize(true);
                      if (brushHideTimerRef.current) clearTimeout(brushHideTimerRef.current);
                      brushHideTimerRef.current = setTimeout(() => {
                        setIsAdjustingBrushSize(false);
                      }, 700);
                    }}
                    className="flex-1 accent-accent"
                  />
                  <span className="text-xs font-mono text-text-muted text-[11px] w-8 text-right">{brushSize}px</span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {['#FFFFFF', '#F7F5EF', '#E9E8E4', '#1F1F22'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCleanupColor(c)}
                      style={{ backgroundColor: c }}
                      className={`w-6 h-6 rounded-control border cursor-pointer ${
                        cleanupColor === c ? 'ring-2 ring-accent border-accent' : 'border-surface-border'
                      }`}
                      title={c}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => setIsEyedropperActive(!isEyedropperActive)}
                    className={`h-7 px-2 rounded-control border transition-colors cursor-pointer flex items-center gap-1 text-xs ${
                      isEyedropperActive
                        ? 'bg-accent border-accent text-accent-contrast'
                        : 'bg-surface-subtle border-surface-border text-text-muted hover:text-text-main'
                    }`}
                    title="Pick color from document"
                  >
                    <Pipette className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* E. RESIZE / FORMAT SUB-PANEL */}
          {activeTool === 'resize' && (
            <div className="w-full max-w-2xl mx-auto space-y-1.5">
              <div className="flex items-center justify-between w-full">
                <button
                  type="button"
                  onClick={handleCancelResize}
                  className="h-8 px-3 rounded-control text-xs font-medium text-text-muted hover:text-text-main bg-surface-subtle hover:bg-surface-hover border border-surface-border transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  Cancel
                </button>

                <div className="flex items-center gap-2 sm:gap-3">
                  {pages.length > 1 && (
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-text-muted hover:text-text-main select-none">
                      <input
                        type="checkbox"
                        checked={applyFormatToAll}
                        onChange={(e) => setApplyFormatToAll(e.target.checked)}
                        className="w-3.5 h-3.5 rounded accent-accent cursor-pointer"
                      />
                      <span>Apply to all</span>
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={handleDoneResize}
                    disabled={isProcessing}
                    className="h-8 px-4 rounded-control text-xs font-bold text-accent-contrast bg-accent hover:bg-accent-hover shadow-xs transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isProcessing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    <span>Done</span>
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { id: 'fit', label: 'Fit', desc: 'Original' },
                  { id: 'a4', label: 'A4', desc: '210 × 297 mm' },
                  { id: 'letter', label: 'Letter', desc: '8.5 × 11 in' },
                  { id: 'a5', label: 'A5', desc: '148 × 210 mm' },
                ].map((fmt) => (
                  <button
                    key={fmt.id}
                    type="button"
                    onClick={() => handleSelectFormatPreset(fmt.id as PageFormatType)}
                    className={`h-11 px-1 rounded-control text-xs flex flex-col items-center justify-center border text-center transition-colors cursor-pointer ${
                      selectedFormat === fmt.id
                        ? 'bg-accent text-accent-contrast border-accent font-semibold shadow-2xs'
                        : 'bg-surface-subtle border-surface-border text-text-main hover:bg-surface-hover'
                    }`}
                  >
                    <span className="font-bold leading-tight">{fmt.label}</span>
                    <span
                      className={`text-[10px] leading-tight font-mono ${
                        selectedFormat === fmt.id ? 'text-accent-contrast/90' : 'text-text-muted'
                      }`}
                    >
                      {fmt.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* F. DEFAULT / NO TOOL ACTIVE: Shifted Page Indicator & Zoom Level (Hidden in sub options) */}
          {activeTool === 'none' && (
            <div className="w-full h-full relative flex items-center justify-between px-3 sm:px-6 select-none">
              {/* Centered Page Number Indicator with Navigation Arrows - Absolutely centered to never move */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="pointer-events-auto flex items-center gap-2 bg-surface-subtle border border-surface-border rounded-control px-2 py-1 shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setActiveIndex((prev) => Math.max(0, prev - 1))}
                    disabled={activeIndex <= 0}
                    style={{ touchAction: 'manipulation' }}
                    className="min-w-[32px] min-h-[32px] inline-flex items-center justify-center rounded-control hover:bg-surface-hover hover:text-text-main text-text-muted disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                    aria-label="Previous page"
                    title="Previous page (Left arrow)"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="font-mono text-xs text-text-muted px-1 select-none">
                    Page <span className="font-bold text-text-main">{Math.min(pages.length, Math.max(1, activeIndex + 1))}</span> / {pages.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveIndex((prev) => Math.min(pages.length - 1, prev + 1))}
                    disabled={activeIndex >= pages.length - 1}
                    style={{ touchAction: 'manipulation' }}
                    className="min-w-[32px] min-h-[32px] inline-flex items-center justify-center rounded-control hover:bg-surface-hover hover:text-text-main text-text-muted disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                    aria-label="Next page"
                    title="Next page (Right arrow)"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Left Spacer to maintain flex layout structure */}
              <div className="w-28 shrink-0 pointer-events-none" />

              {/* Right: Zoom Level Controller (Fixed width and shape, never shifts or expands, Desktop only) */}
              <div className="relative z-10 hidden lg:flex items-center justify-end shrink-0">
                <div className="inline-flex items-center bg-surface-subtle border border-surface-border rounded-control p-0.5 shadow-2xs select-none">
                  <button
                    type="button"
                    onClick={handleZoomOut}
                    disabled={scale <= 1.0}
                    className="w-8 h-8 inline-flex items-center justify-center rounded-control text-text-muted hover:text-text-main hover:bg-surface-hover disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer transition-colors shrink-0"
                    title="Zoom out"
                    aria-label="Zoom out"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={handleResetFit}
                    className="font-mono text-xs font-semibold w-14 h-8 flex items-center justify-center text-text-main cursor-pointer hover:text-accent select-none text-center rounded-control transition-colors shrink-0"
                    title="Click to reset zoom to 100%"
                    aria-label="Reset zoom to 100%"
                  >
                    {Math.round(scale * 100)}%
                  </button>

                  <button
                    type="button"
                    onClick={handleZoomIn}
                    disabled={scale >= 8.0}
                    className="w-8 h-8 inline-flex items-center justify-center rounded-control text-text-muted hover:text-text-main hover:bg-surface-hover disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer transition-colors shrink-0"
                    title="Zoom in"
                    aria-label="Zoom in"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

      {/* 4. MOBILE SCROLLABLE BOTTOM TOOLBAR (Hidden on desktop) */}
      <div className="lg:hidden relative z-30 bg-surface-panel border-t border-surface-border px-3 py-2 overflow-x-auto no-scrollbar shrink-0 text-text-main">
        <div className="flex items-center justify-between gap-4 min-w-max px-2">
          {/* 1. Crop */}
          <button
            type="button"
            onClick={() => {
              if (activeTool === 'crop') {
                handleCancelCrop();
              } else {
                setActiveTool('crop');
              }
            }}
            style={{ touchAction: 'manipulation' }}
            className={`min-w-[52px] min-h-[44px] flex flex-col items-center justify-center gap-1 rounded-control cursor-pointer transition-colors touch-manipulation ${
              activeTool === 'crop' ? 'text-accent font-semibold' : 'text-text-muted hover:text-text-main'
            }`}
          >
            <CropIcon className="w-5 h-5" />
            <span className="text-xs font-medium">Crop</span>
          </button>

          {/* 2. Retake / Replace */}
          <button
            type="button"
            onClick={handleTriggerReplace}
            style={{ touchAction: 'manipulation' }}
            className="min-w-[52px] min-h-[44px] flex flex-col items-center justify-center gap-1 rounded-control text-text-muted hover:text-text-main cursor-pointer transition-colors touch-manipulation"
          >
            {isMobile ? <RotateCcw className="w-5 h-5" /> : <FolderPlus className="w-5 h-5" />}
            <span className="text-xs font-medium">{isMobile ? 'Retake' : 'Replace'}</span>
          </button>

          {/* 3. Rotate */}
          <button
            type="button"
            onClick={handleRotate}
            disabled={isRotating}
            style={{ touchAction: 'manipulation' }}
            className={`min-w-[52px] min-h-[44px] flex flex-col items-center justify-center gap-1 rounded-control cursor-pointer transition-colors touch-manipulation disabled:pointer-events-none ${
              isRotating ? 'text-accent font-semibold' : 'text-text-muted hover:text-text-main'
            }`}
          >
            <RotateCw className={`w-5 h-5 ${isRotating ? 'animate-spin text-accent' : ''}`} />
            <span className="text-xs font-medium">{isRotating ? 'Rotating' : 'Rotate'}</span>
          </button>

          {/* 4. Filters */}
          <button
            type="button"
            onClick={() => {
              if (activeTool === 'filters') {
                handleCancelFilters();
              } else {
                filterBackupRef.current = activePage?.filter || 'original';
                setActiveTool('filters');
              }
            }}
            style={{ touchAction: 'manipulation' }}
            className={`min-w-[52px] min-h-[44px] flex flex-col items-center justify-center gap-1 rounded-control cursor-pointer transition-colors touch-manipulation ${
              activeTool === 'filters' ? 'text-accent font-semibold' : 'text-text-muted hover:text-text-main'
            }`}
          >
            <Sparkles className="w-5 h-5" />
            <span className="text-xs font-medium">Filters</span>
          </button>

          {/* 5. Adjust */}
          <button
            type="button"
            onClick={() => {
              if (activeTool === 'adjust') {
                handleCancelAdjust();
              } else {
                adjustBackupRef.current = { ...(activePage?.adjustments || { brightness: 0, contrast: 0 }) };
                setAdjustments(adjustBackupRef.current);
                setActiveTool('adjust');
              }
            }}
            style={{ touchAction: 'manipulation' }}
            className={`min-w-[52px] min-h-[44px] flex flex-col items-center justify-center gap-1 rounded-control cursor-pointer transition-colors touch-manipulation ${
              activeTool === 'adjust' ? 'text-accent font-semibold' : 'text-text-muted hover:text-text-main'
            }`}
          >
            <Sliders className="w-5 h-5" />
            <span className="text-xs font-medium">Adjust</span>
          </button>

          {/* 6. Cleanup */}
          <button
            type="button"
            onClick={() => {
              if (activeTool === 'cleanup') {
                handleCancelCleanup();
              } else {
                setActiveTool('cleanup');
              }
            }}
            style={{ touchAction: 'manipulation' }}
            className={`min-w-[52px] min-h-[44px] flex flex-col items-center justify-center gap-1 rounded-control cursor-pointer transition-colors touch-manipulation ${
              activeTool === 'cleanup' ? 'text-accent font-semibold' : 'text-text-muted hover:text-text-main'
            }`}
          >
            <Eraser className="w-5 h-5" />
            <span className="text-xs font-medium">Cleanup</span>
          </button>

          {/* 7. Reorder */}
          <button
            type="button"
            onClick={() => setActiveTool((prev) => (prev === 'reorder' ? 'none' : 'reorder'))}
            style={{ touchAction: 'manipulation' }}
            className={`min-w-[52px] min-h-[44px] flex flex-col items-center justify-center gap-1 rounded-control cursor-pointer transition-colors touch-manipulation ${
              activeTool === 'reorder' ? 'text-accent font-semibold' : 'text-text-muted hover:text-text-main'
            }`}
          >
            <Layers className="w-5 h-5" />
            <span className="text-xs font-medium">Reorder</span>
          </button>

          {/* 8. Resize */}
          <button
            type="button"
            onClick={() => {
              if (activeTool === 'resize') {
                handleCancelResize();
              } else {
                if (activePage) {
                  setResizeBackupPage({ ...activePage });
                  setSelectedFormat(activePage.format || 'fit');
                }
                setActiveTool('resize');
              }
            }}
            style={{ touchAction: 'manipulation' }}
            className={`min-w-[52px] min-h-[44px] flex flex-col items-center justify-center gap-1 rounded-control cursor-pointer transition-colors touch-manipulation ${
              activeTool === 'resize' ? 'text-accent font-semibold' : 'text-text-muted hover:text-text-main'
            }`}
          >
            <Maximize2 className="w-5 h-5" />
            <span className="text-xs font-medium">Resize</span>
          </button>

          {/* 9. Delete with Confirmation Card */}
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            style={{ touchAction: 'manipulation' }}
            className="min-w-[52px] min-h-[44px] flex flex-col items-center justify-center gap-1 rounded-control text-status-error hover:bg-status-error-bg cursor-pointer transition-colors touch-manipulation"
            title="Delete this page"
          >
            <Trash2 className="w-5 h-5" />
            <span className="text-xs font-medium">Delete</span>
          </button>
        </div>
      </div>

      {/* 5. MOBILE BOTTOM ACTION BAR (Hidden on desktop) */}
      <div className="lg:hidden relative z-30 bg-surface-bg border-t border-surface-border px-3 sm:px-4 py-3 pb-[max(1.25rem,var(--safe-area-bottom))] pl-[max(0.75rem,var(--safe-area-left))] pr-[max(0.75rem,var(--safe-area-right))] flex items-center justify-between gap-2 sm:gap-3 shrink-0 transition-[padding] duration-150">
        <button
          type="button"
          onClick={handleTriggerAddFiles}
          className="flex-1 min-w-0 max-w-[180px] min-h-[44px] px-3 rounded-control border border-surface-border bg-surface-panel hover:bg-surface-hover text-text-main font-semibold text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
        >
          {isMobile ? (
            <>
              <Camera className="w-4 h-4 shrink-0" />
              <span className="truncate">Keep scanning</span>
            </>
          ) : (
            <>
              <FolderPlus className="w-4 h-4 shrink-0" />
              <span className="truncate">Add Files</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={handleSavePdf}
          disabled={isProcessing}
          className="flex-1 min-w-0 min-h-[44px] px-4 rounded-control bg-accent hover:bg-accent-hover text-accent-contrast font-semibold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:bg-surface-disabled disabled:text-text-disabled"
        >
          <FileDown className="w-4 h-4 shrink-0" />
          <span className="truncate">Save PDF</span>
        </button>
      </div>
    </div>

    {/* Desktop Right Side Bar: Main Options + 2 Main Buttons (Add Files & Save PDF) */}
    <div className="hidden lg:flex flex-col w-72 xl:w-80 border-l border-surface-border bg-surface-panel shrink-0 h-full justify-between select-none z-30">
      <div className="px-5 py-3.5 border-b border-surface-border shrink-0 flex items-center justify-between">
        <div>
          <h3 className="font-bold text-sm text-text-main leading-tight">Tools</h3>
          <p className="text-xs text-text-muted font-mono mt-0.5">
            Page {activeIndex + 1} of {pages.length}
          </p>
        </div>
        {activeTool !== 'none' && activeTool !== 'reorder' && (
          <button
            type="button"
            onClick={() => {
              if (activeTool === 'filters') handleCancelFilters();
              else if (activeTool === 'adjust') handleCancelAdjust();
              else if (activeTool === 'cleanup') handleCancelCleanup();
              else if (activeTool === 'crop') handleCancelCrop();
              else if (activeTool === 'resize') handleCancelResize();
              else setActiveTool('none');
            }}
            className="text-xs font-semibold text-accent hover:underline cursor-pointer"
          >
            Close tool
          </button>
        )}
      </div>

      {/* Main Options Grid */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        <div className="text-[11px] font-mono font-bold tracking-wider text-text-muted uppercase px-1">
          Page Options
        </div>

        <div className="grid grid-cols-2 gap-2">
          {/* 1. Crop */}
          <button
            type="button"
            onClick={() => {
              if (activeTool === 'crop') {
                handleCancelCrop();
              } else {
                setActiveTool('crop');
              }
            }}
            className={`min-h-[44px] px-3 rounded-control flex items-center gap-2.5 text-xs transition-colors cursor-pointer border ${
              activeTool === 'crop'
                ? 'bg-accent/15 text-accent border-accent/40 font-semibold shadow-2xs'
                : 'bg-surface-subtle hover:bg-surface-hover text-text-main border-surface-border font-medium'
            }`}
          >
            <CropIcon className="w-4 h-4 shrink-0" />
            <span className="truncate">Crop</span>
          </button>

          {/* 2. Replace */}
          <button
            type="button"
            onClick={handleTriggerReplace}
            className="min-h-[44px] px-3 rounded-control flex items-center gap-2.5 text-xs bg-surface-subtle hover:bg-surface-hover text-text-main border border-surface-border font-medium transition-colors cursor-pointer"
          >
            <FolderPlus className="w-4 h-4 shrink-0" />
            <span className="truncate">Replace</span>
          </button>

          {/* 3. Rotate */}
          <button
            type="button"
            onClick={handleRotate}
            disabled={isRotating || isProcessing}
            className="w-full min-h-[44px] px-2.5 rounded-control flex items-center justify-center gap-1.5 text-xs bg-surface-subtle hover:bg-surface-hover text-text-main border border-surface-border font-medium transition-colors cursor-pointer disabled:opacity-50"
            title="Rotate active page 90° Clockwise"
          >
            <RotateCw className={`w-3.5 h-3.5 shrink-0 ${isRotating ? 'animate-spin text-accent' : ''}`} />
            <span className="truncate">{isRotating ? 'Rotating…' : 'Rotate'}</span>
          </button>

          {/* 4. Filters */}
          <button
            type="button"
            onClick={() => {
              if (activeTool === 'filters') {
                handleCancelFilters();
              } else {
                filterBackupRef.current = activePage?.filter || 'original';
                setActiveTool('filters');
              }
            }}
            className={`min-h-[44px] px-3 rounded-control flex items-center gap-2.5 text-xs transition-colors cursor-pointer border ${
              activeTool === 'filters'
                ? 'bg-accent/15 text-accent border-accent/40 font-semibold shadow-2xs'
                : 'bg-surface-subtle hover:bg-surface-hover text-text-main border-surface-border font-medium'
            }`}
          >
            <Sparkles className="w-4 h-4 shrink-0" />
            <span className="truncate">Filters</span>
          </button>

          {/* 5. Adjust */}
          <button
            type="button"
            onClick={() => {
              if (activeTool === 'adjust') {
                handleCancelAdjust();
              } else {
                adjustBackupRef.current = { ...(activePage?.adjustments || { brightness: 0, contrast: 0 }) };
                setAdjustments(adjustBackupRef.current);
                setActiveTool('adjust');
              }
            }}
            className={`min-h-[44px] px-3 rounded-control flex items-center gap-2.5 text-xs transition-colors cursor-pointer border ${
              activeTool === 'adjust'
                ? 'bg-accent/15 text-accent border-accent/40 font-semibold shadow-2xs'
                : 'bg-surface-subtle hover:bg-surface-hover text-text-main border-surface-border font-medium'
            }`}
          >
            <Sliders className="w-4 h-4 shrink-0" />
            <span className="truncate">Adjust</span>
          </button>

          {/* 6. Cleanup */}
          <button
            type="button"
            onClick={() => {
              if (activeTool === 'cleanup') {
                handleCancelCleanup();
              } else {
                setActiveTool('cleanup');
              }
            }}
            className={`min-h-[44px] px-3 rounded-control flex items-center gap-2.5 text-xs transition-colors cursor-pointer border ${
              activeTool === 'cleanup'
                ? 'bg-accent/15 text-accent border-accent/40 font-semibold shadow-2xs'
                : 'bg-surface-subtle hover:bg-surface-hover text-text-main border-surface-border font-medium'
            }`}
          >
            <Eraser className="w-4 h-4 shrink-0" />
            <span className="truncate">Cleanup</span>
          </button>

          {/* 7. Resize */}
          <button
            type="button"
            onClick={() => {
              if (activeTool === 'resize') {
                handleCancelResize();
              } else {
                if (activePage) {
                  setResizeBackupPage({ ...activePage });
                  setSelectedFormat(activePage.format || 'fit');
                }
                setActiveTool('resize');
              }
            }}
            className={`min-h-[44px] px-3 rounded-control flex items-center gap-2.5 text-xs transition-colors cursor-pointer border ${
              activeTool === 'resize'
                ? 'bg-accent/15 text-accent border-accent/40 font-semibold shadow-2xs'
                : 'bg-surface-subtle hover:bg-surface-hover text-text-main border-surface-border font-medium'
            }`}
          >
            <Maximize2 className="w-4 h-4 shrink-0" />
            <span className="truncate">Resize</span>
          </button>

          {/* 8. Reorder */}
          <button
            type="button"
            onClick={() => setActiveTool((prev) => (prev === 'reorder' ? 'none' : 'reorder'))}
            disabled={pages.length <= 1}
            className={`min-h-[44px] px-3 rounded-control flex items-center gap-2.5 text-xs transition-colors cursor-pointer border disabled:opacity-40 disabled:cursor-not-allowed ${
              activeTool === 'reorder'
                ? 'bg-accent/15 text-accent border-accent/40 font-semibold shadow-2xs'
                : 'bg-surface-subtle hover:bg-surface-hover text-text-main border-surface-border font-medium'
            }`}
          >
            <Layers className="w-4 h-4 shrink-0" />
            <span className="truncate">Reorder</span>
          </button>
        </div>

        {/* 9. Delete Current Page */}
        <button
          type="button"
          onClick={() => setShowDeleteConfirm(true)}
          className="w-full min-h-[40px] px-3 rounded-control flex items-center justify-center gap-2 text-xs font-semibold text-status-error hover:bg-status-error-bg border border-transparent hover:border-status-error-border transition-colors cursor-pointer"
        >
          <Trash2 className="w-4 h-4 shrink-0" />
          <span>Delete Page</span>
        </button>
      </div>

      {/* Action Buttons: Undo/Redo, Add Files, Save PDF */}
      <div className="p-4 border-t border-surface-border bg-surface-panel space-y-2.5 shrink-0">
        {/* Undo & Redo Controls (Hidden when a particular tool is opened) */}
        {activeTool === 'none' && (
          <div className="grid grid-cols-2 gap-2 pb-1">
            <button
              type="button"
              onClick={handleUndo}
              disabled={!canUndo}
              className="min-h-[38px] px-3 rounded-control border border-surface-border bg-surface-subtle hover:bg-surface-hover text-text-main font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Undo"
            >
              <Undo2 className="w-4 h-4 shrink-0" />
              <span>Undo</span>
            </button>

            <button
              type="button"
              onClick={handleRedo}
              disabled={!canRedo}
              className="min-h-[38px] px-3 rounded-control border border-surface-border bg-surface-subtle hover:bg-surface-hover text-text-main font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Redo"
            >
              <Redo2 className="w-4 h-4 shrink-0" />
              <span>Redo</span>
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={handleTriggerAddFiles}
          className="w-full min-h-[42px] px-3 rounded-control border border-surface-border bg-surface-subtle hover:bg-surface-hover text-text-main font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors"
        >
          <FolderPlus className="w-4 h-4 shrink-0" />
          <span>Add Files</span>
        </button>

        <button
          type="button"
          onClick={handleSavePdf}
          disabled={isProcessing}
          className="w-full min-h-[44px] px-4 rounded-control bg-accent hover:bg-accent-hover text-accent-contrast font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-sm disabled:bg-surface-disabled disabled:text-text-disabled"
        >
          {isProcessing ? (
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          ) : (
            <FileDown className="w-4 h-4 shrink-0" />
          )}
          <span>Save PDF</span>
        </button>
      </div>
    </div>

    {/* FULL-SCREEN REORDER OVERLAY */}
    {activeTool === 'reorder' && (
      <div className="absolute inset-0 z-50 bg-surface-bg text-text-main flex flex-col justify-between overflow-hidden animate-in fade-in duration-150">
        {/* Top Bar: Title Left, Cancel + Done Right (Consistent with other sub-panels) */}
        <div className="relative z-10 px-4 py-3 pt-[max(0.75rem,var(--safe-area-top))] pl-[max(1rem,var(--safe-area-left))] pr-[max(1rem,var(--safe-area-right))] flex items-center justify-between border-b border-surface-border bg-surface-panel shrink-0">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-accent" />
            <h2 className="text-base font-bold text-text-main">
              Reorder Pages <span className="text-xs font-normal text-text-muted">({reorderPages.length})</span>
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCancelReorder}
              className="h-8 px-3 rounded-control text-xs font-medium text-text-muted hover:text-text-main bg-surface-subtle hover:bg-surface-hover border border-surface-border transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmReorder}
              className="h-8 px-4 rounded-control text-xs font-bold text-accent-contrast bg-accent hover:bg-accent-hover shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Done</span>
            </button>
          </div>
        </div>

        {/* Reorder Instruction Banner */}
        <div className="bg-surface-subtle/80 border-b border-surface-border px-4 py-2 text-center text-xs text-text-muted select-none flex items-center justify-center gap-1.5">
          <span>Drag cards to reorder, or use the</span>
          <ChevronLeft className="w-3.5 h-3.5 inline text-text-main" />
          <span>and</span>
          <ChevronRight className="w-3.5 h-3.5 inline text-text-main" />
          <span>move buttons below each page.</span>
        </div>

        {/* 2-Column Scrollable Grid */}
        <div
          onTouchMove={moveTouchDrag}
          onTouchEnd={endTouchDrag}
          onTouchCancel={endTouchDrag}
          className="flex-1 min-h-0 overflow-y-auto p-6 sm:p-8 select-none"
        >
          {/* Floating Dragged Card Follower (for mobile touch drag) */}
          {draggedPageIndex !== null && touchDragPos !== null && reorderPages[draggedPageIndex] && (
            <div
              style={{
                left: `${touchDragPos.x}px`,
                top: `${touchDragPos.y}px`,
                transform: 'translate(-50%, -50%) scale(1.08)',
              }}
              className="fixed z-50 pointer-events-none w-36 aspect-[1/1.414] bg-white rounded-lg shadow-2xl border-2 border-accent overflow-hidden opacity-95 transition-none"
            >
              <img
                src={reorderPages[draggedPageIndex].displayUrl}
                className="w-full h-full object-contain pointer-events-none"
                alt="Dragging preview"
              />
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4 sm:gap-6 w-full max-w-[1800px] mx-auto px-2 sm:px-4">
            {reorderPages.map((p, idx) => {
              const isBeingDragged = draggedPageIndex === idx;
              const isDragTarget = dragOverPageIndex === idx;
              const isSelectedForSwap = selectedSwapIndex === idx;

              return (
                <div
                  key={p.id}
                  data-reorder-index={idx}
                  draggable={true}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', String(idx));
                    setDraggedPageIndex(idx);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverPageIndex !== idx) {
                      setDragOverPageIndex(idx);
                    }
                  }}
                  onDragLeave={() => {
                    if (dragOverPageIndex === idx) {
                      setDragOverPageIndex(null);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const fromStr = e.dataTransfer.getData('text/plain');
                    const from = fromStr !== '' ? parseInt(fromStr, 10) : draggedPageIndex;
                    if (from !== null && from !== undefined && !isNaN(from) && from !== idx) {
                      handleMoveReorderPage(from, idx);
                    }
                    setDraggedPageIndex(null);
                    setDragOverPageIndex(null);
                  }}
                  onDragEnd={() => {
                    setDraggedPageIndex(null);
                    setDragOverPageIndex(null);
                  }}
                  onClick={() => {
                    if (draggedPageIndex !== null) return;
                    if (selectedSwapIndex === null) {
                      setSelectedSwapIndex(idx);
                    } else if (selectedSwapIndex === idx) {
                      setSelectedSwapIndex(null);
                    } else {
                      handleMoveReorderPage(selectedSwapIndex, idx);
                      setSelectedSwapIndex(null);
                    }
                  }}
                  onTouchStart={(e) => startTouchHold(idx, e)}
                  className="relative flex flex-col items-center cursor-grab active:cursor-grabbing select-none"
                >
                  <div
                    className={`w-full aspect-[1/1.414] bg-white rounded-none overflow-hidden border transition-all flex items-center justify-center ${
                      isBeingDragged
                        ? 'opacity-40 border-2 border-accent shadow-lifted scale-95'
                        : isDragTarget && draggedPageIndex !== null && draggedPageIndex !== idx
                        ? 'border-accent ring-2 ring-accent shadow-lifted z-20 scale-105'
                        : isSelectedForSwap
                        ? 'ring-2 ring-accent border-accent shadow-lifted'
                        : 'border-surface-border hover:border-text-muted shadow-sm'
                    }`}
                  >
                    <img
                      src={p.displayUrl}
                      alt={`Page ${idx + 1}`}
                      className="w-full h-full object-contain pointer-events-none"
                      draggable={false}
                    />
                  </div>

                  {/* Move Left / Right Buttons and Page Indicator */}
                  <div className="mt-2.5 flex items-center justify-between w-full max-w-[150px] px-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMoveReorderPage(idx, idx - 1);
                      }}
                      disabled={idx === 0}
                      className="w-7 h-7 rounded-full bg-surface-subtle hover:bg-surface-hover border border-surface-border flex items-center justify-center text-text-main disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer transition-colors"
                      title="Move left"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>

                    <span className="text-xs font-mono font-bold text-text-main">
                      #{idx + 1}
                    </span>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMoveReorderPage(idx, idx + 1);
                      }}
                      disabled={idx === reorderPages.length - 1}
                      className="w-7 h-7 rounded-full bg-surface-subtle hover:bg-surface-hover border border-surface-border flex items-center justify-center text-text-main disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer transition-colors"
                      title="Move right"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {isDragTarget && draggedPageIndex !== null && draggedPageIndex !== idx && (
                    <div className="absolute -top-2.5 px-2.5 py-0.5 rounded-chip bg-accent text-accent-contrast text-xs font-mono font-semibold shadow-lifted pointer-events-none">
                      Drop #{idx + 1}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    )}
  </div>

      {/* DISCARD SCAN CONFIRMATION WARNING MODAL */}
      {showDiscardConfirm && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-sheet bg-surface-panel border border-surface-border p-5 shadow-lifted text-center space-y-4"
          >
            <div className="space-y-1.5">
              <h3 className="font-semibold text-md text-text-main">
                Discard scan?
              </h3>
              <p className="text-sm text-text-muted">
                Unsaved changes and pages will be discarded.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDiscardConfirm(false)}
                className="flex-1 min-h-[44px] px-4 rounded-control border border-surface-border bg-surface-subtle hover:bg-surface-hover text-text-main font-semibold text-sm transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDiscardConfirm(false);
                  onClose();
                }}
                className="flex-1 min-h-[44px] px-4 rounded-control bg-status-error hover:opacity-90 text-white font-semibold text-sm transition-colors cursor-pointer"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE PAGE CONFIRMATION WARNING MODAL */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-sheet bg-surface-panel border border-surface-border p-5 shadow-lifted text-center space-y-4"
          >
            <div className="space-y-1.5">
              <h3 className="font-semibold text-md text-text-main">
                Delete this page?
              </h3>
              <p className="text-sm text-text-muted">
                Page {activeIndex + 1} of {pages.length} will be permanently removed.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 min-h-[44px] px-4 rounded-control border border-surface-border bg-surface-subtle hover:bg-surface-hover text-text-main font-semibold text-sm transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  handleDeletePage(activeIndex);
                }}
                className="flex-1 min-h-[44px] px-4 rounded-control bg-status-error hover:opacity-90 text-white font-semibold text-sm transition-colors cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden File Inputs for Desktop Add Files & Replace inside Editor */}
      {!isMobile && (
        <>
          <input
            ref={desktopAddFilesInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/avif,image/bmp,image/*,application/pdf,.pdf"
            className="hidden"
            onChange={handleDesktopAddFilesChange}
          />
          <input
            ref={desktopReplaceInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif,image/bmp,image/*"
            className="hidden"
            onChange={handleDesktopReplaceChange}
          />
        </>
      )}
    </div>,
    document.body
  );
};
