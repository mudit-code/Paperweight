import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  ArrowLeft,
  Share2,
  Save,
  Search,
  Minimize2,
  Maximize2,
  MoreVertical,
  ChevronUp,
  ChevronDown,
  X,
  Loader2,
  AlertCircle,
  Printer,
  PanelLeft,
  Plus,
  Minus,
  Download,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { downloadBlob, shareBlob, isMobileApp } from '../../core/processors/download';
import { formatBytes } from '../../core/files/validation';
import { registerBackHandler } from '../../core/navigation/backButton';
import { CanvasPool } from '../../core/pdf/canvasPool';
import { RenderQueue, type PageRenderState, type RenderQueueStats } from '../../core/pdf/renderQueue';
import {
  computeVisiblePageRange,
  getScrollOffsetForPage,
  calculateFocalScrollOffsets,
  probeAllPageDimensions,
  type PageSizeProberHandle,
} from '../../core/pdf/virtualizer';
import { PdfThumbnailSidebar, clearThumbnailCache } from './PdfThumbnailSidebar';

export const MIN_SCALE = 0.4;
export const MAX_SCALE = 10.0;

// Ensure PDF.js worker is registered with standalone bundle URL
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
}

export const getStandardFontsUrl = () => {
  if (typeof window !== 'undefined') {
    try {
      return new URL('./standard_fonts/', document.baseURI || window.location.href).href;
    } catch {
      return './standard_fonts/';
    }
  }
  return './standard_fonts/';
};

export const getCMapUrl = () => {
  if (typeof window !== 'undefined') {
    try {
      return new URL('./cmaps/', document.baseURI || window.location.href).href;
    } catch {
      return './cmaps/';
    }
  }
  return './cmaps/';
};

export interface PdfViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  pdfBlob: Blob | null;
  fileName: string;
  isCompressed?: boolean;
  onCompress?: (blob: Blob, fileName: string) => void;
}

export interface SearchHighlight {
  matchIndex: number;
  pageNumber: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

interface SearchMatch {
  pageNumber: number;
}

const EMPTY_HIGHLIGHTS: SearchHighlight[] = [];

export const PdfViewerModal: React.FC<PdfViewerModalProps> = ({
  isOpen,
  onClose,
  pdfBlob,
  fileName,
  isCompressed = false,
  onCompress,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const pagesWrapperRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const loadingTaskRef = useRef<pdfjsLib.PDFDocumentLoadingTask | null>(null);
  const proberHandleRef = useRef<PageSizeProberHandle | null>(null);
  const historyPushedRef = useRef(false);
  const unregisterBackRef = useRef<(() => void) | null>(null);
  const isMenuOpenRef = useRef(false);
  const isSearchOpenRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Unified modal close that closes immediately and cleans up synthetic SPA history without double-firing back handlers
  const handleModalClose = useCallback(() => {
    if (unregisterBackRef.current) {
      unregisterBackRef.current();
      unregisterBackRef.current = null;
    }
    if (historyPushedRef.current && typeof window !== 'undefined' && window.history.state?.modal === 'pdf-viewer') {
      historyPushedRef.current = false;
      try {
        window.history.back();
      } catch {
        // Ignore
      }
    } else {
      historyPushedRef.current = false;
    }
    onCloseRef.current();
  }, []);

  // Time-to-First-Page tracking
  const [timeToFirstPage, setTimeToFirstPage] = useState<number | null>(null);
  const openStartTimeRef = useRef(0);
  const page1RenderedRef = useRef(false);

  // Zoom State: interactiveScale drives real-time DOM layout; settledScale drives PDF.js rasterization
  const [interactiveScale, setInteractiveScale] = useState(1.0);
  const interactiveScaleRef = useRef(1.0);
  interactiveScaleRef.current = interactiveScale;

  const [settledScale, setSettledScale] = useState(1.0);
  const settledScaleRef = useRef(1.0);
  settledScaleRef.current = settledScale;

  const isGesturingRef = useRef(false);
  const pendingFocalScrollRef = useRef<{ scrollLeft: number; scrollTop: number } | null>(null);

  // Document state
  const [totalPages, setTotalPages] = useState(0);
  const totalPagesRef = useRef(0);
  totalPagesRef.current = totalPages;

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);

  const [defaultAspectRatio, setDefaultAspectRatio] = useState(1.414);
  const defaultAspectRatioRef = useRef(1.414);
  defaultAspectRatioRef.current = defaultAspectRatio;

  const [aspectRatioMap, setAspectRatioMap] = useState<Map<number, number>>(new Map());
  const aspectRatioMapRef = useRef<Map<number, number>>(new Map());
  aspectRatioMapRef.current = aspectRatioMap;

  // Layout & Virtualization state
  const [containerWidth, setContainerWidth] = useState(360);
  const containerWidthRef = useRef(360);
  containerWidthRef.current = containerWidth;
  const [visibleRange, setVisibleRange] = useState<[number, number]>([1, 3]);
  const [visiblePages, setVisiblePages] = useState<[number, number]>([1, 1]);
  const [currentPage, setCurrentPage] = useState(1);
  const [viewportTick, setViewportTick] = useState(0);
  const scrollDetailTimerRef = useRef<number | null>(null);

  // Desktop Mode & Controls
  const isDesktop = !isMobileApp();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [fitMode, setFitMode] = useState<'width' | 'page' | null>('width');
  const [pageInputText, setPageInputText] = useState(String(currentPage));

  useEffect(() => {
    setPageInputText(String(currentPage));
  }, [currentPage]);
  const [isScrubberVisible, setIsScrubberVisible] = useState(false);
  const [scrubberTop, setScrubberTop] = useState(70);
  const scrubberTimerRef = useRef<number | null>(null);
  const isScrubbingRef = useRef(false);

  const triggerScrubberVisibility = useCallback(() => {
    setIsScrubberVisible(true);
    if (scrubberTimerRef.current !== null) {
      clearTimeout(scrubberTimerRef.current);
    }
    // Auto-hide after 2 seconds of inactivity
    scrubberTimerRef.current = window.setTimeout(() => {
      if (!isScrubbingRef.current) {
        setIsScrubberVisible(false);
      }
    }, 2000);
  }, []);

  const syncScrubberPosition = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const maxScroll = container.scrollHeight - container.clientHeight;
    const progress = maxScroll > 0 ? Math.max(0, Math.min(1, container.scrollTop / maxScroll)) : 0;
    const rect = container.getBoundingClientRect();
    const trackTop = rect.top + 8;
    const trackHeight = Math.max(50, rect.height - 16 - 44);
    setScrubberTop(Math.round(trackTop + progress * trackHeight));
  }, []);

  // Synchronize scrollLeft/scrollTop immediately after React updates DOM layout dimensions
  // but before the browser paints, eliminating 1-frame layout thrashing and "earthquake" shivering!
  useLayoutEffect(() => {
    if (pendingFocalScrollRef.current && containerRef.current) {
      const { scrollLeft, scrollTop } = pendingFocalScrollRef.current;
      pendingFocalScrollRef.current = null;
      containerRef.current.scrollLeft = scrollLeft;
      containerRef.current.scrollTop = scrollTop;
      syncScrubberPosition();
    }
  }, [interactiveScale, syncScrubberPosition]);

  const pageRangeText = useMemo(() => {
    if (totalPages <= 0) return '';
    const [first, last] = visiblePages;
    if (first === last) {
      return `${first}/${totalPages}`;
    }
    return `${first}-${last}/${totalPages}`;
  }, [visiblePages, totalPages]);

  // Clean up scrubber and detail scroll timers on unmount
  useEffect(() => {
    return () => {
      if (scrubberTimerRef.current !== null) {
        clearTimeout(scrubberTimerRef.current);
      }
      if (scrollDetailTimerRef.current !== null) {
        clearTimeout(scrollDetailTimerRef.current);
      }
    };
  }, []);

  // Sync scrubber position when document opens (do NOT force visible until user scrolls)
  useEffect(() => {
    if (totalPages > 0) {
      syncScrubberPosition();
    }
  }, [totalPages, syncScrubberPosition]);

  // Header & Menu state
  const [isSharing, setIsSharing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  isMenuOpenRef.current = isMenuOpen;

  // Search state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  isSearchOpenRef.current = isSearchOpen;
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [highlightsByPage, setHighlightsByPage] = useState<Map<number, SearchHighlight[]>>(new Map());
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // Responsive Small Space Detection (Hide sidebar toggle, sidebar, and filename in compact desktop windows)
  const [windowWidth, setWindowWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1200));

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isSmallSpace = windowWidth < 768;

  // Unified Mobile hardware navigation bar back button & Android edge gesture synchronization
  useEffect(() => {
    if (!isOpen) return;

    try {
      window.history.pushState({ modal: 'pdf-viewer' }, '');
      historyPushedRef.current = true;
    } catch {
      // Ignore
    }

    const handleBackAction = (): boolean => {
      if (isMenuOpenRef.current) {
        isMenuOpenRef.current = false;
        setIsMenuOpen(false);
        return true;
      }
      if (isSearchOpenRef.current) {
        isSearchOpenRef.current = false;
        setIsSearchOpen(false);
        setSearchQuery('');
        setMatches([]);
        return true;
      }
      handleModalClose();
      return true;
    };

    const handlePopState = (e: PopStateEvent) => {
      if (!historyPushedRef.current) {
        return;
      }
      e.stopImmediatePropagation();
      if (isMenuOpenRef.current) {
        isMenuOpenRef.current = false;
        setIsMenuOpen(false);
        try {
          window.history.pushState({ modal: 'pdf-viewer' }, '');
          historyPushedRef.current = true;
        } catch {
          // Ignore
        }
        return;
      }
      if (isSearchOpenRef.current) {
        isSearchOpenRef.current = false;
        setIsSearchOpen(false);
        setSearchQuery('');
        setMatches([]);
        try {
          window.history.pushState({ modal: 'pdf-viewer' }, '');
          historyPushedRef.current = true;
        } catch {
          // Ignore
        }
        return;
      }
      historyPushedRef.current = false;
      if (unregisterBackRef.current) {
        unregisterBackRef.current();
        unregisterBackRef.current = null;
      }
      onCloseRef.current();
    };

    const handleHardwareBack = (e: Event) => {
      e.stopImmediatePropagation();
      e.preventDefault();
      handleBackAction();
    };

    unregisterBackRef.current = registerBackHandler(() => handleBackAction());

    window.addEventListener('popstate', handlePopState, { capture: true });
    window.addEventListener('hardwareBackPress', handleHardwareBack, { capture: true });

    return () => {
      if (unregisterBackRef.current) {
        unregisterBackRef.current();
        unregisterBackRef.current = null;
      }
      window.removeEventListener('popstate', handlePopState, { capture: true });
      window.removeEventListener('hardwareBackPress', handleHardwareBack, { capture: true });
      if (historyPushedRef.current && typeof window !== 'undefined' && window.history.state?.modal === 'pdf-viewer') {
        historyPushedRef.current = false;
        try {
          window.history.back();
        } catch {
          // Ignore
        }
      }
    };
  }, [isOpen, handleModalClose]);


  // Close 3-dot menu when clicking outside
  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

  // Track container width via ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = Math.floor(entry.contentRect.width);
        if (width > 0) {
          setContainerWidth(width);
        }
      }
    });

    ro.observe(container);
    return () => ro.disconnect();
  }, [isOpen]);

  // Document Loading: Direct Uint8Array buffer loading (instant offline reliability in Capacitor Android WebView)
  useEffect(() => {
    if (!isOpen || !pdfBlob) {
      if (proberHandleRef.current) {
        proberHandleRef.current.cancel();
        proberHandleRef.current = null;
      }
      if (loadingTaskRef.current) {
        try {
          loadingTaskRef.current.destroy();
        } catch {}
        loadingTaskRef.current = null;
      }
      RenderQueue.getInstance().clear();
      CanvasPool.clearAll();
      clearThumbnailCache();
      setPdfDoc(null);
      setTotalPages(0);
      setMatches([]);
      setHighlightsByPage(new Map());
      setIsLoading(false);
      setInteractiveScale(1.0);
      setSettledScale(1.0);
      return;
    }

    let isCancelled = false;
    setIsLoading(true);
    setError(null);
    setSearchQuery('');
    setMatches([]);
    setHighlightsByPage(new Map());
    setCurrentMatchIndex(0);
    setAspectRatioMap(new Map());
    openStartTimeRef.current = performance.now();
    setTimeToFirstPage(null);
    page1RenderedRef.current = false;
    setInteractiveScale(1.0);
    setSettledScale(1.0);
    RenderQueue.getInstance().clear();

    const loadPdf = async () => {
      try {
        const buffer = await pdfBlob.arrayBuffer();
        if (isCancelled) return;

        const loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(buffer),
          standardFontDataUrl: getStandardFontsUrl(),
          cMapUrl: getCMapUrl(),
          cMapPacked: true,
        });
        loadingTaskRef.current = loadingTask;
        const doc = await loadingTask.promise;

        if (isCancelled) return;

        // Immediate page 1 aspect ratio retrieval
        let defaultAspect = 1.414;
        try {
          const firstPage = await doc.getPage(1);
          const [x1, y1, x2, y2] = firstPage.view;
          const rawW = Math.abs(x2 - x1);
          const rawH = Math.abs(y2 - y1);
          const isRotated = firstPage.rotate % 180 !== 0;
          const w = isRotated ? rawH : rawW;
          const h = isRotated ? rawW : rawH;
          if (w > 0 && h > 0) {
            defaultAspect = h / w;
          }
          firstPage.cleanup();
        } catch {
          // Standard A4 fallback
        }

        setDefaultAspectRatio(defaultAspect);
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        setIsLoading(false);
      } catch (err) {
        if (isCancelled) return;
        console.error('Failed to load PDF in viewer:', err);
        setError('Failed to open PDF document. The file may be password-protected or corrupted.');
        setIsLoading(false);
      }
    };

    loadPdf();

    return () => {
      isCancelled = true;
      if (proberHandleRef.current) {
        proberHandleRef.current.cancel();
        proberHandleRef.current = null;
      }
      if (loadingTaskRef.current) {
        try {
          loadingTaskRef.current.destroy();
        } catch {}
        loadingTaskRef.current = null;
      }
      RenderQueue.getInstance().clear();
      CanvasPool.clearAll();
      clearThumbnailCache();
    };
  }, [isOpen, pdfBlob]);

  // Focus search input when search bar opens
  useEffect(() => {
    if (isSearchOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [isSearchOpen]);

  // Stable Total Scroll Height calculation based on real-time interactiveScale
  const totalScrollHeight = useMemo(() => {
    if (totalPages <= 0) return 0;
    return computeVisiblePageRange(
      0,
      0,
      totalPages,
      containerWidth,
      defaultAspectRatio,
      aspectRatioMap,
      interactiveScale
    ).totalScrollHeight;
  }, [totalPages, containerWidth, defaultAspectRatio, aspectRatioMap, interactiveScale]);

  // Native Scroll-Driven Virtualizer Windowing
  const scrollRafIdRef = useRef<number | null>(null);

  const updateVisibleRange = useCallback(
    (explicitScrollTop?: number, explicitScale?: number) => {
      const container = containerRef.current;
      const pagesCount = totalPagesRef.current;
      if (!container || pagesCount <= 0) return;

      const scrollTop = explicitScrollTop !== undefined ? explicitScrollTop : container.scrollTop;
      const currentScale = explicitScale !== undefined ? explicitScale : interactiveScaleRef.current;
      const viewportHeight = container.clientHeight || 600;

      const range = computeVisiblePageRange(
        scrollTop,
        viewportHeight,
        pagesCount,
        containerWidthRef.current,
        defaultAspectRatioRef.current,
        aspectRatioMapRef.current,
        currentScale
      );

      setVisibleRange((prev) => {
        if (prev[0] === range.bufferStart && prev[1] === range.bufferEnd) return prev;
        return [range.bufferStart, range.bufferEnd];
      });

      setVisiblePages((prev) => {
        if (prev[0] === range.displayFirst && prev[1] === range.displayLast) return prev;
        return [range.displayFirst, range.displayLast];
      });

      setCurrentPage((prev) => (prev === range.centerPage ? prev : range.centerPage));
    },
    []
  );

  const handleScroll = useCallback(() => {
    if (isGesturingRef.current) return;
    if (scrollRafIdRef.current !== null) return;
    scrollRafIdRef.current = requestAnimationFrame(() => {
      scrollRafIdRef.current = null;
      updateVisibleRange();
      syncScrubberPosition();
      triggerScrubberVisibility();
      if (settledScaleRef.current > 1.25) {
        if (scrollDetailTimerRef.current !== null) {
          clearTimeout(scrollDetailTimerRef.current);
        }
        scrollDetailTimerRef.current = window.setTimeout(() => {
          scrollDetailTimerRef.current = null;
          setViewportTick((t) => t + 1);
        }, 55);
      }
    });
  }, [updateVisibleRange, syncScrubberPosition, triggerScrubberVisibility]);

  // Scrubber Touch & Pointer Handlers (Smooth fast scrolling & dynamic page indications)
  const handleScrubberTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    isScrubbingRef.current = true;
    triggerScrubberVisibility();
  };

  const handleScrubberTouchMove = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    if (!isScrubbingRef.current) return;

    const touch = e.touches[0];
    if (!touch) return;

    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const trackTop = rect.top + 8;
    const trackHeight = Math.max(50, rect.height - 16 - 44);
    const progress = Math.max(0, Math.min(1, (touch.clientY - trackTop - 22) / trackHeight));
    const maxScroll = container.scrollHeight - container.clientHeight;

    const targetScroll = Math.round(progress * maxScroll);
    container.scrollTop = targetScroll;
    setScrubberTop(Math.round(trackTop + progress * trackHeight));
    updateVisibleRange(targetScroll);
    triggerScrubberVisibility();
  };

  const handleScrubberTouchEnd = (e: React.TouchEvent) => {
    e.stopPropagation();
    isScrubbingRef.current = false;
    triggerScrubberVisibility();
  };

  const handleScrubberPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') {
      e.stopPropagation();
      e.preventDefault();
      isScrubbingRef.current = true;
      triggerScrubberVisibility();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const handleScrubberPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && isScrubbingRef.current) {
      e.stopPropagation();
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const trackTop = rect.top + 8;
      const trackHeight = Math.max(50, rect.height - 16 - 44);
      const progress = Math.max(0, Math.min(1, (e.clientY - trackTop - 22) / trackHeight));
      const maxScroll = container.scrollHeight - container.clientHeight;

      const targetScroll = Math.round(progress * maxScroll);
      container.scrollTop = targetScroll;
      setScrubberTop(Math.round(trackTop + progress * trackHeight));
      updateVisibleRange(targetScroll);
      triggerScrubberVisibility();
    }
  };

  const handleScrubberPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && isScrubbingRef.current) {
      e.stopPropagation();
      isScrubbingRef.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
      triggerScrubberVisibility();
    }
  };

  // Re-run visible range update on load, resize, aspect ratio, or scale change
  useEffect(() => {
    if (totalPages > 0) {
      updateVisibleRange();
      syncScrubberPosition();
    }
  }, [totalPages, containerWidth, defaultAspectRatio, aspectRatioMap, settledScale, updateVisibleRange, syncScrubberPosition]);

  // Synchronize RenderQueue window bounds with virtualization visible range
  useEffect(() => {
    RenderQueue.getInstance().updateWindow(visibleRange[0], visibleRange[1], settledScale, currentPage);
  }, [visibleRange, settledScale, currentPage]);

  // Track sharp render completion & trigger deferred prober after Page 1 is on-screen
  const handlePageRenderComplete = useCallback(
    (pageNumber: number) => {
      if (pageNumber === 1 && !page1RenderedRef.current) {
        page1RenderedRef.current = true;
        if (openStartTimeRef.current > 0) {
          const ttfp = Math.round(performance.now() - openStartTimeRef.current);
          setTimeToFirstPage(ttfp);
        }

        // Defer background dimension probing until Page 1 is rendered!
        if (pdfDoc && totalPages > 1 && !proberHandleRef.current) {
          proberHandleRef.current = probeAllPageDimensions(
            pdfDoc,
            totalPages,
            (batch) => {
              setAspectRatioMap((prev) => {
                let hasChanges = false;
                for (const [k, v] of batch) {
                  if (Math.abs(v - defaultAspectRatioRef.current) > 0.01 && prev.get(k) !== v) {
                    hasChanges = true;
                    break;
                  }
                }
                if (!hasChanges) return prev;
                const merged = new Map(prev);
                for (const [k, v] of batch) {
                  if (Math.abs(v - defaultAspectRatioRef.current) > 0.01) {
                    merged.set(k, v);
                  }
                }
                return merged;
              });
            },
            () => RenderQueue.getInstance().isBusy() || isGesturingRef.current,
            4
          );
        }
      }
    },
    [pdfDoc, totalPages]
  );

  // Lazy aspect ratio update callback when a page is rasterized
  const handleAspectRatioLoaded = useCallback((pageNumber: number, ratio: number) => {
    setAspectRatioMap((prev) => {
      if (prev.get(pageNumber) === ratio) return prev;
      const next = new Map(prev);
      next.set(pageNumber, ratio);
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Google Drive Style Continuous Layout Zoom & One-Handed Double-Tap-and-Drag
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isOpen) return;
    const container = containerRef.current;
    if (!container) return;

    let initialDist = 0;
    let initialScale = interactiveScaleRef.current;
    let focalX = 0;
    let focalY = 0;
    let startScrollLeft = 0;
    let startScrollTop = 0;
    let isPinching = false;
    let isPinchReleasing = false;

    // Double-tap & One-handed drag zoom state
    let lastTapTime = 0;
    let lastTapPos = { x: 0, y: 0 };
    let isDoubleTapCandidate = false;
    let isDoubleTapDragging = false;
    let doubleTapStartY = 0;
    let doubleTapStartScale = 1.0;
    let doubleTapFocalX = 0;
    let doubleTapFocalY = 0;
    let doubleTapStartScrollLeft = 0;
    let doubleTapStartScrollTop = 0;
    let animRafId: number | null = null;
    let latestPinchScale = 1.0;
    let latestCurFocalX = 0;
    let latestCurFocalY = 0;
    let latestDragScale = 1.0;
    let dynamicSettleTimer: ReturnType<typeof setTimeout> | null = null;
    let lastDynamicSettleTime = 0;

    const scheduleDynamicZoomSettle = (targetScale: number) => {
      const now = performance.now();
      const relDiff = Math.abs(targetScale - settledScaleRef.current) / Math.max(0.1, settledScaleRef.current);
      if (relDiff < 0.06) return;

      if (now - lastDynamicSettleTime >= 110) {
        lastDynamicSettleTime = now;
        if (dynamicSettleTimer) {
          clearTimeout(dynamicSettleTimer);
          dynamicSettleTimer = null;
        }
        setSettledScale(targetScale);
        RenderQueue.getInstance().cancelForScaleChange(targetScale);
      } else {
        if (dynamicSettleTimer) clearTimeout(dynamicSettleTimer);
        dynamicSettleTimer = setTimeout(() => {
          dynamicSettleTimer = null;
          lastDynamicSettleTime = performance.now();
          const cur = interactiveScaleRef.current;
          if (Math.abs(cur - settledScaleRef.current) / Math.max(0.1, settledScaleRef.current) > 0.04) {
            setSettledScale(cur);
            RenderQueue.getInstance().cancelForScaleChange(cur);
          }
        }, 70);
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        // Multi-touch Pinch Zoom: strictly disable scrolling and take full touch control
        container.style.touchAction = 'none';
        isDoubleTapCandidate = false;
        isDoubleTapDragging = false;
        isPinchReleasing = false;

        const t1 = e.touches[0];
        const t2 = e.touches[1];
        initialDist = Math.max(10, Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY));
        initialScale = interactiveScaleRef.current;

        const rect = container.getBoundingClientRect();
        focalX = (t1.clientX + t2.clientX) / 2 - rect.left;
        focalY = (t1.clientY + t2.clientY) / 2 - rect.top;
        startScrollLeft = container.scrollLeft;
        startScrollTop = container.scrollTop;
        isPinching = true;
        isGesturingRef.current = true;

        if (e.cancelable) {
          e.preventDefault();
        }
      } else if (e.touches.length === 1 && !isPinching && !isPinchReleasing) {
        const now = performance.now();
        const t = e.touches[0];
        const distFromLast = Math.hypot(t.clientX - lastTapPos.x, t.clientY - lastTapPos.y);

        if (now - lastTapTime < 350 && distFromLast < 50) {
          // Second tap within 350ms -> candidate for double-tap or double-tap drag!
          if (e.cancelable) {
            e.preventDefault(); // Stop native scrolling so drag works!
          }
          container.style.touchAction = 'none';
          const rect = container.getBoundingClientRect();
          isDoubleTapCandidate = true;
          isDoubleTapDragging = false;
          doubleTapStartY = t.clientY;
          doubleTapStartScale = interactiveScaleRef.current;
          doubleTapFocalX = t.clientX - rect.left;
          doubleTapFocalY = t.clientY - rect.top;
          doubleTapStartScrollLeft = container.scrollLeft;
          doubleTapStartScrollTop = container.scrollTop;
          lastTapTime = 0; // consumed
        } else {
          lastTapTime = now;
          lastTapPos = { x: t.clientX, y: t.clientY };
          isDoubleTapCandidate = false;
          isDoubleTapDragging = false;
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        // Multi-touch active: STRICTLY DISABLE SCROLL
        if (e.cancelable) {
          e.preventDefault();
        }

        if (!isPinching) {
          container.style.touchAction = 'none';
          const t1 = e.touches[0];
          const t2 = e.touches[1];
          initialDist = Math.max(10, Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY));
          initialScale = interactiveScaleRef.current;
          const rect = container.getBoundingClientRect();
          focalX = (t1.clientX + t2.clientX) / 2 - rect.left;
          focalY = (t1.clientY + t2.clientY) / 2 - rect.top;
          startScrollLeft = container.scrollLeft;
          startScrollTop = container.scrollTop;
          isPinching = true;
          isGesturingRef.current = true;
        }

        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const ratio = dist / initialDist;
        const rawScale = initialScale * ratio;
        const clampedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, rawScale));

        const rect = container.getBoundingClientRect();
        latestCurFocalX = (t1.clientX + t2.clientX) / 2 - rect.left;
        latestCurFocalY = (t1.clientY + t2.clientY) / 2 - rect.top;
        latestPinchScale = clampedScale;

        if (animRafId === null) {
          animRafId = requestAnimationFrame(() => {
            animRafId = null;
            const targetScale = latestPinchScale;
            const curX = latestCurFocalX;
            const curY = latestCurFocalY;

            const { scrollLeft: targetScrollLeft, scrollTop: targetScrollTop } = calculateFocalScrollOffsets(
              focalX,
              focalY,
              startScrollLeft,
              startScrollTop,
              initialScale,
              targetScale,
              containerWidthRef.current,
              defaultAspectRatioRef.current,
              aspectRatioMapRef.current,
              totalPagesRef.current,
              curX,
              curY
            );

            if (targetScale === interactiveScaleRef.current) {
              if (container) {
                container.scrollLeft = targetScrollLeft;
                container.scrollTop = targetScrollTop;
              }
            } else {
              pendingFocalScrollRef.current = {
                scrollLeft: targetScrollLeft,
                scrollTop: targetScrollTop,
              };
              setInteractiveScale(targetScale);
            }
            updateVisibleRange(targetScrollTop, targetScale);
            triggerScrubberVisibility();
            scheduleDynamicZoomSettle(targetScale);
          });
        }
        return;
      }

      if (isPinchReleasing) {
        if (e.cancelable) {
          e.preventDefault();
        }
        return;
      }

      if (isDoubleTapCandidate && e.touches.length === 1) {
        if (e.cancelable) {
          e.preventDefault();
        }
        const t = e.touches[0];
        // Swapped directions: Down is positive (zoom in), up is negative (zoom out)
        const deltaY = t.clientY - doubleTapStartY;

        if (!isDoubleTapDragging && Math.abs(deltaY) > 6) {
          isDoubleTapDragging = true;
          isGesturingRef.current = true;
        }

        if (isDoubleTapDragging) {
          const scaleFactor = Math.pow(2, deltaY / 80);
          const rawScale = doubleTapStartScale * scaleFactor;
          const clampedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, rawScale));

          latestDragScale = clampedScale;

          if (animRafId === null) {
            animRafId = requestAnimationFrame(() => {
              animRafId = null;
              const targetScale = latestDragScale;
              const { scrollLeft: targetScrollLeft, scrollTop: targetScrollTop } = calculateFocalScrollOffsets(
                doubleTapFocalX,
                doubleTapFocalY,
                doubleTapStartScrollLeft,
                doubleTapStartScrollTop,
                doubleTapStartScale,
                targetScale,
                containerWidthRef.current,
                defaultAspectRatioRef.current,
                aspectRatioMapRef.current,
                totalPagesRef.current
              );

              if (targetScale === interactiveScaleRef.current) {
                if (container) {
                  container.scrollLeft = targetScrollLeft;
                  container.scrollTop = targetScrollTop;
                }
              } else {
                pendingFocalScrollRef.current = {
                  scrollLeft: targetScrollLeft,
                  scrollTop: targetScrollTop,
                };
                setInteractiveScale(targetScale);
              }
              updateVisibleRange(targetScrollTop, targetScale);
              triggerScrubberVisibility();
              scheduleDynamicZoomSettle(targetScale);
            });
          }
          return;
        }
      }

      if (!isDoubleTapCandidate && e.touches.length === 1 && lastTapTime > 0) {
        const t = e.touches[0];
        if (Math.hypot(t.clientX - lastTapPos.x, t.clientY - lastTapPos.y) > 10) {
          lastTapTime = 0;
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (dynamicSettleTimer) {
        clearTimeout(dynamicSettleTimer);
        dynamicSettleTimer = null;
      }

      if (isPinching) {
        if (e.touches.length < 2) {
          isPinching = false;
          isPinchReleasing = e.touches.length > 0;
          if (!isPinchReleasing) {
            isGesturingRef.current = false;
            container.style.touchAction = 'pan-x pan-y';
          }

          if (animRafId !== null) {
            cancelAnimationFrame(animRafId);
            animRafId = null;
          }

          const finalScale = interactiveScaleRef.current;
          setSettledScale(finalScale);
          RenderQueue.getInstance().cancelForScaleChange(finalScale);
          updateVisibleRange();
          syncScrubberPosition();
          triggerScrubberVisibility();
          setViewportTick((t) => t + 1);
        }
        return;
      }

      if (isPinchReleasing && e.touches.length === 0) {
        isPinchReleasing = false;
        isGesturingRef.current = false;
        container.style.touchAction = 'pan-x pan-y';
        return;
      }

      if (isDoubleTapCandidate) {
        isDoubleTapCandidate = false;

        if (animRafId !== null) {
          cancelAnimationFrame(animRafId);
          animRafId = null;
        }

        if (isDoubleTapDragging) {
          // Finished One-Handed Drag Zoom
          isDoubleTapDragging = false;
          isGesturingRef.current = false;
          container.style.touchAction = 'pan-x pan-y';

          const finalScale = interactiveScaleRef.current;
          setSettledScale(finalScale);
          RenderQueue.getInstance().cancelForScaleChange(finalScale);
          updateVisibleRange();
          syncScrubberPosition();
          triggerScrubberVisibility();
          setViewportTick((t) => t + 1);
        } else {
          // Quick Double-Tap:
          // Rule i: If already fit to page (1.0x) -> zoom to fixed level (2.5x)
          // Rule ii: If not fit to page -> reset to fit to page (1.0x)
          container.style.touchAction = 'pan-x pan-y';
          const currentScale = interactiveScaleRef.current;
          const isFitToPage = Math.abs(currentScale - 1.0) < 0.05;
          const targetScale = isFitToPage ? 3.0 : 1.0;

          const { scrollLeft: targetScrollLeft, scrollTop: targetScrollTop } = calculateFocalScrollOffsets(
            doubleTapFocalX,
            doubleTapFocalY,
            doubleTapStartScrollLeft,
            doubleTapStartScrollTop,
            currentScale,
            targetScale,
            containerWidthRef.current,
            defaultAspectRatioRef.current,
            aspectRatioMapRef.current,
            totalPagesRef.current
          );

          pendingFocalScrollRef.current = {
            scrollLeft: isFitToPage ? targetScrollLeft : 0,
            scrollTop: targetScrollTop,
          };
          setInteractiveScale(targetScale);
          setSettledScale(targetScale);
          updateVisibleRange(targetScrollTop, targetScale);
          RenderQueue.getInstance().cancelForScaleChange(targetScale);
          triggerScrubberVisibility();
        }
      }
    };

    const onTouchCancel = (e: TouchEvent) => {
      onTouchEnd(e);
      isPinchReleasing = false;
      isGesturingRef.current = false;
      container.style.touchAction = 'pan-x pan-y';
    };

    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: true });
    container.addEventListener('touchcancel', onTouchCancel, { passive: true });

    return () => {
      if (dynamicSettleTimer) {
        clearTimeout(dynamicSettleTimer);
        dynamicSettleTimer = null;
      }
      if (animRafId !== null) {
        cancelAnimationFrame(animRafId);
      }
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [isOpen]);

  // Desktop Fit to Width / Fit to Page Calculations (Accurately adapts whether sidebar is open or closed)
  const calculateFitWidthScale = useCallback(() => {
    const container = containerRef.current;
    if (!container) return 1.0;
    const availableWidth = container.clientWidth - 48; // 24px margin each side
    const baseTargetMaxWidth = Math.min(Math.max(container.clientWidth - 32, 280), 800);
    const scale = availableWidth / baseTargetMaxWidth;
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(scale * 100) / 100));
  }, []);

  const calculateFitPageScale = useCallback(() => {
    const container = containerRef.current;
    if (!container) return 1.0;
    const availableHeight = container.clientHeight - 48; // 24px top and bottom margin
    const availableWidth = container.clientWidth - 48;
    const baseTargetMaxWidth = Math.min(Math.max(container.clientWidth - 32, 280), 800);
    const pageHeightAtBase = baseTargetMaxWidth * defaultAspectRatioRef.current;
    const scaleH = availableHeight / pageHeightAtBase;
    const scaleW = availableWidth / baseTargetMaxWidth;
    const scale = Math.min(scaleH, scaleW);
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(scale * 100) / 100));
  }, []);

  const handleToggleFit = useCallback(() => {
    if (fitMode === 'width') {
      const targetScale = calculateFitPageScale();
      setFitMode('page');
      setInteractiveScale(targetScale);
      setSettledScale(targetScale);
      RenderQueue.getInstance().cancelForScaleChange(targetScale);
      updateVisibleRange(undefined, targetScale);
    } else {
      const targetScale = calculateFitWidthScale();
      setFitMode('width');
      setInteractiveScale(targetScale);
      setSettledScale(targetScale);
      RenderQueue.getInstance().cancelForScaleChange(targetScale);
      updateVisibleRange(undefined, targetScale);
    }
  }, [fitMode, calculateFitWidthScale, calculateFitPageScale, updateVisibleRange]);

  // Re-adjust fit scale dynamically when thumbnail sidebar opens/closes or window resizes
  useEffect(() => {
    if (!isDesktop || !fitMode || totalPages <= 0) return;
    if (fitMode === 'width') {
      const targetScale = calculateFitWidthScale();
      setInteractiveScale(targetScale);
      setSettledScale(targetScale);
      RenderQueue.getInstance().cancelForScaleChange(targetScale);
      updateVisibleRange(undefined, targetScale);
    } else if (fitMode === 'page') {
      const targetScale = calculateFitPageScale();
      setInteractiveScale(targetScale);
      setSettledScale(targetScale);
      RenderQueue.getInstance().cancelForScaleChange(targetScale);
      updateVisibleRange(undefined, targetScale);
    }
  }, [isDesktop, isSidebarOpen, containerWidth, fitMode, totalPages, calculateFitWidthScale, calculateFitPageScale, updateVisibleRange]);

  // Desktop Zoom In & Zoom Out
  const handleZoomIn = useCallback(() => {
    setFitMode(null);
    const cur = interactiveScaleRef.current;
    const next = Math.min(MAX_SCALE, Math.round((cur + (cur >= 2 ? 0.5 : 0.25)) * 100) / 100);
    setInteractiveScale(next);
    setSettledScale(next);
    RenderQueue.getInstance().cancelForScaleChange(next);
    updateVisibleRange(undefined, next);
  }, [updateVisibleRange]);

  const handleZoomOut = useCallback(() => {
    setFitMode(null);
    const cur = interactiveScaleRef.current;
    const next = Math.max(MIN_SCALE, Math.round((cur - (cur > 2 ? 0.5 : 0.25)) * 100) / 100);
    setInteractiveScale(next);
    setSettledScale(next);
    RenderQueue.getInstance().cancelForScaleChange(next);
    updateVisibleRange(undefined, next);
  }, [updateVisibleRange]);

  // Desktop Page Indicator Input Commit
  const handlePageInputCommit = useCallback(() => {
    const val = parseInt(pageInputText, 10);
    if (!isNaN(val) && val >= 1 && val <= totalPages) {
      if (!containerRef.current) return;
      const offset = getScrollOffsetForPage(
        val,
        containerWidth,
        defaultAspectRatio,
        aspectRatioMap,
        interactiveScale
      );
      containerRef.current.scrollTop = offset;
      setCurrentPage(val);
    } else {
      setPageInputText(String(currentPage));
    }
  }, [pageInputText, totalPages, containerWidth, defaultAspectRatio, aspectRatioMap, interactiveScale, currentPage]);

  // Desktop Print Action (Ctrl+P & Print button)
  const handlePrint = useCallback(() => {
    if (!pdfBlob) return;
    const blobUrl = URL.createObjectURL(pdfBlob);
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    iframe.src = blobUrl;
    document.body.appendChild(iframe);

    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (err) {
        console.warn('Iframe print failed, falling back to window.open:', err);
        const win = window.open(blobUrl, '_blank');
        win?.focus();
        win?.print();
      }
      setTimeout(() => {
        try {
          document.body.removeChild(iframe);
        } catch {}
        URL.revokeObjectURL(blobUrl);
      }, 60000);
    };
  }, [pdfBlob]);

  // Desktop Ctrl + Scroll Wheel / Precision Trackpad Pinch Zoom
  const wheelZoomTimerRef = useRef<number | null>(null);
  const lastWheelSettleTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!isOpen || !isDesktop) return;

    const onWheelNative = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();

        const container = containerRef.current;
        if (!container) return;

        const delta = -e.deltaY;
        const factor =
          Math.abs(e.deltaY) < 40
            ? Math.exp(-e.deltaY * 0.0085)
            : delta > 0
            ? 1.15
            : 0.87;
        const curScale = interactiveScaleRef.current;
        const targetScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(curScale * factor * 1000) / 1000));
        if (Math.abs(targetScale - curScale) < 0.001) return;

        const rect = container.getBoundingClientRect();
        const focalX = Math.max(0, Math.min(container.clientWidth, e.clientX - rect.left));
        const focalY = Math.max(0, Math.min(container.clientHeight, e.clientY - rect.top));

        const { scrollLeft: targetScrollLeft, scrollTop: targetScrollTop } = calculateFocalScrollOffsets(
          focalX,
          focalY,
          container.scrollLeft,
          container.scrollTop,
          curScale,
          targetScale,
          containerWidthRef.current,
          defaultAspectRatioRef.current,
          aspectRatioMapRef.current,
          totalPagesRef.current
        );

        setFitMode(null);
        pendingFocalScrollRef.current = {
          scrollLeft: targetScrollLeft,
          scrollTop: targetScrollTop,
        };
        setInteractiveScale(targetScale);
        updateVisibleRange(targetScrollTop, targetScale);

        const now = performance.now();
        const relDiff = Math.abs(targetScale - settledScaleRef.current) / Math.max(0.1, settledScaleRef.current);
        if (relDiff >= 0.08 && now - lastWheelSettleTimeRef.current >= 110) {
          lastWheelSettleTimeRef.current = now;
          if (wheelZoomTimerRef.current !== null) {
            clearTimeout(wheelZoomTimerRef.current);
            wheelZoomTimerRef.current = null;
          }
          setSettledScale(targetScale);
          RenderQueue.getInstance().cancelForScaleChange(targetScale);
          updateVisibleRange(targetScrollTop, targetScale);
        } else {
          if (wheelZoomTimerRef.current !== null) {
            clearTimeout(wheelZoomTimerRef.current);
          }
          wheelZoomTimerRef.current = window.setTimeout(() => {
            lastWheelSettleTimeRef.current = performance.now();
            const finalScale = interactiveScaleRef.current;
            setSettledScale(finalScale);
            RenderQueue.getInstance().cancelForScaleChange(finalScale);
            updateVisibleRange(undefined, finalScale);
            setViewportTick((t) => t + 1);
          }, 85);
        }
      }
    };

    window.addEventListener('wheel', onWheelNative, { passive: false });
    return () => {
      if (wheelZoomTimerRef.current !== null) {
        clearTimeout(wheelZoomTimerRef.current);
      }
      window.removeEventListener('wheel', onWheelNative);
    };
  }, [isOpen, isDesktop, updateVisibleRange]);

  // Desktop Global Keyboard Shortcuts (Ctrl+P, Ctrl+F, Ctrl+=, Ctrl+-, Ctrl+0)
  useEffect(() => {
    if (!isOpen || !isDesktop) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;

      if (isCmdOrCtrl) {
        if (e.key === 'p' || e.key === 'P') {
          e.preventDefault();
          handlePrint();
          return;
        }

        if (e.key === 'f' || e.key === 'F') {
          e.preventDefault();
          setIsSearchOpen(true);
          setTimeout(() => {
            searchInputRef.current?.focus();
            searchInputRef.current?.select();
          }, 50);
          return;
        }

        if (e.key === '=' || e.key === '+') {
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
          setFitMode('width');
          const target = calculateFitWidthScale();
          setInteractiveScale(target);
          setSettledScale(target);
          RenderQueue.getInstance().cancelForScaleChange(target);
          updateVisibleRange(undefined, target);
          return;
        }
      }

      if (e.key === 'Escape') {
        if (isSearchOpen) {
          setIsSearchOpen(false);
          setSearchQuery('');
          setMatches([]);
          return;
        }
        if (isMenuOpen) {
          setIsMenuOpen(false);
          return;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    isOpen,
    isDesktop,
    isSearchOpen,
    isMenuOpen,
    handlePrint,
    handleZoomIn,
    handleZoomOut,
    calculateFitWidthScale,
    updateVisibleRange,
  ]);

  // Jump to specific page
  const scrollToPage = useCallback((pageNum: number) => {
    if (!containerRef.current) return;
    const offset = getScrollOffsetForPage(
      pageNum,
      containerWidth,
      defaultAspectRatio,
      aspectRatioMap,
      interactiveScale
    );
    containerRef.current.scrollTop = offset;
    setCurrentPage(pageNum);
  }, [containerWidth, defaultAspectRatio, aspectRatioMap, interactiveScale]);

  // Jump to specific search match and center it vertically
  const scrollToMatch = useCallback(
    (matchIdx: number, foundList?: SearchMatch[], hlMap?: Map<number, SearchHighlight[]>) => {
      const list = foundList || matches;
      const hls = hlMap || highlightsByPage;
      if (list.length === 0 || matchIdx < 0 || matchIdx >= list.length || !containerRef.current) return;
      const targetPage = list[matchIdx].pageNumber;
      const pageTop = getScrollOffsetForPage(
        targetPage,
        containerWidth,
        defaultAspectRatio,
        aspectRatioMap,
        interactiveScale
      );

      const pageHls = hls.get(targetPage);
      const hl = pageHls?.find((h) => h.matchIndex === matchIdx);
      if (hl) {
        const baseTargetMaxWidth = Math.min(Math.max(containerWidth - 32, 280), 800);
        const ratio = aspectRatioMap.get(targetPage) || defaultAspectRatio;
        const pageHeight = baseTargetMaxWidth * interactiveScale * ratio;
        const matchYOffset = pageTop + (hl.yPct / 100) * pageHeight;
        const viewportH = containerRef.current.clientHeight || 600;
        containerRef.current.scrollTop = Math.max(0, matchYOffset - viewportH / 2);
      } else {
        containerRef.current.scrollTop = pageTop;
      }
      setCurrentPage(targetPage);
    },
    [matches, highlightsByPage, containerWidth, defaultAspectRatio, aspectRatioMap, interactiveScale]
  );

  // Search inside PDF Document & generate precise text highlight coordinates
  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim() || !pdfDoc) {
      setMatches([]);
      setHighlightsByPage(new Map());
      setCurrentMatchIndex(0);
      return;
    }

    setIsSearching(true);
    const foundMatches: SearchMatch[] = [];
    const highlightsMap = new Map<number, SearchHighlight[]>();
    const lowerQuery = query.toLowerCase();

    try {
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const unscaledVp = page.getViewport({ scale: 1.0 });
        const textContent = await page.getTextContent();
        let pageHasItemMatch = false;
        const pageHighlights: SearchHighlight[] = [];

        for (const rawItem of textContent.items) {
          const item = rawItem as { str?: string; transform?: number[]; width?: number; height?: number };
          const str = item.str || '';
          if (!str) continue;

          const lowerStr = str.toLowerCase();
          let startIdx = 0;

          while ((startIdx = lowerStr.indexOf(lowerQuery, startIdx)) !== -1) {
            pageHasItemMatch = true;
            const matchIdx = foundMatches.length;
            foundMatches.push({ pageNumber: i });

            const transform = item.transform || [1, 0, 0, 1, 0, 0];
            const tx = transform[4];
            const ty = transform[5];
            const fontHeight = Math.abs(transform[3]) || item.height || 12;
            const itemWidth = item.width || (Math.abs(transform[0]) * str.length) || (fontHeight * 0.6 * str.length);

            const [vxBase, vyBase] = unscaledVp.convertToViewportPoint(tx, ty);
            const [, vyTop] = unscaledVp.convertToViewportPoint(tx, ty + fontHeight);

            const boxTop = Math.min(vyBase, vyTop);
            const boxHeight = Math.max(3, Math.abs(vyBase - vyTop));

            // Proportional character width estimation with canvas measurement when available
            let boxLeft: number;
            let boxWidth: number;

            let measuredPrefix = 0;
            let measuredMatch = 0;
            let totalMeasured = 0;
            if (typeof document !== 'undefined') {
              try {
                const measureCanvas = document.createElement('canvas');
                const ctx = measureCanvas.getContext('2d');
                if (ctx) {
                  ctx.font = `${fontHeight}px sans-serif`;
                  measuredPrefix = ctx.measureText(str.substring(0, startIdx)).width;
                  measuredMatch = ctx.measureText(str.substring(startIdx, startIdx + lowerQuery.length)).width;
                  totalMeasured = ctx.measureText(str).width;
                }
              } catch {}
            }

            if (totalMeasured > 0 && itemWidth > 0) {
              const scale = itemWidth / totalMeasured;
              boxLeft = vxBase + measuredPrefix * scale;
              boxWidth = Math.max(4, measuredMatch * scale);
            } else {
              const charStartRatio = startIdx / str.length;
              const charLenRatio = lowerQuery.length / str.length;
              boxLeft = vxBase + charStartRatio * itemWidth;
              boxWidth = Math.max(6, charLenRatio * itemWidth);
            }

            const xPct = Math.max(0, Math.min(100, (boxLeft / unscaledVp.width) * 100));
            const yPct = Math.max(0, Math.min(100, (boxTop / unscaledVp.height) * 100));
            const wPct = Math.max(0.5, Math.min(100, (boxWidth / unscaledVp.width) * 100));
            const hPct = Math.max(0.5, Math.min(100, (boxHeight / unscaledVp.height) * 100));

            pageHighlights.push({
              matchIndex: matchIdx,
              pageNumber: i,
              xPct,
              yPct,
              wPct,
              hPct,
            });

            startIdx += Math.max(1, lowerQuery.length);
          }
        }

        if (!pageHasItemMatch) {
          const fullPageText = textContent.items
            .map((item: any) => item.str || '')
            .join(' ')
            .toLowerCase();
          if (fullPageText.includes(lowerQuery)) {
            foundMatches.push({ pageNumber: i });
          }
        }

        if (pageHighlights.length > 0) {
          highlightsMap.set(i, pageHighlights);
        }

        page.cleanup();
      }

      setMatches(foundMatches);
      setHighlightsByPage(highlightsMap);
      setCurrentMatchIndex(0);

      if (foundMatches.length > 0) {
        scrollToMatch(0, foundMatches, highlightsMap);
      }
    } catch (err) {
      console.error('Error searching in PDF:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handlePrevMatch = () => {
    if (matches.length === 0) return;
    const prevIndex = (currentMatchIndex - 1 + matches.length) % matches.length;
    setCurrentMatchIndex(prevIndex);
    scrollToMatch(prevIndex);
  };

  const handleNextMatch = () => {
    if (matches.length === 0) return;
    const nextIndex = (currentMatchIndex + 1) % matches.length;
    setCurrentMatchIndex(nextIndex);
    scrollToMatch(nextIndex);
  };

  // Share
  const handleShare = async () => {
    if (!pdfBlob) return;
    setIsSharing(true);
    try {
      await shareBlob(pdfBlob, fileName);
    } catch (err) {
      console.warn('Share cancelled or failed:', err);
    } finally {
      setIsSharing(false);
    }
  };

  // Save
  const handleSave = async () => {
    if (!pdfBlob) return;
    setIsSaving(true);
    try {
      await downloadBlob(pdfBlob, fileName);
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  // Rendered active pages array
  const renderedPages: number[] = [];
  if (totalPages > 0) {
    for (let p = visibleRange[0]; p <= visibleRange[1]; p++) {
      renderedPages.push(p);
    }
  }

  return (
    <div data-pdf-modal="true" className="fixed inset-0 z-50 bg-surface-bg flex flex-col animate-in fade-in duration-150 select-none">
      {/* Top Header Bar */}
      {isDesktop ? (
        /* Desktop Top Header Bar (Chrome / Acrobat Style) */
        <header className="w-full bg-surface-panel border-b border-surface-border px-3 sm:px-4 py-2 flex items-center justify-between shrink-0 shadow-xs relative z-30 select-none">
          {/* Left: Sidebar Toggle, Document Title (Back button removed on desktop; hidden in small spaces) */}
          <div className="flex items-center gap-2 min-w-0">
            {/* Sidebar Toggle Option (Hidden in small spaces) */}
            {!isSmallSpace && (
              <button
                type="button"
                onClick={() => setIsSidebarOpen((prev) => !prev)}
                className={`p-1.5 rounded-lg border transition-all cursor-pointer shrink-0 flex items-center justify-center ${
                  isSidebarOpen
                    ? 'bg-surface-subtle border-accent text-accent shadow-xs'
                    : 'bg-surface-panel border-surface-border text-text-muted hover:text-text-main hover:border-surface-border-strong'
                }`}
                title={isSidebarOpen ? 'Hide thumbnail sidebar' : 'Show thumbnail sidebar'}
                aria-label="Toggle thumbnail sidebar"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
            )}

            {/* Document Title (Hidden in small spaces) */}
            {!isSmallSpace && (
              <div className="flex items-center gap-2 min-w-0 max-w-[180px] lg:max-w-xs xl:max-w-md">
                <span className="font-semibold text-xs text-text-main truncate" title={fileName}>
                  {fileName}
                </span>
                {isCompressed && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-accent-subtle text-accent border border-accent-border">
                    Compressed
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Center: Page Indicator & Zoom Controls */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Page Indicator at Top */}
            <div className="flex items-center gap-1.5 text-xs text-text-muted font-mono">
              <input
                type="text"
                value={pageInputText}
                onChange={(e) => setPageInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handlePageInputCommit();
                    (e.target as HTMLElement).blur();
                  }
                }}
                onBlur={handlePageInputCommit}
                className="w-11 text-center bg-surface-subtle border border-surface-border rounded py-0.5 px-1 font-bold text-text-main focus:outline-none focus:border-accent text-xs"
                title="Current page (press Enter to jump)"
                aria-label="Page number input"
              />
              <span className="text-text-muted select-none">/ {totalPages > 0 ? totalPages : 1}</span>
            </div>

            <div className="h-4 w-[1px] bg-surface-border hidden xs:block" />

            {/* Zoom Controls with + - and percentage indicator */}
            <div className="flex items-center bg-surface-subtle border border-surface-border rounded-lg p-0.5">
              <button
                type="button"
                onClick={handleZoomOut}
                disabled={interactiveScale <= MIN_SCALE}
                className="p-1 rounded text-text-muted hover:text-text-main hover:bg-surface-panel disabled:opacity-30 cursor-pointer transition-colors"
                title="Zoom out (Ctrl -)"
                aria-label="Zoom out"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>

              <span
                onClick={() => {
                  setFitMode(null);
                  setInteractiveScale(1.0);
                  setSettledScale(1.0);
                  RenderQueue.getInstance().cancelForScaleChange(1.0);
                  updateVisibleRange(undefined, 1.0);
                }}
                className="font-mono text-xs font-semibold px-2 text-text-main cursor-pointer hover:text-accent select-none min-w-[48px] text-center"
                title="Click to reset to 100%"
              >
                {Math.round(interactiveScale * 100)}%
              </span>

              <button
                type="button"
                onClick={handleZoomIn}
                disabled={interactiveScale >= MAX_SCALE}
                className="p-1 rounded text-text-muted hover:text-text-main hover:bg-surface-panel disabled:opacity-30 cursor-pointer transition-colors"
                title="Zoom in (Ctrl +)"
                aria-label="Zoom in"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Fit to Page & Fit to Width in a Single Toggle Button */}
            <button
              type="button"
              onClick={handleToggleFit}
              className={`p-1.5 rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 text-xs ${
                fitMode
                  ? 'bg-surface-subtle border-accent text-accent shadow-xs'
                  : 'bg-surface-panel border-surface-border text-text-muted hover:text-text-main hover:border-surface-border-strong'
              }`}
              title={
                fitMode === 'width'
                  ? 'Currently Fit to Width. Click to Fit to Page.'
                  : 'Currently Fit to Page. Click to Fit to Width.'
              }
              aria-label="Toggle Fit to Width / Fit to Page"
            >
              {fitMode === 'width' ? (
                <Maximize2 className="w-3.5 h-3.5" />
              ) : (
                <Minimize2 className="w-3.5 h-3.5" />
              )}
              <span className="hidden xl:inline font-medium text-[11px]">
                {fitMode === 'width' ? 'Fit Page' : 'Fit Width'}
              </span>
            </button>
          </div>

          {/* Right: Search, Save, Compress, Print */}
          <div className="flex items-center gap-1 sm:gap-1.5">
            {/* Search (Ctrl+F) */}
            <button
              type="button"
              onClick={() => {
                setIsSearchOpen((prev) => !prev);
                if (!isSearchOpen) {
                  setTimeout(() => searchInputRef.current?.focus(), 50);
                }
              }}
              className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                isSearchOpen
                  ? 'bg-surface-subtle border-accent text-accent'
                  : 'bg-surface-panel border-surface-border text-text-muted hover:text-text-main hover:border-surface-border-strong'
              }`}
              title="Find text in PDF (Ctrl+F)"
              aria-label="Find text"
            >
              <Search className="w-4 h-4" />
            </button>

            {/* Save Button */}
            <button
              type="button"
              onClick={handleSave}
              disabled={!pdfBlob || isSaving}
              className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg border border-surface-border bg-surface-panel text-text-main hover:border-accent hover:text-accent hover:bg-surface-subtle transition-all cursor-pointer flex items-center gap-1.5 text-xs disabled:opacity-40"
              title="Save PDF"
              aria-label="Save PDF"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin text-accent" /> : <Download className="w-4 h-4" />}
              <span className="hidden lg:inline font-medium">Save</span>
            </button>

            {/* Compress Button */}
            {onCompress && (
              <button
                type="button"
                onClick={() => {
                  if (pdfBlob && onCompress) {
                    onCompress(pdfBlob, fileName);
                  }
                }}
                disabled={!pdfBlob}
                className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg border border-accent/40 bg-accent-subtle/40 text-accent hover:bg-accent-subtle hover:border-accent transition-all cursor-pointer flex items-center gap-1.5 text-xs font-medium disabled:opacity-40"
                title="Compress PDF"
                aria-label="Compress PDF"
              >
                <Minimize2 className="w-4 h-4" />
                <span className="hidden lg:inline">Compress</span>
              </button>
            )}

            {/* Print Button (Ctrl+P) */}
            <button
              type="button"
              onClick={handlePrint}
              disabled={!pdfBlob}
              className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg border border-surface-border bg-surface-panel text-text-main hover:border-accent hover:text-accent hover:bg-surface-subtle transition-all cursor-pointer flex items-center gap-1.5 text-xs disabled:opacity-40"
              title="Print PDF (Ctrl+P)"
              aria-label="Print PDF"
            >
              <Printer className="w-4 h-4" />
              <span className="hidden lg:inline font-medium">Print</span>
            </button>

            {/* Desktop Close Button (Esc) */}
            <div className="h-4 w-[1px] bg-surface-border mx-0.5" />
            <button
              type="button"
              onClick={handleModalClose}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer"
              title="Close viewer (Esc)"
              aria-label="Close viewer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>
      ) : (
        /* Mobile Top Header Bar (Preserved exactly for mobile devices!) */
        <header className="w-full bg-surface-panel border-b border-surface-border px-3 sm:px-5 py-2.5 flex items-center justify-between shrink-0 pt-[var(--safe-area-top)] shadow-xs relative z-30">
          {/* Left: Back Button & Document Title */}
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={handleModalClose}
              className="p-2 rounded-full hover:bg-surface-subtle text-text-main transition-colors cursor-pointer shrink-0 active:scale-95"
              title="Back"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-semibold text-sm text-text-main truncate max-w-[140px] xs:max-w-[180px] sm:max-w-xs md:max-w-md">
                  {fileName}
                </h1>
                {isCompressed && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-accent-subtle text-accent border border-accent-border">
                    Compressed
                  </span>
                )}
              </div>
              <p className="text-[11px] text-text-muted font-mono truncate">
                {totalPages > 0 ? `Page ${currentPage} of ${totalPages}` : 'Loading...'}
                {pdfBlob && ` • ${formatBytes(pdfBlob.size)}`}
              </p>
            </div>
          </div>

          {/* Right: Actions & Three-Dot Menu */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Three-Dot Menu Button */}
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setIsMenuOpen((prev) => !prev)}
                className={`p-2 rounded-lg border transition-all cursor-pointer shadow-2xs ${
                  isMenuOpen
                    ? 'bg-surface-subtle border-accent text-accent'
                    : 'bg-surface-panel border-surface-border text-text-main hover:bg-surface-subtle hover:border-accent hover:text-accent'
                }`}
                title="More options"
                aria-label="More options"
                aria-expanded={isMenuOpen}
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {/* Three-Dot Dropdown Menu */}
              {isMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 rounded-xl bg-surface-panel border border-surface-border shadow-xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
                  {/* 1. Share */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      handleShare();
                    }}
                    disabled={!pdfBlob || isSharing}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-text-main hover:bg-surface-subtle hover:text-accent transition-colors cursor-pointer disabled:opacity-40"
                  >
                    <span>Share</span>
                    {isSharing ? (
                      <Loader2 className="w-4 h-4 text-accent animate-spin" />
                    ) : (
                      <Share2 className="w-4 h-4 text-text-muted" />
                    )}
                  </button>

                  {/* 2. Save */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      handleSave();
                    }}
                    disabled={!pdfBlob || isSaving}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-text-main hover:bg-surface-subtle hover:text-accent transition-colors cursor-pointer disabled:opacity-40"
                  >
                    <span>Save</span>
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 text-accent animate-spin" />
                    ) : (
                      <Save className="w-4 h-4 text-text-muted" />
                    )}
                  </button>

                  {/* 3. Find */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      setIsSearchOpen(true);
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-text-main hover:bg-surface-subtle hover:text-accent transition-colors cursor-pointer"
                  >
                    <span>Find</span>
                    <Search className="w-4 h-4 text-text-muted" />
                  </button>

                  <div className="my-1 border-t border-surface-border-subtle" />

                  {/* 4. Compress */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      if (pdfBlob && onCompress) {
                        onCompress(pdfBlob, fileName);
                      }
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-accent hover:bg-accent-subtle transition-colors cursor-pointer"
                  >
                    <span className="font-semibold">Compress</span>
                    <Minimize2 className="w-4 h-4 text-accent" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
      )}

      {/* Main Content Area: Left Thumbnail Sidebar (Desktop) + Central Native Scroll Area */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden relative">
        {/* Floating Minimalist Find Dialogue (Chrome / Edge style — Image 3) */}
        {isSearchOpen && (
          <div
            className="absolute top-3 right-4 sm:right-6 z-40 flex items-center bg-[#252526] dark:bg-[#1e1e1e] text-neutral-100 rounded-lg shadow-2xl border border-white/10 px-3 py-1.5 gap-2 backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
            role="search"
            aria-label="Find in document"
          >
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (e.shiftKey) {
                    handlePrevMatch();
                  } else {
                    handleNextMatch();
                  }
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setIsSearchOpen(false);
                  setSearchQuery('');
                  setMatches([]);
                  setHighlightsByPage(new Map());
                }
              }}
              placeholder="Find in document..."
              className="w-32 sm:w-44 bg-transparent text-xs text-white placeholder:text-neutral-400 focus:outline-none"
              autoFocus
            />

            <span className="text-[11px] font-mono text-neutral-400 shrink-0 min-w-[28px] text-right select-none">
              {isSearching
                ? '...'
                : matches.length > 0
                ? `${currentMatchIndex + 1}/${matches.length}`
                : searchQuery.trim()
                ? '0/0'
                : ''}
            </span>

            <div className="w-px h-3.5 bg-neutral-600/70 shrink-0 mx-0.5" />

            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={handlePrevMatch}
                disabled={matches.length === 0}
                className="p-1 rounded hover:bg-white/10 text-neutral-300 hover:text-white disabled:opacity-30 cursor-pointer transition-colors"
                title="Previous match (Shift+Enter)"
                aria-label="Previous match"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleNextMatch}
                disabled={matches.length === 0}
                className="p-1 rounded hover:bg-white/10 text-neutral-300 hover:text-white disabled:opacity-30 cursor-pointer transition-colors"
                title="Next match (Enter)"
                aria-label="Next match"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSearchOpen(false);
                  setSearchQuery('');
                  setMatches([]);
                  setHighlightsByPage(new Map());
                }}
                className="p-1 rounded hover:bg-white/10 text-neutral-400 hover:text-white cursor-pointer transition-colors"
                title="Close (Esc)"
                aria-label="Close find"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
        {/* Desktop Collapsible Thumbnail Sidebar (Hidden in small space windows) */}
        {isDesktop && isSidebarOpen && !isSmallSpace && totalPages > 0 && !isLoading && (
          <PdfThumbnailSidebar
            pdfDoc={pdfDoc}
            totalPages={totalPages}
            currentPage={currentPage}
            onSelectPage={scrollToPage}
            aspectRatioMap={aspectRatioMap}
            defaultAspectRatio={defaultAspectRatio}
          />
        )}

        {/* Main Native Scroll Container: 100% Native Momentum & Fling Scrolling */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-auto bg-surface-subtle/50 relative select-none"
          style={{
            WebkitOverflowScrolling: 'touch',
            overscrollBehavior: 'contain',
            overflowAnchor: 'none',
            touchAction: 'pan-x pan-y',
          }}
        >
        {(isLoading || !pdfBlob || totalPages === 0) && !error && (
          <div className="min-h-full flex flex-col items-center justify-center gap-3 my-auto text-text-muted animate-in fade-in py-20">
            <Loader2 className="w-8 h-8 text-accent animate-spin" />
            <p className="text-xs font-semibold">Opening PDF document...</p>
          </div>
        )}

        {error && (
          <div className="min-h-full flex flex-col items-center justify-center gap-3 my-auto p-6 text-center max-w-sm mx-auto py-20">
            <AlertCircle className="w-10 h-10 text-status-error" />
            <h3 className="font-semibold text-text-main text-sm">Unable to view PDF</h3>
            <p className="text-xs text-text-muted">{error}</p>
            <button
              type="button"
              onClick={handleModalClose}
              className="mt-2 px-4 py-2 rounded-lg bg-accent text-white text-xs font-semibold shadow-sm cursor-pointer"
            >
              Return
            </button>
          </div>
        )}

        {/* Stable TanStack-Style Absolute Virtualization Canvas Area */}
        {!isLoading && !error && pdfDoc && totalPages > 0 && (() => {
          const baseTargetMaxWidth = Math.min(Math.max(containerWidth - 32, 280), 800);
          const displayWidth = baseTargetMaxWidth * interactiveScale;
          const contentWidth = Math.max(containerWidth, displayWidth + 48);

          return (
            <div
              ref={pagesWrapperRef}
              style={{
                position: 'relative',
                width: contentWidth,
                minWidth: contentWidth,
                height: totalScrollHeight + 40,
                minHeight: totalScrollHeight + 40,
              }}
              className="select-none"
            >
              {renderedPages.map((pageNumber) => {
                const pageTop = getScrollOffsetForPage(
                  pageNumber,
                  containerWidth,
                  defaultAspectRatio,
                  aspectRatioMap,
                  interactiveScale
                );

                return (
                  <div
                    key={pageNumber}
                    style={{
                      position: 'absolute',
                      top: pageTop + 16,
                      left: 0,
                      right: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                    }}
                  >
                    <PdfPageCanvas
                      pdfDoc={pdfDoc}
                      pageNumber={pageNumber}
                      settledScale={settledScale}
                      interactiveScale={interactiveScale}
                      highlights={highlightsByPage.get(pageNumber) || EMPTY_HIGHLIGHTS}
                      activeMatchIndex={currentMatchIndex}
                      containerWidth={containerWidth}
                      defaultAspectRatio={defaultAspectRatio}
                      onAspectRatioLoaded={handleAspectRatioLoaded}
                      onRenderComplete={() => handlePageRenderComplete(pageNumber)}
                      isHighPriority={pageNumber >= visiblePages[0] && pageNumber <= visiblePages[1]}
                      scrollContainerRef={containerRef}
                      viewportTick={viewportTick}
                    />
                  </div>
                );
              })}
            </div>
          );
        })()}



        {/* Dev-only FPS and Memory Budget Overlay */}
        {import.meta.env.DEV && (
          <PdfDevOverlay
            settledScale={settledScale}
            timeToFirstPage={timeToFirstPage}
          />
        )}
        </div>
      </div>

      {/* Floating Fast-Scroll Scrubber Pill & Drag Handle (Mobile Only) */}
      {!isDesktop && pdfDoc && totalPages > 0 && (
        <div
          style={{
            position: 'fixed',
            right: 4,
            top: `${scrubberTop}px`,
            touchAction: 'none',
          }}
          className={`z-40 flex items-center pr-1 transition-opacity duration-300 select-none ${
            isScrubberVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
          onTouchStart={handleScrubberTouchStart}
          onTouchMove={handleScrubberTouchMove}
          onTouchEnd={handleScrubberTouchEnd}
          onTouchCancel={handleScrubberTouchEnd}
          onPointerDown={handleScrubberPointerDown}
          onPointerMove={handleScrubberPointerMove}
          onPointerUp={handleScrubberPointerUp}
          onPointerCancel={handleScrubberPointerUp}
        >
          {/* White Pill Badge */}
          <div
            style={{
              backgroundColor: '#FFFFFF',
              color: '#0F172A',
              boxShadow: '0 2px 10px rgba(0, 0, 0, 0.28)',
              border: '1px solid rgba(0, 0, 0, 0.12)',
            }}
            className="font-sans text-xs font-bold px-3 py-1.5 rounded-full mr-1.5 flex items-center justify-center whitespace-nowrap pointer-events-auto cursor-grab active:cursor-grabbing"
          >
            {pageRangeText}
          </div>

          {/* Circular Grip Handle */}
          <div
            style={{
              backgroundColor: '#FFFFFF',
              boxShadow: '0 2px 10px rgba(0, 0, 0, 0.28)',
              border: '1px solid rgba(0, 0, 0, 0.12)',
            }}
            className="w-11 h-11 rounded-full flex items-center justify-center cursor-grab active:cursor-grabbing shrink-0 pointer-events-auto"
          >
            <svg width="12" height="18" viewBox="0 0 12 18" fill="#475569">
              <circle cx="3" cy="3" r="1.5" />
              <circle cx="9" cy="3" r="1.5" />
              <circle cx="3" cy="9" r="1.5" />
              <circle cx="9" cy="9" r="1.5" />
              <circle cx="3" cy="15" r="1.5" />
              <circle cx="9" cy="15" r="1.5" />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Active Canvas Component: Priority Queued, Explicit State
// ---------------------------------------------------------------------------
interface PdfPageCanvasProps {
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  settledScale: number;
  interactiveScale: number;
  highlights?: SearchHighlight[];
  activeMatchIndex?: number;
  containerWidth: number;
  defaultAspectRatio: number;
  onAspectRatioLoaded: (pageNum: number, ratio: number) => void;
  onRenderComplete?: () => void;
  isHighPriority: boolean;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  viewportTick: number;
}

interface DetailTileState {
  left: number;
  top: number;
  width: number;
  height: number;
  scale: number;
  containerWidth: number;
}

const PdfPageCanvasComponent: React.FC<PdfPageCanvasProps> = ({
  pdfDoc,
  pageNumber,
  settledScale,
  interactiveScale,
  highlights = [],
  activeMatchIndex = -1,
  containerWidth,
  defaultAspectRatio,
  onAspectRatioLoaded,
  onRenderComplete,
  isHighPriority,
  scrollContainerRef,
  viewportTick,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageBoxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detailCanvasRef = useRef<HTMLCanvasElement>(null);
  const detailTileRef = useRef<DetailTileState | null>(null);
  const activeDetailTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const [detailTile, setDetailTile] = useState<DetailTileState | null>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const textLayerInstanceRef = useRef<pdfjsLib.TextLayer | null>(null);
  const textLayerGenerationRef = useRef(0);
  const [renderState, setRenderState] = useState<PageRenderState>('idle');
  const [aspectRatio, setAspectRatio] = useState(defaultAspectRatio);
  const hasRenderedOnceRef = useRef(CanvasPool.hasLiveCanvas(pageNumber));

  // Immediate cache check & synchronous blit on mount or settledScale change
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const liveEntry = CanvasPool.getLiveCanvasEntry(pageNumber);
    if (liveEntry && liveEntry.canvas && liveEntry.canvas.width > 0 && liveEntry.canvas.height > 0) {
      if (liveEntry.canvas !== canvas) {
        canvas.width = liveEntry.canvas.width;
        canvas.height = liveEntry.canvas.height;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        const ctx = canvas.getContext('2d', { alpha: false });
        if (ctx) {
          ctx.drawImage(liveEntry.canvas, 0, 0);
        }
        CanvasPool.updateCanvasElement(pageNumber, canvas);
      }
      hasRenderedOnceRef.current = true;
      if (liveEntry.scale === settledScale || ((liveEntry.scale ?? 0) >= 2.0 && settledScale >= 2.0)) {
        setRenderState('done');
      }
    }
  }, [pageNumber, settledScale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Backing canvas caps at 2.0x; skip redundant re-renders when zooming between 2.0x and 10.0x
    const liveEntry = CanvasPool.getLiveCanvasEntry(pageNumber);
    if (
      liveEntry &&
      liveEntry.canvas.width > 0 &&
      (liveEntry.scale === settledScale || ((liveEntry.scale ?? 0) >= 2.0 && settledScale >= 2.0))
    ) {
      setRenderState('done');
      onRenderComplete?.();
      return;
    }

    const rq = RenderQueue.getInstance();
    rq.enqueue({
      pageNumber,
      pdfDoc,
      canvas,
      containerWidth,
      settledScale,
      defaultAspectRatio,
      isHighPriority,
      onAspectRatioLoaded: (pageNum, ratio) => {
        setAspectRatio(ratio);
        onAspectRatioLoaded(pageNum, ratio);
      },
      onSuccess: () => {
        hasRenderedOnceRef.current = true;
        setRenderState('done');
        onRenderComplete?.();
      },
      onError: () => {
        setRenderState('failed');
      },
    });

    const unsubscribe = rq.subscribe(() => {
      setRenderState(rq.getPageState(pageNumber));
    });

    return () => {
      unsubscribe();
    };
  }, [
    pdfDoc,
    pageNumber,
    settledScale,
    containerWidth,
    isHighPriority,
    defaultAspectRatio,
    onRenderComplete,
    onAspectRatioLoaded,
  ]);

  const baseTargetMaxWidth = Math.min(Math.max(containerWidth - 32, 280), 800);
  const displayWidth = baseTargetMaxWidth * interactiveScale;
  const displayHeight = displayWidth * aspectRatio;

  // High-Zoom Viewport Detail Layer: renders visible cropped region at exact 1:1 native DPR (matches Brave/Chrome crispness up to 1000%)
  useEffect(() => {
    const detailCanvas = detailCanvasRef.current;
    if (!pdfDoc || pageNumber < 1 || !isHighPriority || settledScale <= 1.25) {
      if (activeDetailTaskRef.current) {
        try {
          activeDetailTaskRef.current.cancel();
        } catch {}
        activeDetailTaskRef.current = null;
      }
      detailTileRef.current = null;
      setDetailTile(null);
      if (detailCanvas && (detailCanvas.width > 0 || detailCanvas.height > 0)) {
        detailCanvas.width = 0;
        detailCanvas.height = 0;
      }
      return;
    }

    let isCancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const tileTimer = setTimeout(() => {
      attemptRenderDetail();
    }, 20);

    const attemptRenderDetail = async () => {
      if (isCancelled) return;
      const rqState = RenderQueue.getInstance().getPageState(pageNumber);
      if (rqState === 'rendering' || rqState === 'queued') {
        pollTimer = setTimeout(attemptRenderDetail, 45);
        return;
      }

      const scrollEl = scrollContainerRef.current;
      const pageEl = pageBoxRef.current;
      if (!scrollEl || !pageEl || !detailCanvasRef.current) return;

      const cRect = scrollEl.getBoundingClientRect();
      const pRect = pageEl.getBoundingClientRect();
      if (cRect.width <= 0 || cRect.height <= 0 || pRect.width <= 0) return;

      const settledWidth = baseTargetMaxWidth * settledScale;
      const settledHeight = settledWidth * aspectRatio;
      const ratioToSettled = pRect.width / settledWidth || 1;

      const visLeft = Math.max(0, Math.floor((cRect.left - pRect.left) / ratioToSettled));
      const visTop = Math.max(0, Math.floor((cRect.top - pRect.top) / ratioToSettled));
      const visRight = Math.min(Math.ceil(settledWidth), Math.ceil((cRect.right - pRect.left) / ratioToSettled));
      const visBottom = Math.min(Math.ceil(settledHeight), Math.ceil((cRect.bottom - pRect.top) / ratioToSettled));

      if (visRight <= visLeft || visBottom <= visTop) return;

      // Skip re-render if existing detail tile still covers this viewport at exact settledScale
      const existing = detailTileRef.current;
      if (
        existing &&
        Math.abs(existing.scale - settledScale) < 0.001 &&
        existing.containerWidth === containerWidth &&
        visLeft >= existing.left + (visLeft > 0 ? 12 : 0) &&
        visTop >= existing.top + (visTop > 0 ? 12 : 0) &&
        visRight <= existing.left + existing.width - (visRight < settledWidth ? 12 : 0) &&
        visBottom <= existing.top + existing.height - (visBottom < settledHeight ? 12 : 0)
      ) {
        return;
      }

      const OVERSCAN = 180;
      const tileLeft = Math.max(0, visLeft - OVERSCAN);
      const tileTop = Math.max(0, visTop - OVERSCAN);
      const tileRight = Math.min(Math.ceil(settledWidth), visRight + OVERSCAN);
      const tileBottom = Math.min(Math.ceil(settledHeight), visBottom + OVERSCAN);
      const tileW = tileRight - tileLeft;
      const tileH = tileBottom - tileTop;
      if (tileW <= 0 || tileH <= 0) return;

      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (isCancelled) return;

        const unscaledVp = page.getViewport({ scale: 1.0 });
        const fitScale = baseTargetMaxWidth / (unscaledVp.width || 1);
        const cssViewport = page.getViewport({ scale: fitScale * settledScale });

        const sysDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const desiredDpr = Math.min(Math.max(sysDpr, 1.5), 3.0);
        const { pixelWidth, pixelHeight, effectiveDpr } = CanvasPool.calculateSafeDimensions(
          tileW,
          tileH,
          desiredDpr
        );

        const offscreen = document.createElement('canvas');
        offscreen.width = pixelWidth;
        offscreen.height = pixelHeight;
        const offCtx = offscreen.getContext('2d', { alpha: false });
        if (!offCtx) return;

        offCtx.imageSmoothingEnabled = true;
        offCtx.imageSmoothingQuality = 'high';
        offCtx.setTransform(1, 0, 0, 1, 0, 0);
        offCtx.fillStyle = '#ffffff';
        offCtx.fillRect(0, 0, pixelWidth, pixelHeight);

        if (activeDetailTaskRef.current) {
          try {
            activeDetailTaskRef.current.cancel();
          } catch {}
        }

        const task = page.render({
          canvasContext: offCtx,
          viewport: cssViewport,
          transform: [effectiveDpr, 0, 0, effectiveDpr, -tileLeft * effectiveDpr, -tileTop * effectiveDpr],
        } as unknown as Parameters<typeof page.render>[0]);
        activeDetailTaskRef.current = task;

        await task.promise;
        if (activeDetailTaskRef.current === task) {
          activeDetailTaskRef.current = null;
        }
        if (isCancelled || !detailCanvasRef.current) {
          offscreen.width = 0;
          offscreen.height = 0;
          return;
        }

        const target = detailCanvasRef.current;
        target.width = pixelWidth;
        target.height = pixelHeight;
        const tCtx = target.getContext('2d', { alpha: false });
        if (tCtx) {
          tCtx.drawImage(offscreen, 0, 0);
        }
        offscreen.width = 0;
        offscreen.height = 0;

        const nextState: DetailTileState = {
          left: tileLeft,
          top: tileTop,
          width: tileW,
          height: tileH,
          scale: settledScale,
          containerWidth,
        };
        detailTileRef.current = nextState;
        setDetailTile(nextState);
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          // Non-fatal: Layer 1 backing canvas stays visible
        }
      }
    };

    return () => {
      isCancelled = true;
      clearTimeout(tileTimer);
      if (pollTimer) clearTimeout(pollTimer);
      if (activeDetailTaskRef.current) {
        try {
          activeDetailTaskRef.current.cancel();
        } catch {}
        activeDetailTaskRef.current = null;
      }
    };
  }, [pdfDoc, pageNumber, settledScale, containerWidth, baseTargetMaxWidth, aspectRatio, isHighPriority, viewportTick]);

  // Render and synchronize PDF.js TextLayer for native text selection
  useEffect(() => {
    const targetEl = textLayerRef.current;
    if (!targetEl || !pdfDoc || pageNumber < 1) return;

    // Only compile TextLayer for visible pages: avoids massive DOM overhead & worker contention while scrolling
    if (!isHighPriority) {
      targetEl.innerHTML = '';
      return;
    }

    const currentGeneration = ++textLayerGenerationRef.current;
    let isCancelled = false;

    // Reset DOM immediately so stale text from previous scales/zooms never lingers
    targetEl.innerHTML = '';

    // Small debounce so rapid scrolling skips text layer compilation
    const timer = setTimeout(() => {
      renderText();
    }, 50);

    async function renderText() {
      if (!targetEl) return;
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (isCancelled || currentGeneration !== textLayerGenerationRef.current || !textLayerRef.current) {
          page.cleanup();
          return;
        }

        const unscaledVp = page.getViewport({ scale: 1.0 });
        const baseWidth = Math.min(Math.max(containerWidth - 32, 280), 800);
        const settledWidth = baseWidth * settledScale;
        const currentScale = settledWidth / (unscaledVp.width || 1);
        const viewport = page.getViewport({ scale: currentScale });

        // Configure CSS variables matching PDF.js TextLayer calculations
        targetEl.innerHTML = '';
        targetEl.style.setProperty('--scale-factor', `${currentScale}`);
        targetEl.style.setProperty('--total-scale-factor', `${currentScale}`);
        targetEl.style.setProperty('--user-unit', '1');

        const textContentSource = await page.getTextContent();
        if (isCancelled || currentGeneration !== textLayerGenerationRef.current || !textLayerRef.current) {
          page.cleanup();
          return;
        }

        if (textLayerInstanceRef.current) {
          try {
            textLayerInstanceRef.current.cancel();
          } catch {}
          textLayerInstanceRef.current = null;
        }

        const instance = new pdfjsLib.TextLayer({
          textContentSource,
          container: targetEl,
          viewport,
        });
        textLayerInstanceRef.current = instance;

        await instance.render();
        page.cleanup();
      } catch (err: any) {
        if (err?.name !== 'AbortException') {
          // Ignore cancellation errors
        }
      }
    }

    return () => {
      isCancelled = true;
      clearTimeout(timer);
      if (textLayerInstanceRef.current) {
        try {
          textLayerInstanceRef.current.cancel();
        } catch {}
        textLayerInstanceRef.current = null;
      }
      if (targetEl) {
        targetEl.innerHTML = '';
      }
    };
  }, [pdfDoc, pageNumber, settledScale, containerWidth, isHighPriority]);

  const showDetailTile = Boolean(detailTile && settledScale > 1.25 && interactiveScale >= 1.15);
  const detailScaleRatio = detailTile
    ? displayWidth /
      (Math.min(Math.max(detailTile.containerWidth - 32, 280), 800) * detailTile.scale)
    : 1;

  return (
    <div
      ref={containerRef}
      id={`pdf-page-container-${pageNumber}`}
      className="relative flex flex-col items-center group pdf-page-container"
    >
      <div
        ref={pageBoxRef}
        className="rounded-none bg-white shadow-md border border-surface-border-subtle overflow-hidden relative select-text"
        style={{ width: displayWidth, height: displayHeight }}
      >
        <canvas ref={canvasRef} className="w-full h-full block select-none pointer-events-none" />

        {/* High-Zoom 1:1 Native DPR Viewport Detail Overlay */}
        <canvas
          ref={detailCanvasRef}
          style={
            showDetailTile && detailTile
              ? {
                  position: 'absolute',
                  left: `${detailTile.left * detailScaleRatio}px`,
                  top: `${detailTile.top * detailScaleRatio}px`,
                  width: `${detailTile.width * detailScaleRatio}px`,
                  height: `${detailTile.height * detailScaleRatio}px`,
                  zIndex: 2,
                  pointerEvents: 'none',
                }
              : {
                  display: 'none',
                }
          }
          className="select-none pointer-events-none"
        />

        {/* PDF.js Native Text Layer for High-Performance Text Selection */}
        <div
          ref={textLayerRef}
          className="textLayer absolute inset-0 z-[5] select-text"
          style={{ width: displayWidth, height: displayHeight }}
        />

        {/* Precise Search Match Text Highlights Overlay */}
        {highlights && highlights.length > 0 && (
          <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden mix-blend-multiply dark:mix-blend-screen">
            {highlights.map((h, idx) => {
              const isActive = h.matchIndex === activeMatchIndex;
              return (
                <div
                  key={`${h.matchIndex}-${idx}`}
                  style={{
                    position: 'absolute',
                    left: `${h.xPct}%`,
                    top: `${h.yPct}%`,
                    width: `${h.wPct}%`,
                    height: `${h.hPct}%`,
                  }}
                  className={`rounded-[2px] pointer-events-none transition-colors ${
                    isActive
                      ? 'bg-[#388bfd]/65 dark:bg-[#3b82f6]/60 shadow-xs'
                      : 'bg-[#ffe600]/60 dark:bg-[#eab308]/50'
                  }`}
                />
              );
            })}
          </div>
        )}

        {renderState === 'failed' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-surface-subtle/50 select-none">
            <span className="text-[11px] text-status-error font-medium">Failed to render</span>
          </div>
        )}
      </div>
    </div>
  );
};

// React.memo wrapper ensures unchanged pages do not re-render
const PdfPageCanvas = React.memo(
  PdfPageCanvasComponent,
  (prev, next) =>
    prev.pageNumber === next.pageNumber &&
    prev.containerWidth === next.containerWidth &&
    prev.highlights === next.highlights &&
    prev.activeMatchIndex === next.activeMatchIndex &&
    prev.settledScale === next.settledScale &&
    prev.interactiveScale === next.interactiveScale &&
    prev.pdfDoc === next.pdfDoc &&
    prev.isHighPriority === next.isHighPriority &&
    prev.defaultAspectRatio === next.defaultAspectRatio &&
    prev.viewportTick === next.viewportTick
);

// ---------------------------------------------------------------------------
// Dev-only FPS, Memory, TTFP, and Render States Overlay
// ---------------------------------------------------------------------------
interface PdfDevOverlayProps {
  settledScale: number;
  timeToFirstPage: number | null;
}

const PdfDevOverlay: React.FC<PdfDevOverlayProps> = ({
  settledScale,
  timeToFirstPage,
}) => {
  const [fps, setFps] = useState(60);
  const [stats, setStats] = useState({
    liveCanvases: 0,
    displayPixels: 0,
    offscreenPixels: 0,
    totalPixels: 0,
    totalMB: 0,
    isOffscreenActive: false,
  });
  const [rqStats, setRqStats] = useState<RenderQueueStats>({
    queued: 0,
    rendering: 0,
    done: 0,
    failed: 0,
    currentRenderingPage: null,
    watchdogLogs: [],
  });
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    let frameCount = 0;
    let lastTime = performance.now();
    let animId: number;

    const measure = (now: number) => {
      frameCount++;
      if (now - lastTime >= 500) {
        setFps(Math.round((frameCount * 1000) / (now - lastTime)));
        frameCount = 0;
        lastTime = now;
        setStats(CanvasPool.getStats());
        setRqStats(RenderQueue.getInstance().getStats());
      }
      animId = requestAnimationFrame(measure);
    };

    animId = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(animId);
  }, []);

  const totalMP = (stats.totalPixels / (1024 * 1024)).toFixed(2);
  const budgetPercent = Math.min(100, Math.round((stats.totalPixels / (32 * 1024 * 1024)) * 100));

  return (
    <div
      onClick={() => setIsExpanded((prev) => !prev)}
      className="fixed top-14 right-3 z-50 cursor-pointer select-none font-mono text-[11px] leading-tight transition-all duration-150"
    >
      {!isExpanded ? (
        <div className="bg-black/90 border border-emerald-500/40 text-emerald-400 px-2.5 py-1 rounded-full shadow-lg flex items-center gap-2">
          <span className="font-bold">{fps} FPS</span>
          <span>•</span>
          <span>{stats.liveCanvases} Canvases</span>
          <span>•</span>
          <span>{totalMP} MP</span>
        </div>
      ) : (
        <div className="bg-black/95 border border-emerald-500/50 text-emerald-400 p-2.5 rounded-xl shadow-2xl backdrop-blur-md flex flex-col gap-1 min-w-[210px]">
          <div className="flex items-center justify-between border-b border-emerald-500/20 pb-1">
            <span className="font-bold text-white tracking-wider">DEV STATS</span>
            <span className="text-[10px] text-emerald-300/80 font-bold">{fps} FPS</span>
          </div>

          {/* Time to First Page */}
          <div className="flex items-center justify-between text-yellow-300 font-semibold">
            <span>TTFP:</span>
            <span>{timeToFirstPage !== null ? `${timeToFirstPage} ms` : 'Measuring...'}</span>
          </div>

          {/* Scale */}
          <div className="flex items-center justify-between">
            <span>Scale:</span>
            <span className="font-bold text-white">{settledScale.toFixed(2)}x</span>
          </div>

          {/* RenderQueue Lifecycle States */}
          <div className="flex items-center justify-between text-[10px] pt-0.5 border-t border-emerald-500/20">
            <span className="text-gray-300">Queue:</span>
            <span className="font-semibold text-white">
              Q:{rqStats.queued} | R:{rqStats.rendering} | D:{rqStats.done}
              {rqStats.failed > 0 && <span className="text-red-400"> | F:{rqStats.failed}</span>}
            </span>
          </div>

          {/* Active Rendering Page */}
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-gray-400">Active:</span>
            <span className="text-cyan-300 font-medium">
              {rqStats.currentRenderingPage !== null
                ? `Page ${rqStats.currentRenderingPage}`
                : 'idle'}
            </span>
          </div>

          {/* Watchdog Warnings */}
          {rqStats.watchdogLogs.length > 0 && (
            <div className="text-[9px] text-amber-300 bg-amber-950/60 p-1 rounded border border-amber-600/40">
              {rqStats.watchdogLogs[rqStats.watchdogLogs.length - 1]}
            </div>
          )}

          {/* Memory Budget */}
          <div className="flex items-center justify-between pt-0.5 border-t border-emerald-500/20">
            <span>Live Canvases:</span>
            <span className="font-bold text-white">{stats.liveCanvases}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Total VRAM:</span>
            <span className="font-bold text-white">
              {totalMP} MP ({stats.totalMB.toFixed(1)} MB)
            </span>
          </div>

          {/* Progress Bar of 32 MP Budget */}
          <div className="w-full bg-emerald-950/80 rounded-full h-1.5 overflow-hidden mt-0.5">
            <div
              className={`h-full transition-all duration-300 ${
                budgetPercent > 80 ? 'bg-red-500' : budgetPercent > 50 ? 'bg-amber-400' : 'bg-emerald-400'
              }`}
              style={{ width: `${budgetPercent}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
