import React, { useEffect } from 'react';
import { FolderArchive, X, LogOut } from 'lucide-react';
import { Button } from './Button';
import { registerBackHandler } from '../../core/navigation/backButton';

export interface MoveToLibraryModalProps {
  isOpen: boolean;
  actionWording?: string; // e.g. "resizing", "converting", "compressing", "merging", "scanning"
  itemCount: number;
  onExitAndMove: () => void;
  onExitWithoutSaving: () => void;
  onCancel: () => void;
  // Backward compatibility alias for onExitAndMove
  onMove?: () => void;
}

export const MoveToLibraryModal: React.FC<MoveToLibraryModalProps> = ({
  isOpen,
  actionWording = 'current work',
  itemCount,
  onExitAndMove,
  onExitWithoutSaving,
  onCancel,
  onMove,
}) => {
  // Mobile hardware back button cancels the exit prompt
  useEffect(() => {
    if (!isOpen) return;
    const unregister = registerBackHandler(() => {
      onCancel();
      return true;
    });
    return unregister;
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const countLabel = itemCount === 1 ? '1 unsaved file' : `${itemCount} unsaved files`;
  const handleMove = onExitAndMove || onMove;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-library-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs select-none animate-in fade-in duration-150"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-surface-panel border border-surface-border shadow-2xl p-5 space-y-4 animate-in zoom-in-95 duration-150 text-text-main"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/25 text-accent flex items-center justify-center shrink-0">
              <FolderArchive className="w-5 h-5" />
            </div>
            <div>
              <h2 id="move-library-title" className="text-sm font-semibold font-serif text-text-main">
                Save Work to Drafts?
              </h2>
              <p className="text-[11px] font-mono text-accent font-medium mt-0.5">
                {countLabel} in {actionWording}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer"
            aria-label="Stay in current workspace"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Message */}
        <p className="text-xs sm:text-sm text-text-main leading-relaxed">
          Move your in-progress work to Library Drafts to resume later, or exit without saving?
        </p>

        {/* Action Buttons: Exit & Move vs Exit Without Saving */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="text-xs text-text-muted hover:text-text-main order-3 sm:order-1"
          >
            Cancel
          </Button>

          <button
            type="button"
            onClick={onExitWithoutSaving}
            className="h-8 px-3 text-xs font-semibold rounded-md border border-surface-border bg-surface-subtle hover:bg-surface-hover text-text-muted hover:text-text-main active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-1.5 order-2"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Exit without Saving</span>
          </button>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleMove}
            leftIcon={<FolderArchive className="w-3.5 h-3.5" />}
            className="h-8 px-3 text-xs font-semibold shadow-xs order-1 sm:order-3"
          >
            <span>Exit & Move</span>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default MoveToLibraryModal;
