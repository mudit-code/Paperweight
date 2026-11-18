import React from 'react';
import type { ToolProps } from '../../core/tools/types';
import { PdfToImageShowcase } from '../pdf-to-image/PdfToImageShowcase';
import { GenericConverterShowcase } from './GenericConverterShowcase';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { isMobileApp } from '../../core/processors/download';
import { FEATURE_FLAGS } from '../../core/config/feature-flags';
import {
  FileText,
  FileImage,
  FileSpreadsheet,
  Presentation,
  ArrowRightLeft,
  ChevronRight,
  AlertCircle,
  X,
} from 'lucide-react';

export type ConverterMode =
  | 'pdf-to-img'
  | 'img-to-pdf'
  | 'img-to-img'
  | 'word-to-pdf'
  | 'excel-to-pdf'
  | 'ppt-to-pdf';

interface ConverterOptionDef {
  id: ConverterMode;
  title: string;
  shortLabel: string;
  description: string;
  fromFormat: string;
  toFormat: string;
  badge: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor: string;
}

const BASE_CONVERTER_OPTIONS: ConverterOptionDef[] = [
  {
    id: 'pdf-to-img',
    title: 'PDF to Image',
    shortLabel: 'PDF → Image',
    description: 'Extract pages into crisp images',
    fromFormat: 'PDF',
    toFormat: 'Images',
    badge: '.pdf → .png · .jpg · .webp',
    icon: FileText,
    accentColor: 'from-amber-500/10 to-orange-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400',
  },
  {
    id: 'img-to-pdf',
    title: 'Image to PDF',
    shortLabel: 'Image → PDF',
    description: 'Combine photos into a clean PDF',
    fromFormat: 'Images',
    toFormat: 'PDF',
    badge: '.jpg · .png · .webp → .pdf',
    icon: FileImage,
    accentColor: 'from-blue-500/10 to-cyan-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400',
  },
  {
    id: 'img-to-img',
    title: 'Convert Images',
    shortLabel: 'Convert Images',
    description: 'Convert format and dimensions',
    fromFormat: 'Any Image',
    toFormat: 'Any Format',
    badge: '.png · .jpg · .webp · .avif',
    icon: ArrowRightLeft,
    accentColor: 'bg-surface-subtle text-text-muted border-surface-border',
  },
];

const EXPERIMENTAL_OFFICE_OPTIONS: ConverterOptionDef[] = [
  {
    id: 'word-to-pdf',
    title: 'Word to PDF',
    shortLabel: 'Word → PDF',
    description: 'Convert Microsoft Word documents (.docx) into clean, standard PDF documents completely offline.',
    fromFormat: 'DOCX',
    toFormat: 'PDF',
    badge: 'DOCX → PDF',
    icon: FileText,
    accentColor: 'from-indigo-500/10 to-blue-500/10 border-indigo-500/30 text-indigo-600 dark:text-indigo-400',
  },
  {
    id: 'excel-to-pdf',
    title: 'Excel to PDF',
    shortLabel: 'Excel → PDF',
    description: 'Convert Microsoft Excel spreadsheets (.xlsx) into professional, tabular PDF reports with gridlines.',
    fromFormat: 'XLSX',
    toFormat: 'PDF',
    badge: 'XLSX → PDF',
    icon: FileSpreadsheet,
    accentColor: 'from-emerald-500/10 to-teal-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400',
  },
  {
    id: 'ppt-to-pdf',
    title: 'PowerPoint to PDF',
    shortLabel: 'PPT → PDF',
    description: 'Convert Microsoft PowerPoint presentations (.pptx) into landscape presentation PDF slides.',
    fromFormat: 'PPTX',
    toFormat: 'PDF',
    badge: 'PPTX → PDF',
    icon: Presentation,
    accentColor: 'from-rose-500/10 to-orange-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400',
  },
];

export const CONVERTER_OPTIONS: ConverterOptionDef[] = FEATURE_FLAGS.ENABLE_OFFICE_CONVERTER
  ? [...BASE_CONVERTER_OPTIONS, ...EXPERIMENTAL_OFFICE_OPTIONS]
  : BASE_CONVERTER_OPTIONS;

export const ConverterTool: React.FC<ToolProps> = ({
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
  onExecute,
  onCancel,
  onViewFile,
  onViewImages,
}) => {
  // Converter mode driven by options.converterMode.
  // On mobile (< md), null renders the compact hub list; on desktop (>= md), segmented control defaults to 'pdf-to-img' above one large drop zone.
  const isMobile = isMobileApp();
  const selectedMode = (options.converterMode as ConverterMode) || null;
  const activeDesktopMode: ConverterMode = selectedMode || 'pdf-to-img';

  const handleSelectMode = (mode: ConverterMode) => {
    if (mode !== selectedMode) {
      if (onDismissResult) onDismissResult();
      onFilesChange([]);
    }
    if (onOptionsChange) {
      onOptionsChange({
        ...options,
        converterMode: mode,
      });
    }
  };

  const renderShowcaseForMode = (mode: ConverterMode, extraClassName: string = '') =>
    mode === 'pdf-to-img' ? (
      <PdfToImageShowcase
        files={files}
        onFilesChange={onFilesChange}
        options={options}
        isProcessing={isProcessing}
        result={result}
        onDismissResult={onDismissResult}
        onExecute={onExecute}
        onViewFile={onViewFile}
        onViewImages={onViewImages}
        className={extraClassName}
      />
    ) : (
      <GenericConverterShowcase
        mode={mode}
        files={files}
        onFilesChange={onFilesChange}
        options={options}
        isProcessing={isProcessing}
        result={result}
        onDismissResult={onDismissResult}
        onExecute={onExecute}
        onViewFile={onViewFile}
        onViewImages={onViewImages}
        className={extraClassName}
      />
    );

  return (
    <div className={`flex-1 flex flex-col ${isMobile ? `h-full overflow-hidden p-2 sm:p-3 ${selectedMode ? 'pb-1' : 'pb-[calc(4.5rem+var(--safe-area-bottom))]'}` : 'lg:h-full lg:overflow-hidden select-none bg-surface-bg'}`}>
      {/* Scrollable Main Area on desktop lg, fitted flex column on mobile */}
      <div className={`flex-1 flex flex-col ${isMobile ? 'min-h-0 overflow-hidden' : 'lg:overflow-y-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4 min-h-0'}`}>
        {/* Error Alert */}
        {error && (
          <div
            role="alert"
            className="flex items-start justify-between gap-3 p-4 rounded-sheet bg-status-error-bg border border-status-error-border text-status-error"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="text-sm space-y-1">
                <p className="font-semibold">{error.title}</p>
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
                className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-control text-status-error hover:bg-status-error-bg transition-colors cursor-pointer"
                aria-label="Dismiss error"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* Progress Bar Overlay (matching Resizer) */}
        {isProcessing && progress && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 select-none animate-in fade-in">
            <div className="w-full max-w-sm p-4 sm:p-5 rounded-sheet bg-surface-panel border border-surface-border shadow-lifted space-y-3">
              <ProgressBar progress={progress} onCancel={onCancel} />
            </div>
          </div>
        )}

        {/* DESKTOP (>= md): Segmented control centered above large drop zone */}
        <div className="hidden md:flex flex-col gap-4 max-w-5xl mx-auto w-full flex-1 min-h-0">
          <div className="flex items-center justify-center gap-3">
            <div
              role="tablist"
              aria-label="Conversion type"
              className="inline-flex items-center p-1 rounded-control bg-surface-panel border border-surface-border gap-1"
            >
              {CONVERTER_OPTIONS.map((opt) => {
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
                    <span>{opt.title}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {renderShowcaseForMode(activeDesktopMode, 'flex-1 min-h-0')}
        </div>

        {/* MOBILE (< md): Options hub when no mode chosen */}
        <div className={`md:hidden ${selectedMode ? 'flex-1 min-h-0 flex flex-col' : ''}`}>
          {!selectedMode ? (
            <div className="w-full max-w-2xl mx-auto py-2 sm:py-4 flex flex-col gap-3">
              {/* Unified 3-Row Card matching Compress hub */}
              <div className="rounded-sheet border border-surface-border bg-surface-panel divide-y divide-surface-border overflow-hidden shadow-2xs">
                {CONVERTER_OPTIONS.map((opt) => {
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
                          {opt.title}
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
            renderShowcaseForMode(selectedMode, 'flex-1 min-h-0')
          )}
        </div>
      </div>
    </div>
  );
};

export default ConverterTool;
