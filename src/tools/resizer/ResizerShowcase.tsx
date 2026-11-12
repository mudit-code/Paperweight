import React, { useRef, useState, useEffect } from 'react';
import {
  FolderPlus,
  Trash2,
  Save,
  X,
  FileImage,
  Loader2,
  CheckCircle2,
  Crop,
  Sliders,
  Image as ImageIcon,
  Settings,
} from 'lucide-react';
import type { ProcessedFile } from '../../core/types';
import type { BatchResult } from '../../core/processors/types';
import { validateFile, formatBytes } from '../../core/files/validation';
import { toUserFacingError, type UserFacingError } from '../../core/errors';
import { downloadBlob } from '../../core/processors/download';
import { Button } from '../../components/ui/Button';
import { ClearWarningBanner } from '../../components/ui/ClearWarningBanner';
import { DedicatedCropper } from './DedicatedCropper';
import {
  convertToPixels,
  type DimensionUnit,
  type EditorCropData,
} from '../../core/processors/resizer';

export interface ResizerShowcaseProps {
  files: ProcessedFile[];
  onFilesChange: (files: ProcessedFile[]) => void;
  options: Record<string, unknown>;
  onOptionsChange: (options: Record<string, unknown>) => void;
  isProcessing: boolean;
  result?: BatchResult | null;
  onDismissResult?: () => void;
  onExecute?: () => void;
  onToggleSidebar?: () => void;
  onOpenSettings?: () => void;
  className?: string;
}

export const ResizerShowcase: React.FC<ResizerShowcaseProps> = ({
  files,
  onFilesChange,
  options,
  onOptionsChange,
  isProcessing,
  result,
  onDismissResult,
  onExecute,
  onToggleSidebar: _onToggleSidebar,
  onOpenSettings,
  className = '',
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showSizePopover, setShowSizePopover] = useState(false);
  const [naturalDimensions, setNaturalDimensions] = useState<{ width: number; height: number } | null>(null);

  // Active file
  const currentFile = files[0];
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  // Options
  const unit = (options.unit as DimensionUnit) || 'px';
  const targetWidth = Number(options.targetWidth) || 1200;
  const targetHeight = Number(options.targetHeight) || 1200;
  const dpi = Number(options.dpi) || 300;
  const targetSizeEnabled = Boolean(options.targetSizeEnabled ?? true);
  const maxSizeKB = Number(options.maxSizeKB) || 200;
  const minSizeKB = Number(options.minSizeKB) || 0;
  const format = (options.outputFormat as string) || 'jpeg';

  // Calculate target pixel dimensions and aspect ratio
  const targetWidthPx = convertToPixels(targetWidth, unit, dpi);
  const targetHeightPx = convertToPixels(targetHeight, unit, dpi);
  const targetAspectRatio = targetWidthPx / targetHeightPx;
  const dimensionLabel = `${targetWidth} × ${targetHeight} ${unit}`;

  // Generate object URL for current source image
  useEffect(() => {
    if (!currentFile) {
      setImageUrl(null);
      setNaturalDimensions(null);
      return;
    }
    const blob = new Blob([currentFile.data], { type: currentFile.type });
    const url = URL.createObjectURL(blob);
    setImageUrl(url);

    // Read natural dimensions
    const probe = new Image();
    probe.onload = () => {
      setNaturalDimensions({ width: probe.naturalWidth, height: probe.naturalHeight });
    };
    probe.src = url;

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [currentFile?.id]);

  // Generate object URL for result blob
  useEffect(() => {
    if (!result?.blob) {
      setResultUrl(null);
      return;
    }
    const url = URL.createObjectURL(result.blob);
    setResultUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [result?.blob]);

  const handleProcessIncomingFile = async (rawFiles: FileList | File[]) => {
    if (!rawFiles || rawFiles.length === 0) return;
    setIsImporting(true);
    setError(null);

    try {
      const file = rawFiles[0];
      await validateFile(file, {
        acceptedMimes: [
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/avif',
          'image/bmp',
          'image/tiff',
          'image/*',
        ],
      });

      const buffer = await file.arrayBuffer();
      const processed: ProcessedFile = {
        id: `f_resizer_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        name: file.name,
        size: file.size,
        type: file.type || 'image/jpeg',
        lastModified: file.lastModified,
        data: buffer,
      };

      if (onDismissResult) onDismissResult();
      onFilesChange([processed]);
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
      await handleProcessIncomingFile(e.dataTransfer.files);
    }
  };

  const handleCropChange = (cropData: EditorCropData) => {
    onOptionsChange({
      ...options,
      editorCrop: cropData,
    });
  };

  const handleUnitChange = (newUnit: DimensionUnit) => {
    if (newUnit === unit) return;
    const oldUnit = unit;
    const curW = targetWidth;
    const curH = targetHeight;

    const pxW = oldUnit === 'in' ? curW * dpi : oldUnit === 'cm' ? (curW / 2.54) * dpi : curW;
    const pxH = oldUnit === 'in' ? curH * dpi : oldUnit === 'cm' ? (curH / 2.54) * dpi : curH;

    let nextW = pxW;
    let nextH = pxH;
    if (newUnit === 'in') {
      nextW = Number((pxW / dpi).toFixed(2));
      nextH = Number((pxH / dpi).toFixed(2));
    } else if (newUnit === 'cm') {
      nextW = Number(((pxW / dpi) * 2.54).toFixed(2));
      nextH = Number(((pxH / dpi) * 2.54).toFixed(2));
    } else {
      nextW = Math.round(pxW);
      nextH = Math.round(pxH);
    }

    onOptionsChange({
      ...options,
      unit: newUnit,
      targetWidth: nextW,
      targetHeight: nextH,
    });
  };

  const handleWidthChange = (val: string) => {
    onOptionsChange({
      ...options,
      targetWidth: val,
    });
  };

  const handleHeightChange = (val: string) => {
    onOptionsChange({
      ...options,
      targetHeight: val,
    });
  };

  const handleConfirmClear = () => {
    if (onDismissResult) onDismissResult();
    onFilesChange([]);
    setShowClearConfirm(false);
  };

  return (
    <div className={`h-full w-full flex flex-col overflow-hidden select-none bg-surface-bg text-text-main ${className}`}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/bmp,image/tiff,image/*"
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

      {/* Error Callout */}
      {error && (
        <div
          role="alert"
          className="shrink-0 m-2 flex items-start justify-between gap-3 p-3 rounded-xl bg-status-error-bg border border-status-error-border text-status-error text-xs animate-in fade-in z-40"
        >
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

      {/* ─────────────────────────────────────────────────────────────
          STATE 0 - EMPTY STATE: CLEAN & MINIMAL ("Add image to resize")
      ───────────────────────────────────────────────────────────── */}
      {!currentFile && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`w-full flex-1 flex flex-col h-full overflow-hidden transition-colors ${
            isDragOver ? 'bg-surface-subtle ring-2 ring-accent' : 'bg-surface-bg'
          }`}
        >
          {/* Top Header: Simple and theme-synced (Mobile only; desktop has main window header) */}
          <div className="lg:hidden shrink-0 h-14 px-4 bg-surface-panel border-b border-surface-border flex items-center justify-between gap-3 text-text-main">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Crop className="w-4 h-4 text-accent" />
                <span className="text-sm font-semibold tracking-tight text-text-main font-serif">
                  Image Resizer
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {onOpenSettings && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="p-2 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer"
                  title="Settings & Appearance"
                  aria-label="Settings"
                >
                  <Settings className="w-4 h-4" />
                </button>
              )}
              <Button
                variant="primary"
                size="sm"
                disabled={isImporting}
                onClick={() => fileInputRef.current?.click()}
                leftIcon={isImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderPlus className="w-3.5 h-3.5" />}
                className="h-8 px-3 text-xs font-semibold shadow-xs"
              >
                {isImporting ? 'Reading Photo...' : 'Add Image'}
              </Button>
            </div>
          </div>

          {/* Center Clean Drop Target: "Add image to resize" */}
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center p-8 sm:p-12 text-center space-y-4 max-w-sm w-full border-2 border-dashed border-surface-border rounded-3xl bg-surface-panel/60 hover:bg-surface-panel hover:border-accent/60 transition-all cursor-pointer shadow-xs group"
            >
              <div className="w-14 h-14 rounded-2xl bg-accent/10 text-accent flex items-center justify-center shadow-xs group-hover:scale-110 transition-transform">
                {isImporting ? (
                  <Loader2 className="w-7 h-7 animate-spin" />
                ) : (
                  <ImageIcon className="w-7 h-7" />
                )}
              </div>
              <h3 className="text-base sm:text-lg font-serif font-bold text-text-main tracking-tight">
                Add image to resize
              </h3>
              <Button
                variant="primary"
                size="md"
                disabled={isImporting}
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                leftIcon={isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />}
                className="px-5 py-2 font-semibold text-xs shadow-sm"
              >
                {isImporting ? 'Reading Photo...' : 'Add Image'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          STATE 2 - CONVERTED / CROPPED RESULT PREVIEW
      ───────────────────────────────────────────────────────────── */}
      {currentFile && result && resultUrl && (
        <div className="flex-1 min-h-0 bg-surface-subtle dark:bg-black flex flex-col overflow-hidden animate-in fade-in">
          {/* Header Bar: Clean single row without wrapping */}
          <div className="shrink-0 min-h-12 py-2 px-3 sm:px-4 bg-surface-panel border-b border-surface-border flex items-center justify-between gap-2 z-20 text-text-main">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-500 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div className="flex items-center gap-2 truncate">
                <h3 className="text-xs sm:text-sm font-semibold text-text-main truncate">
                  Resized Photo
                </h3>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/20 text-accent border border-accent/30 font-semibold uppercase shrink-0">
                  {format}
                </span>
                {targetSizeEnabled && maxSizeKB > 0 && result.size <= maxSizeKB * 1024 && (
                  <span className="text-[10px] font-mono text-emerald-500 font-semibold hidden md:inline shrink-0">
                    (Target met: {formatBytes(result.size)})
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (onDismissResult) onDismissResult();
                }}
                className="h-8 px-2.5 sm:px-3 text-xs font-medium"
              >
                Edit Again
              </Button>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="h-8 px-2.5 sm:px-3 text-xs font-medium"
              >
                New Photo
              </Button>

              <Button
                variant="primary"
                size="sm"
                leftIcon={<Save className="w-3.5 h-3.5" />}
                onClick={() => downloadBlob(result.blob, result.filename)}
                className="h-8 px-3 sm:px-3.5 text-xs font-semibold shadow-xs"
              >
                Save Image
              </Button>
            </div>
          </div>

          {/* Center Image Display: Theme-synced background, clean object contain */}
          <div className="flex-1 min-h-0 bg-surface-subtle dark:bg-black p-4 flex items-center justify-center overflow-hidden relative">
            <div className="relative max-w-full max-h-full flex items-center justify-center">
              <img
                src={resultUrl}
                alt={result.filename}
                className="max-w-full max-h-[calc(100vh-10rem)] object-contain rounded-none shadow-2xl border border-surface-border dark:border-white/10"
              />
            </div>
          </div>

          {/* Result Footer Bar: Single aligned row */}
          <div className="shrink-0 h-10 px-4 bg-surface-panel/95 border-t border-surface-border flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5 font-mono text-[11px] text-text-muted min-w-0">
              <span className="font-bold text-text-main uppercase tracking-wider shrink-0">
                {format.toUpperCase()}
              </span>
              <span className="truncate max-w-[180px] sm:max-w-sm text-text-main" title={result.filename}>
                {result.filename}
              </span>
              <span className="shrink-0">•</span>
              <span className="font-semibold text-emerald-500 shrink-0">
                {formatBytes(result.size)}
              </span>
              {currentFile && (
                <span className="text-text-muted text-[10px] hidden md:inline shrink-0">
                  (Original: {formatBytes(currentFile.size)}
                  {result.size < currentFile.size && (
                    <span className="text-emerald-500 font-semibold ml-1">
                      -
                      {Math.round(
                        ((currentFile.size - result.size) / currentFile.size) * 100
                      )}
                      %
                    </span>
                  )}
                  )
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="px-2 py-0.5 rounded bg-surface-subtle border border-surface-border text-text-main text-[11px] font-mono font-medium">
                {dimensionLabel}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          STATE 1 - GALLERY PHOTO EDITOR & CROPPER
          Matches Windows Photos gallery editor layout
      ───────────────────────────────────────────────────────────── */}
      {currentFile && !result && imageUrl && (
        <div className="relative flex-1 min-h-0 w-full h-full bg-surface-subtle dark:bg-black flex flex-col overflow-hidden animate-in fade-in">
          {/* Top Gallery Bar: Filename on Left, Save/Crop on Right (Mobile only; desktop has main window header) */}
          <div className="lg:hidden shrink-0 h-14 px-3 sm:px-4 bg-surface-panel border-b border-surface-border flex items-center justify-between gap-2 overflow-x-auto no-scrollbar z-20 text-text-main">
            {/* Top-Left: Image icon + Filename + Resolution info */}
            <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-accent/15 border border-accent/25 text-accent flex items-center justify-center shrink-0">
                <FileImage className="w-3.5 h-3.5" />
              </div>
              <div className="flex items-center gap-2 truncate">
                <span className="text-xs sm:text-sm font-semibold text-text-main truncate max-w-[140px] sm:max-w-[220px]" title={currentFile.name}>
                  {currentFile.name}
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-subtle text-text-muted border border-surface-border">
                  {formatBytes(currentFile.size)}
                </span>
                {naturalDimensions && (
                  <span className="text-[10px] font-mono text-text-muted hidden sm:inline">
                    ({naturalDimensions.width} × {naturalDimensions.height} px)
                  </span>
                )}
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 font-semibold hidden md:inline">
                  {dimensionLabel}
                </span>
              </div>
            </div>

            {/* Top-Right: Crop & Resize + Change Photo + Remove */}
            <div className="flex items-center gap-2 shrink-0">
              {onOpenSettings && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer"
                  title="Settings & Appearance"
                  aria-label="Settings"
                >
                  <Settings className="w-4 h-4" />
                </button>
              )}

              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="h-8 text-xs font-medium px-2.5"
              >
                Change Photo
              </Button>

              <button
                type="button"
                onClick={() => setShowClearConfirm(true)}
                disabled={isProcessing}
                className="p-1.5 rounded-lg text-text-muted hover:text-status-error hover:bg-status-error-bg/20 border border-transparent transition-colors cursor-pointer"
                title="Remove photo"
              >
                <Trash2 className="w-4 h-4" />
              </button>

              {onExecute && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={isProcessing}
                  isLoading={isProcessing}
                  leftIcon={<Crop className="w-3.5 h-3.5" />}
                  onClick={onExecute}
                  className="h-8 px-3.5 text-xs font-semibold shadow-xs"
                >
                  Crop & Resize
                </Button>
              )}
            </div>
          </div>

          {/* Center Gallery Viewport: full canvas with DedicatedCropper */}
          <div className="relative flex-1 min-h-0 w-full bg-surface-subtle dark:bg-black flex flex-col overflow-hidden">
            <DedicatedCropper
              imageUrl={imageUrl}
              naturalDimensions={naturalDimensions}
              targetAspectRatio={targetAspectRatio}
              outputFormat={format}
              dimensionLabel={dimensionLabel}
              fileSize={currentFile.size}
              initialCropData={options.editorCrop as EditorCropData | undefined}
              onChange={handleCropChange}
              className="h-full w-full"
            />
          </div>

          {/* ─────────────────────────────────────────────────────────────
              BOTTOM-MOST MIDDLE PARAMETERS DOCK (Visible on small spaces / < lg)
          ───────────────────────────────────────────────────────────── */}
          <div className="lg:hidden absolute bottom-2 inset-x-0 mx-auto w-fit max-w-[96vw] z-30 flex flex-col items-center">
            {/* Target Size Mini-Popover (Toggled above dock) */}
            {showSizePopover && (
              <div className="mb-2 p-3 rounded-2xl bg-surface-panel/95 border border-surface-border shadow-2xl text-xs space-y-2.5 animate-in fade-in zoom-in-95 w-64 backdrop-blur-md text-text-main">
                <div className="flex items-center justify-between pb-1.5 border-b border-surface-border">
                  <span className="font-semibold text-text-main flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-accent" />
                    Target File Size Limit
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowSizePopover(false)}
                    className="p-0.5 text-text-muted hover:text-text-main rounded cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={targetSizeEnabled}
                    onChange={(e) => onOptionsChange({ ...options, targetSizeEnabled: e.target.checked })}
                    className="rounded border-surface-border text-accent accent-accent cursor-pointer"
                  />
                  <span className="text-xs font-medium text-text-main">Enforce size limit</span>
                </label>

                {targetSizeEnabled && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <span className="text-[10px] text-text-muted block">Min KB:</span>
                      <input
                        type="number"
                        value={minSizeKB}
                        onChange={(e) => onOptionsChange({ ...options, minSizeKB: e.target.value })}
                        className="w-full text-xs font-mono bg-surface-subtle border border-surface-border rounded px-2 py-1 text-text-main"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-text-muted block">Max KB:</span>
                      <input
                        type="number"
                        value={maxSizeKB}
                        onChange={(e) => onOptionsChange({ ...options, maxSizeKB: e.target.value })}
                        className="w-full text-xs font-mono bg-surface-subtle border border-surface-border rounded px-2 py-1 text-text-main"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* The Floating Dock Bar in Bottom-Most Middle */}
            <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-2xl bg-surface-panel/95 backdrop-blur-md border border-surface-border shadow-2xl overflow-x-auto no-scrollbar text-text-main">
              {/* 1. Selector of parameter: px, cm, in */}
              <div className="flex items-center p-0.5 rounded-xl bg-surface-subtle border border-surface-border shrink-0">
                {(['px', 'cm', 'in'] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => handleUnitChange(u)}
                    className={`px-2 py-1 text-[11px] font-semibold rounded-lg transition-all cursor-pointer ${
                      unit === u
                        ? 'bg-accent text-white shadow-xs'
                        : 'text-text-muted hover:text-text-main'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>

              {/* 2. Target Width & Height */}
              <div className="flex items-center gap-1 shrink-0 text-xs">
                <div className="flex items-center gap-1 bg-surface-subtle border border-surface-border rounded-lg px-2 py-0.5">
                  <span className="text-[10px] font-mono text-text-muted">W</span>
                  <input
                    type="text"
                    value={targetWidth}
                    onChange={(e) => handleWidthChange(e.target.value)}
                    className="w-12 sm:w-14 h-6 text-xs text-center font-mono font-semibold bg-transparent text-text-main focus:outline-none"
                    placeholder="Width"
                  />
                </div>
                <span className="text-text-muted font-bold">&times;</span>
                <div className="flex items-center gap-1 bg-surface-subtle border border-surface-border rounded-lg px-2 py-0.5">
                  <span className="text-[10px] font-mono text-text-muted">H</span>
                  <input
                    type="text"
                    value={targetHeight}
                    onChange={(e) => handleHeightChange(e.target.value)}
                    className="w-12 sm:w-14 h-6 text-xs text-center font-mono font-semibold bg-transparent text-text-main focus:outline-none"
                    placeholder="Height"
                  />
                </div>
              </div>

              <div className="h-5 w-px bg-surface-border shrink-0" />

              {/* 3. Output Format Dropdown */}
              <select
                value={format}
                onChange={(e) => onOptionsChange({ ...options, outputFormat: e.target.value })}
                className="h-7 px-2 text-[11px] font-semibold font-mono bg-surface-subtle text-text-main border border-surface-border rounded-lg focus:outline-none cursor-pointer shrink-0"
              >
                <option value="jpeg">JPG</option>
                <option value="png">PNG</option>
                <option value="webp">WEBP</option>
              </select>

              {/* 4. Target Size Limit Pill Button */}
              <button
                type="button"
                onClick={() => setShowSizePopover((prev) => !prev)}
                className={`h-7 px-2.5 rounded-lg border text-[11px] font-mono font-semibold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
                  targetSizeEnabled && maxSizeKB > 0
                    ? 'bg-accent/20 border-accent text-accent'
                    : 'bg-surface-subtle border-surface-border text-text-muted hover:text-text-main'
                }`}
                title="Configure target file size limit"
              >
                <Sliders className="w-3 h-3 shrink-0" />
                <span>{targetSizeEnabled && maxSizeKB > 0 ? `≤${maxSizeKB}K` : 'Size'}</span>
              </button>

              {/* 5. DPI Selector (when unit is 'in' or 'cm') */}
              {(unit === 'in' || unit === 'cm') && (
                <select
                  value={dpi}
                  onChange={(e) => onOptionsChange({ ...options, dpi: Number(e.target.value) })}
                  className="h-7 px-1.5 text-[11px] font-mono bg-surface-subtle text-text-main border border-surface-border rounded-lg focus:outline-none cursor-pointer shrink-0"
                  title="Print resolution DPI"
                >
                  <option value={150}>150 DPI</option>
                  <option value={300}>300 DPI</option>
                  <option value={600}>600 DPI</option>
                </select>
              )}

              {/* 6. Smart Action Execution Button */}
              {onExecute && (
                <button
                  type="button"
                  onClick={onExecute}
                  disabled={isProcessing}
                  className="h-7 px-3 bg-accent hover:bg-accent-hover active:scale-95 text-white font-semibold text-xs rounded-lg shadow-md transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ml-0.5"
                >
                  {isProcessing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Crop className="w-3.5 h-3.5" />
                  )}
                  <span>Crop & Resize</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default ResizerShowcase;
