import React, { useRef, useState, useEffect } from 'react';
import {
  FolderPlus,
  Save,
  Share2,
  X,
  Loader2,
  CheckCircle2,
  Crop,
  Sliders,
  ArrowRight,
  ArrowLeft,
  RotateCcw,
  RotateCw,
  FileImage,
} from 'lucide-react';
import type { ProcessedFile } from '../../core/types';
import type { BatchResult } from '../../core/processors/types';
import { validateFile, formatBytes } from '../../core/files/validation';
import { toUserFacingError, type UserFacingError } from '../../core/errors';
import { downloadBlob, shareBlob, isMobileApp } from '../../core/processors/download';
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
  className = '',
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [naturalDimensions, setNaturalDimensions] = useState<{ width: number; height: number } | null>(null);

  const isMobile = isMobileApp() || (typeof window !== 'undefined' && window.innerWidth < 1024);

  // Active step: 'settings' (Step 1) or 'crop' (Step 2) for mobile view
  const [activeStep, setActiveStep] = useState<'settings' | 'crop'>(
    (options.resizerStep as 'settings' | 'crop') || 'settings'
  );

  // Sync active step changes with parent options
  useEffect(() => {
    if (options.resizerStep !== activeStep) {
      onOptionsChange({
        ...options,
        resizerStep: activeStep,
      });
    }
  }, [activeStep]);

  // Sync external step updates (e.g. from AppShell header back)
  useEffect(() => {
    if (options.resizerStep && options.resizerStep !== activeStep) {
      setActiveStep(options.resizerStep as 'settings' | 'crop');
    }
  }, [options.resizerStep]);

  // Active file
  const currentFile = files[0];
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  // Options state with string preservation for backspace/editing
  const unit = (options.unit as DimensionUnit) || 'px';
  const rawWidth = options.targetWidth !== undefined ? String(options.targetWidth) : '1200';
  const rawHeight = options.targetHeight !== undefined ? String(options.targetHeight) : '1200';
  const dpi = Number(options.dpi) || 300;
  const targetSizeEnabled = Boolean(options.targetSizeEnabled ?? false);
  const rawMaxSizeKB = options.maxSizeKB !== undefined ? String(options.maxSizeKB) : '200';
  const rawMinSizeKB = options.minSizeKB !== undefined ? String(options.minSizeKB) : '0';
  const outputFormat = (options.outputFormat as string) || 'original';

  const numWidth = Number(rawWidth);
  const numHeight = Number(rawHeight);
  const isWidthValid = rawWidth.trim() !== '' && !isNaN(numWidth) && numWidth > 0;
  const isHeightValid = rawHeight.trim() !== '' && !isNaN(numHeight) && numHeight > 0;

  const numMaxSize = Number(rawMaxSizeKB);
  const numMinSize = Number(rawMinSizeKB);
  const isMaxSizeValid = !targetSizeEnabled || (rawMaxSizeKB.trim() !== '' && !isNaN(numMaxSize) && numMaxSize > 0);
  const isMinSizeValid = !targetSizeEnabled || (rawMinSizeKB.trim() === '' || (!isNaN(numMinSize) && numMinSize >= 0));
  const isSizeRangeValid = !targetSizeEnabled || (isMaxSizeValid && isMinSizeValid && (rawMinSizeKB.trim() === '' || numMinSize <= numMaxSize));

  const canProceed = isWidthValid && isHeightValid && isSizeRangeValid;

  // Safe numeric values for computation and processing
  const targetWidth = isWidthValid ? numWidth : 1200;
  const targetHeight = isHeightValid ? numHeight : 1200;
  const maxSizeKB = isMaxSizeValid ? numMaxSize : 200;
  const minSizeKB = isMinSizeValid ? numMinSize : 0;

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
      setActiveStep('settings');
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
      // Smoothly advance to Step 2 (Crop)
      setActiveStep('crop');
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

  const rotation = (options.editorCrop as EditorCropData | undefined)?.rotation || 0;

  const handleRotationChange = (nextRotation: number) => {
    onOptionsChange({
      ...options,
      editorCrop: {
        ...((options.editorCrop as EditorCropData | undefined) || {
          relX: 0,
          relY: 0,
          relW: 1,
          relH: 1,
        }),
        rotation: nextRotation,
      },
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

  const sanitizeNumeric = (val: string, allowDecimals: boolean) => {
    if (allowDecimals) {
      let cleaned = val.replace(/[^0-9.]/g, '');
      const parts = cleaned.split('.');
      if (parts.length > 2) {
        cleaned = parts[0] + '.' + parts.slice(1).join('');
      }
      return cleaned;
    }
    return val.replace(/[^0-9]/g, '');
  };

  const handleWidthChange = (val: string) => {
    const sanitized = sanitizeNumeric(val, unit !== 'px');
    onOptionsChange({
      ...options,
      targetWidth: sanitized,
    });
  };

  const handleHeightChange = (val: string) => {
    const sanitized = sanitizeNumeric(val, unit !== 'px');
    onOptionsChange({
      ...options,
      targetHeight: sanitized,
    });
  };

  const handleMinSizeChange = (val: string) => {
    const sanitized = sanitizeNumeric(val, false);
    onOptionsChange({
      ...options,
      minSizeKB: sanitized,
    });
  };

  const handleMaxSizeChange = (val: string) => {
    const sanitized = sanitizeNumeric(val, false);
    onOptionsChange({
      ...options,
      maxSizeKB: sanitized,
    });
  };

  const handleConfirmClear = () => {
    if (onDismissResult) onDismissResult();
    onFilesChange([]);
    setActiveStep('settings');
    setShowClearConfirm(false);
  };

  const resolvedFormatLabel = () => {
    if (outputFormat === 'original') {
      if (currentFile?.type?.includes('png')) return 'PNG (Original)';
      if (currentFile?.type?.includes('webp')) return 'WebP (Original)';
      return 'JPG (Original)';
    }
    return outputFormat === 'jpeg' ? 'JPG' : outputFormat.toUpperCase();
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
        title="Discard Changes?"
        message="Going back will discard your current photo and crop adjustments."
        confirmText="Discard"
        itemCount={files.length}
        onConfirm={handleConfirmClear}
        onCancel={() => setShowClearConfirm(false)}
      />

      {/* Error Callout */}
      {error && (
        <div
          role="alert"
          className="shrink-0 m-3 flex items-start justify-between gap-3 p-3 rounded-sheet bg-status-error-bg border border-status-error-border text-status-error text-xs animate-in fade-in z-40"
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

      {/* ═══════════════════════════════════════════════════════════════
          STEP 3: FINAL PROCESSED SCREEN (Result + Save & Share)
      ═══════════════════════════════════════════════════════════════ */}
      {currentFile && result && resultUrl && (
        <div className="flex-1 min-h-0 bg-surface-bg flex flex-col overflow-hidden animate-in fade-in">
          {/* Header Banner: Clean metrics and target compliance */}
          <div className="shrink-0 py-3 px-4 bg-surface-panel border-b border-surface-border flex items-center justify-between gap-2 z-20">
            <div className="flex items-center gap-2.5 min-w-0">
              <CheckCircle2 className="w-5 h-5 text-status-success shrink-0" />
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-text-main leading-tight truncate">
                  Image Resized
                </h3>
                <p className="text-xs text-text-muted font-mono truncate">
                  {dimensionLabel} • {resolvedFormatLabel()}
                </p>
              </div>
            </div>

            {/* Target Size Badge */}
            {targetSizeEnabled && maxSizeKB > 0 && (
              <span
                className={`text-xs font-mono font-semibold px-2.5 py-1 rounded-chip border shrink-0 ${
                  result.size <= maxSizeKB * 1024 && (minSizeKB === 0 || result.size >= minSizeKB * 1024)
                    ? 'bg-status-success/10 text-status-success border-status-success/30'
                    : 'bg-accent/10 text-accent border-accent/30'
                }`}
              >
                {result.size <= maxSizeKB * 1024 && (minSizeKB === 0 || result.size >= minSizeKB * 1024)
                  ? minSizeKB > 0
                    ? `${minSizeKB}-${maxSizeKB}KB Met`
                    : `≤${maxSizeKB}KB Met`
                  : minSizeKB > 0
                  ? `Target: ${minSizeKB}-${maxSizeKB}KB`
                  : `Target: ≤${maxSizeKB}KB`}
              </span>
            )}
          </div>

          {/* Center Image Display */}
          <div className="flex-1 min-h-0 bg-surface-bg p-4 sm:p-6 flex items-center justify-center overflow-hidden relative">
            <div className="paper-sheet p-2 sm:p-3 relative max-w-full max-h-full flex items-center justify-center shadow-lg">
              <img
                src={resultUrl}
                alt={result.filename}
                className="max-w-full max-h-[calc(100vh-16rem)] object-contain rounded-none select-none"
              />
            </div>
          </div>

          {/* Footer Metrics & Actions Bar */}
          <div className="shrink-0 bg-surface-panel border-t border-surface-border px-4 py-3 pb-[calc(4.75rem+var(--safe-area-bottom))] lg:pb-3 space-y-3 z-20">
            {/* File info summary */}
            <div className="flex items-center justify-between gap-2 font-mono text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold text-text-main truncate max-w-[150px] sm:max-w-xs">
                  {result.filename}
                </span>
                <span className="text-text-muted">•</span>
                <span className="font-bold text-status-success">
                  {formatBytes(result.size)}
                </span>
                {currentFile.size > result.size && (
                  <span className="text-text-muted hidden sm:inline">
                    (-{Math.round(((currentFile.size - result.size) / currentFile.size) * 100)}%)
                  </span>
                )}
              </div>

              <span className="text-text-muted shrink-0">
                Original: {formatBytes(currentFile.size)}
              </span>
            </div>

            {/* Action Buttons: Save, Share, Crop Again, Resize Another */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Button
                variant="primary"
                size="md"
                leftIcon={<Save className="w-4 h-4" />}
                onClick={() => downloadBlob(result.blob, result.filename)}
                className="w-full font-bold shadow-sm"
              >
                Save
              </Button>

              <Button
                variant="secondary"
                size="md"
                leftIcon={<Share2 className="w-4 h-4" />}
                onClick={() => shareBlob(result.blob, result.filename)}
                className="w-full font-semibold"
              >
                Share
              </Button>

              <Button
                variant="secondary"
                size="md"
                leftIcon={<Crop className="w-4 h-4" />}
                onClick={() => {
                  if (onDismissResult) onDismissResult();
                  setActiveStep('crop');
                }}
                className="w-full"
              >
                Crop again
              </Button>

              <Button
                variant="secondary"
                size="md"
                leftIcon={<RotateCcw className="w-4 h-4" />}
                onClick={() => {
                  if (onDismissResult) onDismissResult();
                  onFilesChange([]);
                  setActiveStep('settings');
                }}
                className="w-full text-text-muted hover:text-text-main"
              >
                Resize another
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          STEP 2: CROPPER WITH GENERATED CROPPER
          (Mobile: 2 docked buttons; Desktop: direct view + sleek desktop bar)
      ═══════════════════════════════════════════════════════════════ */}
      {currentFile && !result && imageUrl && (isMobile ? activeStep === 'crop' : true) && (
        <div className="relative flex-1 min-h-0 w-full h-full bg-surface-bg flex flex-col overflow-hidden animate-in fade-in">
          {/* Full-bleed DedicatedCropper Canvas */}
          <div className="relative flex-1 min-h-0 w-full bg-surface-bg flex flex-col overflow-hidden">
            <DedicatedCropper
              imageUrl={imageUrl}
              naturalDimensions={naturalDimensions}
              targetAspectRatio={targetAspectRatio}
              outputFormat={outputFormat === 'original' ? 'jpeg' : outputFormat}
              dimensionLabel={dimensionLabel}
              fileSize={currentFile.size}
              initialCropData={options.editorCrop as EditorCropData | undefined}
              onChange={handleCropChange}
              rotation={rotation}
              onRotationChange={handleRotationChange}
              className="h-full w-full"
            />
          </div>

          {/* Action Bar: Mobile gets 2 docked buttons; Desktop gets a sleek single-line desktop bar */}
          {isMobile ? (
            <div className="shrink-0 bg-surface-panel border-t border-surface-border px-4 py-3 pb-[calc(4.75rem+var(--safe-area-bottom))] grid grid-cols-2 gap-3 z-20 select-none shadow-md">
              <Button
                variant="secondary"
                size="md"
                leftIcon={<Sliders className="w-4 h-4" />}
                onClick={() => setActiveStep('settings')}
                className="w-full font-semibold"
              >
                Change settings
              </Button>

              <Button
                variant="primary"
                size="md"
                leftIcon={isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crop className="w-4 h-4" />}
                onClick={onExecute}
                disabled={isProcessing || !canProceed}
                className="w-full font-bold shadow-sm"
              >
                {isProcessing ? 'Resizing...' : targetSizeEnabled ? 'Compress & Resize' : 'Crop & Resize'}
              </Button>
            </div>
          ) : (
            <div className="shrink-0 min-h-[46px] bg-surface-panel border-t border-surface-border px-4 py-1.5 flex items-center justify-between text-xs z-20 select-none">
              {/* Back to Photo Selection (Prompts discard warning) */}
              <button
                type="button"
                onClick={() => setShowClearConfirm(true)}
                className="min-h-[34px] px-3 rounded-control border border-surface-border bg-surface-bg hover:bg-surface-subtle text-text-muted hover:text-text-main inline-flex items-center gap-1.5 text-xs font-semibold transition-colors cursor-pointer"
                title="Discard adjustments and choose another photo"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>

              {/* 90° Rotations */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleRotationChange((rotation - 90 + 360) % 360)}
                  title="Rotate 90° counter-clockwise"
                  aria-label="Rotate 90 degrees counter-clockwise"
                  className="min-h-[34px] px-2.5 rounded-control border border-surface-border bg-surface-bg hover:bg-surface-subtle text-text-muted hover:text-text-main inline-flex items-center justify-center gap-1.5 text-xs font-semibold font-mono transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span className="hidden sm:inline">Rotate -90°</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleRotationChange((rotation + 90) % 360)}
                  title="Rotate 90° clockwise"
                  aria-label="Rotate 90 degrees clockwise"
                  className="min-h-[34px] px-2.5 rounded-control border border-surface-border bg-surface-bg hover:bg-surface-subtle text-text-muted hover:text-text-main inline-flex items-center justify-center gap-1.5 text-xs font-semibold font-mono transition-colors cursor-pointer"
                >
                  <RotateCw className="w-4 h-4" />
                  <span className="hidden sm:inline">Rotate +90°</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          DESKTOP EMPTY STATE: Clean, full-bleed dropzone (fills to bottom dynamically)
      ═══════════════════════════════════════════════════════════════ */}
      {!isMobile && !currentFile && !result && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className="flex-1 min-h-0 w-full p-4 sm:p-5 flex flex-col overflow-hidden"
        >
          <div
            className={`w-full h-full flex-1 min-h-0 rounded-sheet border transition-colors duration-150 flex flex-col items-center justify-center p-6 sm:p-8 text-center space-y-4 ${
              isDragOver
                ? 'border-accent bg-surface-hover shadow-lifted'
                : 'border-surface-border bg-surface-panel'
            }`}
          >
            <div className="w-16 h-16 mx-auto rounded-full bg-surface-subtle border border-surface-border flex items-center justify-center text-text-muted">
              <FolderPlus className="w-8 h-8" />
            </div>
            <div className="space-y-1 max-w-md">
              <h3 className="text-base sm:text-lg font-bold text-text-main">
                Choose photo to resize & crop
              </h3>
              <p className="text-xs sm:text-sm text-text-muted">
                Drag and drop an image here or browse from your computer
              </p>
            </div>
            <div className="pt-2">
              <Button
                variant="primary"
                size="md"
                disabled={isImporting}
                onClick={() => fileInputRef.current?.click()}
                leftIcon={isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />}
                className="w-auto px-8 font-semibold shadow-xs"
              >
                {isImporting ? 'Reading Photo...' : 'Choose image'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          STEP 1: PARAMETERS FIRST + PHOTO UPLOAD (Mobile Phone Only)
          (Shown initially or when mobile user taps "Change settings")
      ═══════════════════════════════════════════════════════════════ */}
      {isMobile && (!currentFile || activeStep === 'settings') && !result && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`flex-1 overflow-y-auto px-4 py-4 sm:p-6 w-full transition-colors ${
            isDragOver ? 'bg-surface-subtle ring-2 ring-accent' : 'bg-surface-bg'
          }`}
        >
          <div className="max-w-2xl mx-auto space-y-4 pb-[calc(5rem+var(--safe-area-bottom))] lg:pb-8 animate-in fade-in">
            {/* Card 1: Dimensions & Measurement Unit */}
            <div className="p-4 sm:p-5 rounded-sheet bg-surface-panel border border-surface-border space-y-4 shadow-xs">
              <div className="flex items-center justify-between pb-2 border-b border-surface-border">
                <h3 className="text-sm font-bold text-text-main flex items-center gap-2">
                  <span>Target Dimensions</span>
                </h3>

                {/* Unit Selector: px / cm / in */}
                <div className="flex items-center p-0.5 rounded-control bg-surface-subtle border border-surface-border">
                  {(['px', 'cm', 'in'] as const).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => handleUnitChange(u)}
                      className={`min-h-[32px] px-3 text-xs font-semibold font-mono rounded-control transition-colors cursor-pointer ${
                        unit === u
                          ? 'bg-accent text-accent-contrast shadow-sm'
                          : 'text-text-muted hover:text-text-main'
                      }`}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>

              {/* Width & Height Inputs */}
              <div className="flex items-start gap-3">
                <div className="flex-1 space-y-1">
                  <label className="text-[11px] font-mono text-text-muted uppercase tracking-wider block">
                    Width ({unit})
                  </label>
                  <div className={`flex items-center bg-surface-subtle border ${!isWidthValid ? 'border-status-error' : 'border-surface-border'} rounded-control px-3 min-h-[42px] focus-within:ring-2 focus-within:ring-accent`}>
                    <input
                      type="text"
                      inputMode={unit === 'px' ? 'numeric' : 'decimal'}
                      value={rawWidth}
                      onChange={(e) => handleWidthChange(e.target.value)}
                      className="w-full text-sm font-mono font-bold bg-transparent text-text-main focus:outline-none"
                      placeholder={unit === 'px' ? '1200' : '4.0'}
                      aria-label="Target Width"
                    />
                    <span className="text-xs font-mono font-medium text-text-muted ml-1">
                      {unit}
                    </span>
                  </div>
                  {!isWidthValid && (
                    <p className="text-[10px] text-status-error font-medium">Please enter a valid width</p>
                  )}
                </div>

                <span className="text-text-muted font-bold text-lg pt-4 select-none">&times;</span>

                <div className="flex-1 space-y-1">
                  <label className="text-[11px] font-mono text-text-muted uppercase tracking-wider block">
                    Height ({unit})
                  </label>
                  <div className={`flex items-center bg-surface-subtle border ${!isHeightValid ? 'border-status-error' : 'border-surface-border'} rounded-control px-3 min-h-[42px] focus-within:ring-2 focus-within:ring-accent`}>
                    <input
                      type="text"
                      inputMode={unit === 'px' ? 'numeric' : 'decimal'}
                      value={rawHeight}
                      onChange={(e) => handleHeightChange(e.target.value)}
                      className="w-full text-sm font-mono font-bold bg-transparent text-text-main focus:outline-none"
                      placeholder={unit === 'px' ? '1200' : '4.0'}
                      aria-label="Target Height"
                    />
                    <span className="text-xs font-mono font-medium text-text-muted ml-1">
                      {unit}
                    </span>
                  </div>
                  {!isHeightValid && (
                    <p className="text-[10px] text-status-error font-medium">Please enter a valid height</p>
                  )}
                </div>

                {/* DPI Selector (Only if unit is in or cm) */}
                {(unit === 'in' || unit === 'cm') && (
                  <div className="w-28 space-y-1 shrink-0">
                    <label className="text-[11px] font-mono text-text-muted uppercase tracking-wider block">
                      DPI
                    </label>
                    <div className="grid grid-cols-3 gap-1 p-0.5 bg-surface-subtle border border-surface-border rounded-control">
                      {[150, 300, 600].map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => onOptionsChange({ ...options, dpi: d })}
                          className={`min-h-[38px] text-xs font-semibold font-mono rounded-control transition-colors cursor-pointer ${
                            dpi === d
                              ? 'bg-accent text-accent-contrast shadow-sm'
                              : 'text-text-muted hover:text-text-main'
                          }`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Card 2: Target File Size Range / Limit */}
            <div className="p-4 sm:p-5 rounded-sheet bg-surface-panel border border-surface-border space-y-3.5 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-text-muted" />
                  <h3 className="text-sm font-bold text-text-main">
                    Target File Size
                  </h3>
                </div>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={targetSizeEnabled}
                    onChange={(e) => onOptionsChange({ ...options, targetSizeEnabled: e.target.checked })}
                    className="rounded border-surface-border text-accent accent-accent cursor-pointer"
                  />
                  <span className="text-xs font-medium text-text-main select-none">
                    Limit file size
                  </span>
                </label>
              </div>

              {targetSizeEnabled && (
                <div className="space-y-1 pt-1">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-mono text-text-muted uppercase tracking-wider block">
                        Min Size (KB)
                      </label>
                      <div className={`flex items-center bg-surface-subtle border ${!isMinSizeValid ? 'border-status-error' : 'border-surface-border'} rounded-control px-3 min-h-[42px] focus-within:ring-2 focus-within:ring-accent`}>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={rawMinSizeKB}
                          onChange={(e) => handleMinSizeChange(e.target.value)}
                          className="w-full text-sm font-mono font-bold bg-transparent text-text-main focus:outline-none"
                          placeholder="0"
                          aria-label="Minimum file size in KB"
                        />
                        <span className="text-xs font-mono font-medium text-text-muted ml-1">KB</span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-mono text-text-muted uppercase tracking-wider block">
                        Max Size (KB)
                      </label>
                      <div className={`flex items-center bg-surface-subtle border ${!isMaxSizeValid ? 'border-status-error' : 'border-surface-border'} rounded-control px-3 min-h-[42px] focus-within:ring-2 focus-within:ring-accent`}>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={rawMaxSizeKB}
                          onChange={(e) => handleMaxSizeChange(e.target.value)}
                          className="w-full text-sm font-mono font-bold bg-transparent text-text-main focus:outline-none"
                          placeholder="200"
                          aria-label="Maximum file size in KB"
                        />
                        <span className="text-xs font-mono font-medium text-text-muted ml-1">KB</span>
                      </div>
                    </div>
                  </div>
                  {!isSizeRangeValid && (
                    <p className="text-[10px] text-status-error font-medium">
                      {!isMaxSizeValid
                        ? 'Please enter a valid max size (> 0)'
                        : 'Min size cannot be greater than max size'}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Card 3: Output Format */}
            <div className="p-4 sm:p-5 rounded-sheet bg-surface-panel border border-surface-border space-y-3 shadow-xs">
              <div className="flex items-center gap-2">
                <FileImage className="w-4 h-4 text-text-muted" />
                <h3 className="text-sm font-bold text-text-main">
                  Output Format
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {[
                  { id: 'original', label: 'Same as original' },
                  { id: 'jpeg', label: 'JPG' },
                  { id: 'png', label: 'PNG' },
                  { id: 'webp', label: 'WebP' },
                ].map((fmt) => (
                  <button
                    key={fmt.id}
                    type="button"
                    onClick={() => onOptionsChange({ ...options, outputFormat: fmt.id })}
                    className={`min-h-[34px] px-3 rounded-control text-xs font-mono font-semibold transition-colors cursor-pointer border ${
                      outputFormat === fmt.id
                        ? 'bg-accent text-accent-contrast border-accent shadow-xs'
                        : 'bg-surface-subtle text-text-muted border-surface-border hover:text-text-main'
                    }`}
                  >
                    {fmt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Card 4: Upload Image / Continue to Cropper */}
            <div className="p-5 rounded-sheet bg-surface-panel border border-surface-border space-y-4 shadow-xs">
              {!currentFile ? (
                <div className="text-center py-4 space-y-3">
                  <div className="w-12 h-12 mx-auto rounded-full bg-surface-subtle border border-surface-border flex items-center justify-center text-text-muted">
                    <FolderPlus className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-text-main">
                      Choose photo to resize & crop
                    </h4>
                    <p className="text-xs text-text-muted">
                      Select a photo from your gallery or files
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    size="md"
                    disabled={isImporting}
                    onClick={() => fileInputRef.current?.click()}
                    leftIcon={isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />}
                    className="font-bold shadow-sm"
                  >
                    {isImporting ? 'Reading Photo...' : 'Choose files'}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-surface-border">
                    <span className="text-xs font-semibold text-text-main">
                      Selected Photo
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowClearConfirm(true)}
                      className="text-xs text-status-error hover:underline cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="flex items-center gap-3 p-2.5 rounded-sheet bg-surface-subtle border border-surface-border">
                    {imageUrl && (
                      <img
                        src={imageUrl}
                        alt={currentFile.name}
                        className="w-14 h-14 object-cover rounded-control border border-surface-border shrink-0"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-text-main truncate">
                        {currentFile.name}
                      </p>
                      <p className="text-xs font-mono text-text-muted">
                        {formatBytes(currentFile.size)}
                        {naturalDimensions && (
                          <span> • {naturalDimensions.width} × {naturalDimensions.height} px</span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Actions when photo is already selected */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full text-xs"
                    >
                      Replace photo
                    </Button>

                    <Button
                      variant="primary"
                      size="md"
                      disabled={!canProceed}
                      rightIcon={<ArrowRight className="w-4 h-4" />}
                      onClick={() => setActiveStep('crop')}
                      className="w-full font-bold shadow-sm"
                    >
                      Continue to Crop
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ResizerShowcase;