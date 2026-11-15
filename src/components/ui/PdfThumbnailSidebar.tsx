import React, { useEffect, useRef, useState } from 'react';
import type * as pdfjsLib from 'pdfjs-dist';
import { RenderQueue } from '../../core/pdf/renderQueue';

// Global LRU thumbnail cache across pages of the current document
const thumbnailCache = new Map<number, string>();
const inFlightRenders = new Map<number, Promise<string | null>>();

export function clearThumbnailCache(): void {
  for (const url of thumbnailCache.values()) {
    if (url.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    }
  }
  thumbnailCache.clear();
  inFlightRenders.clear();
}

async function renderThumbnailForPage(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNumber: number
): Promise<string | null> {
  if (thumbnailCache.has(pageNumber)) {
    return thumbnailCache.get(pageNumber)!;
  }

  const existingPromise = inFlightRenders.get(pageNumber);
  if (existingPromise) {
    return existingPromise;
  }

  const renderPromise = (async () => {
    try {
      // Yield if the main viewer is rendering a page; thumbnails never block primary viewing!
      const rq = RenderQueue.getInstance();
      let waitCount = 0;
      while (rq.isBusy() && waitCount < 15) {
        waitCount++;
        await new Promise((r) => setTimeout(r, 80));
      }

      const page = await pdfDoc.getPage(pageNumber);
      const unscaledViewport = page.getViewport({ scale: 1.0 });
      const targetWidth = 140; // Crisp width for 120-130px sidebar display
      const scale = targetWidth / unscaledViewport.width;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        page.cleanup();
        return null;
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: ctx,
        viewport,
      } as unknown as Parameters<typeof page.render>[0]).promise;

      // Asynchronous non-blocking toBlob instead of synchronous toDataURL
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.8);
      });
      page.cleanup();
      canvas.width = 0;
      canvas.height = 0;

      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      thumbnailCache.set(pageNumber, url);
      return url;
    } catch (err) {
      console.warn(`Failed to generate thumbnail for page ${pageNumber}:`, err);
      return null;
    } finally {
      inFlightRenders.delete(pageNumber);
    }
  })();

  inFlightRenders.set(pageNumber, renderPromise);
  return renderPromise;
}

interface ThumbnailItemProps {
  pageNumber: number;
  pdfDoc: pdfjsLib.PDFDocumentProxy | null;
  isActive: boolean;
  aspectRatio: number;
  onClick: () => void;
  registerRef: (el: HTMLButtonElement | null) => void;
}

const ThumbnailItem: React.FC<ThumbnailItemProps> = React.memo(({
  pageNumber,
  pdfDoc,
  isActive,
  aspectRatio,
  onClick,
  registerRef,
}) => {
  const [thumbUrl, setThumbUrl] = useState<string | null>(() => thumbnailCache.get(pageNumber) || null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // IntersectionObserver for fast lazy loading of thumbnails
  useEffect(() => {
    if (thumbUrl || !pdfDoc) return;
    const el = containerRef.current;
    if (!el) return;

    let observer: IntersectionObserver | null = null;
    let cancelled = false;

    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && !cancelled) {
              observer?.disconnect();
              observer = null;
              renderThumbnailForPage(pdfDoc, pageNumber).then((url) => {
                if (url && isMountedRef.current && !cancelled) {
                  setThumbUrl(url);
                }
              });
              break;
            }
          }
        },
        { rootMargin: '80px 0px' }
      );
      observer.observe(el);
    } else {
      renderThumbnailForPage(pdfDoc, pageNumber).then((url) => {
        if (url && isMountedRef.current && !cancelled) {
          setThumbUrl(url);
        }
      });
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [pageNumber, pdfDoc, thumbUrl]);

  return (
    <button
      ref={registerRef}
      type="button"
      onClick={onClick}
      className="flex flex-col items-center group w-full cursor-pointer select-none transition-colors duration-fast ease-out"
      aria-label={`Jump to page ${pageNumber}`}
      aria-current={isActive ? 'page' : undefined}
    >
      <div
        ref={containerRef}
        className={`w-32 rounded-control border overflow-hidden transition-colors duration-fast ease-out relative bg-white ${
          isActive
            ? 'border-2 border-surface-border-focus'
            : 'border-surface-border group-hover:border-surface-border-focus'
        }`}
        style={{
          aspectRatio: `1 / ${aspectRatio}`,
          minHeight: 110,
          maxHeight: 190,
        }}
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={`Page ${pageNumber}`}
            className="w-full h-full object-contain block select-none pointer-events-none"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col justify-center items-center p-3 gap-1.5 bg-surface-subtle">
            <div className="w-full h-1.5 bg-surface-border rounded-control" />
            <div className="w-4/5 h-1.5 bg-surface-border rounded-control" />
            <div className="w-2/3 h-1.5 bg-surface-border rounded-control" />
          </div>
        )}
      </div>
      <span
        className={`mt-1.5 text-xs font-mono transition-colors duration-fast ease-out ${
          isActive
            ? 'bg-accent text-accent-contrast px-2 py-0.5 rounded-chip font-bold'
            : 'text-text-muted group-hover:text-text-main font-medium'
        }`}
      >
        {pageNumber}
      </span>
    </button>
  );
});

export interface PdfThumbnailSidebarProps {
  pdfDoc: pdfjsLib.PDFDocumentProxy | null;
  totalPages: number;
  currentPage: number;
  onSelectPage: (pageNum: number) => void;
  aspectRatioMap?: Map<number, number>;
  defaultAspectRatio?: number;
}

export const PdfThumbnailSidebar: React.FC<PdfThumbnailSidebarProps> = ({
  pdfDoc,
  totalPages,
  currentPage,
  onSelectPage,
  aspectRatioMap,
  defaultAspectRatio = 1.414,
}) => {
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const sidebarContainerRef = useRef<HTMLDivElement>(null);
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<number | null>(null);

  // Auto-scroll the sidebar to keep currentPage thumbnail visible
  useEffect(() => {
    if (isUserScrollingRef.current) return;
    const buttonEl = itemRefs.current.get(currentPage);
    if (buttonEl && sidebarContainerRef.current) {
      buttonEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentPage]);

  const handleSidebarScroll = () => {
    isUserScrollingRef.current = true;
    if (scrollTimeoutRef.current !== null) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = window.setTimeout(() => {
      isUserScrollingRef.current = false;
    }, 1000);
  };

  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <aside
      ref={sidebarContainerRef}
      onScroll={handleSidebarScroll}
      className="w-44 sm:w-48 md:w-52 bg-surface-panel border-r border-surface-border flex flex-col shrink-0 overflow-y-auto select-none py-4 px-3 space-y-4 custom-scrollbar z-20"
      style={{
        overscrollBehavior: 'contain',
      }}
      aria-label="Page thumbnails"
    >
      <div className="flex items-center justify-between px-1 mb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Thumbnails
        </span>
        <span className="text-[11px] font-mono text-text-muted">
          {totalPages} {totalPages === 1 ? 'page' : 'pages'}
        </span>
      </div>

      <div className="space-y-4 flex flex-col items-center">
        {pages.map((p) => {
          const ratio = aspectRatioMap?.get(p) || defaultAspectRatio;
          return (
            <ThumbnailItem
              key={p}
              pageNumber={p}
              pdfDoc={pdfDoc}
              isActive={p === currentPage}
              aspectRatio={ratio}
              onClick={() => onSelectPage(p)}
              registerRef={(el) => {
                if (el) itemRefs.current.set(p, el);
                else itemRefs.current.delete(p);
              }}
            />
          );
        })}
      </div>
    </aside>
  );
};
