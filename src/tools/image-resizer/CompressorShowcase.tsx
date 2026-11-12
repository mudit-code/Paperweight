import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  PlusCircle,
  FolderPlus,
  Trash2,
  Archive,
  Save,
  Share2,
  Eye,
  X,
  FileText,
  FileCode,
  FileImage,
  TrendingDown,
  AlertCircle,
  Loader2,
  Check,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';
import type { ProcessedFile, ProgressReport } from '../../core/types';
import type { BatchResult, CompressedItemResult } from '../../core/processors/types';
import type { SizeEstimate } from '../../core/processors/estimate-size';
import { validateFile, validateBatchLimits, formatBytes } from '../../core/files/validation';
import { toUserFacingError, type UserFacingError } from '../../core/errors';
import { downloadBlob, saveMultipleBlobs, shareBlob, isMobileApp } from '../../core/processors/download';
import { compressSingleFile } from '../../core/processors/image-resizer';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { DeleteConfirmModal } from '../../components/ui/DeleteConfirmModal';
import { PdfViewerModal } from '../../components/ui/PdfViewerModal';

export interface CompressorShowcaseProps {
  files: ProcessedFile[];
  onFilesChange: (files: ProcessedFile[]) => void;
  options: Record<string, unknown>;
  onOptionsChange?: (options: Record<string, unknown>) => void;
  isProcessing: boolean;
  progress?: ProgressReport | null;
  onCancel?: () => void;
  result?: BatchResult | null;
  sizeEstimate?: SizeEstimate | null;
  onExecuteBatch?: () => void;
  acceptedMimes?: string[];
  maxFiles?: number;
  activeMode?: 'pdf' | 'image' | 'doc';
  className?: string;
}

export const CompressorShowcase: React.FC<CompressorShowcaseProps> = ({
  files,
  onFilesChange,
  options,
  onOptionsChange,
  isProcessing,
  progress,
  onCancel,
  result,
  sizeEstimate: _sizeEstimate,
  onExecuteBatch,
  acceptedMimes = [],
  maxFiles = 250,
  activeMode = 'pdf',
  className = '',
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = isMobileApp() || (typeof window !== 'undefined' && window.innerWidth < 768);
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);

  // Modern Delete Confirm Modal state (replaces inline top banner)
  const [deleteTarget, setDeleteTarget] = useState<{
    isOpen: boolean;
    id?: string;
    name?: string;
    isAll?: boolean;
    count?: number;
  }>({ isOpen: false });

  // In-button success state (replaces toast with green check on button)
  const [hasCompressedBatch, setHasCompressedBatch] = useState(false);

  // Track on-demand individual file compressions and action type (share vs save)
  const [singleCompressingId, setSingleCompressingId] = useState<string | null>(null);
  const [singleActionType, setSingleActionType] = useState<'share' | 'save' | null>(null);
  const [singleResults, setSingleResults] = useState<Map<string, CompressedItemResult>>(
    new Map()
  );

  // In-App PDF Viewer state
  const [viewingPdf, setViewingPdf] = useState<{
    blob: Blob;
    name: string;
    isCompressed: boolean;
  } | null>(null);

  // Background thumbnail mapping and pending set for non-blocking UI
  const [previewMap, setPreviewMap] = useState<Map<string, string>>(new Map());
  const [pendingThumbnails, setPendingThumbnails] = useState<Set<string>>(new Set());

  // Set hasCompressedBatch when batch compression finishes
  useEffect(() => {
    if (result && result.items && result.items.length > 0 && files.length > 0) {
      setHasCompressedBatch(true);
    } else if (!result || files.length === 0) {
      setHasCompressedBatch(false);
    }
  }, [result, files.length]);

  // Ensure PDF thumbnails render even when files are restored from Drafts or Library
  useEffect(() => {
    const missingPdfThumbs = files.filter(
      (f) =>
        (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) &&
        !previewMap.has(f.id) &&
        !pendingThumbnails.has(f.id)
    );
    if (missingPdfThumbs.length === 0) return;

    setPendingThumbnails((prev) => {
      const next = new Set(prev);
      missingPdfThumbs.forEach((p) => next.add(p.id));
      return next;
    });

    missingPdfThumbs.forEach(async (pdfFile) => {
      try {
        const thumbUrl = await generatePdfThumbnail(pdfFile.data);
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

  // Current compression level
  const currentLevel = typeof options.compressionLevel === 'number' ? options.compressionLevel : 40;

  const handleLevelChange = (lvl: number) => {
    setHasCompressedBatch(false);
    if (onOptionsChange) {
      onOptionsChange({
        ...options,
        compressionLevel: lvl,
        compressionPreset: lvl <= 20 ? 'light' : lvl >= 70 ? 'maximum' : 'balanced',
      });
    }
  };

  const handlePresetSelect = (lvl: number, preset: string) => {
    setHasCompressedBatch(false);
    if (onOptionsChange) {
      onOptionsChange({
        ...options,
        compressionLevel: lvl,
        compressionPreset: preset,
      });
    }
  };

  // Generate thumbnail for PDF files
  const generatePdfThumbnail = async (buffer: ArrayBuffer): Promise<string | null> => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;
    try {
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(buffer.slice(0)),
      });
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 0.45 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({
        canvasContext: ctx,
        viewport,
      } as unknown as Parameters<typeof page.render>[0]).promise;
      const thumbBlob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, 'image/jpeg', 0.82)
      );
      return thumbBlob ? URL.createObjectURL(thumbBlob) : null;
    } catch {
      return null;
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

        onFilesChange([...files, ...processedItems]);
        setHasCompressedBatch(false);
        setIsImporting(false);

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
              const thumbUrl = await generatePdfThumbnail(pdfFile.data);
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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isProcessing) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (isProcessing) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleProcessIncomingFiles(e.dataTransfer.files);
    }
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleRemoveFile = (id: string) => {
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
    const updated = files.filter((f) => f.id !== id);
    onFilesChange(updated);
    setHasCompressedBatch(false);

    if (singleResults.has(id)) {
      const nextMap = new Map(singleResults);
      nextMap.delete(id);
      setSingleResults(nextMap);
    }
  };

  const handleRequestClearAll = () => {
    setDeleteTarget({ isOpen: true, isAll: true, count: files.length });
  };

  const handleConfirmClearAll = () => {
    files.forEach((f) => {
      if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    });
    previewMap.forEach((url) => URL.revokeObjectURL(url));
    setPreviewMap(new Map());
    setPendingThumbnails(new Set());
    setSingleResults(new Map());
    onFilesChange([]);
    setHasCompressedBatch(false);
    setDeleteTarget({ isOpen: false });
  };

  const handleShareSingle = async (file: ProcessedFile) => {
    const batchItem = result?.items?.find(
      (it) => it.id === file.id || it.name.startsWith(file.name.replace(/\.[^.]+$/, ''))
    );
    if (batchItem) {
      await shareBlob(batchItem.blob, batchItem.name);
      return;
    }

    const cachedSingle = singleResults.get(file.id);
    if (cachedSingle) {
      await shareBlob(cachedSingle.blob, cachedSingle.name);
      return;
    }

    try {
      setSingleCompressingId(file.id);
      setSingleActionType('share');
      const compressed = await compressSingleFile(file, options);
      setSingleResults((prev) => new Map(prev).set(file.id, compressed));
      await shareBlob(compressed.blob, compressed.name);
    } catch (err) {
      setError(toUserFacingError(err));
    } finally {
      setSingleCompressingId(null);
      setSingleActionType(null);
    }
  };

  const handleDownloadSingle = async (file: ProcessedFile) => {
    const batchItem = result?.items?.find(
      (it) => it.id === file.id || it.name.startsWith(file.name.replace(/\.[^.]+$/, ''))
    );
    if (batchItem) {
      downloadBlob(batchItem.blob, batchItem.name);
      return;
    }

    const cachedSingle = singleResults.get(file.id);
    if (cachedSingle) {
      downloadBlob(cachedSingle.blob, cachedSingle.name);
      return;
    }

    try {
      setSingleCompressingId(file.id);
      setSingleActionType('save');
      const compressed = await compressSingleFile(file, options);
      setSingleResults((prev) => new Map(prev).set(file.id, compressed));
      downloadBlob(compressed.blob, compressed.name);
    } catch (err) {
      setError(toUserFacingError(err));
    } finally {
      setSingleCompressingId(null);
      setSingleActionType(null);
    }
  };

  const handlePreviewClick = (file: ProcessedFile) => {
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    if (!isPdf) return;

    const batchItem = result?.items?.find(
      (it) => it.id === file.id || it.name.startsWith(file.name.replace(/\.[^.]+$/, ''))
    );
    const singleItem = singleResults.get(file.id);
    const activeItem = batchItem || singleItem;

    if (activeItem) {
      setViewingPdf({
        blob: activeItem.blob,
        name: activeItem.name,
        isCompressed: true,
      });
    } else {
      const blob = new Blob([file.data], { type: 'application/pdf' });
      setViewingPdf({
        blob,
        name: file.name,
        isCompressed: false,
      });
    }
  };

  const handleDownloadZip = async () => {
    if (files.length === 0) return;

    if (isMobile) {
      if (result?.items && result.items.length > 0) {
        setIsSavingAll(true);
        try {
          if (result.items.length === 1) {
            downloadBlob(result.items[0].blob, result.items[0].name);
          } else {
            await saveMultipleBlobs(result.items.map((it) => ({ blob: it.blob, name: it.name })));
          }
        } finally {
          setIsSavingAll(false);
        }
        return;
      }

      if (files.length === 1 && singleResults.has(files[0].id)) {
        const item = singleResults.get(files[0].id)!;
        downloadBlob(item.blob, item.name);
        return;
      }

      if (files.length > 1 && files.every((f) => singleResults.has(f.id))) {
        setIsSavingAll(true);
        try {
          const itemsToSave = files.map((f) => {
            const item = singleResults.get(f.id)!;
            return { blob: item.blob, name: item.name };
          });
          await saveMultipleBlobs(itemsToSave);
        } finally {
          setIsSavingAll(false);
        }
        return;
      }

      if (onExecuteBatch) {
        onExecuteBatch();
      }
      return;
    }

    if (result && result.fileType === 'zip') {
      downloadBlob(result.blob, result.filename);
      return;
    }

    if (result?.items && result.items.length > 0) {
      const zip = new JSZip();
      for (const it of result.items) {
        zip.file(it.name, it.blob);
      }
      const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
      });
      downloadBlob(zipBlob, 'paperweight_compressed_archive.zip');
      return;
    }

    if (onExecuteBatch) {
      onExecuteBatch();
    }
  };

  const getAddLabel = () => {
    if (activeMode === 'pdf') return 'Add PDFs';
    if (activeMode === 'image') return 'Add Images';
    if (activeMode === 'doc') return 'Add Documents';
    return 'Add Files';
  };

  const getSelectLabel = () => {
    if (activeMode === 'pdf') return 'Select PDF';
    if (activeMode === 'image') return 'Select Image';
    if (activeMode === 'doc') return 'Select Document';
    return 'Select Files';
  };

  const totalOriginalBytes = files.reduce((acc, f) => acc + f.size, 0);

  return (
    <div className={`flex flex-col ${isMobile ? 'h-full min-h-0 space-y-2.5' : 'space-y-4'} ${className}`}>
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

      {/* Modern Centered Delete Confirm Modal (Replaces inline banner from Image 2) */}
      <DeleteConfirmModal
        isOpen={deleteTarget.isOpen}
        fileName={deleteTarget.name}
        itemCount={deleteTarget.count}
        title={deleteTarget.isAll ? 'Clear All Files?' : 'Remove File?'}
        confirmText={deleteTarget.isAll ? 'Clear All' : 'Remove'}
        onConfirm={() => {
          if (deleteTarget.isAll) {
            handleConfirmClearAll();
          } else if (deleteTarget.id) {
            handleRemoveFile(deleteTarget.id);
            setDeleteTarget({ isOpen: false });
          }
        }}
        onCancel={() => setDeleteTarget({ isOpen: false })}
      />

      {/* Error Callout */}
      {error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 p-3.5 rounded-xl bg-status-error-bg border border-status-error-border text-status-error text-xs animate-in fade-in shrink-0"
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

      {/* Main Showcase Box (Stretched down on mobile, no dead space, internal scrolling) */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`w-full rounded-2xl border-2 border-dashed transition-all duration-200 flex flex-col justify-between ${
          isMobile
            ? 'flex-1 min-h-0 p-3 pb-0 overflow-hidden'
            : 'min-h-[260px] sm:min-h-[320px] lg:min-h-[440px] p-4 sm:p-6'
        } shadow-sm ${
          isDragOver
            ? 'border-accent bg-accent-subtle/20 ring-2 ring-accent/30'
            : 'border-surface-border bg-surface-subtle/40 hover:border-surface-border-focus'
        }`}
      >
        {/* Showcase Files Workspace */}
        {isImporting && files.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-4 my-auto space-y-2 animate-in fade-in duration-150">
            <div className="w-12 h-12 rounded-full bg-accent-subtle border border-accent-border flex items-center justify-center shadow-xs">
              <Loader2 className="w-6 h-6 text-accent animate-spin" />
            </div>
            <p className="text-xs font-semibold text-text-main">Reading files...</p>
          </div>
        ) : files.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-4 my-auto space-y-3 pb-3.5">
            <button
              type="button"
              onClick={openFilePicker}
              disabled={isProcessing}
              className={`${
                isMobile ? 'w-24 h-24' : 'w-32 h-32'
              } rounded-full border-2 border-dashed border-surface-border bg-surface-panel hover:bg-surface-panel hover:border-accent hover:text-accent flex flex-col items-center justify-center gap-1.5 text-text-muted transition-all shadow-sm group cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent`}
              aria-label={getAddLabel()}
            >
              <PlusCircle className={`${isMobile ? 'w-7 h-7' : 'w-8 h-8'} text-text-muted group-hover:text-accent transition-colors`} />
              <span className="text-xs font-semibold text-text-main group-hover:text-accent transition-colors">
                {getAddLabel()}
              </span>
            </button>
            {!isMobile && (
              <p className="text-xs text-text-faint text-center max-w-sm">
                Drag and drop files here, or click the circle above to browse from your device.
              </p>
            )}
          </div>
        ) : (
          <div className={`w-full flex-1 min-h-0 ${isMobile ? 'overflow-y-auto px-1 pt-1 pb-2' : 'max-h-[280px] sm:max-h-[340px] lg:max-h-none overflow-y-auto px-1 pt-1 pb-3'} no-scrollbar`}>
            <div className={`grid ${isMobile ? 'grid-cols-2 gap-2.5' : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4'} items-start`}>
              {files.map((file) => {
                const batchItem = result?.items?.find(
                  (it) =>
                    it.id === file.id || it.name.startsWith(file.name.replace(/\.[^.]+$/, ''))
                );
                const singleItem = singleResults.get(file.id);
                const activeItem = batchItem || singleItem;
                const isSingleCompressing = singleCompressingId === file.id;

                const isDoc =
                  /\.(docx|doc)$/i.test(file.name) || file.type.includes('word');
                const isPdf =
                  /\.pdf$/i.test(file.name) || file.type === 'application/pdf';

                const previewUrl = file.previewUrl || previewMap.get(file.id);
                const isRenderingPreview = isPdf && !previewUrl && pendingThumbnails.has(file.id);

                return (
                  <div
                    key={file.id}
                    style={{
                      contentVisibility: 'auto',
                      containIntrinsicSize: '240px 240px',
                    }}
                    className={`rounded-xl bg-surface-panel border border-surface-border shadow-panel ${
                      isMobile ? 'p-2.5 space-y-2' : 'p-3.5 space-y-3'
                    } flex flex-col justify-between hover:border-surface-border-focus transition-all group relative animate-in fade-in duration-150`}
                  >
                    {/* Top Row: Filename, Original Size, and Remove Button */}
                    <div className="flex items-center justify-between gap-1.5 text-xs">
                      <span
                        className={`font-medium text-text-main truncate ${
                          isMobile ? 'max-w-[85px]' : 'max-w-[120px]'
                        }`}
                        title={file.name}
                      >
                        {file.name}
                      </span>
                      <span className="font-mono text-[10px] text-text-faint shrink-0">
                        {formatBytes(file.size)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget({ isOpen: true, id: file.id, name: file.name, isAll: false });
                        }}
                        className="p-1 rounded-md text-text-faint hover:text-status-error hover:bg-status-error/10 transition-colors shrink-0 cursor-pointer"
                        title="Remove file"
                        aria-label={`Remove ${file.name}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Middle: Document / Image Preview Thumbnail */}
                    <div
                      onClick={() => isPdf && handlePreviewClick(file)}
                      className={`w-full ${
                        isMobile
                          ? 'h-20 max-h-20'
                          : isPdf || isDoc
                          ? 'aspect-[1/1.414] max-h-48'
                          : 'h-36'
                      } mx-auto rounded-none bg-white border border-surface-border-subtle flex items-center justify-center overflow-hidden relative group/thumb shadow-2xs ${
                        isPdf ? 'cursor-pointer hover:ring-2 hover:ring-accent/40 hover:shadow-md' : ''
                      } transition-all`}
                      title={isPdf ? 'Tap to view PDF' : undefined}
                    >
                      {previewUrl ? (
                        <img
                          src={previewUrl}
                          alt={file.name}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-contain p-1 rounded-none animate-in fade-in duration-200"
                        />
                      ) : isRenderingPreview ? (
                        <div className="flex flex-col items-center justify-center gap-1.5 text-text-faint p-2 text-center animate-pulse">
                          <Loader2 className="w-5 h-5 text-accent animate-spin" />
                          <span className="text-[10px] font-mono text-text-muted">Loading preview...</span>
                        </div>
                      ) : isPdf ? (
                        <div className="flex flex-col items-center gap-1.5 text-text-muted">
                          <FileText className="w-8 h-8 text-accent" />
                          <Badge size="sm" variant="neutral">
                            PDF
                          </Badge>
                        </div>
                      ) : isDoc ? (
                        <div className="flex flex-col items-center gap-1.5 text-text-muted">
                          <FileCode className="w-8 h-8 text-accent" />
                          <Badge size="sm" variant="neutral">
                            DOCX
                          </Badge>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1.5 text-text-muted">
                          <FileImage className="w-8 h-8 text-text-faint" />
                          <Badge size="sm" variant="neutral">
                            IMAGE
                          </Badge>
                        </div>
                      )}

                      {/* PDF Tap-to-View Badge Overlay */}
                      {isPdf && (
                        <div className="absolute inset-0 bg-black/5 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center transition-opacity pointer-events-none">
                          <span className="px-2 py-1 rounded bg-black/60 text-white text-[10px] font-medium flex items-center gap-1 shadow-sm">
                            <Eye className="w-3 h-3" /> View
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Bottom: Size Info and Individual Action Buttons */}
                    <div className="space-y-1.5 pt-1 border-t border-surface-border-subtle">
                      <div className="flex items-center justify-between text-xs font-mono">
                        {activeItem ? (
                          <>
                            <span className="text-text-muted text-[10px]">New size:</span>
                            <div className="flex items-center gap-1">
                              <span className="font-bold text-accent text-xs">
                                {formatBytes(activeItem.compressedSize)}
                              </span>
                              {activeItem.savingsPercent > 0 && (
                                <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold bg-accent-subtle text-accent border border-accent-border">
                                  <TrendingDown className="w-2.5 h-2.5" />
                                  -{activeItem.savingsPercent}%
                                </span>
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="text-text-muted text-[10px]">Original:</span>
                            <span className="text-text-muted font-medium text-xs">
                              {formatBytes(file.size)}
                            </span>
                          </>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                        <button
                          type="button"
                          disabled={isProcessing || isSingleCompressing}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleShareSingle(file);
                          }}
                          title="Share file"
                          aria-label={`Share ${file.name}`}
                          className={`${
                            isMobile ? 'h-7' : 'h-8'
                          } rounded-lg border border-surface-border bg-surface-subtle hover:bg-surface-panel hover:border-accent text-text-main hover:text-accent flex items-center justify-center transition-all shadow-2xs active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer`}
                        >
                          {isSingleCompressing && singleActionType === 'share' ? (
                            <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />
                          ) : (
                            <Share2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={isProcessing || isSingleCompressing}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownloadSingle(file);
                          }}
                          title="Save file"
                          aria-label={`Save ${file.name}`}
                          className={`${
                            isMobile ? 'h-7' : 'h-8'
                          } rounded-lg bg-accent hover:bg-accent-hover text-accent-contrast flex items-center justify-center transition-all shadow-2xs active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer`}
                        >
                          {isSingleCompressing && singleActionType === 'save' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Save className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {isImporting && (
                <div className="h-full min-h-[140px] rounded-xl bg-surface-panel/60 border-2 border-dashed border-accent-border/60 p-4 flex flex-col items-center justify-center gap-2 animate-pulse">
                  <Loader2 className="w-6 h-6 text-accent animate-spin" />
                  <span className="text-xs font-semibold text-text-muted">Importing...</span>
                </div>
              )}

              {/* Add Files Round Slot in Grid */}
              <div className={`h-full ${isMobile ? 'min-h-[120px]' : 'min-h-[220px]'} flex items-center justify-center`}>
                <button
                  type="button"
                  onClick={openFilePicker}
                  disabled={isProcessing || isImporting}
                  className={`${isMobile ? 'w-20 h-20' : 'w-28 h-28'} rounded-full border-2 border-dashed border-surface-border bg-surface-panel/40 hover:bg-surface-panel hover:border-accent hover:text-accent flex flex-col items-center justify-center gap-1.5 text-text-muted transition-all shadow-sm group cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent`}
                  aria-label={getAddLabel()}
                >
                  <PlusCircle className={`${isMobile ? 'w-5 h-5' : 'w-6 h-6'} text-text-muted group-hover:text-accent transition-colors`} />
                  <span className="text-[11px] font-semibold text-text-main group-hover:text-accent transition-colors">
                    {getAddLabel()}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Pinned Toolbar inside the drop box */}
        <div className="relative z-20 shrink-0 pt-2 sm:pt-3 mt-auto border-t border-surface-border bg-surface-panel flex items-center justify-between flex-wrap gap-2 -mx-3 px-3 pb-2 rounded-b-2xl shadow-xs">
          {/* Left: Select Files Button & Summary */}
          <div className="flex items-center gap-2 sm:gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={isProcessing || isImporting}
              onClick={openFilePicker}
              leftIcon={
                isImporting ? (
                  <Loader2 className="w-4 h-4 animate-spin text-accent" />
                ) : (
                  <FolderPlus className="w-4 h-4" />
                )
              }
              className="font-medium text-xs shadow-sm"
            >
              {isImporting ? 'Importing...' : getSelectLabel()}
            </Button>

            {files.length > 0 && (
              <span className="text-xs font-mono text-text-muted hidden sm:inline">
                {files.length} {files.length === 1 ? 'file' : 'files'} (
                {formatBytes(totalOriginalBytes)}
                {result && result.size && (
                  <span className="text-accent font-semibold ml-1">
                    → {formatBytes(result.size)}
                    {result.savingsPercent !== undefined && result.savingsPercent > 0 && (
                      <span className="ml-1">(-{result.savingsPercent}%)</span>
                    )}
                  </span>
                )}
                )
              </span>
            )}
          </div>

          {/* Right: Trash Clear and Save Button */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRequestClearAll}
              disabled={files.length === 0 || isProcessing}
              className="p-2 rounded-lg text-text-faint hover:text-status-error hover:bg-status-error/10 border border-transparent hover:border-status-error/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              title="Remove all files"
              aria-label="Remove all files"
            >
              <Trash2 className="w-4 h-4 text-status-error" />
            </button>

            <Button
              variant="primary"
              size="sm"
              disabled={files.length === 0 || isProcessing || isSavingAll}
              isLoading={isProcessing || isSavingAll}
              onClick={handleDownloadZip}
              leftIcon={files.length > 1 && !isMobile ? <Archive className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              className="font-semibold text-xs shadow-sm"
            >
              {files.length > 1 ? (isMobile ? 'Save All' : 'Save ZIP') : 'Save File'}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Integrated Controls Area (Enlarged dropbox directly above; fixed height so elements never jump or float) */}
      {isMobile && (
        <div className="shrink-0 space-y-2 pt-0.5 animate-in fade-in select-none">
          {!isProcessing ? (
            <>
              {/* Compression Level Card */}
              <div className="p-3 rounded-xl bg-surface-panel border border-surface-border shadow-xs space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-text-main">Compression Level</span>
                  <span className="font-mono font-bold text-accent text-xs bg-surface-subtle px-2 py-0.5 rounded border border-surface-border-subtle">
                    {currentLevel}%
                  </span>
                </div>

                <input
                  type="range"
                  min={5}
                  max={95}
                  step={5}
                  value={currentLevel}
                  onChange={(e) => handleLevelChange(Number(e.target.value))}
                  disabled={isProcessing}
                  className="w-full accent-accent cursor-pointer"
                />

                {/* Preset Chips */}
                <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                  {[
                    { label: 'Light (15%)', val: 15, preset: 'light' },
                    { label: 'Balanced (40%)', val: 40, preset: 'balanced' },
                    { label: 'Maximum (75%)', val: 75, preset: 'maximum' },
                  ].map((p) => {
                    const isSel = currentLevel === p.val;
                    return (
                      <button
                        key={p.val}
                        type="button"
                        onClick={() => handlePresetSelect(p.val, p.preset)}
                        className={`py-1 px-1 text-[10px] font-semibold rounded-lg border transition-all cursor-pointer text-center ${
                          isSel
                            ? 'bg-accent text-accent-contrast border-accent font-bold shadow-2xs'
                            : 'bg-surface-subtle border-surface-border text-text-muted hover:text-text-main hover:bg-surface-panel'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Primary Action Button */}
              {hasCompressedBatch && !isProcessing ? (
                <div className="w-full h-11 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 flex items-center justify-center gap-2 text-xs font-semibold select-none shadow-xs pointer-events-none">
                  <div className="w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0">
                    <Check className="w-2.5 h-2.5 stroke-[3]" />
                  </div>
                  <span>Compressed</span>
                </div>
              ) : (
                <Button
                  variant="primary"
                  size="md"
                  className="w-full h-11 text-xs font-semibold shadow-md cursor-pointer"
                  disabled={files.length === 0 || isProcessing}
                  onClick={onExecuteBatch}
                >
                  Compress{' '}
                  {files.length > 0
                    ? activeMode === 'pdf'
                      ? files.length === 1
                        ? '1 PDF'
                        : `${files.length} PDFs`
                      : activeMode === 'image'
                      ? files.length === 1
                        ? '1 Image'
                        : `${files.length} Images`
                      : files.length === 1
                      ? '1 File'
                      : `${files.length} Files`
                    : 'Files'}
                </Button>
              )}
            </>
          ) : (
            <>
              {/* Compressing Progress Bar (Replaces Compression Level Card with matching footprint) */}
              <div className="p-3 rounded-xl bg-surface-panel border border-surface-border shadow-xs space-y-2 animate-in fade-in">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono font-bold text-accent text-xs">
                      {progress?.percentage ? Math.round(progress.percentage) : 0}%
                    </span>
                    <span className="font-semibold text-text-main truncate">
                      {progress?.phase || 'Compressing...'}
                    </span>
                  </div>
                  {onCancel && (
                    <button
                      type="button"
                      onClick={onCancel}
                      className="px-2 py-0.5 rounded text-[11px] font-medium text-text-muted hover:text-status-error hover:bg-status-error/10 transition-colors cursor-pointer flex items-center gap-1 shrink-0"
                    >
                      <X className="w-3 h-3" />
                      <span>Cancel</span>
                    </button>
                  )}
                </div>

                {/* Progress Bar Track */}
                <div className="h-2 w-full bg-surface-subtle rounded-full overflow-hidden relative shadow-inner">
                  <div
                    className="h-full bg-accent transition-all duration-300 ease-out rounded-full relative overflow-hidden"
                    style={{
                      width: `${Math.min(100, Math.max(0, progress?.percentage ? Math.round(progress.percentage) : 0))}%`,
                    }}
                  >
                    <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] font-mono text-text-faint">
                  <span className="truncate">
                    {progress?.message || (files.length > 1 ? `${files.length} files in queue` : files[0]?.name || '')}
                  </span>
                  {progress?.current !== undefined && progress?.total !== undefined && (
                    <span className="shrink-0 ml-1">
                      {progress.current}/{progress.total}
                    </span>
                  )}
                </div>
              </div>

              {/* Disabled Spinner Button */}
              <Button
                variant="primary"
                size="md"
                className="w-full h-11 text-xs font-semibold shadow-md"
                disabled={true}
                isLoading={true}
              >
                Compressing...
              </Button>
            </>
          )}
        </div>
      )}


      {/* In-App PDF Viewer Modal */}
      <PdfViewerModal
        isOpen={Boolean(viewingPdf)}
        onClose={() => setViewingPdf(null)}
        pdfBlob={viewingPdf?.blob ?? null}
        fileName={viewingPdf?.name ?? ''}
        isCompressed={viewingPdf?.isCompressed ?? false}
        onCompress={() => setViewingPdf(null)}
      />
    </div>
  );
};
