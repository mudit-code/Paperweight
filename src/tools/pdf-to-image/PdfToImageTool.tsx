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
}) => {
  const currentFormat = ((options.format as string) || 'png').toUpperCase();

  return (
    <div className="flex-1 flex flex-col lg:h-full lg:overflow-hidden">
      {/* Sticky Top Subheader */}
      <div className="shrink-0 z-10 px-4 sm:px-6 lg:px-8 py-3.5 bg-surface-bg border-b border-surface-border">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-serif font-bold text-text-main tracking-tight">
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

          {/* Format pills */}
          <div className="inline-flex items-center p-1 rounded-full bg-surface-subtle border border-surface-border-subtle shadow-xs shrink-0">
            <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-accent-subtle text-accent border border-accent-border">
              <FileText className="w-3 h-3" />
              PDF
            </span>
            <span className="text-text-faint px-1 text-xs">&rarr;</span>
            <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-surface-panel text-text-main border border-surface-border">
              <FileImage className="w-3 h-3" />
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

        {/* Progress Bar */}
        {isProcessing && progress && (
          <ProgressBar progress={progress} onCancel={onCancel} />
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
        />
      </div>
    </div>
  );
};

export default PdfToImageTool;
