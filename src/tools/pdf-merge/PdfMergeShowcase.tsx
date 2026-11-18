import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  FolderPlus,
  Trash2,
  X,
  FileText,
  FileImage,
  AlertCircle,
  Loader2,
  GripVertical,
  ChevronLeft,
  ChevronRight,
  Layers,
  Check,
  Save,
  ExternalLink,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ProcessedFile } from '../../core/types';
import type { BatchResult } from '../../core/processors/types';
import { validateFile, validateBatchLimits, formatBytes } from '../../core/files/validation';
import { toUserFacingError, type UserFacingError } from '../../core/errors';
import { isMobileApp, downloadBlob } from '../../core/processors/download';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { ClearWarningBanner } from '../../components/ui/ClearWarningBanner';

// Set up worker source in browser environment
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
}

export interface PdfMergeShowcaseProps {
  files: ProcessedFile[];
  onFilesChange: (files: ProcessedFile[]) => void;
  options?: Record<string, unknown>;
  onOptionsChange?: (options: Record<string, unknown>) => void;
  isProcessing: boolean;
  result?: BatchResult | null;
  onDismissResult?: () => void;
  onExecute?: () => void;
  acceptedMimes?: string[];
  maxFiles?: number;
  selectedFileId?: string | null;
  onSelectFile?: (id: string | null) => void;
  onViewFile?: (file: ProcessedFile) => void;
  className?: string;
}

export const PdfMergeShowcase: React.FC<PdfMergeShowcaseProps> = ({
  files,
  onFilesChange,
  options = {},
  onOptionsChange,
  isProcessing,
  result,
  onDismissResult,
  onExecute,
  acceptedMimes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/*',
    '.pdf',
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
  ],
  maxFiles = 100,
  selectedFileId,
  onSelectFile,
  onViewFile,
  className = '',
}) => {
  const isMobile = isMobileApp() || (typeof window !== 'undefined' && window.innerWidth < 768);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Background thumbnails and page counts
  const [previewMap, setPreviewMap] = useState<Map<string, string>>(new Map());
  const [pageCountMap, setPageCountMap] = useState<Map<string, number>>(new Map());
  const [pendingThumbnails, setPendingThumbnails] = useState<Set<string>>(new Set());

  // Drag and drop reordering states
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Hydrate PDF thumbnails & page counts when files arrive via Draft resume or Library open
  useEffect(() => {
    const missingImgs = files.filter(
      (f) =>
        (f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name)) &&
        !pageCountMap.has(f.id)
    );
    if (missingImgs.length > 0) {
      setPageCountMap((prev) => {
        const next = new Map(prev);
        missingImgs.forEach((it) => next.set(it.id, 1));
        return next;
      });
    }

    const missingPdfs = files.filter(
      (f) =>
        (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) &&
        !previewMap.has(f.id) &&
        !pendingThumbnails.has(f.id)
    );
    if (missingPdfs.length === 0) return;

    setPendingThumbnails((prev) => {
      const next = new Set(prev);
      missingPdfs.forEach((p) => next.add(p.id));
      return next;
    });

    missingPdfs.forEach(async (pdfFile) => {
      try {
        const { pageCount, thumbUrl } = await loadPdfMetadataAndThumbnail(pdfFile.data);
        setPageCountMap((prev) => new Map(prev).set(pdfFile.id, pageCount));
        if (thumbUrl) {
          setPreviewMap((prev) => new Map(prev).set(pdfFile.id, thumbUrl));
        }
      } finally {
        setPendingThumbnails((prev) => {
          const next = new Set(prev);
          next.delete(pdfFile.id);
          return next;
        });
      }
    });
  }, [files]);

  // Generate thumbnail and get page count for PDF
  const loadPdfMetadataAndThumbnail = async (
    buffer: ArrayBuffer
  ): Promise<{ pageCount: number; thumbUrl: string | null }> => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return { pageCount: 1, thumbUrl: null };
    }
    try {
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(buffer.slice(0)),
      });
      const pdf = await loadingTask.promise;
      const numPages = pdf.numPages || 1;

      // Render page 1 thumbnail
      let thumbUrl: string | null = null;
      try {
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 0.45 });
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
          const thumbBlob = await new Promise<Blob | null>((res) =>
            canvas.toBlob(res, 'image/jpeg', 0.82)
          );
          if (thumbBlob) {
            thumbUrl = URL.createObjectURL(thumbBlob);
          }
        }
      } catch {
        // Thumbnail generation failed, fallback to icon
      }

      return { pageCount: numPages, thumbUrl };
    } catch {
      return { pageCount: 1, thumbUrl: null };
    }
  };

  const handleProcessIncomingFiles = useCallback(
    async (fileList: FileList | File[]) => {
      setError(null);
      const fileArray = Array.from(fileList);
      if (fileArray.length === 0) return;

      setIsImporting(true);

      try {
        validateBatchLimits(fileArray, { maxBatchCount: maxFiles });

        // Fast parallel buffer read (<30ms for entire batch)
        const processedItems: ProcessedFile[] = await Promise.all(
          fileArray.map(async (file) => {
            await validateFile(file, { acceptedMimes });
            const buffer = await file.arrayBuffer();

            let previewUrl: string | undefined = undefined;
            if (file.type.startsWith('image/')) {
              const blob = new Blob([buffer], { type: file.type });
              previewUrl = URL.createObjectURL(blob);
            }

            return {
              id: `f_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
              name: file.name,
              size: file.size,
              type: file.type || 'application/octet-stream',
              lastModified: file.lastModified,
              data: buffer,
              blob: file,
              previewUrl,
            };
          })
        );

        // Instantly register pageCount=1 for images
        setPageCountMap((prev) => {
          const next = new Map(prev);
          processedItems.forEach((it) => {
            if (it.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(it.name)) {
              next.set(it.id, 1);
            }
          });
          return next;
        });

        // Instantly display files in the workspace (zero delay!)
        if (result && onDismissResult) onDismissResult();
        onFilesChange([...files, ...processedItems]);
        setIsImporting(false);

        // Asynchronously inspect PDF page counts and thumbnails in background
        const pdfItems = processedItems.filter(
          (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
        );

        if (pdfItems.length > 0) {
          setPendingThumbnails((prev) => {
            const next = new Set(prev);
            pdfItems.forEach((p) => next.add(p.id));
            return next;
          });

          pdfItems.forEach(async (pdfFile) => {
            try {
              const { pageCount, thumbUrl } = await loadPdfMetadataAndThumbnail(pdfFile.data);
              setPageCountMap((prev) => new Map(prev).set(pdfFile.id, pageCount));
              if (thumbUrl) {
                setPreviewMap((prev) => new Map(prev).set(pdfFile.id, thumbUrl));
              }
            } finally {
              setPendingThumbnails((prev) => {
                const next = new Set(prev);
                next.delete(pdfFile.id);
                return next;
              });
            }
          });
        }
      } catch (err) {
        setIsImporting(false);
        setError(toUserFacingError(err));
      }
    },
    [files, onFilesChange, acceptedMimes, maxFiles]
  );

  const handleDragOverContainer = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isProcessing) setIsDragOver(true);
  };

  const handleDragLeaveContainer = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDropContainer = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (isProcessing) return;

    // Only process file drops from external desktop/file manager
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleProcessIncomingFiles(e.dataTransfer.files);
    }
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleRemoveFile = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const target = files.find((f) => f.id === id);
    if (target?.previewUrl) {
      URL.revokeObjectURL(target.previewUrl);
    }
    const bgUrl = previewMap.get(id);
    if (bgUrl) {
      URL.revokeObjectURL(bgUrl);
      setPreviewMap((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    }
    setPageCountMap((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });

    if (selectedFileId === id) {
      onSelectFile?.(null);
    }
    if (result && onDismissResult) onDismissResult();
    onFilesChange(files.filter((f) => f.id !== id));
  };

  const handleRequestClearAll = () => {
    setShowClearConfirm(true);
  };

  const handleConfirmClearAll = () => {
    if (result && onDismissResult) onDismissResult();
    files.forEach((f) => {
      if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    });
    previewMap.forEach((url) => URL.revokeObjectURL(url));
    setPreviewMap(new Map());
    setPageCountMap(new Map());
    setPendingThumbnails(new Set());
    onSelectFile?.(null);
    onFilesChange([]);
    setShowClearConfirm(false);
  };

  // Reorder via Move buttons (1 step left/right)
  const handleMoveStep = (currentIndex: number, direction: 'left' | 'right', e?: React.MouseEvent) => {
    e?.stopPropagation();
    const targetIndex = direction === 'left' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= files.length) return;

    const updated = Array.from(files);
    const [moved] = updated.splice(currentIndex, 1);
    updated.splice(targetIndex, 0, moved);
    if (result && onDismissResult) onDismissResult();
    onFilesChange(updated);
    onSelectFile?.(moved.id);
  };

  // Drag and drop within the grid to reorder
  const handleItemDragStart = (e: React.DragEvent, index: number) => {
    if (isProcessing) return;
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `${index}`);
  };

  const handleItemDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedIndex === null || draggedIndex === index) return;
    setDragOverIndex(index);
  };

  const handleItemDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const updated = Array.from(files);
    const [movedItem] = updated.splice(draggedIndex, 1);
    updated.splice(targetIndex, 0, movedItem);

    if (result && onDismissResult) onDismissResult();
    onFilesChange(updated);
    onSelectFile?.(movedItem.id);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleItemDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // Compute cumulative serial numbers (SN) and page allocations based on current order
  let runningStartPage = 1;
  const itemsWithMeta = files.map((file) => {
    const isImg =
      file.type.startsWith('image/') ||
      /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name);
    const pages = isImg ? 1 : pageCountMap.get(file.id) || 1;
    const startPage = runningStartPage;
    const endPage = runningStartPage + pages - 1;
    runningStartPage += pages;

    return {
      file,
      isImg,
      pages,
      startPage,
      endPage,
    };
  });

  const totalPagesCount = runningStartPage - 1;
  const totalOriginalBytes = files.reduce((acc, f) => acc + f.size, 0);
  const outputFilename = String(options.outputFilename ?? 'merged_document.pdf');

  return (
    <div
      className={`flex flex-col select-none ${
        isMobile ? 'h-full min-h-0 space-y-2' : 'space-y-4 w-full max-w-5xl mx-auto pb-6 flex-1 min-h-0'
      } ${className}`}
    >
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={acceptedMimes.join(',')}
        onChange={(e) => {
          if (e.target.files) handleProcessIncomingFiles(e.target.files);
          e.target.value = '';
        }}
        className="hidden"
        disabled={isProcessing}
      />

      {/* Clear Warning Banner */}
      <ClearWarningBanner
        isOpen={showClearConfirm}
        itemCount={files.length}
        onConfirm={handleConfirmClearAll}
        onCancel={() => setShowClearConfirm(false)}
      />

      {/* Error Callout */}
      {error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 p-3.5 rounded-sheet bg-status-error-bg border border-status-error-border text-status-error text-sm shrink-0"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">{error.title}</p>
              <p className="text-text-main mt-0.5">{error.message}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-control text-status-error hover:bg-status-error/10 transition-colors cursor-pointer"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Box: Showcase Workspace (flex-1 on mobile, fills all available height) */}
      <div
        onDragOver={handleDragOverContainer}
        onDragLeave={handleDragLeaveContainer}
        onDrop={handleDropContainer}
        className={`w-full rounded-sheet border transition-colors duration-150 flex flex-col justify-between ${
          isMobile
            ? 'flex-1 min-h-0 p-3 sm:p-4 overflow-hidden'
            : 'flex-1 min-h-[340px] p-4 sm:p-5'
        } ${
          isDragOver ? 'border-accent bg-surface-hover shadow-lifted' : 'border-surface-border bg-surface-panel'
        }`}
      >
        {isImporting && files.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 my-auto space-y-2.5 animate-in fade-in duration-150">
            <Loader2 className="w-8 h-8 text-accent animate-spin" />
            <p className="text-sm font-semibold text-text-main">Reading files...</p>
            <p className="text-xs text-text-muted">Loading and validating documents on this device</p>
          </div>
        ) : files.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-4 my-auto text-center gap-2">
            <h3 className="text-base sm:text-lg font-bold text-text-main">
              Drop PDFs here
            </h3>
            <p className="text-xs sm:text-sm text-text-muted">
              or choose them from your device.
            </p>
            <div className="pt-2">
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={openFilePicker}
                disabled={isProcessing}
                leftIcon={<FolderPlus className="w-4 h-4" />}
                className="font-semibold px-6 shadow-xs"
              >
                Select PDFs
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3 items-start">
              {itemsWithMeta.map((item, index) => {
                  const { file, isImg, pages, startPage, endPage } = item;
                  const previewUrl = file.previewUrl || previewMap.get(file.id);
                  const isRenderingPreview = !isImg && !previewUrl && pendingThumbnails.has(file.id);

                  const isBeingDragged = draggedIndex === index;
                  const isDragTarget = dragOverIndex === index;
                  const isSelected = selectedFileId === file.id;

                  return (
                    <div
                      key={file.id}
                      draggable={!isProcessing}
                      onClick={() => onSelectFile?.(file.id)}
                      onDragStart={(e) => handleItemDragStart(e, index)}
                      onDragOver={(e) => handleItemDragOver(e, index)}
                      onDrop={(e) => handleItemDrop(e, index)}
                      onDragEnd={handleItemDragEnd}
                      className={`paper-sheet p-2.5 sm:p-3 flex flex-col justify-between space-y-2 transition-colors relative group cursor-pointer select-none ${
                        isBeingDragged
                          ? 'opacity-60 border-accent shadow-lifted'
                          : isDragTarget || isSelected
                          ? 'border-accent ring-1 ring-accent'
                          : ''
                      }`}
                    >
                      {/* Top Row: Drag Grip, Filename, and Remove Button */}
                      <div className="flex items-center justify-between gap-1 text-xs">
                        <div className="flex items-center gap-1 min-w-0" title="Drag to rearrange">
                          <GripVertical
                            className="w-3.5 h-3.5 text-text-muted group-hover:text-text-main shrink-0 cursor-grab active:cursor-grabbing"
                          />
                          <span
                            className="font-mono font-medium text-text-main truncate max-w-[75px] sm:max-w-[140px]"
                            title={file.name}
                          >
                            {file.name}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => handleRemoveFile(file.id, e)}
                          className="min-w-[32px] min-h-[32px] sm:min-w-[40px] sm:min-h-[40px] -m-1 inline-flex items-center justify-center rounded-control text-text-muted hover:text-status-error hover:bg-status-error-bg transition-colors shrink-0 cursor-pointer"
                          title="Remove file"
                          aria-label={`Remove ${file.name}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Middle: Document / Image Preview Thumbnail */}
                      <div
                        className="w-full h-28 sm:h-36 rounded-none bg-surface-subtle border border-surface-border-subtle flex items-center justify-center overflow-hidden relative"
                      >
                        {previewUrl ? (
                          <img
                            src={previewUrl}
                            alt={file.name}
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-contain p-1 rounded-none pointer-events-none"
                          />
                        ) : isRenderingPreview ? (
                          <div className="flex flex-col items-center justify-center gap-1.5 text-text-muted p-2 text-center">
                            <Loader2 className="w-5 h-5 text-accent animate-spin" />
                            <span className="text-xs font-mono">Rendering...</span>
                          </div>
                        ) : isImg ? (
                          <div className="flex flex-col items-center gap-1.5 text-text-muted">
                            <FileImage className="w-7 h-7" />
                            <Badge size="sm" variant="neutral">
                              IMAGE
                            </Badge>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-1.5 text-text-muted">
                            <FileText className="w-7 h-7" />
                            <Badge size="sm" variant="neutral">
                              PDF
                            </Badge>
                          </div>
                        )}

                        {/* Format Badge overlay on preview */}
                        <div className="absolute top-1.5 right-1.5">
                          <span className="px-1.5 py-0.5 rounded-chip text-xs font-mono font-medium bg-surface-panel text-text-main border border-surface-border shadow-xs">
                            {isImg ? 'IMG' : 'PDF'}
                          </span>
                        </div>
                      </div>

                      {/* Serial Number & Output Page Callout */}
                      <div className="px-1.5 py-1 rounded-control bg-surface-subtle border border-surface-border flex items-center justify-between text-[11px] font-mono">
                        <div className="flex items-center gap-1 whitespace-nowrap">
                          <span className="font-bold text-text-main">
                            SN {startPage}
                          </span>
                          <span className="text-text-muted">
                            ({pages}{pages === 1 ? 'p' : 'pp'})
                          </span>
                        </div>
                        <span className="font-medium text-text-main whitespace-nowrap">
                          {startPage}–{endPage}
                        </span>
                      </div>

                      {/* Bottom row: File size and reorder buttons */}
                      <div className="flex items-center justify-between pt-1 border-t border-surface-border-subtle text-[11px] font-mono">
                        <span className="text-text-muted truncate max-w-[60px]">
                          {formatBytes(file.size)}
                        </span>

                        {/* Reorder Buttons */}
                        <div className="flex items-center shrink-0">
                          <button
                            type="button"
                            disabled={index === 0 || isProcessing}
                            onClick={(e) => handleMoveStep(index, 'left', e)}
                            title="Move earlier"
                            aria-label="Move earlier"
                            className="p-1 rounded-control text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors disabled:text-text-disabled disabled:cursor-not-allowed cursor-pointer"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                          </button>
                          <span className="text-[11px] font-mono text-text-main font-semibold px-0.5 whitespace-nowrap">
                            #{index + 1}
                          </span>
                          <button
                            type="button"
                            disabled={index === files.length - 1 || isProcessing}
                            onClick={(e) => handleMoveStep(index, 'right', e)}
                            title="Move later"
                            aria-label="Move later"
                            className="p-1 rounded-control text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors disabled:text-text-disabled disabled:cursor-not-allowed cursor-pointer"
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {isImporting && (
                  <div className="paper-sheet p-3 flex flex-col items-center justify-center h-48 sm:h-56 border-dashed border-accent/60 bg-surface-subtle/60 animate-pulse">
                    <Loader2 className="w-5 h-5 text-accent animate-spin mb-1.5" />
                    <span className="text-xs font-semibold text-text-main">Reading file...</span>
                    <span className="text-[11px] text-text-muted">Loading data</span>
                  </div>
                )}
              </div>
            </div>
          )}

        {/* Bottom pinned summary bar: ALWAYS present to prevent UI jump */}
        <div className="shrink-0 pt-2.5 border-t border-surface-border flex items-center justify-between gap-2 text-xs -mx-4 sm:-mx-5 -mb-4 sm:-mb-5 px-4 sm:px-5 py-2.5 rounded-b-sheet bg-surface-panel">
          {files.length === 0 ? (
            <>
              <span className="font-mono text-text-muted text-xs">0 files</span>
              <button
                type="button"
                disabled
                className="h-8 px-2.5 rounded-control inline-flex items-center justify-center gap-1.5 text-xs font-mono text-text-disabled cursor-not-allowed opacity-40"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span>Clear</span>
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={openFilePicker}
                  className="h-8 px-3 rounded-control inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-text-main bg-surface-subtle hover:bg-surface-hover border border-surface-border transition-colors cursor-pointer disabled:opacity-50"
                >
                  <FolderPlus className="w-3.5 h-3.5 shrink-0" />
                  <span>Add files</span>
                </button>
                <span className="font-mono text-text-muted text-xs truncate">
                  {files.length} {files.length === 1 ? 'file' : 'files'} · {totalPagesCount} {totalPagesCount === 1 ? 'page' : 'pages'} ({formatBytes(totalOriginalBytes)})
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={handleRequestClearAll}
                  className="h-8 px-2.5 rounded-control inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-status-error hover:bg-status-error-bg border border-transparent hover:border-status-error-border transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Clear</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom Docked Section: On desktop, duplicate options and Merge button are removed (already in OptionsPanel); only result card shows if merged */}
      {(isMobile || Boolean(result)) && (
        <div className="shrink-0 space-y-2 pt-0.5 select-none">
          {/* Full-width Merge Button (Mobile only) */}
          {isMobile && onExecute && (
            <Button
              variant={result ? 'secondary' : 'primary'}
              size="lg"
              disabled={files.length === 0 || isProcessing || Boolean(result)}
              onClick={onExecute}
              className={`w-full min-h-[48px] font-bold shadow-sm ${
                result ? 'opacity-90 cursor-not-allowed border-surface-border' : ''
              }`}
              leftIcon={
                isProcessing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : result ? (
                  <Check className="w-4 h-4 text-status-success" />
                ) : (
                  <Layers className="w-4 h-4" />
                )
              }
            >
              {isProcessing ? 'Merging Documents...' : result ? 'Merged' : 'Merge'}
            </Button>
          )}

          {/* Result Card: show Save File & Open buttons if merged */}
          {result ? (
            <div className="p-3 sm:p-3.5 rounded-sheet bg-surface-panel border border-surface-border space-y-2.5 shadow-2xs animate-in fade-in">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="w-4 h-4 text-accent shrink-0" />
                  <span className="font-mono font-medium text-text-main truncate" title={result.filename || outputFilename}>
                    {result.filename || outputFilename}
                  </span>
                  {result.size && (
                    <span className="font-mono text-text-muted shrink-0">
                      ({formatBytes(result.size)})
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[11px] font-mono text-status-success font-semibold px-2 py-0.5 rounded-chip bg-status-success-bg border border-status-success-border">
                    Ready
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-0.5">
                <Button
                  variant="primary"
                  size="md"
                  leftIcon={<Save className="w-4 h-4" />}
                  onClick={() => downloadBlob(result.blob, result.filename || outputFilename)}
                  className="w-full font-bold shadow-xs"
                >
                  Save File
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  leftIcon={<ExternalLink className="w-4 h-4" />}
                  onClick={async () => {
                    if (onViewFile && result?.blob) {
                      try {
                        const buffer = await result.blob.arrayBuffer();
                        onViewFile({
                          id: `merged_${Date.now()}`,
                          name: result.filename || outputFilename,
                          size: result.blob.size,
                          type: 'application/pdf',
                          lastModified: Date.now(),
                          data: buffer,
                          blob: result.blob,
                        });
                        return;
                      } catch (e) {
                        console.warn('Could not open preview in modal:', e);
                      }
                    }
                    if (result.downloadUrl) {
                      window.open(result.downloadUrl, '_blank');
                    } else {
                      const url = URL.createObjectURL(result.blob);
                      window.open(url, '_blank');
                    }
                  }}
                  className="w-full font-semibold"
                >
                  Open
                </Button>
              </div>
            </div>
          ) : isMobile ? (
            /* Output Name Card (Mobile only) */
            <div className="p-3 sm:p-3.5 rounded-sheet bg-surface-panel border border-surface-border space-y-1.5 shadow-2xs">
              <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block">
                Output Name
              </label>
              <input
                type="text"
                value={outputFilename}
                onChange={(e) => onOptionsChange?.({ ...options, outputFilename: e.target.value })}
                placeholder="merged_document.pdf"
                className="w-full min-h-[42px] px-3.5 text-xs sm:text-sm font-mono bg-surface-subtle border border-surface-border rounded-control text-text-main focus:outline-none focus:border-accent"
              />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};
