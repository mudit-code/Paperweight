import React, { useRef, useState } from 'react';
import {
  FolderPlus,
  PlusCircle,
  Trash2,
  Archive,
  Save,
  X,
  FileText,
  FileImage,
  FileSpreadsheet,
  Presentation,
  Loader2,
  CheckCircle2,
  Play,
  RotateCcw,
} from 'lucide-react';
import type { ProcessedFile } from '../../core/types';
import type { BatchResult, CompressedItemResult } from '../../core/processors/types';
import { validateFile, formatBytes } from '../../core/files/validation';
import { toUserFacingError, type UserFacingError } from '../../core/errors';
import { downloadBlob, saveMultipleBlobs, isMobileApp } from '../../core/processors/download';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { ClearWarningBanner } from '../../components/ui/ClearWarningBanner';

export interface GenericConverterShowcaseProps {
  mode: 'img-to-pdf' | 'img-to-img' | 'word-to-pdf' | 'excel-to-pdf' | 'ppt-to-pdf';
  files: ProcessedFile[];
  onFilesChange: (files: ProcessedFile[]) => void;
  options: Record<string, unknown>;
  isProcessing: boolean;
  result?: BatchResult | null;
  onDismissResult?: () => void;
  onExecute?: () => void;
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
  className = '',
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = isMobileApp();
  const [isSavingAll, setIsSavingAll] = useState(false);
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

  const getAddLabel = () => {
    if (mode === 'img-to-pdf' || mode === 'img-to-img') return 'Add Images';
    if (mode === 'word-to-pdf') return 'Add Documents';
    if (mode === 'excel-to-pdf') return 'Add Spreadsheets';
    if (mode === 'ppt-to-pdf') return 'Add Slides';
    return 'Add Files';
  };

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

        const buffer = await f.arrayBuffer();
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

  const convertedItems: CompressedItemResult[] = result
    ? result.items && result.items.length > 0
      ? result.items
      : [
          {
            id: result.id,
            name: result.filename,
            blob: result.blob,
            originalSize: result.size,
            compressedSize: result.size,
            fileType: result.fileType,
            savingsPercent: 0,
          },
        ]
    : [];

  const totalConvertedSize = convertedItems.reduce((acc, it) => acc + it.compressedSize, 0);
  const totalInputSize = files.reduce((acc, f) => acc + f.size, 0);

  return (
    <div className={`space-y-4 select-none ${className}`}>
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

      {/* EMPTY STATE (Matching Screenshot 3 Dropbox) */}
      {files.length === 0 && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`w-full rounded-2xl border-2 border-dashed transition-all duration-200 flex flex-col justify-between min-h-[260px] sm:min-h-[320px] lg:min-h-[460px] p-4 sm:p-6 shadow-sm ${
            isDragOver
              ? 'border-accent bg-accent-subtle/20 ring-2 ring-accent/30'
              : 'border-surface-border bg-surface-subtle/40 hover:border-surface-border-focus'
          }`}
        >
          {/* Central Add Target (Matching Screenshot 3) */}
          <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 my-auto space-y-3 sm:space-y-4">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing || isImporting}
              className="w-24 h-24 sm:w-32 sm:h-32 rounded-full border-2 border-dashed border-surface-border bg-surface-panel hover:bg-surface-panel hover:border-accent hover:text-accent flex flex-col items-center justify-center gap-1.5 sm:gap-2 text-text-muted transition-all shadow-sm group cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent"
              aria-label={getAddLabel()}
            >
              {isImporting ? (
                <Loader2 className="w-8 h-8 text-accent animate-spin" />
              ) : (
                <PlusCircle className="w-8 h-8 text-text-muted group-hover:text-accent transition-colors" />
              )}
              <span className="text-xs font-semibold text-text-main group-hover:text-accent transition-colors">
                {isImporting ? 'Reading...' : getAddLabel()}
              </span>
            </button>
            <p className="text-xs text-text-faint text-center max-w-sm">
              Drag and drop files here, or click the circle above to browse from your device.
            </p>
          </div>

          {/* Bottom Action Toolbar (Matching Screenshot 3) */}
          <div className="pt-4 mt-auto border-t border-surface-border flex items-center justify-between flex-wrap gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={isProcessing || isImporting}
              onClick={() => fileInputRef.current?.click()}
              leftIcon={
                isImporting ? (
                  <Loader2 className="w-4 h-4 animate-spin text-accent" />
                ) : (
                  <FolderPlus className="w-4 h-4" />
                )
              }
              className="font-medium text-xs shadow-sm"
            >
              {getSelectLabel()}
            </Button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled
                className="p-2 rounded-lg text-text-faint opacity-30 cursor-not-allowed"
                title="Remove all files"
                aria-label="Remove all files"
              >
                <Trash2 className="w-4 h-4 text-status-error" />
              </button>

              <Button
                variant="primary"
                size="sm"
                disabled
                leftIcon={<Archive className="w-4 h-4" />}
                className="font-semibold text-xs shadow-sm opacity-50 cursor-not-allowed"
              >
                Save ZIP
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* POST-CONVERSION RESULTS PREVIEW */}
      {files.length > 0 && result && (
        <div className="border border-surface-border rounded-2xl bg-surface-panel overflow-hidden shadow-xs animate-in fade-in">
          {/* Header Bar */}
          <div className="px-5 py-3.5 bg-surface-subtle border-b border-surface-border flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-text-main">
                    Conversion Complete
                  </h3>
                  <Badge variant="accent" size="sm">
                    {targetBadge}
                  </Badge>
                </div>
                <p className="text-xs text-text-muted">
                  {convertedItems.length} {convertedItems.length === 1 ? 'file' : 'files'} generated ({formatBytes(totalConvertedSize)})
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {onDismissResult && (
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                  onClick={onDismissResult}
                  className="h-8 text-xs font-medium"
                >
                  Convert Again / Adjust
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<FolderPlus className="w-3.5 h-3.5" />}
                onClick={() => fileInputRef.current?.click()}
                className="h-8 text-xs font-medium"
              >
                Add More Files
              </Button>
            </div>
          </div>

          {/* Converted Files Grid */}
          <div className="p-4 sm:p-5 max-h-[280px] sm:max-h-[340px] lg:max-h-[600px] overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {convertedItems.map((item, index) => {
                const isImage = item.fileType === 'image';
                const fileUrl = URL.createObjectURL(item.blob);
                return (
                  <div
                    key={item.id || index}
                    className="group bg-surface-bg border border-surface-border rounded-xl p-3 flex flex-col shadow-xs hover:border-accent/40 hover:shadow-md transition-all"
                  >
                    {/* Filename & Format badge */}
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-surface-border-subtle">
                      <span className="text-xs font-medium text-text-main truncate" title={item.name}>
                        {item.name}
                      </span>
                      <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-surface-subtle text-text-muted border border-surface-border-subtle shrink-0">
                        {targetBadge}
                      </span>
                    </div>

                    {/* Preview box */}
                    <div className="relative aspect-[3/4] w-full bg-surface-subtle rounded-none border border-surface-border-subtle my-2.5 flex items-center justify-center overflow-hidden p-1.5">
                      {isImage ? (
                        <img
                          src={fileUrl}
                          alt={item.name}
                          className="max-h-full max-w-full object-contain rounded-none shadow-xs"
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center gap-2 text-accent">
                          <FileText className="w-10 h-10" />
                          <span className="text-[10px] font-mono text-text-muted font-semibold">
                            {targetBadge} DOCUMENT
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Footer with Size & Save */}
                    <div className="mt-auto pt-2 flex items-center justify-between gap-2 border-t border-surface-border-subtle">
                      <span className="text-[11px] font-mono text-text-muted">
                        {formatBytes(item.compressedSize || item.blob.size)}
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        leftIcon={<Save className="w-3 h-3" />}
                        onClick={() => downloadBlob(item.blob, item.name)}
                        className="h-7 text-xs px-2.5 font-medium hover:bg-accent-subtle hover:text-accent hover:border-accent-border"
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bottom Toolbar */}
          <div className="px-5 py-3 bg-surface-subtle border-t border-surface-border flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-text-muted flex items-center gap-1.5 font-mono">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>
                {convertedItems.length} {convertedItems.length === 1 ? 'file' : 'files'} ready &bull; Total: {formatBytes(totalConvertedSize)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={isSavingAll}
                isLoading={isSavingAll}
                leftIcon={convertedItems.length > 1 && !isMobile ? <Archive className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                onClick={async () => {
                  if (!result) return;
                  if (isMobile && convertedItems.length > 1) {
                    setIsSavingAll(true);
                    try {
                      await saveMultipleBlobs(convertedItems.map((it) => ({ blob: it.blob, name: it.name })));
                    } finally {
                      setIsSavingAll(false);
                    }
                  } else {
                    downloadBlob(result.blob, result.filename);
                  }
                }}
                className="h-9 px-4 text-xs font-semibold shadow-xs"
              >
                {convertedItems.length > 1 ? (isMobile ? 'Save All' : 'Save ZIP') : `Save ${targetBadge}`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* PRE-CONVERSION FILES SHOWCASE */}
      {files.length > 0 && !result && (
        <div className="border border-surface-border rounded-2xl bg-surface-panel overflow-hidden shadow-xs animate-in fade-in">
          {/* Header Bar */}
          <div className="px-5 py-3.5 bg-surface-subtle border-b border-surface-border flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-accent-subtle border border-accent/20 text-accent flex items-center justify-center shrink-0">
                <IconComponent className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-xs sm:text-sm font-semibold text-text-main">
                    {files.length} {files.length === 1 ? fileTypeLabel.slice(0, -1) : fileTypeLabel} Selected
                  </h3>
                  <Badge variant="neutral" size="sm">
                    {formatBytes(totalInputSize)}
                  </Badge>
                  <Badge variant="accent" size="sm">
                    &rarr; {targetBadge}
                  </Badge>
                </div>
                <p className="text-[11px] text-text-muted mt-0.5">
                  Ready to convert to <span className="font-semibold text-accent font-mono">{targetBadge}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<FolderPlus className="w-3.5 h-3.5" />}
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="h-8 text-xs font-medium"
              >
                Add Files
              </Button>
              <button
                type="button"
                onClick={handleRequestClear}
                disabled={isProcessing}
                className="p-1.5 rounded-lg text-text-muted hover:text-status-error hover:bg-status-error-bg border border-transparent hover:border-status-error-border transition-colors cursor-pointer"
                title="Clear all"
                aria-label="Clear all"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Files Grid */}
          <div className="p-4 sm:p-5 max-h-[280px] sm:max-h-[340px] lg:max-h-[600px] overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {files.map((file, idx) => {
                const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp|avif|bmp|gif)$/i.test(file.name);
                return (
                  <div
                    key={file.id || idx}
                    className="group bg-surface-bg border border-surface-border rounded-xl p-3 flex flex-col shadow-xs hover:border-accent/40 hover:shadow-md transition-all relative"
                  >
                    {/* Header: Name + Remove */}
                    <div className="flex items-center justify-between gap-1 pb-2 border-b border-surface-border-subtle">
                      <span className="text-xs font-medium text-text-main truncate" title={file.name}>
                        {file.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveSingle(idx)}
                        className="text-text-faint hover:text-status-error transition-colors p-0.5"
                        title="Remove file"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Preview Area */}
                    <div className="relative aspect-[3/4] max-h-36 sm:max-h-44 lg:max-h-none w-full bg-surface-subtle rounded-none border border-surface-border-subtle my-2 flex items-center justify-center overflow-hidden p-1.5">
                      {isImage && file.previewUrl ? (
                        <img
                          src={file.previewUrl}
                          alt={file.name}
                          className="max-h-full max-w-full object-contain rounded-none shadow-xs"
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center gap-2 text-accent">
                          <IconComponent className="w-10 h-10" />
                          <span className="text-[10px] font-mono text-text-muted uppercase">
                            {file.name.split('.').pop()}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Footer */}
                    <div className="mt-auto pt-2 flex items-center justify-between text-[11px] text-text-muted border-t border-surface-border-subtle">
                      <span className="font-mono text-[10px]">{formatBytes(file.size)}</span>
                      <span className="text-[10px] font-mono font-medium text-accent">
                        &rarr; {targetBadge}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bottom Action Bar */}
          <div className="px-5 py-3 bg-surface-subtle border-t border-surface-border flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-text-muted flex items-center gap-1.5 font-mono">
              <IconComponent className="w-4 h-4 text-accent" />
              <span>
                {files.length} {files.length === 1 ? 'file' : 'files'} ({formatBytes(totalInputSize)}) &bull; Output: {targetBadge}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRequestClear}
                disabled={isProcessing}
                className="h-9 px-3 text-xs font-medium"
              >
                Clear all
              </Button>

              {onExecute && (
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                  onClick={onExecute}
                  disabled={isProcessing || files.length === 0}
                  className="h-9 px-4 text-xs font-semibold shadow-xs"
                >
                  {isProcessing ? 'Converting...' : `Convert to ${targetBadge}`}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

