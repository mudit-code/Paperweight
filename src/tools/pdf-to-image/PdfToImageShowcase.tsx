import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  FolderPlus,
  PlusCircle,
  Trash2,
  Archive,
  Save,
  X,
  FileText,
  FileImage,
  Loader2,
  CheckCircle2,
  Play,
  RotateCcw,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ProcessedFile } from '../../core/types';
import type { BatchResult, CompressedItemResult } from '../../core/processors/types';
import { validateFile, formatBytes } from '../../core/files/validation';
import { toUserFacingError, type UserFacingError } from '../../core/errors';
import { downloadBlob, saveMultipleBlobs, isMobileApp } from '../../core/processors/download';
import { parsePageRange } from '../../core/processors/image-encoders';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { ClearWarningBanner } from '../../components/ui/ClearWarningBanner';

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
  className = '',
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = isMobileApp();
  const [isSavingAll, setIsSavingAll] = useState(false);
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

  // Extract converted image items from result
  const convertedItems: CompressedItemResult[] = result
    ? result.items && result.items.length > 0
      ? result.items
      : [
          {
            id: result.id,
            name: result.filename,
            blob: result.blob,
            originalSize: currentFile?.size || result.size,
            compressedSize: result.size,
            fileType: 'image',
            savingsPercent: 0,
          },
        ]
    : [];

  const totalConvertedSize = convertedItems.reduce((acc, it) => acc + it.compressedSize, 0);

  return (
    <div className={`space-y-4 select-none ${className}`}>
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

      {/* STATE 0: EMPTY STATE (Matching Screenshot 3 Dropbox) */}
      {!currentFile && (
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
              aria-label="Add PDFs"
            >
              {isImporting ? (
                <Loader2 className="w-8 h-8 text-accent animate-spin" />
              ) : (
                <PlusCircle className="w-8 h-8 text-text-muted group-hover:text-accent transition-colors" />
              )}
              <span className="text-xs font-semibold text-text-main group-hover:text-accent transition-colors">
                {isImporting ? 'Reading...' : 'Add PDFs'}
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
              Select PDF
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

      {/* STATE 2: CONVERTED IMAGES PREVIEW (Only after clicking Convert button) */}
      {currentFile && result && (
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
                    {formatUpper}
                  </Badge>
                </div>
                <p className="text-xs text-text-muted">
                  {convertedItems.length} {convertedItems.length === 1 ? 'image' : 'images'} generated from{' '}
                  <span className="font-mono text-text-main">{currentFile.name}</span> ({formatBytes(totalConvertedSize)})
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
                Change PDF
              </Button>
            </div>
          </div>

          {/* Converted Image Cards Grid */}
          <div className="p-4 sm:p-5 max-h-[300px] sm:max-h-[380px] lg:max-h-[650px] overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {convertedItems.map((item, index) => {
                const imageUrl = URL.createObjectURL(item.blob);
                return (
                  <div
                    key={item.id || index}
                    className="group bg-surface-bg border border-surface-border rounded-xl p-3 flex flex-col shadow-xs hover:border-accent/40 hover:shadow-md transition-all"
                  >
                    {/* Image Filename & Format */}
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-surface-border-subtle">
                      <span
                        className="text-xs font-medium text-text-main truncate"
                        title={item.name}
                      >
                        {item.name}
                      </span>
                      <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-surface-subtle text-text-muted border border-surface-border-subtle shrink-0">
                        {formatUpper}
                      </span>
                    </div>

                    {/* Image Preview Canvas */}
                    <div className="relative aspect-[3/4] max-h-36 sm:max-h-44 lg:max-h-none w-full bg-surface-subtle rounded-none border border-surface-border-subtle my-2 flex items-center justify-center overflow-hidden p-1.5">
                      <img
                        src={imageUrl}
                        alt={item.name}
                        className="max-h-full max-w-full object-contain rounded-none shadow-xs"
                      />
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
              <FileImage className="w-4 h-4 text-accent" />
              <span>
                {convertedItems.length} {convertedItems.length === 1 ? 'image' : 'images'} ready &bull; Total: {formatBytes(totalConvertedSize)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {onDismissResult && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onDismissResult}
                  className="h-9 px-3 text-xs font-medium"
                >
                  Adjust Pages
                </Button>
              )}

              {/* Save All (Save All on mobile, Save ZIP on desktop) */}
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
                {convertedItems.length > 1 ? (isMobile ? 'Save All' : 'Save ZIP') : 'Save Image'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* STATE 1: SELECTED PAGES PREVIEW (Uploaded PDF, before clicking Convert button) */}
      {currentFile && !result && (
        <div className="border border-surface-border rounded-2xl bg-surface-panel overflow-hidden shadow-xs animate-in fade-in">
          {/* Header Bar */}
          <div className="px-5 py-3.5 bg-surface-subtle border-b border-surface-border flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-accent-subtle border border-accent/20 text-accent flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-xs sm:text-sm font-semibold text-text-main truncate max-w-xs" title={currentFile.name}>
                    {currentFile.name}
                  </h3>
                  <Badge variant="neutral" size="sm">
                    {formatBytes(currentFile.size)}
                  </Badge>
                  <Badge variant="accent" size="sm">
                    {selectedPageNumbers.length} of {numPdfPages || '...'} {selectedPageNumbers.length === 1 ? 'page' : 'pages'} selected
                  </Badge>
                </div>
                <p className="text-[11px] text-text-muted mt-0.5">
                  Target: <span className="font-semibold text-accent font-mono">{formatUpper}</span> &bull; Previewing pages ready to convert
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
                Replace PDF
              </Button>
              <button
                type="button"
                onClick={handleRequestClear}
                disabled={isProcessing}
                className="p-1.5 rounded-lg text-text-muted hover:text-status-error hover:bg-status-error-bg border border-transparent hover:border-status-error-border transition-colors cursor-pointer"
                title="Remove PDF"
                aria-label="Remove PDF"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Selected Pages Thumbnail Grid */}
          <div className="p-4 sm:p-5 max-h-[280px] sm:max-h-[340px] lg:max-h-[600px] overflow-y-auto">
            {selectedPageNumbers.length === 0 ? (
              <div className="p-8 text-center text-xs text-text-muted italic">
                No pages match the current selection. Please adjust the Page Selection in the parameters panel.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {selectedPageNumbers.map((p) => {
                  const thumbUrl = pageThumbnails.get(p);
                  return (
                    <div
                      key={`page_${p}`}
                      className="group bg-surface-bg border border-surface-border rounded-xl p-3 flex flex-col shadow-xs hover:border-accent/40 hover:shadow-md transition-all"
                    >
                      {/* Page Label & Target Format */}
                      <div className="flex items-center justify-between gap-1 pb-2 border-b border-surface-border-subtle">
                        <span className="text-xs font-medium text-text-main">
                          Page {p} <span className="text-[11px] text-text-faint">of {numPdfPages}</span>
                        </span>
                        <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-accent-subtle text-accent border border-accent-border">
                          &rarr; {formatUpper}
                        </span>
                      </div>

                      {/* Thumbnail Preview Area */}
                      <div className="relative aspect-[3/4] max-h-36 sm:max-h-44 lg:max-h-none w-full bg-surface-subtle rounded-none border border-surface-border-subtle my-2 flex items-center justify-center overflow-hidden p-1.5">
                        {thumbUrl ? (
                          <img
                            src={thumbUrl}
                            alt={`Preview page ${p}`}
                            className="max-h-full max-w-full object-contain rounded-none shadow-xs"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-1.5 text-text-faint text-xs">
                            <Loader2 className="w-5 h-5 text-accent animate-spin" />
                            <span className="text-[10px]">Rendering preview...</span>
                          </div>
                        )}
                      </div>

                      {/* Ready Indicator */}
                      <div className="mt-auto pt-2 flex items-center justify-between text-[11px] text-text-muted border-t border-surface-border-subtle">
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Selected
                        </span>
                        <span className="font-mono text-[10px] text-text-faint">
                          #{p}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Bottom Action Bar */}
          <div className="px-5 py-3 bg-surface-subtle border-t border-surface-border flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-text-muted flex items-center gap-1.5 font-mono">
              <FileText className="w-4 h-4 text-accent" />
              <span>
                1 PDF &bull; {selectedPageNumbers.length} {selectedPageNumbers.length === 1 ? 'page' : 'pages'} to convert ({formatBytes(currentFile.size)})
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
                Clear
              </Button>

              {onExecute && (
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                  onClick={onExecute}
                  disabled={isProcessing || selectedPageNumbers.length === 0}
                  className="h-9 px-4 text-xs font-semibold shadow-xs"
                >
                  {isProcessing
                    ? 'Converting Pages...'
                    : `Convert ${selectedPageNumbers.length} ${selectedPageNumbers.length === 1 ? 'Page' : 'Pages'}`}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
