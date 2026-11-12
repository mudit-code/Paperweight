import React from 'react';
import type { ToolProps } from '../../core/tools/types';
import { ResizerShowcase } from './ResizerShowcase';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { AlertCircle, X } from 'lucide-react';

export const ResizerTool: React.FC<ToolProps> = ({
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
  onToggleSidebar,
  onOpenSettings,
}) => {
  return (
    <div className="flex-1 flex flex-col h-full w-full overflow-hidden select-none bg-surface-bg text-text-main p-0">
      {/* Error Alert */}
      {error && (
        <div
          role="alert"
          className="shrink-0 m-2 flex items-start justify-between gap-3 p-3 rounded-xl bg-status-error-bg border border-status-error-border text-status-error animate-in fade-in z-40"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="text-xs">
              <span className="font-semibold">{error.title}: </span>
              <span>{error.message}</span>
              {error.suggestion && (
                <p className="text-text-muted mt-0.5">{error.suggestion}</p>
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
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Progress Bar */}
      {isProcessing && progress && (
        <div className="shrink-0 m-2 z-40">
          <ProgressBar progress={progress} onCancel={onCancel} />
        </div>
      )}

      {/* Resizer & Cropper Full-Bleed Windows Photos Style Gallery Studio */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden w-full h-full">
        <ResizerShowcase
          files={files}
          onFilesChange={onFilesChange}
          options={options}
          onOptionsChange={onOptionsChange}
          isProcessing={isProcessing}
          result={result}
          onDismissResult={onDismissResult}
          onExecute={onExecute}
          onToggleSidebar={onToggleSidebar}
          onOpenSettings={onOpenSettings}
          className="h-full w-full"
        />
      </div>
    </div>
  );
};

export default ResizerTool;
