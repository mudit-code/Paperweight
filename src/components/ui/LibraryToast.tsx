import React, { useEffect, useRef } from 'react';
import { X, CheckCircle2 } from 'lucide-react';

export interface LibraryToastProps {
  isOpen: boolean;
  message?: string;
  onUndo: () => void;
  onClose: () => void;
  durationMs?: number;
}

/**
 * Floating confirmation toast with Undo action and dismiss control.
 */
export const LibraryToast: React.FC<LibraryToastProps> = ({
  isOpen,
  message = 'Added to library',
  onUndo,
  onClose,
  durationMs = 5000,
}) => {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      onClose();
    }, durationMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [isOpen, onClose, durationMs]);

  if (!isOpen) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-[calc(4.25rem+var(--safe-area-top))] left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2 rounded-control bg-surface-panel text-text-main shadow-lifted border border-surface-border transition-colors duration-fast ease-out select-none max-w-[92vw] animate-in fade-in slide-in-from-top-2"
    >
      <CheckCircle2 className="w-4 h-4 text-status-success shrink-0" />
      <span className="text-sm font-medium text-text-main whitespace-nowrap truncate">
        {message}
      </span>

      <div className="h-5 w-px bg-surface-border shrink-0" />

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onUndo();
        }}
        className="min-h-[36px] px-3 py-1 rounded-control bg-accent text-accent-contrast hover:bg-accent-hover font-bold text-xs uppercase tracking-wider transition-colors duration-fast ease-out cursor-pointer shrink-0"
        title="Undo and remove from library"
      >
        Undo
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center text-text-muted hover:text-text-main rounded-control hover:bg-surface-subtle transition-colors duration-fast ease-out cursor-pointer shrink-0"
        title="Dismiss"
        aria-label="Dismiss notification"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export default LibraryToast;
