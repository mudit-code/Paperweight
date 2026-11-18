import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X, Trash2 } from 'lucide-react';
import { Button } from './Button';
import { registerBackHandler } from '../../core/navigation/backButton';

export interface DiscardWarningModalProps {
  isOpen: boolean;
  itemCount?: number;
  actionWording?: string;
  title?: string;
  message?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const DiscardWarningModal: React.FC<DiscardWarningModalProps> = ({
  isOpen,
  itemCount = 0,
  actionWording,
  title = 'Discard in-progress work?',
  message,
  confirmLabel = 'Discard & Leave',
  onConfirm,
  onCancel,
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
  if (typeof document === 'undefined') return null;

  const defaultMessage =
    itemCount > 0
      ? `You have ${itemCount === 1 ? '1 unsaved file' : `${itemCount} unsaved files`}${
          actionWording ? ` in ${actionWording}` : ''
        }. If you leave now, your current work will be lost.`
      : 'A process is currently in progress or unsaved. If you leave now, your current work will be lost.';

  const displayMessage = message || defaultMessage;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="discard-warning-title"
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-3 sm:p-4 bg-black/60 select-none animate-in fade-in duration-150"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md my-auto max-h-[90dvh] overflow-y-auto rounded-sheet bg-surface-panel border border-surface-border shadow-lifted p-5 space-y-4 text-text-main transition-colors duration-fast ease-out"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-control bg-status-error-bg border border-status-error-border text-status-error flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-status-error" />
            </div>
            <div>
              <h2 id="discard-warning-title" className="text-md font-bold text-text-main">
                {title}
              </h2>
              {itemCount > 0 && (
                <p className="text-xs font-mono text-text-muted mt-0.5">
                  {itemCount === 1 ? '1 file' : `${itemCount} files`} active
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="min-w-[44px] min-h-[44px] -mr-2 -mt-2 flex items-center justify-center rounded-control text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors duration-fast ease-out cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-text-main leading-relaxed">
          {displayMessage}
        </p>

        <div className="flex items-center justify-end gap-2.5 pt-2 w-full">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onCancel}
            className="px-4"
          >
            Cancel
          </Button>

          <Button
            type="button"
            variant="danger"
            size="md"
            onClick={onConfirm}
            leftIcon={<Trash2 className="w-4 h-4 shrink-0" />}
            className="px-4"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
};
