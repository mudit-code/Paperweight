import React from 'react';
import type { ProgressReport } from '../../core/types';
import { Button } from './Button';
import { XCircle } from 'lucide-react';

export interface ProgressBarProps {
  progress: ProgressReport;
  onCancel?: () => void;
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  progress,
  onCancel,
  className = '',
}) => {
  const percentage = Math.min(100, Math.max(0, Math.round(progress.percentage)));

  return (
    <div
      role="progressbar"
      aria-valuenow={percentage}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={progress.message || `Processing: ${percentage}%`}
      className={`p-4 rounded-lg bg-surface-panel border border-surface-border shadow-panel space-y-3 ${className}`}
    >
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="font-mono font-medium text-accent">{percentage}%</span>
          <span className="text-text-main font-medium">{progress.phase}</span>
          {progress.message && (
            <span className="text-text-muted truncate max-w-[200px] sm:max-w-xs">
              — {progress.message}
            </span>
          )}
        </div>
        {onCancel && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            leftIcon={<XCircle className="w-3.5 h-3.5 text-text-muted" />}
            className="text-xs text-text-muted hover:text-status-error"
          >
            Cancel
          </Button>
        )}
      </div>

      <div className="h-2 w-full bg-surface-subtle rounded-full overflow-hidden relative shadow-inner">
        <div
          className="h-full bg-accent transition-all duration-300 ease-out rounded-full relative overflow-hidden"
          style={{ width: `${percentage}%` }}
        >
          {percentage < 100 && (
            <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
          )}
        </div>
      </div>

      <div className="flex justify-between items-center text-[11px] text-text-faint font-mono">
        <span>
          {typeof progress.current === 'number'
            ? `${
                progress.phase?.toLowerCase().includes('page')
                  ? 'Page '
                  : progress.total > 1 || progress.phase?.toLowerCase().includes('file')
                  ? 'File '
                  : ''
              }${Math.round(progress.current)} of ${Math.round(Number(progress.total))}`
            : `${progress.current} of ${progress.total}`}
        </span>
        {progress.etaSeconds !== undefined && progress.etaSeconds > 0 && (
          <span>~{progress.etaSeconds}s remaining</span>
        )}
      </div>
    </div>
  );
};
