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
      className={`p-4 rounded-sheet bg-surface-panel border border-surface-border space-y-3 ${className}`}
    >
      <div className="flex items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono font-bold text-xs px-2 py-0.5 rounded-chip bg-accent text-accent-contrast shrink-0">
            {percentage}%
          </span>
          <span className="text-text-main font-semibold text-sm shrink-0">{progress.phase}</span>
          {progress.message && (
            <span className="text-text-muted text-xs truncate">
              {progress.message}
            </span>
          )}
        </div>
        {onCancel && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            leftIcon={<XCircle className="w-4 h-4 text-text-muted" />}
            className="text-text-muted hover:text-status-error shrink-0"
          >
            Cancel
          </Button>
        )}
      </div>

      <div className="h-2 w-full bg-surface-subtle border border-surface-border rounded-control overflow-hidden">
        <div
          className="h-full bg-accent transition-[width] duration-base ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>

      <div className="flex justify-between items-center text-xs text-text-muted font-mono">
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
