import React, { useState } from 'react';
import type { ToolProps } from '../../core/tools/types';
import { CompressorShowcase } from './CompressorShowcase';
import { DiscardWarningModal } from '../../components/ui/DiscardWarningModal';
import { isMobileApp } from '../../core/processors/download';
import {
  AlertCircle,
  X,
  FileText,
  FileImage,
  FileCode,
  ChevronRight,
} from 'lucide-react';

export type CompressorMode = 'pdf' | 'image' | 'doc';

interface DedicatedConfig {
  id: CompressorMode;
  shortLabel: string;
  compactTitle: string;
  name: string;
  tagline: string;
  badge: string;
  description: string;
  acceptedMimes: string[];
  icon: React.ComponentType<{ className?: string }>;
}

export const COMPRESSOR_MODES: DedicatedConfig[] = [
  {
    id: 'pdf',
    shortLabel: 'PDF',
    compactTitle: 'PDF',
    name: 'PDF Compressor',
    tagline: 'Shrink PDFs, many at once',
    badge: '.pdf',
    description: 'Optimize PDF documents with object stream packing, metadata cleaning, and optional raster downsampling.',
    acceptedMimes: ['application/pdf', '.pdf'],
    icon: FileText,
  },
  {
    id: 'image',
    shortLabel: 'IMG',
    compactTitle: 'Images',
    name: 'Image Compressor',
    tagline: 'Shrink photos and screenshots',
    badge: '.jpg · .png · .webp',
    description: 'Downscale dimensions and apply color quantization to photos and graphics with real-time preview.',
    acceptedMimes: ['image/jpeg', 'image/png', 'image/webp', 'image/*'],
    icon: FileImage,
  },
  {
    id: 'doc',
    shortLabel: 'DOC',
    compactTitle: 'Documents',
    name: 'Document Compressor',
    tagline: 'Shrink Word files',
    badge: '.docx',
    description: 'Unpack Word archives, compress embedded screenshots and photos, and repack with Level 9 DEFLATE.',
    acceptedMimes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      '.docx',
      '.doc',
    ],
    icon: FileCode,
  },
];

const ImageResizerTool: React.FC<ToolProps> = ({
  files,
  onFilesChange,
  options,
  onOptionsChange,
  isProcessing,
  progress,
  result,
  onDismissResult,
  error,
  onDismissError,
  sizeEstimate,
  onExecute,
  onCancel,
  onViewImages,
  onViewFile,
}) => {
  // Driven directly by options.compressorMode (null = Screen 1 Options Hub on mobile; desktop has segmented tabs)
  const selectedMode = (options.compressorMode as CompressorMode) || null;
  const activeDesktopMode: CompressorMode = selectedMode || 'pdf';
  const activeConfig = COMPRESSOR_MODES.find((m) => m.id === (isMobileApp() ? selectedMode : activeDesktopMode));
  const isMobile = isMobileApp() || (typeof window !== 'undefined' && window.innerWidth < 768);
  const [pendingSwitchMode, setPendingSwitchMode] = useState<CompressorMode | null>(null);

  const applyModeSwitch = (mode: CompressorMode) => {
    if (result && onDismissResult) {
      onDismissResult();
    }
    onFilesChange([]);

    onOptionsChange({
      ...options,
      compressorMode: mode,
      compressionPreset: 'balanced',
      compressionLevel: 40,
      maxDimension: 'original',
    });
    setPendingSwitchMode(null);
  };

  const handleSelectMode = (mode: CompressorMode) => {
    if (selectedMode !== null && mode === selectedMode) return;
    if (!isMobile && mode === activeDesktopMode) return;

    if (files.length > 0 && !result) {
      setPendingSwitchMode(mode);
      return;
    }

    applyModeSwitch(mode);
  };

  return (
    <div className={`flex-1 flex flex-col ${isMobile ? 'h-full overflow-hidden p-2 sm:p-3 pb-[calc(4.5rem+var(--safe-area-bottom))]' : 'lg:h-full lg:overflow-hidden select-none bg-surface-bg'}`}>
      {/* Discard Warning Modal on Tab Switching */}
      <DiscardWarningModal
        isOpen={Boolean(pendingSwitchMode)}
        actionWording="compressor"
        itemCount={files.length}
        confirmLabel="Discard & Switch"
        onCancel={() => setPendingSwitchMode(null)}
        onConfirm={() => {
          if (pendingSwitchMode) applyModeSwitch(pendingSwitchMode);
        }}
      />

      {/* Scrollable Main Area on desktop lg, fitted flex column on mobile */}
      <div className={`flex-1 flex flex-col ${isMobile ? 'min-h-0 overflow-hidden' : 'lg:overflow-y-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4 min-h-0'}`}>
        {/* Execution Error Banner */}
        {error && (
          <div
            role="alert"
            className="flex items-start justify-between gap-3 p-4 rounded-xl bg-status-error-bg border border-status-error-border text-status-error animate-in fade-in shrink-0"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <p className="font-semibold text-sm">{error.title}</p>
                <p className="text-text-main">{error.message}</p>
                {error.suggestion && (
                  <p className="text-text-muted mt-1">{error.suggestion}</p>
                )}
              </div>
            </div>
            {onDismissError && (
              <button
                type="button"
                onClick={onDismissError}
                className="p-1 rounded text-status-error hover:bg-status-error/10 transition-colors"
                aria-label="Dismiss error"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* DESKTOP (>= md): Segmented control tabs centered above large showcase */}
        <div className="hidden md:flex flex-col gap-4 max-w-5xl mx-auto w-full flex-1 min-h-0">
          <div className="flex items-center justify-center gap-3">
            <div
              role="tablist"
              aria-label="Compressor type"
              className="inline-flex items-center p-1 rounded-control bg-surface-panel border border-surface-border gap-1"
            >
              {COMPRESSOR_MODES.map((opt) => {
                const isActive = activeDesktopMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => handleSelectMode(opt.id)}
                    className={`min-h-[40px] px-4 rounded-control text-sm font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center gap-2 ${
                      isActive
                        ? 'bg-accent text-accent-contrast font-semibold'
                        : 'text-text-muted hover:text-text-main hover:bg-surface-hover'
                    }`}
                  >
                    <span>{opt.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <CompressorShowcase
            files={files}
            onFilesChange={onFilesChange}
            options={options}
            onOptionsChange={onOptionsChange}
            isProcessing={isProcessing}
            progress={progress}
            onCancel={onCancel}
            result={result}
            onDismissResult={onDismissResult}
            sizeEstimate={sizeEstimate}
            onExecuteBatch={onExecute}
            onViewImages={onViewImages}
            onViewFile={onViewFile}
            acceptedMimes={COMPRESSOR_MODES.find((m) => m.id === activeDesktopMode)?.acceptedMimes}
            maxFiles={250}
            activeMode={activeDesktopMode}
            className="flex-1 min-h-0"
          />
        </div>

        {/* MOBILE (< md): Options Hub or Dedicated Module */}
        <div className={`md:hidden ${selectedMode ? 'flex-1 min-h-0 flex flex-col' : ''}`}>
          {!selectedMode ? (
            <div className="w-full max-w-2xl mx-auto py-2 sm:py-4 flex flex-col gap-3">
              {/* Unified 3-Row Card */}
              <div className="rounded-sheet border border-surface-border bg-surface-panel divide-y divide-surface-border overflow-hidden shadow-2xs">
                {COMPRESSOR_MODES.map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSelectMode(opt.id)}
                      className="hub-option-row w-full p-4 flex items-center gap-4 text-left cursor-pointer group"
                    >
                      {/* Left: Rounded square icon */}
                      <div className="w-12 h-12 rounded-control bg-surface-subtle border border-surface-border/60 flex items-center justify-center shrink-0 text-text-main transition-colors">
                        <Icon className="w-6 h-6" />
                      </div>

                      {/* Middle: Title and Format Badge */}
                      <div className="flex-1 min-w-0">
                        <span className="text-base font-bold text-text-main block">
                          {opt.compactTitle}
                        </span>
                        <span className="font-mono text-xs text-text-muted mt-0.5 inline-block">
                          {opt.badge}
                        </span>
                      </div>

                      {/* Right: Chevron */}
                      <ChevronRight className="w-5 h-5 text-text-muted shrink-0 group-hover:text-text-main group-hover:translate-x-0.5 transition-all" />
                    </button>
                  );
                })}
              </div>

              {/* Bottom Centered Privacy Note */}
              <p className="text-center text-xs text-text-muted pt-1">
                Processed on this device. Nothing is uploaded.
              </p>
            </div>
          ) : (
            /* 2. DEDICATED COMPRESSOR MODULE (No duplicate header/tagline block) */
            <CompressorShowcase
              files={files}
              onFilesChange={onFilesChange}
              options={options}
              onOptionsChange={onOptionsChange}
              isProcessing={isProcessing}
              progress={progress}
              onCancel={onCancel}
              result={result}
              onDismissResult={onDismissResult}
              sizeEstimate={sizeEstimate}
              onExecuteBatch={onExecute}
              onViewImages={onViewImages}
              onViewFile={onViewFile}
              acceptedMimes={activeConfig?.acceptedMimes}
              maxFiles={250}
              activeMode={selectedMode}
              className="flex-1 min-h-0"
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default ImageResizerTool;
