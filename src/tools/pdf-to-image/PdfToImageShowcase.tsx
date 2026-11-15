import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  FolderPlus,
  Trash2,
  X,
  Loader2,
  CheckCircle2,
  Play,
  Check,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ProcessedFile } from '../../core/types';
import type { BatchResult } from '../../core/processors/types';
import { validateFile, formatBytes } from '../../core/files/validation';
import { toUserFacingError, type UserFacingError } from '../../core/errors';
import { isMobileApp } from '../../core/processors/download';
import { parsePageRange } from '../../core/processors/image-encoders';
import { Button } from '../../components/ui/Button';
import { ClearWarningBanner } from '../../components/ui/ClearWarningBanner';
import type { GalleryItem } from '../../components/ui/ImageGalleryModal';

// Set up PDF.js worker in browser
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
}

export interface PdfToImageShowcaseProps {
  files: ProcessedFile[];
  onFilesChange: (files: ProcessedFile[]) => void;
  options: Record<string, unknown>;
  isProcessing: boolean;
  result?: BatchResult | null;
  onDismissResult?: () => void;
  onExecute?: () => void;
  onViewFile?: (file: ProcessedFile) => void;
  onViewImages?: (images: GalleryItem[], initialIndex?: number) => void;
  className?: string;
}

export const PdfToImageShowcase: React.FC<PdfToImageShowcaseProps> = ({
  files,
  onFilesChange,
  options,
  isProcessing,
  result,
  onDismissResult,
  onExecute,
  onViewFile,
  onViewImages,
  className = '',
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = isMobileApp();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // PDF page count & rendered page previews (pre-conversion)
  const [numPdfPages, setNumPdfPages] = useState<number>(0);
  const [pageThumbnails, setPageThumbnails] = useState<Map<number, string>>(new Map());

  // Created URLs tracking for cleanup
  const createdUrlsRef = useRef<string[]>([]);

  const format = ((options.format as string) || 'png').toLowerCase();
  const formatUpper = format.toUpperCase();
  const pageRangeMode = (options.pageRange as string) || 'all';
  const customPagesStr = (options.customPages as string) || '1';

  const currentFile: ProcessedFile | undefined = files[0];

  // Helper to compute selected pages based on active options
  const getSelectedPages = useCallback(
    (totalPages: number): number[] => {
      if (totalPages <= 0) return [];
      if (pageRangeMode === 'first') return [1];
      if (pageRangeMode === 'last') return [totalPages];
      if (pageRangeMode === 'custom') return parsePageRange(customPagesStr, totalPages);
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    },
    [pageRangeMode, customPagesStr]
  );

  const selectedPageNumbers = getSelectedPages(numPdfPages);

  // Cleanup previous object URLs when changing file
  useEffect(() => {
    const currentUrls = createdUrlsRef.current;
    return () => {
      currentUrls.forEach((url) => URL.revokeObjectURL(url));
      createdUrlsRef.current = [];
    };
  }, [currentFile?.id]);

  useEffect(() => {
    if (!currentFile) {
      setNumPdfPages(0);
      setPageThumbnails(new Map());
      return;
    }

    let isCancelled = false;

    const loadPdfAndThumbs = async () => {
      try {
        const loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(currentFile.data.slice(0)),
        });
        const pdf = await loadingTask.promise;
        if (isCancelled) return;

        const totalPages = pdf.numPages || 1;
        setNumPdfPages(totalPages);

        const pagesToLoad = getSelectedPages(totalPages);

        // Render thumbnails for selected pages sequentially or in parallel batches
        for (const p of pagesToLoad) {
          if (isCancelled) break;
          try {
            const page = await pdf.getPage(p);
            const viewport = page.getViewport({ scale: 0.55 });
            const canvas = document.createElement('canvas');
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              await page.render({
                canvasContext: ctx,
                viewport,
              } as unknown as Parameters<typeof page.render>[0]).promise;

              const blob = await new Promise<Blob | null>((res) =>
                canvas.toBlob(res, 'image/jpeg', 0.85)
              );
              if (blob && !isCancelled) {
                const url = URL.createObjectURL(blob);
                createdUrlsRef.current.push(url);
                setPageThumbnails((prev) => new Map(prev).set(p, url));
              }
            }
          } catch {
            // Non-fatal thumbnail error
          }
        }
      } catch (err) {
        if (!isCancelled) {
          setError(toUserFacingError(err));
        }
      }
    };

    loadPdfAndThumbs();

    return () => {
      isCancelled = true;
    };
  }, [currentFile, getSelectedPages]);

  // Handle single file selection (allows only 1 PDF)
  const handleProcessIncomingFile = async (rawFiles: FileList | File[]) => {
    if (!rawFiles || rawFiles.length === 0) return;
    setIsImporting(true);
    setError(null);

    try {
      // Find the first PDF file (enforces single PDF)
      const pdfFile = Array.from(rawFiles).find(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
      );

      if (!pdfFile) {
        throw new Error('Please select a valid PDF document (.pdf).');
      }

      await validateFile(pdfFile, {
        acceptedMimes: ['application/pdf', '.pdf'],
        maxFileSize: 250 * 1024 * 1024,
      });

      const buffer = await pdfFile.arrayBuffer();
      const processed: ProcessedFile = {
        id: `pdf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: pdfFile.name,
        size: pdfFile.size,
        type: pdfFile.type || 'application/pdf',
        lastModified: pdfFile.lastModified,
        data: buffer,
      };

      if (onDismissResult) {
        onDismissResult();
      }

      // Enforce strictly 1 PDF file
      onFilesChange([processed]);
    } catch (err) {
      setError(toUserFacingError(err));
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleProcessIncomingFile(e.dataTransfer.files);
    }
  };

  const handleRequestClear = () => {
    setShowClearConfirm(true);
  };

  const handleConfirmClear = () => {
    if (onDismissResult) onDismissResult();
    onFilesChange([]);
    setPageThumbnails(new Map());
    setNumPdfPages(0);
    setShowClearConfirm(false);
  };

  return (
    <div className={`flex flex-col select-none ${isMobile ? 'flex-1 min-h-0 space-y-2' : 'space-y-4'} ${className}`}>
      {/* Hidden single PDF input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple={false}
        onChange={(e) => {
          if (e.target.files) handleProcessIncomingFile(e.target.files);
        }}
        className="hidden"
      />

      {/* Clear Warning Banner */}
      <ClearWarningBanner
        isOpen={showClearConfirm}
        itemCount={files.length}
        onConfirm={handleConfirmClear}
        onCancel={() => setShowClearConfirm(false)}
      />

      {/* Error alert inside showcase */}
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between p-3.5 rounded-sheet bg-status-error-bg border border-status-error-border text-status-error text-sm"
        >
          <div className="flex items-center gap-2">
            <X className="w-4 h-4 shrink-0" />
            <span>{error.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center hover:bg-status-error/10 rounded-control cursor-pointer"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* STATE 0: EMPTY STATE (One plain line, one primary action) */}
      {!currentFile && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`w-full rounded-sheet border transition-colors duration-150 flex flex-col items-center justify-center text-center p-6 gap-3 ${
            isMobile
              ? 'flex-1 min-h-[180px]'
              : 'flex-1 min-h-[340px]'
          } ${
            isDragOver
              ? 'border-accent bg-surface-hover shadow-lifted'
              : 'border-surface-border bg-surface-panel'
          }`}
        >
          <p className="text-sm text-text-muted max-w-sm">
            {isMobile
              ? 'Choose a PDF on your device to render as images.'
              : 'Choose a PDF or drop it onto the desk to render pages as images.'}
          </p>
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={isProcessing || isImporting}
            isLoading={isImporting}
            onClick={() => fileInputRef.current?.click()}
            leftIcon={!isImporting ? <FolderPlus className="w-4 h-4" /> : undefined}
          >
            {isImporting ? 'Reading...' : isMobile ? 'Choose files' : 'Select PDF'}
          </Button>
        </div>
      )}

      {/* PAGES PREVIEW - Standardized to match Merger Dropbox */}
      {currentFile && (
        <div className={`w-full rounded-sheet border border-surface-border bg-surface-panel p-3.5 sm:p-5 flex flex-col justify-between overflow-hidden relative shadow-2xs ${isMobile ? 'flex-1 min-h-0' : 'flex-1 min-h-[340px]'}`}>
          {/* Selected Pages Thumbnail Grid */}
          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            {selectedPageNumbers.length === 0 ? (
              <div className="p-8 text-center text-sm text-text-muted">
                No pages match the current selection. Update Page Selection in Options.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3 items-start">
                {selectedPageNumbers.map((p) => {
                  const thumbUrl = pageThumbnails.get(p);
                  return (
                    <div
                      key={`page_${p}`}
                      className="paper-sheet p-2.5 sm:p-3 flex flex-col justify-between space-y-2 select-none"
                    >
                      {/* Page Label & Target Format */}
                      <div className="flex items-center justify-between gap-1 pb-1.5 border-b border-surface-border-subtle pr-1 text-xs">
                        <span className="font-medium text-text-main">
                          Page {p} <span className="font-mono text-text-muted">/ {numPdfPages}</span>
                        </span>
                        <span className="text-[11px] font-mono font-medium px-1.5 py-0.5 rounded-chip bg-surface-subtle text-text-muted border border-surface-border">
                          &rarr; {formatUpper}
                        </span>
                      </div>

                      {/* Thumbnail Preview Area: consistent h-28 sm:h-36 */}
                      <div
                        onClick={() => {
                          // When conversion has completed, click opens the converted images in ImageGalleryModal
                          if (result && result.items && result.items.length > 0) {
                            const galleryItems: GalleryItem[] = result.items.map((it, idx) => ({
                              id: it.id || `conv_img_${idx}`,
                              name: it.name,
                              blob: it.blob,
                              size: it.blob?.size,
                              type: it.blob?.type || 'image/png',
                              url: URL.createObjectURL(it.blob),
                            }));
                            const pageIdxInSelection = Math.max(0, Math.min(selectedPageNumbers.indexOf(p), galleryItems.length - 1));
                            if (onViewImages) {
                              onViewImages(galleryItems, pageIdxInSelection);
                              return;
                            }
                          }
                          // Before conversion: preview single page
                          if (thumbUrl && onViewFile && currentFile) {
                            onViewFile({
                              id: `p_${p}`,
                              name: `${currentFile.name} - Page ${p}`,
                              size: currentFile.size,
                              type: 'image/jpeg',
                              lastModified: Date.now(),
                              data: new ArrayBuffer(0),
                              previewUrl: thumbUrl,
                            });
                          }
                        }}
                        className={`w-full h-28 sm:h-36 rounded-none bg-surface-subtle border border-surface-border-subtle flex items-center justify-center overflow-hidden relative ${
                          (thumbUrl && onViewFile) || (result && result.items) ? 'cursor-pointer hover:border-accent hover:ring-1 hover:ring-accent transition-all' : ''
                        } p-1`}
                        title={result && result.items ? 'Click to view converted image' : (thumbUrl && onViewFile ? 'Click to preview' : undefined)}
                      >
                        {thumbUrl ? (
                          <img
                            src={thumbUrl}
                            alt={`Preview page ${p}`}
                            className="max-h-full max-w-full object-contain rounded-none pointer-events-none"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-1.5 text-text-muted text-xs">
                            <Loader2 className="w-5 h-5 text-accent animate-spin" />
                            <span className="font-mono">Rendering...</span>
                          </div>
                        )}
                      </div>

                      {/* Ready Indicator */}
                      <div className="mt-auto pt-1.5 flex items-center justify-between text-xs text-text-muted border-t border-surface-border-subtle">
                        <span className="flex items-center gap-1 text-status-success font-medium text-[11px]">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Ready
                        </span>
                        <span className="font-mono text-[11px] text-text-muted">
                          #{p}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Bottom Summary Bar: Queue summary + Replace + Clear + Full-width Action button */}
          <div className="shrink-0 pt-2 border-t border-surface-border flex flex-col gap-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-text-muted truncate">
                1 PDF &bull; {selectedPageNumbers.length} {selectedPageNumbers.length === 1 ? 'page' : 'pages'} ({formatBytes(currentFile.size)})
              </span>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessing}
                  className="h-8 px-2.5 rounded-control inline-flex items-center justify-center gap-1 text-xs font-semibold text-text-main bg-surface-subtle hover:bg-surface-hover border border-surface-border transition-colors cursor-pointer disabled:opacity-50"
                >
                  <FolderPlus className="w-3.5 h-3.5 shrink-0" />
                  <span>Replace</span>
                </button>

                <button
                  type="button"
                  onClick={handleRequestClear}
                  disabled={isProcessing}
                  className="h-8 px-2.5 rounded-control inline-flex items-center justify-center gap-1 text-xs font-semibold text-status-error hover:bg-status-error-bg border border-surface-border transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Clear</span>
                </button>
              </div>
            </div>

            {isMobile && onExecute && (
              <Button
                variant={result ? 'secondary' : 'primary'}
                size="md"
                disabled={isProcessing || selectedPageNumbers.length === 0 || Boolean(result)}
                onClick={onExecute}
                className={`w-full font-bold shadow-xs min-h-[40px] ${
                  result ? 'opacity-90 cursor-not-allowed border-surface-border' : ''
                }`}
                leftIcon={
                  isProcessing ? (
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  ) : result ? (
                    <Check className="w-4 h-4 text-status-success shrink-0" />
                  ) : (
                    <Play className="w-4 h-4 fill-current shrink-0" />
                  )
                }
              >
                {isProcessing ? 'Converting...' : result ? 'Converted' : 'Convert to Images'}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
