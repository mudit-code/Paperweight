import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  PlusCircle,
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
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ProcessedFile } from '../../core/types';
import { validateFile, validateBatchLimits, formatBytes } from '../../core/files/validation';
import { toUserFacingError, type UserFacingError } from '../../core/errors';
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
  isProcessing: boolean;
  onExecute?: () => void;
  acceptedMimes?: string[];
  maxFiles?: number;
  selectedFileId?: string | null;
  onSelectFile?: (id: string | null) => void;
  className?: string;
}

export const PdfMergeShowcase: React.FC<PdfMergeShowcaseProps> = ({
  files,
  onFilesChange,
  isProcessing,
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
  className = '',
}) => {
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
    onFilesChange(files.filter((f) => f.id !== id));
  };

  const handleRequestClearAll = () => {
    setShowClearConfirm(true);
  };

  const handleConfirmClearAll = () => {
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

  return (
    <div className={`space-y-4 ${className}`}>
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
          className="flex items-start justify-between gap-3 p-3.5 rounded-xl bg-status-error-bg border border-status-error-border text-status-error text-xs animate-in fade-in"
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
            className="p-1 rounded text-status-error hover:bg-status-error/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Showcase Box */}
      <div
        onDragOver={handleDragOverContainer}
        onDragLeave={handleDragLeaveContainer}
        onDrop={handleDropContainer}
        className={`w-full rounded-2xl border-2 border-dashed transition-all duration-200 flex flex-col justify-between min-h-[260px] sm:min-h-[320px] lg:min-h-[440px] p-4 sm:p-6 shadow-sm ${
          isDragOver
            ? 'border-accent bg-accent-subtle/20 ring-2 ring-accent/30'
            : 'border-surface-border bg-surface-subtle/40 hover:border-surface-border-focus'
        }`}
      >
        {/* Showcase Workspace */}
        {isImporting && files.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 my-auto space-y-3 animate-in fade-in duration-150">
            <div className="w-16 h-16 rounded-full bg-accent-subtle border border-accent-border flex items-center justify-center shadow-sm">
              <Loader2 className="w-8 h-8 text-accent animate-spin" />
            </div>
            <p className="text-sm font-semibold text-text-main">Reading files...</p>
            <p className="text-xs text-text-faint">Processing documents into memory</p>
          </div>
        ) : files.length === 0 ? (
          /* Empty State - Central Add Target (Matching Compressor Box) */
          <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 my-auto space-y-3 sm:space-y-4">
            <button
              type="button"
              onClick={openFilePicker}
              disabled={isProcessing}
              className="w-24 h-24 sm:w-32 sm:h-32 rounded-full border-2 border-dashed border-surface-border bg-surface-panel hover:bg-surface-panel hover:border-accent hover:text-accent flex flex-col items-center justify-center gap-1.5 sm:gap-2 text-text-muted transition-all shadow-sm group cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent"
              aria-label="Add PDFs & Images"
            >
              <PlusCircle className="w-8 h-8 text-text-muted group-hover:text-accent transition-colors" />
              <span className="text-xs font-semibold text-text-main group-hover:text-accent transition-colors">
                Add PDFs & Img
              </span>
            </button>
            <div className="text-center space-y-1">
              <p className="text-xs text-text-muted max-w-sm">
                Drag and drop files here, or click the circle above to browse from your device.
              </p>
              <p className="text-[11px] text-text-faint font-mono">
                Accepts PDF, JPG, PNG, WEBP • Drag items to reorder merge sequence
              </p>
            </div>
          </div>
        ) : (
          /* Populated State - Grid of Draggable Document Cards */
          <div className="w-full pb-4 max-h-[280px] sm:max-h-[340px] lg:max-h-none overflow-y-auto pr-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 items-start">
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
                    className={`rounded-xl bg-surface-panel border shadow-panel p-3.5 flex flex-col justify-between space-y-3 transition-all relative group cursor-pointer select-none ${
                      isBeingDragged
                        ? 'opacity-40 border-dashed border-accent scale-98 ring-2 ring-accent/30'
                        : isDragTarget
                        ? 'border-accent bg-accent-subtle/30 ring-2 ring-accent scale-102 shadow-md'
                        : isSelected
                        ? 'border-accent ring-2 ring-accent/60 bg-accent-subtle/20 shadow-md'
                        : 'border-surface-border hover:border-surface-border-focus'
                    }`}
                  >
                    {/* Top Row: Drag Grip, Filename, and Remove Button */}
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5 min-w-0" title="Drag to rearrange">
                        <GripVertical
                          className="w-3.5 h-3.5 text-text-faint group-hover:text-text-main shrink-0 cursor-grab active:cursor-grabbing"
                        />
                        <span
                          className="font-medium text-text-main truncate max-w-[130px]"
                          title={file.name}
                        >
                          {file.name}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleRemoveFile(file.id, e)}
                        className="p-1 rounded-md text-text-faint hover:text-status-error hover:bg-status-error/10 transition-colors shrink-0"
                        title="Remove file"
                        aria-label={`Remove ${file.name}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Middle: Document / Image Preview Thumbnail */}
                    <div className="w-full h-36 rounded-none bg-surface-subtle border border-surface-border-subtle flex items-center justify-center overflow-hidden relative group/thumb">
                      {previewUrl ? (
                        <img
                          src={previewUrl}
                          alt={file.name}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-contain p-1 rounded-none animate-in fade-in duration-200 pointer-events-none"
                        />
                      ) : isRenderingPreview ? (
                        <div className="flex flex-col items-center justify-center gap-1.5 text-text-faint p-2 text-center animate-pulse">
                          <Loader2 className="w-5 h-5 text-accent animate-spin" />
                          <span className="text-[10px] font-mono text-text-muted">Loading preview...</span>
                        </div>
                      ) : isImg ? (
                        <div className="flex flex-col items-center gap-1.5 text-text-muted">
                          <FileImage className="w-8 h-8 text-accent" />
                          <Badge size="sm" variant="neutral">
                            IMAGE
                          </Badge>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1.5 text-text-muted">
                          <FileText className="w-8 h-8 text-accent" />
                          <Badge size="sm" variant="neutral">
                            PDF
                          </Badge>
                        </div>
                      )}

                      {/* Format Badge overlay on preview */}
                      <div className="absolute top-1.5 right-1.5">
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-black/60 text-white backdrop-blur-xs">
                          {isImg ? 'IMG' : 'PDF'}
                        </span>
                      </div>
                    </div>

                    {/* Serial Number & Output Page Callout (Exact user specification) */}
                    <div className="px-2.5 py-2 rounded-lg bg-accent-subtle/60 border border-accent-border/50 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-accent font-mono">
                          SN {startPage}
                        </span>
                        <span className="text-[10px] text-text-muted font-mono">
                          ({pages} {pages === 1 ? 'page' : 'pages'})
                        </span>
                      </div>
                      <span className="text-[10px] font-mono font-medium text-text-main bg-surface-panel/80 px-1.5 py-0.5 rounded border border-surface-border-subtle">
                        {pages === 1 ? `p. ${startPage}` : `pp. ${startPage}–${endPage}`}
                      </span>
                    </div>

                    {/* Bottom Row: File Size and Precision Reorder Arrows */}
                    <div className="flex items-center justify-between pt-1 border-t border-surface-border-subtle text-xs">
                      <span className="font-mono text-[11px] text-text-faint">
                        {formatBytes(file.size)}
                      </span>

                      {/* Reorder Buttons */}
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={index === 0 || isProcessing}
                          onClick={(e) => handleMoveStep(index, 'left', e)}
                          title="Move earlier (Shift Left)"
                          className={`p-1 rounded text-text-faint hover:text-text-main hover:bg-surface-subtle transition-colors ${
                            index === 0 ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'
                          }`}
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-[10px] font-mono text-text-faint font-semibold">
                          #{index + 1}
                        </span>
                        <button
                          type="button"
                          disabled={index === files.length - 1 || isProcessing}
                          onClick={(e) => handleMoveStep(index, 'right', e)}
                          title="Move later (Shift Right)"
                          className={`p-1 rounded text-text-faint hover:text-text-main hover:bg-surface-subtle transition-colors ${
                            index === files.length - 1 ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'
                          }`}
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Bottom Action / Summary Bar */}
        <div className="w-full pt-4 mt-auto border-t border-surface-border flex items-center justify-between flex-wrap gap-3">
          {/* Left: Add more files button & Batch Summary */}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isProcessing}
              onClick={openFilePicker}
              leftIcon={<FolderPlus className="w-4 h-4" />}
              className="h-9 px-3.5 text-xs font-medium"
            >
              Select Files
            </Button>

            {files.length > 0 && (
              <div className="hidden sm:flex items-center gap-2 text-xs text-text-faint font-mono">
                <span>
                  {files.length} {files.length === 1 ? 'item' : 'items'}
                </span>
                <span>•</span>
                <span className="font-semibold text-text-main">
                  {totalPagesCount} total {totalPagesCount === 1 ? 'page' : 'pages'}
                </span>
                <span>•</span>
                <span>{formatBytes(totalOriginalBytes)}</span>
              </div>
            )}
          </div>

          {/* Right: Clear All & Execute Merge */}
          {files.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isProcessing}
                onClick={handleRequestClearAll}
                title="Clear all documents"
                className="h-9 px-3 rounded-md inline-flex items-center justify-center gap-1.5 text-xs font-medium text-text-muted hover:text-status-error hover:bg-status-error/10 border border-surface-border transition-colors cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
              >
                <Trash2 className="w-3.5 h-3.5 text-status-error" />
                <span>Clear all</span>
              </button>

              {onExecute && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={isProcessing || files.length === 0}
                  isLoading={isProcessing}
                  onClick={onExecute}
                  leftIcon={<Layers className="w-4 h-4" />}
                  className="h-9 px-5 text-xs font-semibold shadow-xs"
                >
                  Merge
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
