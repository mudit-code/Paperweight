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
        className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet / Modal Container (Emil Kowalski Vaul-style) */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-modal-title"
        className="relative z-10 w-full sm:max-w-md bg-surface-panel border-t sm:border border-surface-border rounded-t-[28px] sm:rounded-2xl p-5 sm:p-6 pb-[max(1.25rem,var(--safe-area-bottom))] pl-[max(1.25rem,var(--safe-area-left))] pr-[max(1.25rem,var(--safe-area-right))] shadow-2xl transition-all duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] animate-in slide-in-from-bottom sm:slide-in-from-bottom-4 overscroll-contain"
      >
        {/* Mobile drag handle */}
        <div className="w-9 h-1 bg-surface-border rounded-full mx-auto mb-3.5 sm:hidden shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-surface-border">
          <div>
            <h3 id="scan-modal-title" className="font-serif font-bold text-base sm:text-lg text-text-main">
              Document Scanner
            </h3>
            <p className="text-xs text-text-muted mt-0.5">
              Capture or import documents for offline enhancement
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer active:scale-95"
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
            className="w-full flex items-center gap-3.5 p-3.5 rounded-2xl border border-accent/30 bg-accent-subtle/50 hover:bg-accent-subtle hover:border-accent text-left transition-all duration-150 active:scale-[0.98] group cursor-pointer"
          >
            <div className="w-11 h-11 rounded-xl bg-accent text-white flex items-center justify-center shrink-0 shadow-sm group-hover:scale-105 transition-transform duration-150">
              <Camera className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-text-main group-hover:text-accent transition-colors">
                  Scan with Camera
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent text-white font-semibold uppercase">
                  Live
                </span>
              </div>
              <p className="text-xs text-text-muted mt-0.5">
                Capture single or multi-page documents directly with camera
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
            className="w-full flex items-center gap-3.5 p-3.5 rounded-2xl border border-surface-border bg-surface-subtle/40 hover:bg-surface-subtle hover:border-surface-border-focus text-left transition-all duration-150 active:scale-[0.98] group cursor-pointer"
          >
            <div className="w-11 h-11 rounded-xl bg-surface-panel border border-surface-border text-accent flex items-center justify-center shrink-0 shadow-2xs group-hover:scale-105 transition-transform duration-150">
              <ImageIcon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-semibold text-sm text-text-main group-hover:text-accent transition-colors">
                Import Photos / Images
              </span>
              <p className="text-xs text-text-muted mt-0.5">
                Select document photos from gallery or files (JPG, PNG, WebP)
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
            className="w-full flex items-center gap-3.5 p-3.5 rounded-2xl border border-surface-border bg-surface-subtle/40 hover:bg-surface-subtle hover:border-surface-border-focus text-left transition-all duration-150 active:scale-[0.98] group cursor-pointer"
          >
            <div className="w-11 h-11 rounded-xl bg-surface-panel border border-surface-border text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 shadow-2xs group-hover:scale-105 transition-transform duration-150">
              <FileText className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-semibold text-sm text-text-main group-hover:text-accent transition-colors">
                Import PDF Document
              </span>
              <p className="text-xs text-text-muted mt-0.5">
                Clean and enhance existing PDF pages with contrast filters
              </p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

