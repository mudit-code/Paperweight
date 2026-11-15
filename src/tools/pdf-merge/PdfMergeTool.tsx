import React from 'react';
import type { ToolProps } from '../../core/tools/types';
import { PdfMergeShowcase } from './PdfMergeShowcase';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { isMobileApp } from '../../core/processors/download';
import { AlertCircle, X } from 'lucide-react';

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
  selectedFileId,
  onSelectFile,
  onViewFile,
}) => {
  const isMobile = isMobileApp() || (typeof window !== 'undefined' && window.innerWidth < 768);

  return (
    <div className={`flex-1 flex flex-col ${isMobile ? 'min-h-0 overflow-y-auto p-2 sm:p-3 pb-[calc(5rem+var(--safe-area-bottom))]' : 'lg:h-full lg:overflow-hidden select-none bg-surface-bg'}`}>
      {/* Main Area: smoothly scrollable on mobile, flex-1 on desktop */}
      <div className={`flex-1 flex flex-col ${isMobile ? 'min-h-0' : 'lg:overflow-y-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4 min-h-0'}`}>
        {/* Error Alert */}
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

        {/* Dedicated PDF & Image Merge Showcase Box */}
        <PdfMergeShowcase
          files={files}
          onFilesChange={(newFiles) => {
            if (result && onDismissResult) {
              onDismissResult();
            }
            onFilesChange(newFiles);
          }}
          options={options}
          onOptionsChange={onOptionsChange}
          isProcessing={isProcessing}
          result={result}
          onDismissResult={onDismissResult}
          onExecute={onExecute}
          acceptedMimes={ACCEPTED_MIMES}
          maxFiles={100}
          selectedFileId={selectedFileId}
          onSelectFile={onSelectFile}
          onViewFile={onViewFile}
          className={isMobile ? 'flex-1 min-h-0' : ''}
        />
      </div>
    </div>
  );
};

export default PdfMergeTool;
