import React from 'react';
import type { ToolProps } from '../../core/tools/types';
import { PdfMergeShowcase } from './PdfMergeShowcase';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { ResultCard } from '../../components/ui/ResultCard';
import { Badge } from '../../components/ui/Badge';
import { AlertCircle, X, FileText, FileImage } from 'lucide-react';

const ACCEPTED_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/*',
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
];

const PdfMergeTool: React.FC<ToolProps> = ({
  files,
  onFilesChange,
  isProcessing,
  progress,
  result,
  onDismissResult,
  error,
  onDismissError,
  onExecute,
  onCancel,
  selectedFileId,
  onSelectFile,
}) => {
  return (
    <div className="flex-1 flex flex-col lg:h-full lg:overflow-hidden">
      {/* Sticky Top Subheader */}
      <div className="shrink-0 z-10 px-4 sm:px-6 lg:px-8 py-3.5 bg-surface-bg border-b border-surface-border">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-serif font-bold text-text-main tracking-tight">
                PDF Merger
              </h1>
              <Badge variant="accent" size="sm">
                MERGE
              </Badge>
            </div>
            <p className="text-xs text-text-muted">
              Combine multiple PDF documents & images, rearrange page sequences by dragging, and export a unified document.
            </p>
          </div>

          {/* Format pills */}
          <div className="hidden sm:inline-flex items-center p-1 rounded-full bg-surface-subtle border border-surface-border-subtle shadow-xs shrink-0">
            <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-accent-subtle text-accent border border-accent-border">
              <FileText className="w-3 h-3" />
              PDF
            </span>
            <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-accent-subtle text-accent border border-accent-border ml-1">
              <FileImage className="w-3 h-3" />
              img
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

        {/* Success Result Card */}
        {result && onDismissResult && (
          <ResultCard result={result} onDismiss={onDismissResult} />
        )}

        {/* Progress Bar */}
        {isProcessing && progress && (
          <ProgressBar progress={progress} onCancel={onCancel} />
        )}

        {/* Dedicated PDF & Image Merge Showcase Box */}
        <PdfMergeShowcase
          files={files}
          onFilesChange={(newFiles) => {
            if (result && onDismissResult) {
              onDismissResult();
            }
            onFilesChange(newFiles);
          }}
          isProcessing={isProcessing}
          onExecute={onExecute}
          acceptedMimes={ACCEPTED_MIMES}
          maxFiles={100}
          selectedFileId={selectedFileId}
          onSelectFile={onSelectFile}
        />
      </div>
    </div>
  );
};

export default PdfMergeTool;
