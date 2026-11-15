import React from 'react';
import type { ToolProps } from '../../core/tools/types';
import { PdfToImageShowcase } from './PdfToImageShowcase';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { Badge } from '../../components/ui/Badge';
import { AlertCircle, X, FileText, FileImage } from 'lucide-react';

const PdfToImageTool: React.FC<ToolProps> = ({
  files,
  onFilesChange,
  options,
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
  const currentFormat = ((options.format as string) || 'png').toUpperCase();

  return (
    <div className="flex-1 flex flex-col lg:h-full lg:overflow-hidden">
      {/* Sticky Top Subheader */}
      <div className="shrink-0 z-10 px-4 sm:px-6 lg:px-8 py-3.5 bg-surface-bg border-b border-surface-border">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg sm:text-xl font-semibold text-text-main tracking-tight">
                PDF to Image
              </h1>
              <Badge variant="accent" size="sm">
                CONVERT
              </Badge>
            </div>
            <p className="text-xs text-text-muted">
              Extract and render PDF document pages into high-resolution images completely offline.
            </p>
          </div>

          {/* Format chips */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-mono font-medium rounded-chip bg-surface-subtle text-text-main border border-surface-border">
              <FileText className="w-3.5 h-3.5 text-text-muted" />
              PDF
            </span>
            <span className="text-text-muted text-xs font-mono">&rarr;</span>
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-mono font-medium rounded-chip bg-surface-panel text-text-main border border-surface-border">
              <FileImage className="w-3.5 h-3.5 text-text-muted" />
              {currentFormat}
            </span>
          </div>
        </div>
      </div>

      {/* Scrollable Main Area on desktop lg, natural flow on small spaces */}
      <div className="flex-1 lg:overflow-y-auto px-4 sm:px-6 lg:px-8 py-5 space-y-4">
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

        {/* Progress Bar Overlay (matching Resizer) */}
        {isProcessing && progress && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 select-none animate-in fade-in">
            <div className="w-full max-w-sm p-4 sm:p-5 rounded-sheet bg-surface-panel border border-surface-border shadow-lifted space-y-3">
              <ProgressBar progress={progress} onCancel={onCancel} />
            </div>
          </div>
        )}

        {/* Dedicated PDF to Image Showcase */}
        <PdfToImageShowcase
          files={files}
          onFilesChange={(newFiles) => {
            if (result && onDismissResult) {
              onDismissResult();
            }
            onFilesChange(newFiles);
          }}
          options={options}
          isProcessing={isProcessing}
          result={result}
          onDismissResult={onDismissResult}
          onExecute={onExecute}
          onViewFile={onViewFile}
          onViewImages={onViewImages}
        />
      </div>
    </div>
  );
};

export default PdfToImageTool;
