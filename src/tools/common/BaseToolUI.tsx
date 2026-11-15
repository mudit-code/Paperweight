import React from 'react';
import type { ToolProps } from '../../core/tools/types';
import { Dropzone } from '../../components/ui/Dropzone';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { ResultCard } from '../../components/ui/ResultCard';
import { AlertCircle, X } from 'lucide-react';

export interface BaseToolUIProps extends ToolProps {
  toolName: string;
  tagline: string;
  acceptedMimes: string[];
  maxFiles?: number;
}

export const BaseToolUI: React.FC<BaseToolUIProps> = ({
  toolName,
  tagline,
  acceptedMimes,
  maxFiles = 250,
  files,
  onFilesChange,
  isProcessing,
  progress,
  result,
  onDismissResult,
  error,
  onDismissError,
  sizeEstimate,
  onCancel,
  onViewFile,
}) => {
  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Tool Header */}
      <div className="space-y-1">
        <h1 className="text-lg sm:text-xl font-semibold text-text-main tracking-tight">
          {toolName}
        </h1>
        <p className="text-xs sm:text-sm text-text-muted">{tagline}</p>
      </div>

      {/* Execution Error Banner */}
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
              className="p-1 rounded text-status-error hover:bg-status-error/10 transition-colors"
              aria-label="Dismiss error"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Result Card when batch is finished */}
      {result && onDismissResult && (
        <ResultCard result={result} onDismiss={onDismissResult} />
      )}

      {/* Progress Bar when active */}
      {isProcessing && progress && (
        <ProgressBar progress={progress} onCancel={onCancel} />
      )}

      {/* Universal Dropzone */}
      <Dropzone
        files={files}
        onFilesChange={(newFiles) => {
          if (result && onDismissResult) {
            onDismissResult();
          }
          onFilesChange(newFiles);
        }}
        acceptedMimes={acceptedMimes}
        maxFiles={maxFiles}
        disabled={isProcessing}
        sizeEstimate={sizeEstimate}
        onViewFile={onViewFile}
      />
    </div>
  );
};
