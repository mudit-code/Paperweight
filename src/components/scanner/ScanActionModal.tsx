import React from 'react';
import { Camera, Image as ImageIcon, FileText, X } from 'lucide-react';

export interface ScanActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCamera: () => void;
  onSelectImages: () => void;
  onSelectPdf: () => void;
}

export const ScanActionModal: React.FC<ScanActionModalProps> = ({
  isOpen,
  onClose,
  onSelectCamera,
  onSelectImages,
  onSelectPdf,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet / Modal Container */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-modal-title"
        className="relative z-10 w-full sm:max-w-md bg-surface-panel border-t sm:border border-surface-border rounded-t-sheet sm:rounded-sheet p-5 sm:p-6 pb-[max(1.25rem,var(--safe-area-bottom))] pl-[max(1.25rem,var(--safe-area-left))] pr-[max(1.25rem,var(--safe-area-right))] shadow-lifted overscroll-contain"
      >
        {/* Mobile drag handle */}
        <div className="w-9 h-1 bg-surface-border rounded-chip mx-auto mb-3.5 sm:hidden shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-surface-border">
          <div>
            <h3 id="scan-modal-title" className="font-semibold text-md text-text-main">
              Document Scanner
            </h3>
            <p className="text-xs text-text-muted mt-0.5">
              Capture or import documents for offline enhancement
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-control text-text-muted hover:text-text-main hover:bg-surface-hover transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action Options */}
        <div className="py-4 space-y-2.5">
          {/* Camera Scan */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onSelectCamera();
            }}
            className="w-full min-h-[56px] flex items-center gap-3.5 p-3.5 rounded-sheet border border-accent bg-surface-subtle hover:bg-surface-hover text-left transition-colors cursor-pointer"
          >
            <div className="w-10 h-10 rounded-control bg-accent text-accent-contrast flex items-center justify-center shrink-0">
              <Camera className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-text-main">
                  Scan with Camera
                </span>
                <span className="text-xs font-mono px-2 py-0.5 rounded-chip bg-accent text-accent-contrast font-semibold uppercase">
                  Live
                </span>
              </div>
              <p className="text-xs text-text-muted mt-0.5">
                Capture single or multi-page documents directly
              </p>
            </div>
          </button>

          {/* Import Images */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onSelectImages();
            }}
            className="w-full min-h-[56px] flex items-center gap-3.5 p-3.5 rounded-sheet border border-surface-border bg-surface-subtle hover:bg-surface-hover text-left transition-colors cursor-pointer"
          >
            <div className="w-10 h-10 rounded-control bg-surface-panel border border-surface-border text-text-main flex items-center justify-center shrink-0">
              <ImageIcon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-semibold text-sm text-text-main">
                Choose Photos / Images
              </span>
              <p className="text-xs text-text-muted mt-0.5">
                Select document photos from device (JPG, PNG, WebP)
              </p>
            </div>
          </button>

          {/* Import PDF */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onSelectPdf();
            }}
            className="w-full min-h-[56px] flex items-center gap-3.5 p-3.5 rounded-sheet border border-surface-border bg-surface-subtle hover:bg-surface-hover text-left transition-colors cursor-pointer"
          >
            <div className="w-10 h-10 rounded-control bg-surface-panel border border-surface-border text-text-main flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-semibold text-sm text-text-main">
                Choose PDF Document
              </span>
              <p className="text-xs text-text-muted mt-0.5">
                Clean and enhance existing PDF pages offline
              </p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

