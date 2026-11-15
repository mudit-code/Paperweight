import React from 'react';
import type { ToolProps } from '../../core/tools/types';
import { ResizerShowcase } from './ResizerShowcase';
import { Button } from '../../components/ui/Button';
import { AlertCircle, X, Loader2 } from 'lucide-react';

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
    <div className="flex-1 flex flex-col h-full w-full overflow-hidden select-none bg-surface-bg text-text-main p-0 relative">
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

      {/* Pretty Overlay Progress Bar Modal: Zero displacement of background elements */}
      {isProcessing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-xs p-4 animate-in fade-in select-none">
          <div className="w-full max-w-sm bg-surface-panel border border-surface-border rounded-sheet shadow-2xl p-5 space-y-4">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-accent animate-spin shrink-0" />
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-semibold text-text-main truncate">
                  {progress?.phase || 'Resizing & Cropping'}
                </h4>
                <p className="text-xs text-text-muted truncate">
                  {progress?.message || 'Processing image...'}
                </p>
              </div>
              {progress && progress.percentage > 0 && (
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-chip bg-accent text-accent-contrast shrink-0">
                  {Math.round(progress.percentage)}%
                </span>
              )}
            </div>

            {/* Smooth animated progress line */}
            <div className="w-full h-2 rounded-full bg-surface-subtle overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-300 rounded-full"
                style={{
                  width: `${Math.min(100, Math.max(12, progress ? progress.percentage : 60))}%`,
                }}
              />
            </div>

            {onCancel && (
              <div className="flex justify-end pt-1">
                <Button size="sm" variant="secondary" onClick={onCancel}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Resizer & Cropper Full-Bleed Studio */}
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
