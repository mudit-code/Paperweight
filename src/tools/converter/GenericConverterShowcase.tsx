import React, { useRef, useState } from 'react';
import {
  FolderPlus,
  Trash2,
  X,
  FileText,
  FileImage,
  FileSpreadsheet,
  Presentation,
  Loader2,
  Play,
  Check,
} from 'lucide-react';
import type { ProcessedFile } from '../../core/types';
import type { BatchResult } from '../../core/processors/types';
import { validateFile, formatBytes, readFileAsArrayBuffer } from '../../core/files/validation';
import { toUserFacingError, type UserFacingError } from '../../core/errors';
import { isMobileApp } from '../../core/processors/download';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { ClearWarningBanner } from '../../components/ui/ClearWarningBanner';
import type { GalleryItem } from '../../components/ui/ImageGalleryModal';

export interface GenericConverterShowcaseProps {
  mode: 'img-to-pdf' | 'img-to-img' | 'word-to-pdf' | 'excel-to-pdf' | 'ppt-to-pdf';
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

export const GenericConverterShowcase: React.FC<GenericConverterShowcaseProps> = ({
  mode,
  files,
  onFilesChange,
  options,
  isProcessing,
  result,
  onDismissResult,
  onExecute,
  onViewFile: _onViewFile,
  onViewImages,
  className = '',
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = isMobileApp();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Configuration per mode
  let acceptedMimes: string[] = [];
  let fileTypeLabel = 'Files';
  let targetBadge = 'PDF';
  let IconComponent = FileText;

  if (mode === 'img-to-pdf') {
    acceptedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/*'];
    fileTypeLabel = 'Images';
    targetBadge = 'PDF';
    IconComponent = FileImage;
  } else if (mode === 'img-to-img') {
    acceptedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/bmp', 'image/tiff', 'image/*'];
    fileTypeLabel = 'Images';
    const targetFormat = ((options.targetFormat as string) || (options.format as string) || 'png').toUpperCase();
    targetBadge = targetFormat;
    IconComponent = FileImage;
  } else if (mode === 'word-to-pdf') {
    acceptedMimes = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      '.docx',
      '.doc',
    ];
    fileTypeLabel = 'Word Documents';
    targetBadge = 'PDF';
    IconComponent = FileText;
  } else if (mode === 'excel-to-pdf') {
    acceptedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      '.xlsx',
      '.xls',
    ];
    fileTypeLabel = 'Spreadsheets';
    targetBadge = 'PDF';
    IconComponent = FileSpreadsheet;
  } else if (mode === 'ppt-to-pdf') {
    acceptedMimes = [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-powerpoint',
      '.pptx',
      '.ppt',
    ];
    fileTypeLabel = 'Presentations';
    targetBadge = 'PDF';
    IconComponent = Presentation;
  }

  const getSelectLabel = () => {
    if (mode === 'img-to-pdf' || mode === 'img-to-img') return 'Select Images';
    if (mode === 'word-to-pdf') return 'Select Word Doc';
    if (mode === 'excel-to-pdf') return 'Select Spreadsheet';
    if (mode === 'ppt-to-pdf') return 'Select Presentation';
    return 'Select Files';
  };

  const handleProcessIncomingFiles = async (rawFiles: FileList | File[]) => {
    if (!rawFiles || rawFiles.length === 0) return;
    setIsImporting(true);
    setError(null);

    try {
      const incomingList = Array.from(rawFiles);
      const processedBatch: ProcessedFile[] = [];

      for (const f of incomingList) {
        await validateFile(f, {
          acceptedMimes,
          maxFileSize: 250 * 1024 * 1024,
        });

        const buffer = await readFileAsArrayBuffer(f);
        let previewUrl: string | undefined = undefined;
        if (f.type.startsWith('image/')) {
          previewUrl = URL.createObjectURL(new Blob([buffer], { type: f.type }));
        }

        processedBatch.push({
          id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: f.name,
          size: f.size,
          type: f.type,
          lastModified: f.lastModified,
          data: buffer,
          blob: f,
          previewUrl,
        });
      }

      if (onDismissResult) onDismissResult();
      onFilesChange([...files, ...processedBatch]);
    } catch (err) {
      setError(toUserFacingError(err));
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
      await handleProcessIncomingFiles(e.dataTransfer.files);
    }
  };

  const handleRequestClear = () => {
    setShowClearConfirm(true);
  };

  const handleConfirmClear = () => {
    if (onDismissResult) onDismissResult();
    files.forEach((f) => {
      if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    });
    onFilesChange([]);
    setShowClearConfirm(false);
  };

  const handleRemoveSingle = (index: number) => {
    const target = files[index];
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    onFilesChange(files.filter((_, i) => i !== index));
  };

  const totalInputSize = files.reduce((acc, f) => acc + f.size, 0);

  return (
    <div className={`flex flex-col select-none ${isMobile ? 'flex-1 min-h-0 h-full space-y-2' : 'space-y-4'} ${className}`}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={acceptedMimes.join(',')}
        onChange={(e) => {
          if (e.target.files) handleProcessIncomingFiles(e.target.files);
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

      {/* Error alert */}
      {error && (
        <div className="flex items-center justify-between p-3.5 rounded-xl bg-status-error-bg border border-status-error-border text-status-error text-xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <X className="w-4 h-4 shrink-0" />
            <span>{error.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="p-1 hover:bg-status-error/10 rounded cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* EMPTY STATE: Standardized across all Converter and App screens */}
      {files.length === 0 && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`w-full rounded-sheet border transition-colors duration-150 flex flex-col justify-between text-center overflow-hidden relative shadow-2xs ${
            isMobile ? 'flex-1 min-h-0' : 'flex-1 min-h-[340px]'
          } ${
            isDragOver
              ? 'border-accent bg-surface-hover shadow-lifted'
              : 'border-surface-border bg-surface-panel'
          }`}
        >
          {/* Centered Content */}
          <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-5 my-auto">
            {isImporting ? (
              <div className="flex flex-col items-center justify-center space-y-2.5 animate-in fade-in duration-150">
                <Loader2 className="w-8 h-8 text-accent animate-spin" />
                <p className="text-sm font-semibold text-text-main">Reading files...</p>
                <p className="text-xs text-text-muted">Loading and validating on this device</p>
              </div>
            ) : (
              <div className="space-y-2">
                <h3 className="text-base sm:text-lg font-bold text-text-main">
                  {mode === 'img-to-pdf'
                    ? 'Drop photos here'
                    : mode === 'img-to-img'
                    ? 'Drop images here'
                    : 'Drop documents here'}
                </h3>
                <p className="text-xs sm:text-sm text-text-muted">
                  or choose them from your device.
                </p>
                <div className="pt-2">
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    disabled={isProcessing}
                    onClick={() => fileInputRef.current?.click()}
                    leftIcon={<FolderPlus className="w-4 h-4" />}
                    className="font-semibold px-6 shadow-xs"
                  >
                    {getSelectLabel()}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Pinned Bottom Bar: ALWAYS visible to prevent UI jump */}
          <div className="shrink-0 border-t border-surface-border flex items-center justify-between gap-2 text-xs px-3 sm:px-5 py-2.5 bg-surface-panel">
            <span className="font-mono text-text-muted text-xs">0 files</span>
            <button
              type="button"
              disabled
              className="h-8 px-2.5 rounded-control inline-flex items-center justify-center gap-1.5 text-xs font-mono text-text-disabled cursor-not-allowed opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" />
              <span>Clear</span>
            </button>
          </div>
        </div>
      )}

      {/* FILES SHOWCASE - Standardized to match Merger Dropbox */}
      {files.length > 0 && (
        <div className={`w-full rounded-sheet border border-surface-border bg-surface-panel p-3.5 sm:p-5 flex flex-col justify-between overflow-hidden relative shadow-2xs ${isMobile ? 'flex-1 min-h-0' : 'flex-1 min-h-[340px]'}`}>
          {/* Files Grid */}
          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3 items-start">
              {files.map((file, idx) => {
                const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp|avif|bmp|gif)$/i.test(file.name);
                return (
                  <div
                    key={file.id || idx}
                    className="paper-sheet p-2.5 sm:p-3 flex flex-col justify-between space-y-2 transition-colors group relative select-none"
                  >
                    {/* Header: Name + Remove */}
                    <div className="flex items-center justify-between gap-1 pb-1.5 border-b border-surface-border-subtle pr-1 text-xs">
                      <span className="font-mono font-medium text-text-main truncate max-w-[85px] sm:max-w-[140px]" title={file.name}>
                        {file.name}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveSingle(idx);
                        }}
                        className="min-w-[32px] min-h-[32px] sm:min-w-[36px] sm:min-h-[36px] -m-1 inline-flex items-center justify-center rounded-control text-text-muted hover:text-status-error hover:bg-status-error-bg transition-colors shrink-0 cursor-pointer"
                        title="Remove file"
                        aria-label={`Remove ${file.name}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Preview Area: consistent h-28 sm:h-36 */}
                    <div
                      onClick={() => {
                        // Only after conversion has completed, click opens the converted images in ImageGalleryModal
                        if (result && result.items && result.items.length > 0) {
                          const galleryItems: GalleryItem[] = result.items.map((it, i) => ({
                            id: it.id || `conv_img_${i}`,
                            name: it.name,
                            blob: it.blob,
                            size: it.blob?.size,
                            type: it.blob?.type || 'image/png',
                            url: URL.createObjectURL(it.blob),
                          }));
                          if (onViewImages) {
                            onViewImages(galleryItems, Math.max(0, Math.min(idx, galleryItems.length - 1)));
                            return;
                          }
                        }
                      }}
                      className={`w-full h-28 sm:h-36 rounded-none bg-surface-subtle border border-surface-border-subtle flex items-center justify-center overflow-hidden relative ${
                        result && result.items ? 'cursor-pointer hover:border-accent hover:ring-1 hover:ring-accent transition-all' : ''
                      } p-1`}
                      title={result && result.items ? 'Click to view converted image' : undefined}
                    >
                      {isImage && file.previewUrl ? (
                        <img
                          src={file.previewUrl}
                          alt={file.name}
                          className="max-h-full max-w-full object-contain rounded-none pointer-events-none"
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center gap-1.5 text-text-muted">
                          <IconComponent className="w-7 h-7 text-text-muted" />
                          <Badge size="sm" variant="neutral">
                            {file.name.split('.').pop()?.toUpperCase() || 'FILE'}
                          </Badge>
                        </div>
                      )}

                      {/* Format Badge overlay on preview */}
                      <div className="absolute top-1.5 right-1.5">
                        <span className="px-1.5 py-0.5 rounded-chip text-xs font-mono font-medium bg-surface-panel text-text-main border border-surface-border shadow-xs">
                          {isImage ? 'IMG' : 'DOC'}
                        </span>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="mt-auto pt-1.5 flex items-center justify-between text-xs text-text-muted border-t border-surface-border-subtle">
                      <span className="font-mono text-[11px]">{formatBytes(file.size)}</span>
                      <span className="font-mono font-medium text-[11px] text-accent">
                        &rarr; {targetBadge}
                      </span>
                    </div>
                  </div>
                );
              })}

              {isImporting && (
                <div className="paper-sheet p-3 flex flex-col items-center justify-center h-28 sm:h-32 border-dashed border-accent/60 bg-surface-subtle/60 animate-pulse">
                  <Loader2 className="w-5 h-5 text-accent animate-spin mb-1.5" />
                  <span className="text-xs font-semibold text-text-main">Reading file...</span>
                  <span className="text-[11px] text-text-muted">Loading data</span>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Summary Bar: Queue summary + Add files + Clear + Full-width Action button */}
          <div className="shrink-0 pt-2 border-t border-surface-border flex flex-col gap-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-text-muted truncate">
                {files.length} {files.length === 1 ? fileTypeLabel.slice(0, -1) : fileTypeLabel} queued ({formatBytes(totalInputSize)})
              </span>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessing}
                  className="h-8 px-2.5 rounded-control inline-flex items-center justify-center gap-1 text-xs font-semibold text-text-main bg-surface-subtle hover:bg-surface-hover border border-surface-border transition-colors cursor-pointer disabled:opacity-50"
                >
                  <FolderPlus className="w-3.5 h-3.5 shrink-0" />
                  <span>Add files</span>
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
                disabled={isProcessing || files.length === 0 || Boolean(result)}
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
                {isProcessing ? 'Converting...' : result ? 'Converted' : `Convert to ${targetBadge}`}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

