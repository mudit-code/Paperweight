import React, { useRef, useState, useCallback } from 'react';
import { Upload, FileIcon, X, AlertCircle, ArrowUp, ArrowDown, Loader2 } from 'lucide-react';
import type { ProcessedFile } from '../../core/types';
import { validateFile, validateBatchLimits, formatBytes } from '../../core/files/validation';
import { toUserFacingError, type UserFacingError } from '../../core/errors';
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
}

export const Dropzone: React.FC<DropzoneProps> = ({
  files,
  onFilesChange,
  acceptedMimes = [],
  maxFiles = 250,
  disabled = false,
  sizeEstimate: _sizeEstimate,
  className = '',
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
              const loadingTask = pdfjsLib.getDocument({
                data: new Uint8Array(pdfFile.data.slice(0)),
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
                  pdfFile.previewUrl = URL.createObjectURL(thumbBlob);
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
          className="flex items-start justify-between gap-3 p-3.5 rounded-lg bg-status-error-bg border border-status-error-border text-status-error animate-in fade-in"
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
            className="p-1 rounded-sm text-status-error hover:bg-status-error/10"
            aria-label="Dismiss error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Drag & Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        tabIndex={disabled ? -1 : 0}
        role="button"
        aria-label="Drop files here or press Enter to browse files"
        className={`relative flex flex-col items-center justify-center p-8 sm:p-12 text-center rounded-xl border-2 border-dashed transition-all duration-200 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent ${
          isDragOver
            ? 'border-accent bg-accent-subtle scale-[0.99]'
            : 'border-surface-border bg-surface-panel hover:border-surface-border-focus hover:bg-surface-subtle/50'
        } ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
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
          <div className="flex flex-col items-center justify-center space-y-2 py-4 animate-in fade-in">
            <Loader2 className="w-8 h-8 text-accent animate-spin" />
            <p className="text-sm font-semibold text-text-main">Reading files...</p>
            <p className="text-xs text-text-muted">Loading documents into local memory</p>
          </div>
        ) : (
          <>
            <div className="p-3.5 rounded-full bg-surface-subtle text-accent mb-3 group-hover:scale-105 transition-transform">
              <Upload className="w-6 h-6" />
            </div>

            <p className="text-sm font-medium text-text-main mb-1">
              <span className="text-accent underline underline-offset-2">Select files</span> or drag and drop here
            </p>

            <p className="text-xs text-text-muted max-w-sm">
              {acceptedMimes.length > 0
                ? acceptedMimes.some((m) => m.includes('word') || m.includes('doc')) &&
                  acceptedMimes.some((m) => m.includes('pdf')) &&
                  acceptedMimes.some((m) => m.startsWith('image'))
                  ? 'Accepts Images (JPG, PNG, WebP), PDFs, and Word (.docx) files'
                  : `Accepts ${acceptedMimes.map((m) => m.replace('*', 'all')).join(', ')}`
                : 'Drop any document or image'}
              {' — Up to '}
              <span className="font-mono">{maxFiles} files</span>
            </p>
          </>
        )}
      </div>

      {/* Files List / Thumbnails */}
      {files.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-text-muted px-1">
            <span>
              {files.length} {files.length === 1 ? 'file' : 'files'} selected (
              {formatBytes(files.reduce((acc, f) => acc + f.size, 0))})
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={handleRequestClearAll} className="text-xs h-7 text-status-error hover:bg-status-error/10">
                Clear all
              </Button>
            </div>
          </div>

          <div
            role="list"
            aria-label="Loaded files list"
            className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-[380px] overflow-y-auto pr-1"
          >
            {files.map((file, idx) => (
              <div
                key={file.id}
                role="listitem"
                className="group relative flex items-center gap-3 p-2.5 rounded-lg bg-surface-panel border border-surface-border hover:border-surface-border-focus transition-all duration-150 shadow-sm"
              >
                {/* Thumbnail / Icon */}
                <div className="w-12 h-12 rounded-none bg-surface-subtle flex items-center justify-center overflow-hidden shrink-0 border border-surface-border-subtle">
                  {file.previewUrl ? (
                    <img
                      src={file.previewUrl}
                      alt={file.name}
                      className="w-full h-full object-cover rounded-none"
                    />
                  ) : (
                    <FileIcon className="w-5 h-5 text-text-muted" />
                  )}
                </div>

                {/* Details */}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-text-main truncate" title={file.name}>
                    {file.name}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className="text-[11px] font-mono text-text-faint">
                      {formatBytes(file.size)}
                    </span>
                    <Badge size="sm" variant="neutral">
                      {/\.docx$/i.test(file.name) || file.type.includes('word')
                        ? 'DOCX'
                        : /\.pdf$/i.test(file.name) || file.type === 'application/pdf'
                        ? 'PDF'
                        : file.type.split('/')[1]?.toUpperCase() ||
                          file.name.split('.').pop()?.toUpperCase() ||
                          'FILE'}
                    </Badge>
                  </div>
                </div>

                {/* Reorder and Delete controls */}
                <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      moveFile(idx, 'up');
                    }}
                    disabled={idx === 0}
                    className="p-1 rounded text-text-faint hover:text-text-main disabled:opacity-20"
                    aria-label={`Move ${file.name} up`}
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
                    className="p-1 rounded text-text-faint hover:text-text-main disabled:opacity-20"
                    aria-label={`Move ${file.name} down`}
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(file.id);
                    }}
                    className="p-1 rounded text-text-faint hover:text-status-error"
                    aria-label={`Remove ${file.name}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
