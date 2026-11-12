import React from 'react';
import type { ToolProps } from '../../core/tools/types';
import { PdfToImageShowcase } from '../pdf-to-image/PdfToImageShowcase';
import { GenericConverterShowcase } from './GenericConverterShowcase';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { FEATURE_FLAGS } from '../../core/config/feature-flags';
import {
  FileText,
  FileImage,
  FileSpreadsheet,
  Presentation,
  ArrowRightLeft,
  ArrowRight,
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
    description: 'Extract and render PDF document pages into crisp PNG, JPEG, WebP, AVIF, TIFF, or BMP images.',
    fromFormat: 'PDF',
    toFormat: 'Images',
    badge: 'PDF → IMG',
    icon: FileText,
    accentColor: 'from-amber-500/10 to-orange-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400',
  },
  {
    id: 'img-to-pdf',
    title: 'Image to PDF',
    shortLabel: 'Image → PDF',
    description: 'Combine single or batch images (JPG, PNG, WebP) into a standardized, crisp PDF document.',
    fromFormat: 'Images',
    toFormat: 'PDF',
    badge: 'IMG → PDF',
    icon: FileImage,
    accentColor: 'from-blue-500/10 to-cyan-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400',
  },
  {
    id: 'img-to-img',
    title: 'Image to Image',
    shortLabel: 'Image → Any',
    description: 'Convert images to any image type: PNG, JPEG, WebP, AVIF, BMP, or TIFF with custom quality.',
    fromFormat: 'Any Image',
    toFormat: 'Any Format',
    badge: 'IMG → IMG',
    icon: ArrowRightLeft,
    accentColor: 'from-purple-500/10 to-pink-500/10 border-purple-500/30 text-purple-600 dark:text-purple-400',
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
}) => {
  // Converter mode directly driven by options.converterMode (null = Screen 1 Options Hub)
  const selectedMode = (options.converterMode as ConverterMode) || null;

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

  return (
    <div className="flex-1 flex flex-col lg:h-full lg:overflow-hidden select-none">
      {/* Scrollable Main Area on desktop lg, natural flow on small spaces */}
      <div className="flex-1 lg:overflow-y-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
        {/* Error Alert */}
        {error && (
          <div
            role="alert"
            className="flex items-start justify-between gap-3 p-4 rounded-xl bg-status-error-bg border border-status-error-border text-status-error animate-in fade-in"
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
                className="p-1 rounded text-status-error hover:bg-status-error/10 transition-colors cursor-pointer"
                aria-label="Dismiss error"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* Progress Bar */}
        {isProcessing && progress && (
          <ProgressBar progress={progress} onCancel={onCancel} />
        )}

        {/* 1. CENTER OPTIONS HUB (Clean Grid of Conversion Tools) */}
        {!selectedMode && (
          <div className="max-w-5xl mx-auto py-2 animate-in fade-in">
            {/* Grid of the 6 options in the center */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
              {CONVERTER_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSelectMode(opt.id)}
                    className="group text-left p-5 rounded-2xl bg-surface-panel border border-surface-border hover:border-accent hover:shadow-md transition-all duration-200 flex flex-col justify-between space-y-4 cursor-pointer relative overflow-hidden"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="w-12 h-12 rounded-xl bg-accent-subtle/80 border border-accent/20 flex items-center justify-center text-accent group-hover:scale-105 transition-transform">
                          <Icon className="w-6 h-6" />
                        </div>
                        <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full bg-surface-subtle text-text-muted border border-surface-border-subtle group-hover:border-accent/40 group-hover:text-accent transition-colors">
                          {opt.badge}
                        </span>
                      </div>

                      <div>
                        <h3 className="font-serif font-bold text-base text-text-main group-hover:text-accent transition-colors flex items-center gap-1.5">
                          {opt.title}
                          <ArrowRight className="w-3.5 h-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-accent" />
                        </h3>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-surface-border-subtle flex items-center justify-between text-[11px] font-mono text-text-faint">
                      <span>{opt.fromFormat}</span>
                      <span>&rarr;</span>
                      <span className="font-semibold text-text-main">{opt.toFormat}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 2. DEDICATED CONVERTER PANEL (When an option is open) */}
        {selectedMode && (
          <div className="animate-in fade-in">
            {selectedMode === 'pdf-to-img' ? (
              <PdfToImageShowcase
                files={files}
                onFilesChange={onFilesChange}
                options={options}
                isProcessing={isProcessing}
                result={result}
                onDismissResult={onDismissResult}
                onExecute={onExecute}
              />
            ) : (
              <GenericConverterShowcase
                mode={selectedMode}
                files={files}
                onFilesChange={onFilesChange}
                options={options}
                isProcessing={isProcessing}
                result={result}
                onDismissResult={onDismissResult}
                onExecute={onExecute}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ConverterTool;
