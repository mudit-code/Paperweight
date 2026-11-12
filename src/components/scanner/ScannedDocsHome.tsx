import React, { useState, useEffect, useRef } from 'react';
import {
  Share2,
  Edit3,
  Camera,
  Trash2,
  FileText,
  Clock,
  FolderPlus,
  Plus,
} from 'lucide-react';
import { getAllScans, deleteScan, type StoredScanDoc } from '../../tools/scanner/scans-db';
import { PDFDocument } from 'pdf-lib';
import { shareBlob } from '../../core/processors';
import { isMobileApp } from '../../core/processors/download';

export interface ScannedDocsHomeProps {
  onStartNewScan: () => void;
  onModifyScan: (scan: StoredScanDoc) => void;
  onAddFiles?: (files: File[]) => void;
}

export const ScannedDocsHome: React.FC<ScannedDocsHomeProps> = ({
  onStartNewScan,
  onModifyScan,
  onAddFiles,
}) => {
  const [scans, setScans] = useState<StoredScanDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteScanTarget, setDeleteScanTarget] = useState<StoredScanDoc | null>(null);
  const addFilesInputRef = useRef<HTMLInputElement>(null);
  const isMobile = isMobileApp();

  const loadScans = async () => {
    setIsLoading(true);
    try {
      const list = await getAllScans();
      setScans(list);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadScans();
  }, []);

  // Handle Share: generates PDF and shares with Paperweight caption
  const handleShareScan = async (scan: StoredScanDoc) => {
    try {
      const pdfDoc = await PDFDocument.create();

      for (const page of scan.pages) {
        const response = await fetch(page.dataUrl);
        const imgBytes = await response.arrayBuffer();

        const embeddedImg = await pdfDoc.embedJpg(imgBytes).catch(async () => {
          return await pdfDoc.embedPng(imgBytes);
        });

        const pdfPage = pdfDoc.addPage([embeddedImg.width, embeddedImg.height]);
        pdfPage.drawImage(embeddedImg, {
          x: 0,
          y: 0,
          width: embeddedImg.width,
          height: embeddedImg.height,
        });
      }

      const pdfBytes = await pdfDoc.save();
      const pdfBlob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
      const filename = `${scan.title.replace(/\s+/g, '_')}.pdf`;

      await shareBlob(pdfBlob, filename);
    } catch (err) {
      console.error('Error sharing document:', err);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteScanTarget) return;
    await deleteScan(deleteScanTarget.id);
    setScans((prev) => prev.filter((s) => s.id !== deleteScanTarget.id));
    setDeleteScanTarget(null);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selected = Array.from(e.target.files);
      if (onAddFiles) {
        onAddFiles(selected);
      }
    }
    e.target.value = '';
  };

  const handleTriggerAdd = () => {
    if (isMobile) {
      onStartNewScan();
    } else {
      addFilesInputRef.current?.click();
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-surface-bg select-none pb-20">
      {/* Hidden File Input for Desktop Add Files */}
      <input
        ref={addFilesInputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/avif,image/bmp,application/pdf,.pdf"
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* Content Area */}
      <div className="max-w-3xl mx-auto w-full px-4 sm:px-6 py-4 space-y-4">
        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-12 text-xs text-text-muted">
            <span>Loading documents...</span>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && scans.length === 0 && (
          <div className="p-8 sm:p-12 rounded-2xl border-2 border-dashed border-surface-border text-center flex flex-col items-center justify-center space-y-4 bg-surface-subtle/30 my-4">
            <div className="w-14 h-14 rounded-full bg-accent-subtle text-accent flex items-center justify-center">
              {isMobile ? <Camera className="w-7 h-7" /> : <FolderPlus className="w-7 h-7" />}
            </div>
            <div className="space-y-1">
              <h3 className="font-serif font-bold text-base text-text-main">
                No Scanned Documents Yet
              </h3>
              <p className="text-xs text-text-muted max-w-xs mx-auto">
                {isMobile
                  ? 'Capture notes, receipts, and documents with camera scanning and auto-enhance them on device.'
                  : 'Add document images or PDFs to enhance readability, crop, and organize completely offline.'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleTriggerAdd}
              className="py-2.5 px-6 rounded-full bg-accent text-white text-xs font-bold shadow-md hover:bg-accent-hover active:scale-95 transition-all cursor-pointer flex items-center gap-2"
            >
              {isMobile ? (
                <>
                  <Camera className="w-4 h-4" />
                  <span>Start First Scan</span>
                </>
              ) : (
                <>
                  <FolderPlus className="w-4 h-4" />
                  <span>Add Files</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Document Cards List */}
        {!isLoading && scans.length > 0 && (
          <div className="space-y-3">
            {/* Desktop Top Action Header */}
            {!isMobile && (
              <div className="flex items-center justify-between pb-1">
                <span className="text-xs font-mono font-semibold text-text-muted">
                  Saved Documents ({scans.length})
                </span>
                <button
                  type="button"
                  onClick={handleTriggerAdd}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-hover text-xs font-semibold shadow-xs cursor-pointer transition-all active:scale-95"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Files</span>
                </button>
              </div>
            )}

            {scans.map((scan) => {
              const dateStr = new Date(scan.createdAt).toLocaleDateString('en-GB', {
                day: '2-digit',
                month: '2-digit',
                year: '2-digit',
              });

              return (
                <div
                  key={scan.id}
                  className="p-3.5 rounded-2xl border border-surface-border bg-surface-panel shadow-xs hover:border-accent/40 transition-all flex items-start gap-4"
                >
                  {/* Thumbnail on left */}
                  <div
                    onClick={() => onModifyScan(scan)}
                    className="relative w-20 sm:w-24 aspect-[1/1.3] rounded-none overflow-hidden border border-surface-border bg-surface-subtle shrink-0 cursor-pointer group"
                  >
                    {scan.thumbnailUrl ? (
                      <img
                        src={scan.thumbnailUrl}
                        alt={scan.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-text-muted">
                        <FileText className="w-8 h-8 opacity-40" />
                      </div>
                    )}
                    {/* Page Count Badge */}
                    <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/70 text-white font-mono text-[9px] font-semibold backdrop-blur-xs">
                      {scan.pageCount} {scan.pageCount === 1 ? 'P' : 'PP'}
                    </div>
                  </div>

                  {/* Card Content & Exactly 2 Options: Share & Modify Scan */}
                  <div className="flex-1 min-w-0 flex flex-col justify-between self-stretch py-0.5">
                    {/* Title & Date */}
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h3
                          onClick={() => onModifyScan(scan)}
                          className="font-semibold text-sm sm:text-base text-text-main truncate hover:text-accent cursor-pointer"
                        >
                          {scan.title}
                        </h3>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteScanTarget(scan);
                          }}
                          className="text-text-muted hover:text-status-error p-1 rounded transition-colors cursor-pointer shrink-0"
                          title="Delete scan"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-text-muted mt-1">
                        <Clock className="w-3.5 h-3.5 text-text-faint" />
                        <span>{dateStr}</span>
                      </div>
                    </div>

                    {/* Options: Share and Modify scan */}
                    <div className="pt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleShareScan(scan)}
                        className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg border border-surface-border bg-surface-subtle hover:bg-surface-panel hover:border-accent text-xs font-semibold text-text-main active:scale-95 transition-all cursor-pointer"
                      >
                        <Share2 className="w-3.5 h-3.5 text-accent" />
                        <span>Share</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onModifyScan(scan)}
                        className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg border border-accent/40 bg-accent-subtle hover:bg-accent/15 text-xs font-semibold text-accent active:scale-95 transition-all cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Modify scan</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* DELETE SCAN CONFIRMATION WARNING MODAL */}
      {deleteScanTarget && (
        <div className="fixed inset-0 z-60 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-2xl bg-surface-panel border border-surface-border p-5 shadow-2xl text-center space-y-4">
            <div className="space-y-1.5">
              <h3 className="font-serif font-bold text-base sm:text-lg text-text-main">
                Are you sure to delete this scan?
              </h3>
              <p className="text-xs text-text-muted">
                &ldquo;{deleteScanTarget.title}&rdquo; will be permanently removed.
              </p>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteScanTarget(null)}
                className="flex-1 py-2.5 px-4 rounded-xl border border-surface-border bg-surface-subtle hover:bg-surface-panel text-text-main font-semibold text-xs transition-colors cursor-pointer active:scale-95"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="flex-1 py-2.5 px-4 rounded-xl bg-status-error hover:opacity-90 text-white font-semibold text-xs transition-colors cursor-pointer active:scale-95 shadow-md"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
