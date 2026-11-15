import React, { useEffect } from 'react';
import { Trash2, X } from 'lucide-react';
import { Button } from './Button';
import { registerBackHandler } from '../../core/navigation/backButton';

export interface DeleteConfirmModalProps {
  isOpen: boolean;
  title?: string;
  message?: string;
  confirmText?: string;
  itemCount?: number;
  fileName?: string;
  onConfirm: () => void;
  onCancel: () => void;
  className?: string;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText,
  itemCount,
  fileName,
  onConfirm,
  onCancel,
  className = '',
}) => {
  // Mobile hardware back button closes this modal
  useEffect(() => {
    if (!isOpen) return;
    const unregister = registerBackHandler(() => {
      onCancel();
      return true;
    });
    return unregister;
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const isSingular = itemCount === 1 || Boolean(fileName);
  const displayTitle = title || (isSingular ? 'Remove File?' : 'Clear All Files?');
  const displayConfirm = confirmText || (isSingular ? 'Remove' : 'Clear All');

  const defaultMessage = fileName
    ? `Remove "${fileName}" from the workspace?`
    : itemCount !== undefined && itemCount > 1
    ? `Remove all ${itemCount} files from the workspace?`
    : 'Remove this file from the workspace?';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 select-none"
      onClick={onCancel}
    >
      <div
        className={`w-full max-w-sm rounded-sheet bg-surface-panel border border-surface-border shadow-lifted p-5 space-y-4 text-text-main transition-colors duration-fast ease-out ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-control bg-status-error-bg border border-status-error-border text-status-error flex items-center justify-center shrink-0">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h2 id="delete-confirm-title" className="text-md font-bold text-text-main">
                {displayTitle}
              </h2>
              <p className="text-xs text-text-muted mt-0.5">Workspace cleanup</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="min-w-[44px] min-h-[44px] -mr-2 -mt-2 flex items-center justify-center rounded-control text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors duration-fast ease-out cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-text-main leading-relaxed">{message || defaultMessage}</p>

        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <Button type="button" variant="secondary" size="md" onClick={onCancel} className="w-full font-semibold">
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            size="md"
            onClick={onConfirm}
            leftIcon={<Trash2 className="w-4 h-4" />}
            className="w-full font-semibold"
          >
            {displayConfirm}
          </Button>
        </div>
      </div>
    </div>
  );
};
