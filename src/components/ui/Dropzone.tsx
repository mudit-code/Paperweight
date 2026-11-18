import React, { useRef, useState, useCallback, useEffect } from 'react';
import { FolderPlus, FileIcon, X, AlertCircle, ArrowUp, ArrowDown, Loader2 } from 'lucide-react';
import type { ProcessedFile } from '../../core/types';
import { validateFile, validateBatchLimits, formatBytes, readFileAsArrayBuffer } from '../../core/files/validation';
import { toUserFacingError, type UserFacingError } from '../../core/errors';
import { isMobileApp } from '../../core/processors/download';
import { Button } from './Button';
import { ClearWarningBanner } from './ClearWarningBanner';
import { Badge } from './Badge';
import * as pdfjsLib from 'pdfjs-dist';

import type { SizeEstimate } from '../../core/processors/estimate-size';

export interface DropzoneProps {
  files: ProcessedFile[];
  onFilesChange: (files: ProcessedFile[]) => void;
  acceptedMimes?: string[];
  maxFiles?: number;
  disabled?: boolean;
  sizeEstimate?: SizeEstimate | null;
  className?: string;
  onViewFile?: (file: ProcessedFile) => void;
}

export const Dropzone: React.FC<DropzoneProps> = ({
  files,
  onFilesChange,
  acceptedMimes = [],
  maxFiles = 250,
  disabled = false,
  sizeEstimate: _sizeEstimate,
  className = '',
  onViewFile,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [pdfPreviews, setPdfPreviews] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const isMobile = isMobileApp();

  useEffect(() => {
    return () => {
      Object.values(pdfPreviews).forEach((url) => {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      });
    };
  }, [pdfPreviews]);

  const processIncomingFiles = useCallback(
    async (rawFiles: FileList | File[]) => {
      setError(null);
      const fileArray = Array.from(rawFiles);
      if (fileArray.length === 0) return;

      setIsImporting(true);

      try {
        // Enforce batch limits
        validateBatchLimits(fileArray, { maxBatchCount: maxFiles });

        // Fast parallel buffer read (<30ms for entire batch)
        const processed: ProcessedFile[] = await Promise.all(
          fileArray.map(async (file) => {
            await validateFile(file, { acceptedMimes });
            const buffer = await readFileAsArrayBuffer(file);

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

        // Immediately update UI so cards appear with zero delay
        onFilesChange([...files, ...processed]);
        setIsImporting(false);

        // Asynchronously render PDF thumbnails in the background
        const pdfFiles = processed.filter(
          (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
        );

        if (pdfFiles.length > 0) {
          pdfFiles.forEach(async (pdfFile) => {
            try {
              let fileBytes: Uint8Array;
              const isDetached = (pdfFile.data as { detached?: boolean }).detached || pdfFile.data.byteLength === 0;
              if (isDetached && pdfFile.blob) {
                const fresh = await pdfFile.blob.arrayBuffer();
                pdfFile.data = fresh;
                fileBytes = new Uint8Array(fresh.slice(0));
              } else {
                fileBytes = new Uint8Array(pdfFile.data.slice(0));
              }
              const loadingTask = pdfjsLib.getDocument({
                data: fileBytes,
              });
              const pdf = await loadingTask.promise;
              const page = await pdf.getPage(1);
              const viewport = page.getViewport({ scale: 0.35 });
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
                  canvas.toBlob(res, 'image/jpeg', 0.8)
                );
                if (thumbBlob) {
                  const thumbUrl = URL.createObjectURL(thumbBlob);
                  pdfFile.previewUrl = thumbUrl;
                  setPdfPreviews((prev) => ({ ...prev, [pdfFile.id]: thumbUrl }));
                }
              }
            } catch {
              // Ignore PDF preview error
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
    if (!disabled) {
      setIsDragOver(true);
    }
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
    if (!disabled && e.dataTransfer.files) {
      processIncomingFiles(e.dataTransfer.files);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processIncomingFiles(e.target.files);
      // Reset input value so re-selecting same file triggers change
      e.target.value = '';
    }
  };

  const removeFile = (id: string) => {
    const target = files.find((f) => f.id === id);
    if (target?.previewUrl) {
      URL.revokeObjectURL(target.previewUrl);
    }
    onFilesChange(files.filter((f) => f.id !== id));
  };

  const moveFile = (index: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= files.length) return;
    const reordered = [...files];
    const temp = reordered[index];
    reordered[index] = reordered[targetIdx];
    reordered[targetIdx] = temp;
    onFilesChange(reordered);
  };

  const handleRequestClearAll = () => {
    setShowClearConfirm(true);
  };

  const handleConfirmClearAll = () => {
    for (const f of files) {
      if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    }
    onFilesChange([]);
    setError(null);
    setShowClearConfirm(false);
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Clear Warning Banner */}
      <ClearWarningBanner
        isOpen={showClearConfirm}
        itemCount={files.length}
        onConfirm={handleConfirmClearAll}
        onCancel={() => setShowClearConfirm(false)}
      />

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 p-3.5 rounded-control bg-status-error-bg border border-status-error-border text-status-error"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-semibold">{error.title}</p>
              <p className="text-text-main">{error.message}</p>
              {error.suggestion && (
                <p className="text-text-muted">{error.suggestion}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="min-w-[44px] min-h-[44px] -mr-2 -my-2 flex items-center justify-center rounded-control text-status-error hover:bg-surface-subtle transition-colors duration-fast ease-out cursor-pointer"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Desk File Zone (solid 1px hairline, no dashed box, no icon-in-circle) */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        tabIndex={disabled ? -1 : 0}
        role="button"
        aria-label={isMobile ? 'Choose files' : 'Choose files or drop them here'}
        className={`relative flex flex-col items-center justify-center p-8 sm:p-12 text-center rounded-sheet border transition-colors duration-fast ease-out cursor-pointer ${
          isDragOver
            ? 'border-surface-border-focus bg-surface-panel-raised shadow-lifted'
            : 'border-surface-border bg-surface-panel hover:border-surface-border-focus'
        } ${disabled ? 'bg-surface-disabled border-surface-border pointer-events-none' : ''}`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={acceptedMimes.join(',')}
          onChange={handleInputChange}
          className="sr-only"
          tabIndex={-1}
        />

        {isImporting ? (
          <div className="flex flex-col items-center justify-center space-y-2 py-4">
            <Loader2 className="w-6 h-6 text-text-main animate-spin" />
            <p className="text-sm font-semibold text-text-main">Reading files...</p>
            <p className="text-xs text-text-muted">Loading documents into local memory</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 max-w-md">
            <p className="text-md font-medium text-text-main">
              {isMobile
                ? 'Choose files from your device.'
                : 'Choose files or drop them on this desk.'}
            </p>
            <Button
              type="button"
              variant="primary"
              size="md"
              disabled={disabled}
              leftIcon={<FolderPlus className="w-4 h-4" />}
              onClick={(e) => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
            >
              Choose files
            </Button>
            <p className="text-xs text-text-muted font-mono">
              {acceptedMimes.length > 0
                ? acceptedMimes.some((m) => m.includes('word') || m.includes('doc')) &&
                  acceptedMimes.some((m) => m.includes('pdf')) &&
                  acceptedMimes.some((m) => m.startsWith('image'))
                  ? 'JPG · PNG · WEBP · PDF · DOCX'
                  : acceptedMimes.map((m) => m.replace('*', 'all')).slice(0, 6).join(' · ')
                : 'Any document or image'}{' '}
              · Up to {maxFiles} files
            </p>
          </div>
        )}
      </div>

      {/* Queued Paper Sheets */}
      {files.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-text-muted font-mono px-1">
            <span>
              {files.length} {files.length === 1 ? 'file' : 'files'} ·{' '}
              {formatBytes(files.reduce((acc, f) => acc + f.size, 0))}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleRequestClearAll}
              className="text-status-error hover:text-status-error"
            >
              Clear all
            </Button>
          </div>

          <div
            role="list"
            aria-label="Loaded files list"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[380px] overflow-y-auto pr-1"
          >
            {files.map((file, idx) => {
              const thumbUrl = pdfPreviews[file.id] || file.previewUrl;
              const extBadge =
                /\.docx$/i.test(file.name) || file.type.includes('word')
                  ? 'DOCX'
                  : /\.pdf$/i.test(file.name) || file.type === 'application/pdf'
                  ? 'PDF'
                  : file.type.split('/')[1]?.toUpperCase() ||
                    file.name.split('.').pop()?.toUpperCase() ||
                    'FILE';

              return (
                <div
                  key={file.id}
                  role="listitem"
                  className="paper-sheet flex items-center gap-3 p-3 hover:border-surface-border-focus"
                >
                  <div
                    onClick={(e) => {
                      if (onViewFile) {
                        e.stopPropagation();
                        onViewFile(file);
                      }
                    }}
                    className={`w-12 h-12 rounded-control bg-surface-subtle flex items-center justify-center overflow-hidden shrink-0 border border-surface-border ${
                      onViewFile ? 'cursor-pointer hover:border-accent hover:ring-1 hover:ring-accent transition-all' : ''
                    }`}
                    title={onViewFile ? 'Click to preview' : undefined}
                  >
                    {thumbUrl ? (
                      <img
                        src={thumbUrl}
                        alt={file.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <FileIcon className="w-5 h-5 text-text-muted" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-mono font-semibold text-text-main truncate" title={file.name}>
                      {file.name}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className="text-xs font-mono text-text-muted">
                        {formatBytes(file.size)}
                      </span>
                      <Badge size="sm" variant="neutral">
                        {extBadge}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        moveFile(idx, 'up');
                      }}
                      disabled={idx === 0}
                      className="min-w-[36px] min-h-[44px] flex items-center justify-center rounded-control text-text-muted hover:text-text-main hover:bg-surface-subtle disabled:text-text-disabled disabled:pointer-events-none transition-colors duration-fast ease-out cursor-pointer"
                      aria-label={`Move ${file.name} up`}
                      title="Move up"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        moveFile(idx, 'down');
                      }}
                      disabled={idx === files.length - 1}
                      className="min-w-[36px] min-h-[44px] flex items-center justify-center rounded-control text-text-muted hover:text-text-main hover:bg-surface-subtle disabled:text-text-disabled disabled:pointer-events-none transition-colors duration-fast ease-out cursor-pointer"
                      aria-label={`Move ${file.name} down`}
                      title="Move down"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(file.id);
                      }}
                      className="min-w-[36px] min-h-[44px] flex items-center justify-center rounded-control text-text-muted hover:text-status-error hover:bg-surface-subtle transition-colors duration-fast ease-out cursor-pointer"
                      aria-label={`Remove ${file.name}`}
                      title="Remove file"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
