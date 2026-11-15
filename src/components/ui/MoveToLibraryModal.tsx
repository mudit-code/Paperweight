import React, { useEffect } from 'react';
import { FolderArchive, X, Trash2 } from 'lucide-react';
import { Button } from './Button';
import { registerBackHandler } from '../../core/navigation/backButton';

export interface MoveToLibraryModalProps {
  isOpen: boolean;
  actionWording?: string;
  itemCount: number;
  onExitAndMove: () => void;
  onExitWithoutSaving: () => void;
  onCancel: () => void;
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
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-3 sm:p-4 bg-black/60 select-none"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md my-auto max-h-[90dvh] overflow-y-auto rounded-sheet bg-surface-panel border border-surface-border shadow-lifted p-5 space-y-4 text-text-main transition-colors duration-fast ease-out"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-control bg-surface-subtle border border-surface-border text-text-main flex items-center justify-center shrink-0">
              <FolderArchive className="w-5 h-5" />
            </div>
            <div>
              <h2 id="move-library-title" className="text-md font-bold text-text-main">
                Save Work to Drafts?
              </h2>
              <p className="text-xs font-mono text-text-muted mt-0.5">
                {countLabel} in {actionWording}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="min-w-[44px] min-h-[44px] -mr-2 -mt-2 flex items-center justify-center rounded-control text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors duration-fast ease-out cursor-pointer"
            aria-label="Stay in current workspace"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-text-main leading-relaxed">
          Move your in-progress work to Library Drafts to resume later, or exit without saving?
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 w-full">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onCancel}
            className="w-full justify-center"
          >
            Cancel
          </Button>

          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={onExitWithoutSaving}
            leftIcon={<Trash2 className="w-4 h-4 shrink-0" />}
            className="w-full justify-center"
          >
            Don't Save
          </Button>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleMove}
            leftIcon={<FolderArchive className="w-4 h-4 shrink-0" />}
            className="w-full justify-center"
          >
            Exit &amp; Save
          </Button>
        </div>
      </div>
    </div>
  );
};

export default MoveToLibraryModal;
