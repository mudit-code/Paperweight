import React from 'react';
import type { ToolProps } from '../../core/tools/types';
import { CompressorShowcase } from './CompressorShowcase';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { ResultCard } from '../../components/ui/ResultCard';
import { isMobileApp } from '../../core/processors/download';
import {
  AlertCircle,
  X,
  FileText,
  FileImage,
  FileCode,
  ArrowRight,
} from 'lucide-react';

export type CompressorMode = 'pdf' | 'image' | 'doc';

interface DedicatedConfig {
  id: CompressorMode;
  shortLabel: string;
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
    name: 'PDF Compressor',
    tagline: 'Lossless stream packing, metadata stripping, and raster resampling for PDF documents.',
    badge: 'PDF',
    description: 'Optimize PDF documents with object stream packing, metadata cleaning, and optional raster downsampling.',
    acceptedMimes: ['application/pdf', '.pdf'],
    icon: FileText,
  },
  {
    id: 'image',
    shortLabel: 'IMG',
    name: 'Image Compressor',
    tagline: 'Scale dimensions, compress file sizes, and convert between WebP, PNG, and JPEG formats.',
    badge: 'JPG, PNG, WEBP',
    description: 'Downscale dimensions and apply color quantization to photos and graphics with real-time preview.',
    acceptedMimes: ['image/jpeg', 'image/png', 'image/webp', 'image/*'],
    icon: FileImage,
  },
  {
    id: 'doc',
    shortLabel: 'DOC',
    name: 'Document Compressor',
    tagline: 'Word (.docx) optimization with embedded media recompression and maximum DEFLATE packaging.',
    badge: 'DOCX',
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
}) => {
  // Driven directly by options.compressorMode (null = Screen 1 Options Hub, just like Converter)
  const selectedMode = (options.compressorMode as CompressorMode) || null;
  const activeConfig = COMPRESSOR_MODES.find((m) => m.id === selectedMode);
  const isMobile = isMobileApp() || (typeof window !== 'undefined' && window.innerWidth < 768);

  const handleSelectMode = (mode: CompressorMode) => {
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
  };

  return (
    <div className={`flex-1 flex flex-col ${isMobile ? 'h-full overflow-hidden p-2 sm:p-3 pb-[calc(4.5rem+var(--safe-area-bottom))]' : 'lg:h-full lg:overflow-hidden select-none bg-surface-bg'}`}>
      {/* Scrollable Main Area on desktop lg, fitted flex column on mobile */}
      <div className={`flex-1 flex flex-col ${isMobile ? 'min-h-0 overflow-hidden' : 'lg:overflow-y-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4'}`}>
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

        {/* Result Card when compression finishes (Desktop only; mobile shows results in-place) */}
        {!isMobile && result && onDismissResult && (
          <ResultCard result={result} onDismiss={onDismissResult} />
        )}

        {/* Progress Bar when active (Desktop only; on mobile, CompressorShowcase embeds the progress bar replacing the compression level card) */}
        {!isMobile && isProcessing && progress && (
          <ProgressBar progress={progress} onCancel={onCancel} />
        )}

        {/* 1. OPTIONS HUB (When no compressor mode selected yet) */}
        {!selectedMode ? (
          <div className="max-w-4xl mx-auto py-2 animate-in fade-in w-full">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
              {COMPRESSOR_MODES.map((opt) => {
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
                        <span className="font-mono text-[10px] font-semibold px-2 py-0.5 rounded-full bg-surface-subtle text-text-muted border border-surface-border">
                          {opt.badge}
                        </span>
                      </div>
                      <div>
                        <h3 className="font-serif font-bold text-base text-text-main group-hover:text-accent transition-colors">
                          {opt.name}
                        </h3>
                      </div>
                    </div>
                    <div className="pt-2 flex items-center gap-1.5 text-xs font-semibold text-accent group-hover:translate-x-0.5 transition-transform">
                      <span>Open Compressor</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                  </button>
                );
              })}
            </div>
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
            sizeEstimate={sizeEstimate}
            onExecuteBatch={onExecute}
            acceptedMimes={activeConfig?.acceptedMimes}
            maxFiles={250}
            activeMode={selectedMode}
            className={isMobile ? 'flex-1 min-h-0' : ''}
          />
        )}
      </div>
    </div>
  );
};

export default ImageResizerTool;
