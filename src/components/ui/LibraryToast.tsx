import React, { useEffect, useRef } from 'react';
import { X, CheckCircle2 } from 'lucide-react';

export interface LibraryToastProps {
  isOpen: boolean;
  message?: string;
  onUndo: () => void;
  onClose: () => void;
  durationMs?: number; // 5000ms default (5 seconds)
}

/**
 * Gmail-style floating toast notification
 * "Added to library" with a 5-second Undo action and early dismiss cross button.
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
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3.5 px-4 py-2.5 rounded-lg bg-neutral-900/95 dark:bg-neutral-800/95 text-white shadow-2xl border border-neutral-700/80 backdrop-blur-md animate-in fade-in slide-in-from-bottom-4 duration-200 select-none max-w-[92vw]"
    >
      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
      <span className="text-xs sm:text-sm font-medium tracking-tight text-neutral-100 whitespace-nowrap">
        {message}
      </span>

      <div className="h-4 w-px bg-neutral-700 mx-0.5" />

      {/* Gmail-style prominent Undo action */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onUndo();
        }}
        className="text-amber-400 hover:text-amber-300 font-bold text-xs uppercase tracking-wider px-2 py-1 rounded hover:bg-white/10 transition-colors cursor-pointer shrink-0"
        title="Undo and remove from library"
      >
        Undo
      </button>

      {/* Cross (close early) button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="p-1 -mr-1 text-neutral-400 hover:text-white rounded-md hover:bg-white/10 transition-colors cursor-pointer shrink-0"
        title="Dismiss"
        aria-label="Dismiss notification"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export default LibraryToast;
