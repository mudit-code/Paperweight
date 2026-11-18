import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  FolderPlus,
  Trash2,
  Save,
  Share2,
  Eye,
  X,
  FileText,
  FileCode,
  FileImage,
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
import { ImageGalleryModal, type GalleryItem } from '../../components/ui/ImageGalleryModal';

export interface CompressorShowcaseProps {
  files: ProcessedFile[];
  onFilesChange: (files: ProcessedFile[]) => void;
  options: Record<string, unknown>;
  onOptionsChange?: (options: Record<string, unknown>) => void;
  isProcessing: boolean;
  progress?: ProgressReport | null;
  onCancel?: () => void;
  result?: BatchResult | null;
  onDismissResult?: () => void;
  sizeEstimate?: SizeEstimate | null;
  onExecuteBatch?: () => void;
  acceptedMimes?: string[];
  maxFiles?: number;
  activeMode?: 'pdf' | 'image' | 'doc';
  className?: string;
  onViewImages?: (images: GalleryItem[], initialIndex?: number) => void;
  onViewFile?: (file: ProcessedFile) => void;
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
  onDismissResult,
  sizeEstimate: _sizeEstimate,
  onExecuteBatch,
  acceptedMimes = [],
  maxFiles = 250,
  activeMode = 'pdf',
  className = '',
  onViewImages,
  onViewFile,
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

  // In-App Gallery Viewer state
  const [isGalleryOpen, setIsGalleryOpen] = useState<boolean>(false);
  const [galleryInitialIndex, setGalleryInitialIndex] = useState<number>(0);

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

  // Reset local compression results when global result is dismissed
  useEffect(() => {
    if (!result && singleResults.size > 0) {
      setSingleResults(new Map());
      setHasCompressedBatch(false);
    }
  }, [result, singleResults.size]);

  // Current compression level
  const currentLevel = typeof options.compressionLevel === 'number' ? options.compressionLevel : 40;

  const handleLevelChange = (lvl: number) => {
    setHasCompressedBatch(false);
    setSingleResults(new Map());
    if (onDismissResult) onDismissResult();
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
    setSingleResults(new Map());
    if (onDismissResult) onDismissResult();
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
              blob: file,
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
      if (onViewFile) {
        activeItem.blob.arrayBuffer().then((buf) => {
          onViewFile({
            id: file.id,
            name: activeItem.name,
            data: buf,
            blob: activeItem.blob,
            size: activeItem.blob.size,
            type: 'application/pdf',
            lastModified: Date.now(),
          });
        });
      } else {
        setViewingPdf({
          blob: activeItem.blob,
          name: activeItem.name,
          isCompressed: true,
        });
      }
    } else {
      if (onViewFile) {
        onViewFile(file);
      } else {
        const blob = new Blob([file.data], { type: 'application/pdf' });
        setViewingPdf({
          blob,
          name: file.name,
          isCompressed: false,
        });
      }
    }
  };

  const imageFiles = files.filter(
    (f) =>
      f.type.startsWith('image/') ||
      /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name)
  );

  const galleryItems: GalleryItem[] = imageFiles.map((f) => {
    const batchItem = result?.items?.find(
      (it) => it.id === f.id || it.name.startsWith(f.name.replace(/\.[^.]+$/, ''))
    );
    const singleItem = singleResults.get(f.id);
    const activeItem = batchItem || singleItem;

    let blob: Blob;
    try {
      blob = activeItem?.blob || new Blob([f.data], { type: f.type || 'image/jpeg' });
    } catch {
      blob = new Blob([], { type: 'image/jpeg' });
    }

    return {
      id: f.id,
      name: activeItem?.name || f.name,
      url: activeItem?.blob ? URL.createObjectURL(activeItem.blob) : (f.previewUrl || (typeof window !== 'undefined' ? URL.createObjectURL(blob) : '')),
      blob,
      size: activeItem?.compressedSize || f.size,
      type: f.type,
    };
  });

  const handleImageClick = (file: ProcessedFile) => {
    const idx = imageFiles.findIndex((f) => f.id === file.id);
    const validIdx = idx >= 0 ? idx : 0;
    if (onViewImages) {
      onViewImages(galleryItems, validIdx);
    } else {
      setGalleryInitialIndex(validIdx);
      setIsGalleryOpen(true);
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

  const getSelectLabel = () => {
    if (activeMode === 'pdf') return 'Select PDF';
    if (activeMode === 'image') return 'Select Image';
    if (activeMode === 'doc') return 'Select Document';
    return 'Select Files';
  };

  const totalOriginalBytes = files.reduce((acc, f) => acc + f.size, 0);

  return (
    <div className={`flex flex-col ${isMobile ? 'h-full min-h-0 space-y-2.5' : 'space-y-4 flex-1 min-h-0'} ${className}`}>
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

      {/* Main Showcase Box */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`w-full rounded-sheet border transition-colors duration-150 flex flex-col justify-between ${
          isMobile
            ? 'flex-1 min-h-0 p-3 pb-0 overflow-hidden'
            : 'flex-1 min-h-[340px] p-4 sm:p-6'
        } ${
          isDragOver
            ? 'border-accent bg-surface-hover shadow-lifted'
            : 'border-surface-border bg-surface-panel'
        }`}
      >
        {/* Showcase Files Workspace */}
        {isImporting && files.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 my-auto space-y-2.5 animate-in fade-in duration-150">
            <Loader2 className="w-8 h-8 text-accent animate-spin" />
            <p className="text-sm font-semibold text-text-main">Reading files...</p>
            <p className="text-xs text-text-muted">Loading and validating on this device</p>
          </div>
        ) : files.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-4 my-auto text-center gap-2 pb-4">
            <h3 className="text-base sm:text-lg font-bold text-text-main">
              {activeMode === 'pdf' ? 'Drop PDFs here' : activeMode === 'image' ? 'Drop images here' : 'Drop documents here'}
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
                {getSelectLabel()}
              </Button>
            </div>
          </div>
        ) : (
          <div className={`w-full flex-1 min-h-0 ${isMobile ? 'overflow-y-auto px-0.5 pt-1 pb-2' : 'max-h-[280px] sm:max-h-[340px] lg:max-h-none overflow-y-auto px-0.5 pt-1 pb-3'} no-scrollbar`}>
            <div className={`grid ${isMobile ? 'grid-cols-[repeat(auto-fill,minmax(145px,1fr))] gap-2.5' : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4'} items-start`}>
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
                const isImage =
                  file.type.startsWith('image/') ||
                  /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name);

                const previewUrl = file.previewUrl || previewMap.get(file.id);
                const isRenderingPreview = isPdf && !previewUrl && pendingThumbnails.has(file.id);

                return (
                  <div
                    key={file.id}
                    style={{
                      contentVisibility: 'auto',
                      containIntrinsicSize: '240px 240px',
                    }}
                    className={`paper-sheet ${
                      isMobile ? 'p-2.5 space-y-2' : 'p-3.5 space-y-3'
                    } flex flex-col justify-between transition-colors group relative`}
                  >
                    {/* Top Row: Filename, Original Size, and Remove Button */}
                    <div className="flex items-center justify-between gap-1 text-xs pr-2">
                      <span
                        className="font-mono font-medium text-text-main truncate flex-1 min-w-0"
                        title={file.name}
                      >
                        {file.name}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget({ isOpen: true, id: file.id, name: file.name, isAll: false });
                        }}
                        className="min-w-[44px] min-h-[44px] -m-1.5 inline-flex items-center justify-center rounded-control text-text-muted hover:text-status-error hover:bg-status-error-bg transition-colors shrink-0 cursor-pointer"
                        title="Remove file"
                        aria-label={`Remove ${file.name}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Middle: Document / Image Preview Thumbnail */}
                    <div
                      onClick={() => {
                        if (isPdf) {
                          handlePreviewClick(file);
                        } else if (isImage) {
                          handleImageClick(file);
                        }
                      }}
                      className={`w-full h-32 sm:h-36 mx-auto rounded-none bg-surface-subtle border border-surface-border-subtle flex items-center justify-center overflow-hidden relative group/thumb ${
                        isPdf || isImage ? 'cursor-pointer hover:border-surface-border-strong' : ''
                      } transition-colors`}
                      title={isPdf ? 'Tap to view PDF' : isImage ? 'Tap to view image in gallery' : undefined}
                    >
                      {previewUrl ? (
                        <img
                          src={previewUrl}
                          alt={file.name}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-contain p-1 rounded-none"
                        />
                      ) : isRenderingPreview ? (
                        <div className="flex flex-col items-center justify-center gap-1.5 text-text-muted p-2 text-center">
                          <Loader2 className="w-5 h-5 text-accent animate-spin" />
                          <span className="text-xs font-mono">Rendering...</span>
                        </div>
                      ) : isPdf ? (
                        <div className="flex flex-col items-center gap-1.5 text-text-muted">
                          <FileText className="w-7 h-7 text-text-muted" />
                          <Badge size="sm" variant="neutral">
                            PDF
                          </Badge>
                        </div>
                      ) : isDoc ? (
                        <div className="flex flex-col items-center gap-1.5 text-text-muted">
                          <FileCode className="w-7 h-7 text-text-muted" />
                          <Badge size="sm" variant="neutral">
                            DOCX
                          </Badge>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1.5 text-text-muted">
                          <FileImage className="w-7 h-7 text-text-muted" />
                          <Badge size="sm" variant="neutral">
                            IMAGE
                          </Badge>
                        </div>
                      )}

                      {/* PDF / Image Tap-to-View Badge Overlay */}
                      {(isPdf || isImage) && (
                        <div className="absolute inset-0 bg-black/5 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center transition-opacity pointer-events-none">
                          <span className="px-2 py-1 rounded-chip bg-surface-panel border border-surface-border text-text-main shadow-lifted text-xs font-medium flex items-center gap-1">
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
                            <span className="text-text-muted">New</span>
                            <div className="flex items-center gap-1">
                              <span className="font-semibold text-status-success">
                                {formatBytes(activeItem.compressedSize)}
                              </span>
                              {activeItem.savingsPercent > 0 && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-chip text-xs font-medium bg-status-success-bg text-status-success border border-status-success-border">
                                  -{activeItem.savingsPercent}%
                                </span>
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="text-text-muted">Size</span>
                            <span className="text-text-main font-medium">
                              {formatBytes(file.size)}
                            </span>
                          </>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                        <button
                          type="button"
                          disabled={isProcessing || isSingleCompressing || !activeItem}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleShareSingle(file);
                          }}
                          title={activeItem ? 'Share file' : 'Compress file to share'}
                          aria-label={`Share ${file.name}`}
                          className="min-h-[44px] rounded-control border border-surface-border bg-surface-subtle hover:bg-surface-hover text-text-main flex items-center justify-center transition-colors disabled:bg-surface-disabled disabled:text-text-disabled disabled:cursor-not-allowed cursor-pointer"
                        >
                          {isSingleCompressing && singleActionType === 'share' ? (
                            <Loader2 className="w-4 h-4 text-accent animate-spin" />
                          ) : (
                            <Share2 className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={isProcessing || isSingleCompressing || !activeItem}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownloadSingle(file);
                          }}
                          title={activeItem ? 'Save file' : 'Compress file to save'}
                          aria-label={`Save ${file.name}`}
                          className={`min-h-[44px] rounded-control flex items-center justify-center transition-colors cursor-pointer ${
                            activeItem
                              ? 'bg-accent hover:bg-accent-hover text-accent-contrast'
                              : 'bg-surface-disabled text-text-disabled cursor-not-allowed border border-surface-border'
                          } disabled:bg-surface-disabled disabled:text-text-disabled disabled:cursor-not-allowed`}
                        >
                          {isSingleCompressing && singleActionType === 'save' ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Save className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {isImporting && (
                <div className="paper-sheet p-3 flex flex-col items-center justify-center h-32 sm:h-36 border-dashed border-accent/60 bg-surface-subtle/60 animate-pulse">
                  <Loader2 className="w-5 h-5 text-accent animate-spin mb-1.5" />
                  <span className="text-xs font-semibold text-text-main">Reading file...</span>
                  <span className="text-[11px] text-text-muted">Loading data</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pinned Bottom Bar: ALWAYS visible on desktop to prevent any UI jump */}
        <div className="relative z-20 shrink-0 pt-2 sm:pt-2.5 mt-auto border-t border-surface-border bg-surface-panel flex items-center justify-between -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 px-4 sm:px-6 py-2.5 rounded-b-sheet">
          {files.length === 0 ? (
            <>
              <span className="text-xs font-mono text-text-muted">0 files</span>
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
              {/* Left: Choose More Files & Summary */}
              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  disabled={isProcessing || isImporting}
                  onClick={openFilePicker}
                  className="h-8 px-3 rounded-control inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-text-main bg-surface-subtle hover:bg-surface-hover border border-surface-border transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isImporting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-accent shrink-0" />
                  ) : (
                    <FolderPlus className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span>Add files</span>
                </button>

                {isProcessing ? (
                  <div className="flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin text-accent shrink-0" />
                    <span className="text-xs font-mono text-accent font-semibold truncate max-w-[200px] sm:max-w-md">
                      {progress?.percentage ? `${Math.round(progress.percentage)}% ` : ''}
                      {progress?.message || progress?.phase || 'Compressing...'}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs font-mono text-text-muted">
                    {files.length} {files.length === 1 ? 'file' : 'files'} · {formatBytes(totalOriginalBytes)}
                    {result && result.size && (
                      <span className="text-status-success font-semibold ml-1">
                        → {formatBytes(result.size)}
                      </span>
                    )}
                  </span>
                )}
              </div>

              {/* Right: Trash Clear / Cancel and Mobile-only Save */}
              <div className="flex items-center gap-2 shrink-0">
                {isProcessing && onCancel ? (
                  <button
                    type="button"
                    onClick={onCancel}
                    className="h-8 px-2.5 rounded-control inline-flex items-center justify-center gap-1 text-xs font-semibold text-text-muted hover:text-status-error hover:bg-status-error-bg border border-surface-border transition-colors cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5 shrink-0" />
                    <span>Cancel</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleRequestClearAll}
                    disabled={isProcessing}
                    className="h-8 px-2.5 rounded-control inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-status-error hover:bg-status-error-bg border border-transparent hover:border-status-error-border transition-colors cursor-pointer"
                    title="Remove all files"
                    aria-label="Remove all files"
                  >
                    <Trash2 className="w-3.5 h-3.5 shrink-0 text-status-error" />
                    <span>Clear</span>
                  </button>
                )}

                {isMobile && result && (
                  <button
                    type="button"
                    disabled={isSavingAll}
                    onClick={handleDownloadZip}
                    className="h-8 px-3 rounded-control inline-flex items-center justify-center gap-1.5 text-xs font-semibold bg-accent text-accent-contrast border border-accent shadow-xs"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Mobile Integrated Controls Area (Enlarged dropbox directly above; fixed height so elements never jump or float) */}
      {isMobile && (
        <div className="shrink-0 space-y-2 pt-0.5 select-none">
          {!isProcessing ? (
            <>
              {/* Compression Level Card */}
              <div className="p-3 rounded-sheet bg-surface-panel border border-surface-border space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-sm text-text-main">Compression Level</span>
                  <span className="font-mono font-semibold text-accent-contrast bg-accent px-2.5 py-0.5 rounded-chip">
                    {currentLevel}%
                  </span>
                </div>

                <input
                  type="range"
                  min={5}
                  max={95}
                  step={1}
                  value={currentLevel}
                  onChange={(e) => handleLevelChange(Number(e.target.value))}
                  disabled={isProcessing}
                  className="w-full accent-accent cursor-pointer min-h-[32px]"
                  aria-label="Compression level percentage"
                />

                {/* Preset Chips */}
                <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                  {[
                    { label: 'Light 15%', val: 15, preset: 'light' },
                    { label: 'Balanced 40%', val: 40, preset: 'balanced' },
                    { label: 'Max 75%', val: 75, preset: 'maximum' },
                  ].map((p) => {
                    const isSel = currentLevel === p.val;
                    return (
                      <button
                        key={p.val}
                        type="button"
                        onClick={() => handlePresetSelect(p.val, p.preset)}
                        className={`min-h-[44px] px-1.5 text-xs font-medium font-mono rounded-control border transition-colors cursor-pointer text-center ${
                          isSel
                            ? 'bg-accent text-accent-contrast border-accent font-semibold'
                            : 'bg-surface-subtle border-surface-border text-text-muted hover:text-text-main hover:bg-surface-hover'
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
                <div className="w-full min-h-[44px] rounded-control border border-status-success-border bg-status-success-bg text-status-success flex items-center justify-center gap-2 text-sm font-semibold select-none pointer-events-none">
                  <Check className="w-4 h-4 stroke-[2.5]" />
                  <span>Compressed</span>
                </div>
              ) : (
                <Button
                  variant="primary"
                  size="md"
                  className="w-full"
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
              <div className="p-3 rounded-sheet bg-surface-panel border border-surface-border space-y-2">
                <div className="flex items-center justify-between text-xs gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono font-semibold text-accent-contrast bg-accent px-2 py-0.5 rounded-chip shrink-0">
                      {progress?.percentage ? Math.round(progress.percentage) : 0}%
                    </span>
                    <span className="font-semibold text-sm text-text-main truncate">
                      {progress?.phase || 'Compressing...'}
                    </span>
                  </div>
                  {onCancel && (
                    <button
                      type="button"
                      onClick={onCancel}
                      className="min-h-[44px] px-3 rounded-control border border-surface-border text-xs font-medium text-text-muted hover:text-status-error hover:border-status-error-border transition-colors cursor-pointer flex items-center gap-1 shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Cancel</span>
                    </button>
                  )}
                </div>

                {/* Progress Bar Track */}
                <div className="h-2 w-full bg-surface-subtle rounded-chip overflow-hidden border border-surface-border-subtle">
                  <div
                    className="h-full bg-accent transition-[width] duration-150 ease-out rounded-chip"
                    style={{
                      width: `${Math.min(100, Math.max(0, progress?.percentage ? Math.round(progress.percentage) : 0))}%`,
                    }}
                  />
                </div>

                <div className="flex items-center justify-between text-xs font-mono text-text-muted">
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
                className="w-full"
                disabled={true}
                isLoading={true}
              >
                Compressing...
              </Button>
            </>
          )}
        </div>
      )}


      {/* In-App PDF Viewer Modal (Fallback if global onViewFile is not provided) */}
      {!onViewFile && (
        <PdfViewerModal
          isOpen={Boolean(viewingPdf)}
          onClose={() => setViewingPdf(null)}
          pdfBlob={viewingPdf?.blob ?? null}
          fileName={viewingPdf?.name ?? ''}
          isCompressed={viewingPdf?.isCompressed ?? false}
        />
      )}

      {/* In-App Image Gallery Modal (Fallback if global onViewImages not provided) */}
      {isGalleryOpen && galleryItems.length > 0 && (
        <ImageGalleryModal
          isOpen={isGalleryOpen}
          onClose={() => setIsGalleryOpen(false)}
          images={galleryItems}
          initialIndex={galleryInitialIndex}
          onCompressImage={(blob, name) => {
            setIsGalleryOpen(false);
            const newFile: ProcessedFile = {
              id: `img_${Date.now()}`,
              name,
              size: blob.size,
              type: blob.type || 'image/jpeg',
              lastModified: Date.now(),
              data: new ArrayBuffer(0),
              previewUrl: URL.createObjectURL(blob),
            };
            blob.arrayBuffer().then((buf) => {
              newFile.data = buf;
              onFilesChange([newFile]);
            });
          }}
          onResizeImage={(blob, name) => {
            setIsGalleryOpen(false);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(
                new CustomEvent('navigate-to-tool', {
                  detail: { toolId: 'resizer', blob, name },
                })
              );
            }
          }}
        />
      )}
    </div>
  );
};
