import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Share2,
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
  X,
  FolderPlus,
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
import { saveScan, type StoredScanDoc } from './scans-db';
import type { CapturedScanItem } from './CameraViewfinder';
import { convertFilesToImagePages } from './convert-pdf-pages';
import { PDFDocument } from 'pdf-lib';
import { downloadBlob, shareBlob } from '../../core/processors';

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
  const dragStartRef = useRef<{
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
  const [cleanupColor, setCleanupColor] = useState<string>('#FFFFFF');
  const [isEyedropperActive, setIsEyedropperActive] = useState<boolean>(false);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [cleanupHistory, setCleanupHistory] = useState<ImageData[]>([]);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState<boolean>(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);

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

  // Smooth Gallery-style Touch Dragging
  const [dragOffset, setDragOffset] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const touchStartTimeRef = useRef<number>(0);
  const isHorizontalDragRef = useRef<boolean | null>(null);
  const galleryContainerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (activeTool !== 'none' || pages.length <= 1) return;
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
    touchStartTimeRef.current = Date.now();
    isHorizontalDragRef.current = null;
    setIsDragging(true);
    setDragOffset(0);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null || touchStartYRef.current === null || activeTool !== 'none' || pages.length <= 1) return;

    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const deltaX = currentX - touchStartXRef.current;
    const deltaY = currentY - touchStartYRef.current;

    if (isHorizontalDragRef.current === null) {
      if (Math.abs(deltaX) > 6 || Math.abs(deltaY) > 6) {
        isHorizontalDragRef.current = Math.abs(deltaX) > Math.abs(deltaY);
      }
    }

    if (isHorizontalDragRef.current === true) {
      // Rubber-band resistance at edges
      if ((activeIndex === 0 && deltaX > 0) || (activeIndex === pages.length - 1 && deltaX < 0)) {
        setDragOffset(deltaX * 0.32);
      } else {
        setDragOffset(deltaX);
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null) return;

    const currentX = e.changedTouches[0].clientX;
    const deltaX = currentX - touchStartXRef.current;
    const deltaTime = Math.max(1, Date.now() - touchStartTimeRef.current);
    const velocity = deltaX / deltaTime; // px/ms
    const containerWidth = galleryContainerRef.current?.clientWidth || window.innerWidth;
    const threshold = containerWidth * 0.5; // 50% threshold requested by user
    const isFlick = Math.abs(velocity) > 0.45 && Math.abs(deltaX) > 35;

    const isHorizontal = isHorizontalDragRef.current;

    touchStartXRef.current = null;
    touchStartYRef.current = null;
    isHorizontalDragRef.current = null;
    setIsDragging(false);
    setDragOffset(0);

    if (isHorizontal) {
      if ((deltaX < -threshold || (isFlick && deltaX < 0)) && activeIndex < pages.length - 1) {
        setActiveIndex((prev) => prev + 1);
      } else if ((deltaX > threshold || (isFlick && deltaX > 0)) && activeIndex > 0) {
        setActiveIndex((prev) => prev - 1);
      }
    }
  };

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
        }
        setActiveTool('none');
      } else if (pages.length > 0) {
        setShowDiscardConfirm(true);
      } else {
        onClose();
      }
    };

    window.addEventListener('hardwareBackPress', handleHardwareBack);
    return () => window.removeEventListener('hardwareBackPress', handleHardwareBack);
  }, [isOpen, showDiscardConfirm, showDeleteConfirm, activeTool, pages.length, onClose]);

  // Initialize pages when opened
  useEffect(() => {
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
    } else if (scanItems && scanItems.length > 0) {
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
  }, [initialPages, initialScan, scanItems]);

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

  // Free 4-Corner Cropper Pointer Handlers (Adobe Scan style)
  const handleHandlePointerDown = (handle: CropHandleType, e: React.PointerEvent) => {
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      corners: { ...cropCorners },
    };
    setDraggingHandle(handle);
  };

  const handleCropPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingHandle || !cropContainerRef.current || !dragStartRef.current) return;
    const rect = cropContainerRef.current.getBoundingClientRect();
    const init = dragStartRef.current.corners;
    const dx = (e.clientX - dragStartRef.current.clientX) / rect.width;
    const dy = (e.clientY - dragStartRef.current.clientY) / rect.height;
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
    dragStartRef.current = null;
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

  const handleDoneResize = () => {
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
    ctx.lineWidth = brushSize * scaleX * 0.5;

    ctx.beginPath();
    ctx.arc(x, y, (brushSize * scaleX * 0.5) / 2, 0, Math.PI * 2);
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

      const pdfPage = pdfDoc.addPage([imgWidth, imgHeight]);
      pdfPage.drawImage(embeddedImg, {
        x: 0,
        y: 0,
        width: imgWidth,
        height: imgHeight,
      });
    }

    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
  };

  // Helper to persist to IndexedDB
  const persistScanToDb = async () => {
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

      const savedScan: StoredScanDoc = {
        id: initialScan?.id || `scan_${Date.now()}`,
        title: docName,
        createdAt: initialScan?.createdAt || Date.now(),
        thumbnailUrl: thumbDataUrl,
        pageCount: pages.length,
        pages: storedPages,
      };

      await saveScan(savedScan);
      if (onScanSaved) onScanSaved(savedScan);
    } catch (e) {
      console.warn('Storage save warning:', e);
    }
  };

  // Save High-Resolution PDF & Persist to Scanned Documents List
  const handleSavePdf = async () => {
    if (pages.length === 0) return;
    setIsProcessing(true);
    try {
      const pdfBlob = await generatePdfBlob();
      const filename = `${docName.replace(/\s+/g, '_')}.pdf`;
      await downloadBlob(pdfBlob, filename);
      await persistScanToDb();
      onSavePdf(pdfBlob, filename);
    } catch (err) {
      console.error('Failed to create PDF:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Share High-Resolution PDF with Caption
  const handleShareDoc = async () => {
    if (pages.length === 0) return;
    setIsProcessing(true);
    try {
      const pdfBlob = await generatePdfBlob();
      const filename = `${docName.replace(/\s+/g, '_')}.pdf`;
      await persistScanToDb();
      await shareBlob(pdfBlob, filename);
    } catch (err) {
      console.error('Failed to share PDF:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen || pages.length === 0) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-surface-bg text-text-main flex flex-col justify-between overflow-hidden select-none animate-in fade-in">
      {/* 1. TOP HEADER (Theme-aligned with safe-area status bar spacing) */}
      <div className="relative z-30 px-4 py-3 pt-[max(0.75rem,var(--safe-area-top))] pl-[max(1rem,var(--safe-area-left))] pr-[max(1rem,var(--safe-area-right))] flex items-center justify-between border-b border-surface-border bg-surface-panel text-text-main shrink-0 transition-[padding] duration-150">
        {/* Back Arrow with Discard Confirmation */}
        <button
          type="button"
          onClick={() => setShowDiscardConfirm(true)}
          className="p-1.5 rounded-full hover:bg-surface-subtle text-text-main active:scale-95 transition-colors cursor-pointer"
          aria-label="Back"
          title="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {/* Editable Document Title */}
        <div className="flex items-center gap-1.5 max-w-[220px] sm:max-w-md">
          {isEditingName ? (
            <input
              type="text"
              value={docName}
              autoFocus
              onBlur={() => setIsEditingName(false)}
              onKeyDown={(e) => e.key === 'Enter' && setIsEditingName(false)}
              onChange={(e) => setDocName(e.target.value)}
              className="bg-surface-subtle text-text-main font-semibold text-sm px-2.5 py-1 rounded-md border border-accent focus:outline-none w-full"
            />
          ) : (
            <button
              type="button"
              onClick={() => setIsEditingName(true)}
              className="flex items-center gap-1.5 text-sm font-semibold truncate hover:text-accent cursor-pointer text-text-main"
              title="Click to rename document"
            >
              <span className="truncate">{docName}</span>
              <Edit2 className="w-3.5 h-3.5 text-text-muted shrink-0" />
            </button>
          )}
        </div>

        {/* Right Action: Share with Caption */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleShareDoc}
            className="p-2 rounded-full hover:bg-surface-subtle text-text-main active:scale-95 transition-colors cursor-pointer"
            aria-label="Share document"
            title="Share with caption"
          >
            <Share2 className="w-5 h-5 text-accent" />
          </button>
        </div>
      </div>

      {/* 2. CENTER PREVIEW AREA & PAGE VIEWER (With Smooth Gallery Carousel Drag) */}
      <div className="relative flex-1 min-h-0 w-full flex flex-col items-center justify-between overflow-hidden bg-[#E2E4E8] dark:bg-[#121214] transition-colors duration-150">
        {/* Page Indicator Bar - Undo & Redo ONLY shown in main menu (when no dedicated tool is active) */}
        <div className="w-full flex items-center justify-between px-4 py-2 shrink-0 select-none">
          {activeTool === 'none' ? (
            <button
              type="button"
              onClick={handleUndo}
              disabled={!canUndo}
              style={{ touchAction: 'manipulation' }}
              className="p-1.5 rounded-full hover:bg-surface-subtle text-text-main disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer transition-colors active:scale-95 touch-manipulation"
              aria-label="Undo"
              title="Undo"
            >
              <Undo2 className="w-4 h-4" />
            </button>
          ) : (
            <div className="w-7 h-7" />
          )}

          {pages.length > 1 ? (
            <div className="flex items-center gap-3 text-xs text-text-muted">
              <button
                type="button"
                onClick={() => setActiveIndex((prev) => Math.max(0, prev - 1))}
                disabled={activeIndex === 0}
                style={{ touchAction: 'manipulation' }}
                className="p-1 rounded-full hover:bg-surface-subtle hover:text-text-main disabled:opacity-20 cursor-pointer transition-colors touch-manipulation"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-mono text-xs">
                Page <span className="font-bold text-text-main">{activeIndex + 1}</span> of {pages.length}
              </span>
              <button
                type="button"
                onClick={() => setActiveIndex((prev) => Math.min(pages.length - 1, prev + 1))}
                disabled={activeIndex === pages.length - 1}
                style={{ touchAction: 'manipulation' }}
                className="p-1 rounded-full hover:bg-surface-subtle hover:text-text-main disabled:opacity-20 cursor-pointer transition-colors touch-manipulation"
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="text-xs text-text-muted font-mono">
              Page <span className="font-bold text-text-main">1</span> of 1
            </div>
          )}

          {activeTool === 'none' ? (
            <button
              type="button"
              onClick={handleRedo}
              disabled={!canRedo}
              style={{ touchAction: 'manipulation' }}
              className="p-1.5 rounded-full hover:bg-surface-subtle text-text-main disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer transition-colors active:scale-95 touch-manipulation"
              aria-label="Redo"
              title="Redo"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          ) : (
            <div className="w-7 h-7" />
          )}
        </div>

        {/* Smooth Gallery Track Container */}
        <div
          ref={galleryContainerRef}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          className="relative flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden touch-pan-y select-none"
        >
          <div
            className="flex h-full w-full items-center"
            style={{
              transform: `translateX(calc(-${activeIndex * 100}% + ${dragOffset}px))`,
              transition: isDragging ? 'none' : 'transform 260ms cubic-bezier(0.16, 1, 0.3, 1)',
              willChange: 'transform',
            }}
          >
            {pages.map((page, idx) => (
              <div
                key={page.id}
                className="w-full h-full shrink-0 flex items-center justify-center p-2 sm:p-4"
              >
                <div className="relative max-w-full max-h-[66vh] flex items-center justify-center shadow-2xl rounded-none overflow-hidden border border-black/10 dark:border-white/10 bg-white">
                  <img
                    ref={idx === activeIndex ? imageElementRef : undefined}
                    src={idx === activeIndex && activeTool === 'crop' ? page.originalUrl : page.displayUrl}
                    alt={`Page ${idx + 1}`}
                    onLoad={() => {
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
                    className="max-w-full max-h-[66vh] object-contain block bg-white transition-opacity duration-150 select-none pointer-events-none"
                    draggable={false}
                  />

                  {/* Visible processing overlay (for Rotate, Filters, Resize, Adjustments) */}
                  {idx === activeIndex && (isRotating || isProcessing) && (
                    <div className="absolute inset-0 bg-black/20 backdrop-blur-[1px] flex items-center justify-center z-30 pointer-events-none animate-in fade-in duration-100">
                      <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-surface-panel/95 text-text-main shadow-lg border border-surface-border text-xs font-semibold">
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

                          {/* Accent Quad Polygon matching Paperweight logo */}
                          <polygon
                            points={`
                              ${cropCorners.topLeft.x * 100},${cropCorners.topLeft.y * 100}
                              ${cropCorners.topRight.x * 100},${cropCorners.topRight.y * 100}
                              ${cropCorners.bottomRight.x * 100},${cropCorners.bottomRight.y * 100}
                              ${cropCorners.bottomLeft.x * 100},${cropCorners.bottomLeft.y * 100}
                            `}
                            fill="rgba(217, 119, 6, 0.12)"
                            stroke="#d97706"
                            strokeWidth="2.5"
                            vectorEffect="non-scaling-stroke"
                          />
                        </svg>

                        {/* 4 Edge Midpoint Pill Handles (Logo Accent style) */}
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
                              className={`w-7 h-2.5 rounded-full border-[2px] border-[#d97706] bg-white dark:bg-stone-900 shadow-md transition-transform ${
                                draggingHandle === key ? 'scale-125 ring-2 ring-orange-500/50' : 'hover:scale-110 active:scale-125'
                              }`}
                            />
                          </div>
                        ))}

                        {/* 4 Circular Corner Handles (Logo Accent style) */}
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
                              className={`w-7 h-7 rounded-full border-[2.5px] border-[#d97706] bg-orange-500/20 backdrop-blur-[1px] shadow-lg flex items-center justify-center transition-transform ${
                                draggingHandle === key
                                  ? 'scale-125 ring-4 ring-orange-500/40 bg-orange-500/30'
                                  : 'hover:scale-110 active:scale-125'
                              }`}
                            >
                              <div className="w-1.5 h-1.5 rounded-full bg-white shadow-sm" />
                            </div>
                          </div>
                        ))}

                        {/* Floating Magnifying Loupe with Crosshair Reticle (Logo Accent style) */}
                        {activeTargetPoint && (
                          <div
                            style={{
                              left: `${loupeCenterX}px`,
                              top: `${loupeCenterY}px`,
                              width: `${loupeSize}px`,
                              height: `${loupeSize}px`,
                              transform: 'translate(-50%, -50%)',
                            }}
                            className="absolute rounded-full overflow-hidden border-[2.5px] border-[#d97706] shadow-2xl bg-neutral-900 pointer-events-none z-40 animate-in fade-in duration-100"
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
                            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[1.5px] bg-[#d97706] opacity-90 shadow-sm" />
                            <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[1.5px] bg-[#d97706] opacity-90 shadow-sm" />
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full border border-[#d97706] opacity-75" />
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
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 2.5 FULL-SCREEN REORDER OVERLAY (Matching User Reference Image 1) */}
      {activeTool === 'reorder' && (
        <div className="absolute inset-0 z-50 bg-surface-bg text-text-main flex flex-col justify-between overflow-hidden animate-in fade-in duration-150">
          {/* Top Bar: [✕] Left, [Reorder] Center, [✓] Right */}
          <div className="relative z-10 px-4 py-3 pt-[max(0.75rem,var(--safe-area-top))] pl-[max(1rem,var(--safe-area-left))] pr-[max(1rem,var(--safe-area-right))] flex items-center justify-between border-b border-surface-border bg-surface-panel shrink-0">
            <button
              type="button"
              onClick={handleCancelReorder}
              className="p-1.5 rounded-full hover:bg-surface-subtle text-text-muted hover:text-text-main active:scale-95 transition-colors cursor-pointer"
              aria-label="Cancel reorder"
              title="Cancel"
            >
              <X className="w-5 h-5" />
            </button>

            <h2 className="text-base font-semibold text-text-main">Reorder</h2>

            <button
              type="button"
              onClick={handleConfirmReorder}
              className="p-1.5 rounded-full hover:bg-surface-subtle text-accent active:scale-95 transition-colors cursor-pointer"
              aria-label="Confirm reorder"
              title="Confirm"
            >
              <Check className="w-5 h-5 stroke-[2.5]" />
            </button>
          </div>

          {/* 2-Column Scrollable Grid */}
          <div
            onTouchMove={moveTouchDrag}
            onTouchEnd={endTouchDrag}
            onTouchCancel={endTouchDrag}
            className="flex-1 min-h-0 overflow-y-auto p-6 sm:p-8 select-none"
          >
            {/* Floating Dragged Card Follower (Follows user finger anywhere on screen) */}
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

            <div className="grid grid-cols-2 gap-x-6 gap-y-6 max-w-md mx-auto">
              {reorderPages.map((p, idx) => {
                const isBeingDragged = draggedPageIndex === idx;
                const isDragTarget = dragOverPageIndex === idx;
                const isSelectedForSwap = selectedSwapIndex === idx;

                return (
                  <div
                    key={p.id}
                    data-reorder-index={idx}
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
                    style={{ touchAction: 'none' }}
                    className="relative flex flex-col items-center cursor-grab active:cursor-grabbing select-none touch-none"
                  >
                    <div
                      className={`w-full aspect-[1/1.414] bg-white rounded-none overflow-hidden shadow-md border transition-all duration-150 flex items-center justify-center ${
                        isBeingDragged
                          ? 'opacity-30 scale-95 border-dashed border-2 border-accent/60 ring-2 ring-accent/20'
                          : isDragTarget && draggedPageIndex !== null && draggedPageIndex !== idx
                          ? 'border-accent ring-4 ring-accent scale-105 shadow-2xl z-20 bg-accent/10'
                          : isSelectedForSwap
                          ? 'scale-105 ring-2 ring-accent border-accent shadow-xl'
                          : 'border-surface-border'
                      }`}
                    >
                      <img
                        src={p.displayUrl}
                        alt={`Page ${idx + 1}`}
                        className="w-full h-full object-contain pointer-events-none"
                        draggable={false}
                      />
                    </div>
                    <span className="mt-2 text-sm font-medium text-text-muted">
                      {idx + 1}
                    </span>

                    {/* Prominent visual badge indicating where the dropped page will land */}
                    {isDragTarget && draggedPageIndex !== null && draggedPageIndex !== idx && (
                      <div className="absolute -top-2.5 px-2 py-0.5 rounded-full bg-accent text-white text-[10px] font-bold shadow-md animate-in zoom-in-95 pointer-events-none">
                        Drop to #{idx + 1}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 3. TOOL SUB-PANELS (Theme-adaptive styling) */}
      {activeTool !== 'none' && activeTool !== 'reorder' && (
        <div className="relative z-30 bg-surface-panel border-t border-surface-border px-4 py-3 animate-in slide-in-from-bottom duration-150 text-text-main">
          {/* A. CROP SUB-PANEL: Small undo icon on left, Rotate in middle, Done button on right */}
          {activeTool === 'crop' && (
            <div className="flex items-center justify-between max-w-md mx-auto px-2 py-0.5">
              <button
                type="button"
                onClick={handleResetCrop}
                className="p-2 rounded-xl hover:bg-surface-subtle text-text-muted hover:text-text-main cursor-pointer active:scale-90 transition-all border border-surface-border shadow-2xs"
                title="Undo / Reset crop"
                aria-label="Undo / Reset crop"
              >
                <Undo2 className="w-4 h-4" />
              </button>

              {/* Dedicated Rotate button in Crop mode */}
              <button
                type="button"
                onClick={handleRotate}
                disabled={isRotating}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-surface-subtle hover:bg-surface-subtle/80 text-text-main text-xs font-semibold border border-surface-border cursor-pointer active:scale-95 transition-all shadow-2xs disabled:opacity-50"
                title="Rotate page 90° Clockwise"
                aria-label="Rotate page 90° Clockwise"
              >
                <RotateCw className={`w-3.5 h-3.5 ${isRotating ? 'animate-spin text-accent' : ''}`} />
                <span>{isRotating ? 'Rotating…' : 'Rotate'}</span>
              </button>

              <button
                type="button"
                onClick={handleApplyCrop}
                className="px-6 py-2 rounded-xl bg-accent hover:bg-accent-hover text-xs font-bold text-white shadow-sm cursor-pointer active:scale-95 transition-transform"
              >
                Done
              </button>
            </div>
          )}

          {/* B. FILTERS SUB-PANEL */}
          {activeTool === 'filters' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-main font-semibold">Document Filters</span>
                <button
                  type="button"
                  onClick={() => setActiveTool('none')}
                  style={{ touchAction: 'manipulation' }}
                  className="text-xs text-accent font-semibold cursor-pointer active:scale-95 touch-manipulation px-2 py-0.5"
                >
                  Done
                </button>
              </div>
              <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
                {[
                  { id: 'original', label: 'Original' },
                  { id: 'color', label: 'Color Doc' },
                  { id: 'bw', label: 'Magic B&W' },
                  { id: 'grayscale', label: 'Grayscale' },
                  { id: 'light_text', label: 'Light Text' },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => handleSelectFilter(f.id as DocumentFilterType)}
                    style={{ touchAction: 'manipulation' }}
                    className={`py-2 px-0.5 rounded-xl text-[11px] sm:text-xs font-medium border text-center transition-all cursor-pointer active:scale-95 touch-manipulation ${
                      activePage?.filter === f.id
                        ? 'bg-accent text-white border-accent shadow-xs'
                        : 'bg-surface-subtle border-surface-border text-text-main hover:bg-surface-panel'
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
            <div className="space-y-3 max-w-md mx-auto">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-main font-semibold">Brightness & Contrast</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAdjustments({ brightness: 0, contrast: 0 })}
                    className="text-xs text-text-muted hover:text-text-main cursor-pointer"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyAdjustments}
                    className="px-3 py-1 rounded-lg bg-accent text-xs font-semibold text-white cursor-pointer shadow-xs"
                  >
                    Done
                  </button>
                </div>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-3">
                  <span className="w-16 text-text-muted font-medium">Brightness</span>
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
                  <span className="w-8 text-right font-mono text-text-muted">
                    {adjustments.brightness}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-16 text-text-muted font-medium">Contrast</span>
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
                  <span className="w-8 text-right font-mono text-text-muted">
                    {adjustments.contrast}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* D. CLEANUP SUB-PANEL */}
          {activeTool === 'cleanup' && (
            <div className="space-y-2.5 max-w-md mx-auto">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-text-main">Cleanup Tool</span>
                  <button
                    type="button"
                    onClick={handleCleanupUndo}
                    className="text-xs px-2 py-0.5 rounded bg-surface-subtle hover:bg-surface-panel border border-surface-border text-text-muted hover:text-text-main cursor-pointer"
                  >
                    Undo
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTool('none')}
                    className="text-xs text-text-muted hover:text-text-main cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyCleanup}
                    className="px-3 py-1 rounded-lg bg-accent text-xs font-semibold text-white shadow-xs cursor-pointer"
                  >
                    Apply
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-[11px] text-text-muted font-medium">Size</span>
                  <input
                    type="range"
                    min="6"
                    max="60"
                    value={brushSize}
                    onChange={(e) => setBrushSize(Number(e.target.value))}
                    className="flex-1 accent-accent"
                  />
                  <span className="text-[11px] font-mono text-text-muted">{brushSize}px</span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {['#FFFFFF', '#FFFDF8', '#F3EBDD', '#E5E7EB'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCleanupColor(c)}
                      style={{ backgroundColor: c }}
                      className={`w-6 h-6 rounded-full border cursor-pointer ${
                        cleanupColor === c ? 'ring-2 ring-accent scale-110' : 'border-surface-border'
                      }`}
                      title={c}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => setIsEyedropperActive(!isEyedropperActive)}
                    className={`p-1.5 rounded-full border transition-colors cursor-pointer ${
                      isEyedropperActive
                        ? 'bg-accent border-accent text-white'
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

          {/* E. RESIZE / FORMAT SUB-PANEL (Live Preview with Confirm/Cancel) */}
          {activeTool === 'resize' && (
            <div className="space-y-3 max-w-md mx-auto">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-main font-semibold">Page Format Preset</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCancelResize}
                    style={{ touchAction: 'manipulation' }}
                    className="px-2.5 py-1 rounded-md text-xs text-text-muted hover:text-text-main hover:bg-surface-subtle cursor-pointer transition-colors active:scale-95 touch-manipulation"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDoneResize}
                    style={{ touchAction: 'manipulation' }}
                    className="px-3.5 py-1 rounded-md bg-accent text-xs font-semibold text-white cursor-pointer shadow-xs active:scale-95 transition-all touch-manipulation"
                  >
                    Done
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { id: 'fit', label: 'Fit / Auto' },
                  { id: 'a4', label: 'A4' },
                  { id: 'letter', label: 'Letter' },
                  { id: 'a5', label: 'A5' },
                ].map((fmt) => (
                  <button
                    key={fmt.id}
                    type="button"
                    onClick={() => handleSelectFormatPreset(fmt.id as PageFormatType)}
                    style={{ touchAction: 'manipulation' }}
                    className={`py-2 px-1 rounded-xl text-xs font-medium border text-center transition-all cursor-pointer active:scale-95 touch-manipulation ${
                      selectedFormat === fmt.id
                        ? 'bg-accent text-white border-accent shadow-xs'
                        : 'bg-surface-subtle border-surface-border text-text-main hover:bg-surface-panel'
                    }`}
                  >
                    {fmt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. SCROLLABLE BOTTOM TOOLBAR (Theme-aligned for both Light & Dark modes) */}
      <div className="relative z-30 bg-surface-panel border-t border-surface-border px-3 py-2.5 overflow-x-auto no-scrollbar shrink-0 text-text-main">
        <div className="flex items-center justify-between gap-5 min-w-max px-2">
          {/* 1. Crop */}
          <button
            type="button"
            onClick={() => setActiveTool((prev) => (prev === 'crop' ? 'none' : 'crop'))}
            style={{ touchAction: 'manipulation' }}
            className={`flex flex-col items-center gap-1 min-w-[50px] cursor-pointer transition-colors active:scale-95 touch-manipulation ${
              activeTool === 'crop' ? 'text-accent font-semibold' : 'text-text-muted hover:text-text-main'
            }`}
          >
            <CropIcon className="w-5 h-5" />
            <span className="text-[11px] font-medium">Crop</span>
          </button>

          {/* 2. Retake / Replace */}
          <button
            type="button"
            onClick={handleTriggerReplace}
            style={{ touchAction: 'manipulation' }}
            className="flex flex-col items-center gap-1 min-w-[50px] text-text-muted hover:text-text-main cursor-pointer transition-colors active:scale-95 touch-manipulation"
          >
            {isMobile ? <RotateCcw className="w-5 h-5" /> : <FolderPlus className="w-5 h-5" />}
            <span className="text-[11px] font-medium">{isMobile ? 'Retake' : 'Replace'}</span>
          </button>

          {/* 3. Rotate (Instant feedback & works both in gallery & inside cropper) */}
          <button
            type="button"
            onClick={handleRotate}
            disabled={isRotating}
            style={{ touchAction: 'manipulation' }}
            className={`flex flex-col items-center gap-1 min-w-[50px] cursor-pointer transition-colors active:scale-95 duration-150 touch-manipulation disabled:pointer-events-none ${
              isRotating ? 'text-accent font-semibold' : 'text-text-muted hover:text-text-main'
            }`}
          >
            <RotateCw className={`w-5 h-5 transition-transform duration-300 ${isRotating ? 'animate-spin text-accent' : ''}`} />
            <span className="text-[11px] font-medium">{isRotating ? 'Rotating…' : 'Rotate'}</span>
          </button>

          {/* 4. Filters */}
          <button
            type="button"
            onClick={() => setActiveTool((prev) => (prev === 'filters' ? 'none' : 'filters'))}
            style={{ touchAction: 'manipulation' }}
            className={`flex flex-col items-center gap-1 min-w-[50px] cursor-pointer transition-colors active:scale-95 touch-manipulation ${
              activeTool === 'filters' ? 'text-accent font-semibold' : 'text-text-muted hover:text-text-main'
            }`}
          >
            <Sparkles className="w-5 h-5" />
            <span className="text-[11px] font-medium">Filters</span>
          </button>

          {/* 5. Adjust */}
          <button
            type="button"
            onClick={() => setActiveTool((prev) => (prev === 'adjust' ? 'none' : 'adjust'))}
            style={{ touchAction: 'manipulation' }}
            className={`flex flex-col items-center gap-1 min-w-[50px] cursor-pointer transition-colors active:scale-95 touch-manipulation ${
              activeTool === 'adjust' ? 'text-accent font-semibold' : 'text-text-muted hover:text-text-main'
            }`}
          >
            <Sliders className="w-5 h-5" />
            <span className="text-[11px] font-medium">Adjust</span>
          </button>

          {/* 6. Cleanup */}
          <button
            type="button"
            onClick={() => setActiveTool((prev) => (prev === 'cleanup' ? 'none' : 'cleanup'))}
            style={{ touchAction: 'manipulation' }}
            className={`flex flex-col items-center gap-1 min-w-[50px] cursor-pointer transition-colors active:scale-95 touch-manipulation ${
              activeTool === 'cleanup' ? 'text-accent font-semibold' : 'text-text-muted hover:text-text-main'
            }`}
          >
            <Eraser className="w-5 h-5" />
            <span className="text-[11px] font-medium">Cleanup</span>
          </button>

          {/* 7. Reorder */}
          <button
            type="button"
            onClick={() => setActiveTool((prev) => (prev === 'reorder' ? 'none' : 'reorder'))}
            style={{ touchAction: 'manipulation' }}
            className={`flex flex-col items-center gap-1 min-w-[50px] cursor-pointer transition-colors active:scale-95 touch-manipulation ${
              activeTool === 'reorder' ? 'text-accent font-semibold' : 'text-text-muted hover:text-text-main'
            }`}
          >
            <Layers className="w-5 h-5" />
            <span className="text-[11px] font-medium">Reorder</span>
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
            className={`flex flex-col items-center gap-1 min-w-[50px] cursor-pointer transition-colors active:scale-95 touch-manipulation ${
              activeTool === 'resize' ? 'text-accent font-semibold' : 'text-text-muted hover:text-text-main'
            }`}
          >
            <Maximize2 className="w-5 h-5" />
            <span className="text-[11px] font-medium">Resize</span>
          </button>

          {/* 9. Delete with Confirmation Card */}
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            style={{ touchAction: 'manipulation' }}
            className="flex flex-col items-center gap-1 min-w-[50px] text-status-error hover:opacity-80 cursor-pointer transition-colors active:scale-95 touch-manipulation"
            title="Delete this page"
          >
            <Trash2 className="w-5 h-5" />
            <span className="text-[11px] font-medium">Delete</span>
          </button>
        </div>
      </div>

      {/* 5. BOTTOM ACTION BAR (Keep scanning & Save PDF, shrink-0) */}
      <div className="relative z-30 bg-surface-bg border-t border-surface-border px-4 py-3 pb-[max(1.25rem,var(--safe-area-bottom))] pl-[max(1rem,var(--safe-area-left))] pr-[max(1rem,var(--safe-area-right))] flex items-center justify-between gap-3 shrink-0 transition-[padding] duration-150">
        <button
          type="button"
          onClick={handleTriggerAddFiles}
          className="flex-1 max-w-[180px] py-3 px-4 rounded-full border border-surface-border bg-surface-panel hover:bg-surface-subtle text-text-main font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-all shadow-xs"
        >
          {isMobile ? (
            <>
              <Camera className="w-4 h-4 text-accent" />
              <span>Keep scanning</span>
            </>
          ) : (
            <>
              <FolderPlus className="w-4 h-4 text-accent" />
              <span>Add Files</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={handleSavePdf}
          disabled={isProcessing}
          className="flex-1 py-3 px-6 rounded-full bg-accent hover:bg-accent-hover text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all cursor-pointer disabled:opacity-50"
        >
          <FileDown className="w-4 h-4" />
          <span>Save PDF</span>
        </button>
      </div>

      {/* DISCARD SCAN CONFIRMATION WARNING MODAL */}
      {showDiscardConfirm && (
        <div className="fixed inset-0 z-60 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-2xl bg-surface-panel border border-surface-border p-5 shadow-2xl text-center space-y-4">
            <div className="space-y-1.5">
              <h3 className="font-serif font-bold text-base sm:text-lg text-text-main">
                Are you sure to discard the scan?
              </h3>
              <p className="text-xs text-text-muted">
                Any unsaved changes and pages will be discarded.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDiscardConfirm(false)}
                className="flex-1 py-2.5 px-4 rounded-xl border border-surface-border bg-surface-subtle hover:bg-surface-panel text-text-main font-semibold text-xs transition-colors cursor-pointer active:scale-95"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDiscardConfirm(false);
                  onClose();
                }}
                className="flex-1 py-2.5 px-4 rounded-xl bg-status-error hover:opacity-90 text-white font-semibold text-xs transition-colors cursor-pointer active:scale-95 shadow-md"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE PAGE CONFIRMATION WARNING MODAL */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-60 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-2xl bg-surface-panel border border-surface-border p-5 shadow-2xl text-center space-y-4">
            <div className="space-y-1.5">
              <h3 className="font-serif font-bold text-base sm:text-lg text-text-main">
                Are you sure to delete this page?
              </h3>
              <p className="text-xs text-text-muted">
                Page {activeIndex + 1} of {pages.length} will be permanently removed.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2.5 px-4 rounded-xl border border-surface-border bg-surface-subtle hover:bg-surface-panel text-text-main font-semibold text-xs transition-colors cursor-pointer active:scale-95"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  handleDeletePage(activeIndex);
                }}
                className="flex-1 py-2.5 px-4 rounded-xl bg-status-error hover:opacity-90 text-white font-semibold text-xs transition-colors cursor-pointer active:scale-95 shadow-md"
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
