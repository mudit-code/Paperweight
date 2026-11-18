import React, { useState, useEffect, useRef } from 'react';
import {
  Share2,
  Edit3,
  Camera,
  Trash2,
  FileText,
  Clock,
  Image,
  Download,
  Loader2,
  FolderPlus,
} from 'lucide-react';
import { getAllScans, deleteScan, type StoredScanDoc } from '../../tools/scanner/scans-db';
import { PDFDocument } from 'pdf-lib';
import { shareBlob, downloadBlob, isMobileApp } from '../../core/processors';
import { Button } from '../ui/Button';

export interface ScannedDocsHomeProps {
  onStartNewScan: () => void;
  onModifyScan: (scan: StoredScanDoc) => void;
  onAddFiles?: (files: File[]) => void | Promise<void>;
  onViewPdf?: (blob: Blob, name: string) => void;
}

export const ScannedDocsHome: React.FC<ScannedDocsHomeProps> = ({
  onStartNewScan,
  onModifyScan,
  onAddFiles,
  onViewPdf,
}) => {
  const [scans, setScans] = useState<StoredScanDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isImportingFiles, setIsImportingFiles] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [loadingPdfScanId, setLoadingPdfScanId] = useState<string | null>(null);
  const [deleteScanTarget, setDeleteScanTarget] = useState<StoredScanDoc | null>(null);
  const addFilesInputRef = useRef<HTMLInputElement>(null);

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

  // Helper: generates PDF blob from stored scan document
  const getScanPdf = async (scan: StoredScanDoc): Promise<{ blob: Blob; filename: string }> => {
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
    const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
    const filename = `${scan.title.replace(/\s+/g, '_')}.pdf`;
    return { blob, filename };
  };

  // Thumbnail Click: Opens PDF in PDF Viewer only
  const handleThumbnailClick = async (scan: StoredScanDoc) => {
    if (onViewPdf) {
      try {
        setLoadingPdfScanId(scan.id);
        const { blob, filename } = await getScanPdf(scan);
        onViewPdf(blob, filename);
      } catch (err) {
        console.error('Error opening scan in PDF viewer:', err);
      } finally {
        setLoadingPdfScanId(null);
      }
    } else {
      onModifyScan(scan);
    }
  };

  // Handle Save
  const handleSaveScan = async (scan: StoredScanDoc) => {
    try {
      const { blob, filename } = await getScanPdf(scan);
      await downloadBlob(blob, filename);
    } catch (err) {
      console.error('Error saving document:', err);
    }
  };

  // Handle Share
  const handleShareScan = async (scan: StoredScanDoc) => {
    try {
      const { blob, filename } = await getScanPdf(scan);
      await shareBlob(blob, filename);
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

  const handleProcessFiles = async (fileList: FileList | File[]) => {
    if (!fileList || fileList.length === 0 || !onAddFiles) return;
    const selected = Array.from(fileList);
    setIsImportingFiles(true);
    try {
      await onAddFiles(selected);
    } finally {
      setIsImportingFiles(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleProcessFiles(e.target.files);
    }
    e.target.value = '';
  };

  const isMobile = isMobileApp();

  return (
    <div className={`flex-1 flex flex-col h-full bg-surface-bg select-none ${
      isMobile
        ? 'overflow-y-auto pb-[calc(5.5rem+var(--safe-area-bottom))]'
        : 'overflow-hidden pb-6'
    }`}>
      {/* Hidden File Input for Gallery / File import */}
      <input
        ref={addFilesInputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/avif,image/bmp,application/pdf,.pdf"
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* Content Area */}
      <div className={`max-w-2xl lg:max-w-5xl mx-auto w-full px-4 sm:px-6 py-4 flex flex-col gap-4 ${
        isMobile ? 'h-auto' : 'flex-1 min-h-0'
      }`}>
        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-12 text-xs text-text-muted">
            <span>Loading documents...</span>
          </div>
        )}

        {!isLoading && (
          <>
            {/* SECTION 1: TOP CARD (Mobile: Scan a doc; Desktop: Import a document) */}
            <div className="shrink-0">
              {isMobileApp() ? (
                <div>
                  <span className="text-[11px] font-mono font-semibold text-text-muted uppercase tracking-wider block mb-2 px-0.5">
                    New Scan
                  </span>
                  <div className="rounded-sheet border border-surface-border bg-surface-panel p-4 sm:p-5 space-y-3.5 shadow-xs">
                    <div className="space-y-1">
                      <h2 className="text-lg sm:text-xl font-bold text-text-main tracking-tight">
                        Scan a document
                      </h2>
                      <p className="text-xs sm:text-sm text-text-muted leading-relaxed">
                        Use the camera, or pick photos from your gallery. Saved as a PDF.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5 pt-1">
                      <Button
                        variant="primary"
                        size="md"
                        onClick={onStartNewScan}
                        leftIcon={<Camera className="w-4 h-4" />}
                        className="w-full font-semibold"
                      >
                        Open camera
                      </Button>

                      <Button
                        variant="secondary"
                        size="md"
                        onClick={() => addFilesInputRef.current?.click()}
                        leftIcon={<Image className="w-4 h-4" />}
                        className="w-full font-semibold"
                      >
                        From gallery
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <span className="text-[11px] font-mono font-semibold text-text-muted uppercase tracking-wider block mb-2 px-0.5">
                    New PDF
                  </span>
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDragOver(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDragOver(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDragOver(false);
                      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        handleProcessFiles(e.dataTransfer.files);
                      }
                    }}
                    className={`rounded-sheet border transition-all duration-150 p-5 sm:p-6 space-y-3.5 shadow-xs text-center flex flex-col items-center ${
                      isDragOver
                        ? 'border-accent bg-surface-hover shadow-lifted'
                        : 'border-surface-border bg-surface-panel'
                    }`}
                  >
                    {isImportingFiles ? (
                      <div className="py-4 flex flex-col items-center justify-center space-y-2.5 animate-in fade-in duration-150">
                        <Loader2 className="w-8 h-8 text-accent animate-spin" />
                        <p className="text-sm font-semibold text-text-main">Reading and organizing document...</p>
                        <p className="text-xs text-text-muted">Extracting pages on this device</p>
                      </div>
                    ) : (
                      <>
                        <div className="space-y-1 max-w-md">
                          <h2 className="text-lg sm:text-xl font-bold text-text-main tracking-tight">
                            Import a document
                          </h2>
                          <p className="text-xs sm:text-sm text-text-muted leading-relaxed">
                            Pick photos or document files from your computer to create and organize a clean PDF.
                          </p>
                        </div>

                        <div className="pt-1">
                          <Button
                            variant="primary"
                            size="md"
                            onClick={() => addFilesInputRef.current?.click()}
                            leftIcon={<FolderPlus className="w-4 h-4" />}
                            className="w-auto px-8 font-semibold shadow-xs"
                          >
                            Add files
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* SECTION 2: RECENT SCANS (Fills remaining height on desktop; scrolls naturally on mobile) */}
            <div className={`w-full ${isMobile ? 'flex flex-col' : 'flex-1 min-h-0 flex flex-col'}`}>
              <div className="flex items-center justify-between mb-2 px-0.5 shrink-0">
                <span className="text-[11px] font-mono font-semibold text-text-muted uppercase tracking-wider">
                  Recent {scans.length > 0 && `(${scans.length})`}
                </span>
              </div>

              {scans.length === 0 ? (
                <div className={`${isMobile ? 'py-8' : 'flex-1'} w-full rounded-sheet border border-surface-border bg-surface-panel p-6 sm:p-8 text-center text-xs sm:text-sm text-text-muted flex items-center justify-center shadow-xs`}>
                  <p>Nothing scanned yet. Your scans will appear here.</p>
                </div>
              ) : (
                <div className={`grid grid-cols-1 md:grid-cols-2 gap-3 space-y-0 items-start content-start auto-rows-max ${
                  isMobile ? '' : 'overflow-y-auto pr-1 flex-1 min-h-0'
                }`}>

            {scans.map((scan) => {
              const scanDate = new Date(scan.createdAt);
              const dateStr = scanDate.toLocaleDateString('en-GB', {
                day: '2-digit',
                month: '2-digit',
                year: '2-digit',
              });
              const timeStr = scanDate.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div
                  key={scan.id}
                  className="paper-sheet p-3.5 transition-colors flex items-start gap-4 h-auto"
                >
                  {/* Thumbnail on left: click opens in PDF viewer directly */}
                  <div
                    onClick={() => handleThumbnailClick(scan)}
                    className="relative w-20 sm:w-24 aspect-[1/1.3] rounded-none overflow-hidden border border-surface-border bg-surface-subtle shrink-0 cursor-pointer group hover:border-accent transition-colors"
                    title="Click to view PDF"
                  >
                    {loadingPdfScanId === scan.id ? (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-accent text-xs">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span className="text-[10px] font-mono">Opening...</span>
                      </div>
                    ) : scan.thumbnailUrl ? (
                      <img
                        src={scan.thumbnailUrl}
                        alt={scan.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-text-muted">
                        <FileText className="w-7 h-7" />
                      </div>
                    )}
                    {/* Page Count Badge */}
                    <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-chip bg-surface-panel text-text-main border border-surface-border shadow-xs font-mono text-xs font-medium">
                      {scan.pageCount} {scan.pageCount === 1 ? 'P' : 'PP'}
                    </div>
                  </div>

                  {/* Card Content & 3 Actions: Edit, Save, Share */}
                  <div className="flex-1 min-w-0 flex flex-col justify-between min-h-[96px] py-0.5 pr-1">
                    {/* Title & Date */}
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h3
                          onClick={() => onModifyScan(scan)}
                          className="font-semibold text-sm sm:text-md text-text-main truncate hover:text-accent cursor-pointer"
                        >
                          {scan.title}
                        </h3>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteScanTarget(scan);
                          }}
                          className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-text-muted hover:text-status-error rounded-control transition-colors cursor-pointer shrink-0"
                          title="Delete scan"
                          aria-label={`Delete ${scan.title}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs font-mono text-text-muted mt-1">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{dateStr}</span>
                        <span className="text-text-muted/60">•</span>
                        <span>{timeStr}</span>
                      </div>
                    </div>

                    {/* Options: 1. Edit, 2. Save, 3. Share in that order */}
                    <div className="pt-2.5 flex items-center gap-1.5 sm:gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => onModifyScan(scan)}
                        className="min-h-[38px] h-9 flex items-center gap-1.5 px-3 rounded-control bg-accent hover:bg-accent-hover text-xs font-semibold text-accent-contrast transition-colors cursor-pointer shadow-2xs"
                        title="Edit scan"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSaveScan(scan)}
                        className="min-h-[38px] h-9 flex items-center gap-1.5 px-3 rounded-control border border-surface-border bg-surface-subtle hover:bg-surface-hover text-xs font-semibold text-text-main transition-colors cursor-pointer"
                        title="Save PDF to device"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Save</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleShareScan(scan)}
                        className="min-h-[38px] h-9 flex items-center gap-1.5 px-3 rounded-control border border-surface-border bg-surface-subtle hover:bg-surface-hover text-xs font-semibold text-text-main transition-colors cursor-pointer"
                        title="Share PDF"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span>Share</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  )}
</div>

      {/* DELETE SCAN CONFIRMATION WARNING MODAL */}
      {deleteScanTarget && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-sheet bg-surface-panel border border-surface-border p-5 shadow-lifted text-center space-y-4"
          >
            <div className="space-y-1.5">
              <h3 className="font-semibold text-md text-text-main">
                Delete this scan?
              </h3>
              <p className="text-sm text-text-muted">
                &ldquo;{deleteScanTarget.title}&rdquo; will be permanently removed.
              </p>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteScanTarget(null)}
                className="flex-1 min-h-[44px] px-4 rounded-control border border-surface-border bg-surface-subtle hover:bg-surface-hover text-text-main font-semibold text-sm transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="flex-1 min-h-[44px] px-4 rounded-control bg-status-error hover:opacity-90 text-white font-semibold text-sm transition-colors cursor-pointer"
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
