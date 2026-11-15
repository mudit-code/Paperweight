import React, { useRef, useState, useEffect } from 'react';
import {
  Camera,
  FolderPlus,
  Trash2,
  ArrowLeft,
  ArrowRight,
  FileText,
  FileImage,
  CheckCircle2,
  Save,
  Plus,
  Sparkles,
  Crop,
} from 'lucide-react';
import type { ProcessedFile } from '../../core/types';
import type { BatchResult } from '../../core/processors/types';
import { formatBytes } from '../../core/files/validation';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { downloadBlob, saveMultipleBlobs, isMobileApp } from '../../core/processors';
import { CameraViewfinder, type CapturedScanItem } from './CameraViewfinder';
import { DocumentEditorModal } from './DocumentEditorModal';

export interface ScannerStudioProps {
  files: ProcessedFile[];
  onFilesChange: (files: ProcessedFile[]) => void;
  options: Record<string, unknown>;
  onOptionsChange: (options: Record<string, unknown>) => void;
  isProcessing: boolean;
  result?: BatchResult | null;
  onDismissResult?: () => void;
  onExecute: () => void;
  className?: string;
}

export const ScannerStudio: React.FC<ScannerStudioProps> = ({
  files,
  onFilesChange,
  options,
  onOptionsChange,
  isProcessing,
  result,
  onDismissResult,
  onExecute,
  className = '',
}) => {
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [capturedRawFiles, setCapturedRawFiles] = useState<File[]>([]);
  const [capturedScanItems, setCapturedScanItems] = useState<CapturedScanItem[]>([]);
  const [retakeIndex, setRetakeIndex] = useState<number | null>(null);

  const [isDragOver, setIsDragOver] = useState(false);
  const isMobile = isMobileApp();
  const [isSavingResult, setIsSavingResult] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const activeFilter = (options.filter as string) || 'bw';
  const outputMode = (options.outputMode as string) || 'pdf';

  // Listen for autoOpenCamera trigger
  useEffect(() => {
    if (options.autoOpenCamera) {
      if (isMobile) {
        setIsCameraOpen(true);
      } else {
        fileInputRef.current?.click();
      }
      onOptionsChange({ ...options, autoOpenCamera: false });
    }
  }, [options.autoOpenCamera, isMobile]);

  const handleFilterChange = (filter: string) => {
    onOptionsChange({ ...options, filter });
  };

  const handleOutputModeChange = (mode: string) => {
    onOptionsChange({ ...options, outputMode: mode });
  };

  // Handle camera captured files (forwards directly to Screen 2 editor)
  const handleCameraCapture = async (newFiles: File[], newItems?: CapturedScanItem[]) => {
    let updatedRaw: File[] = [];
    let updatedItems: CapturedScanItem[] = [];

    if (retakeIndex !== null) {
      updatedRaw = [...capturedRawFiles];
      updatedItems = [...capturedScanItems];
      if (newFiles[0]) {
        updatedRaw[retakeIndex] = newFiles[0];
      }
      if (newItems && newItems[0]) {
        updatedItems[retakeIndex] = newItems[0];
      }
      setRetakeIndex(null);
    } else {
      updatedRaw = [...capturedRawFiles, ...newFiles];
      if (newItems && newItems.length > 0) {
        updatedItems = [...capturedScanItems, ...newItems];
      } else {
        const fallbacks: CapturedScanItem[] = newFiles.map((f) => {
          const u = URL.createObjectURL(f);
          return {
            file: f,
            rawUrl: u,
            displayUrl: u,
          };
        });
        updatedItems = [...capturedScanItems, ...fallbacks];
      }
    }
    setCapturedRawFiles(updatedRaw);
    setCapturedScanItems(updatedItems);

    const newItemsList: ProcessedFile[] = await Promise.all(
      updatedRaw.map(async (file, idx) => {
        const buffer = await file.arrayBuffer();
        const previewUrl = updatedItems[idx]?.displayUrl || URL.createObjectURL(file);
        return {
          id: `scan_${Date.now()}_${idx}`,
          name: file.name,
          size: file.size,
          type: file.type || 'image/jpeg',
          lastModified: file.lastModified,
          data: buffer,
          previewUrl,
        };
      })
    );
    onFilesChange(newItemsList);

    // Forward immediately to Screen 2 (Document Editor)
    setIsCameraOpen(false);
    setIsEditorOpen(true);
  };

  // Handle incoming file uploads
  const handleImportFiles = async (rawFiles: FileList | File[]) => {
    const list = Array.from(rawFiles);
    if (list.length === 0) return;

    const importedItems: CapturedScanItem[] = list.map((file) => {
      const url = URL.createObjectURL(file);
      return {
        file,
        rawUrl: url,
        displayUrl: url,
        cropCorners: {
          topLeft: { x: 0.05, y: 0.05 },
          topRight: { x: 0.95, y: 0.05 },
          bottomRight: { x: 0.95, y: 0.95 },
          bottomLeft: { x: 0.05, y: 0.95 },
        },
      };
    });

    setCapturedRawFiles((prev) => [...prev, ...list]);
    setCapturedScanItems((prev) => [...prev, ...importedItems]);

    const newItems: ProcessedFile[] = await Promise.all(
      list.map(async (file, idx) => {
        const buffer = await file.arrayBuffer();
        let previewUrl: string | undefined = undefined;
        if (file.type.startsWith('image/')) {
          previewUrl = URL.createObjectURL(new Blob([buffer], { type: file.type }));
        }
        return {
          id: `file_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 7)}`,
          name: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream',
          lastModified: file.lastModified,
          data: buffer,
          previewUrl,
        };
      })
    );

    onFilesChange([...files, ...newItems]);
  };

  // Page reordering and rotation actions
  const handleMovePage = (index: number, direction: 'prev' | 'next') => {
    const targetIndex = direction === 'prev' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= files.length) return;
    const updated = Array.from(files);
    const [moved] = updated.splice(index, 1);
    updated.splice(targetIndex, 0, moved);
    onFilesChange(updated);
  };

  const handleRemovePage = (index: number) => {
    const updated = files.filter((_, i) => i !== index);
    onFilesChange(updated);
    setCapturedRawFiles((prev) => prev.filter((_, i) => i !== index));
    setCapturedScanItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files) {
      handleImportFiles(e.dataTransfer.files);
    }
  };

  return (
    <div className={`flex-1 flex flex-col h-full overflow-hidden select-none ${className}`}>
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/avif,image/bmp,image/*"
        onChange={(e) => {
          if (e.target.files) handleImportFiles(e.target.files);
          e.target.value = '';
        }}
        className="hidden"
      />
      <input
        ref={pdfInputRef}
        type="file"
        multiple
        accept="application/pdf,.pdf"
        onChange={(e) => {
          if (e.target.files) handleImportFiles(e.target.files);
          e.target.value = '';
        }}
        className="hidden"
      />
      <input
        ref={replaceInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/bmp,image/*"
        onChange={async (e) => {
          if (e.target.files && e.target.files.length > 0 && retakeIndex !== null) {
            const replacement = e.target.files[0];
            const url = URL.createObjectURL(replacement);
            const replacementItem: CapturedScanItem = {
              file: replacement,
              rawUrl: url,
              displayUrl: url,
              cropCorners: {
                topLeft: { x: 0.05, y: 0.05 },
                topRight: { x: 0.95, y: 0.05 },
                bottomRight: { x: 0.95, y: 0.95 },
                bottomLeft: { x: 0.05, y: 0.95 },
              },
            };
            setCapturedRawFiles((prev) => {
              const next = [...prev];
              next[retakeIndex] = replacement;
              return next;
            });
            setCapturedScanItems((prev) => {
              const next = [...prev];
              next[retakeIndex] = replacementItem;
              return next;
            });
            const buffer = await replacement.arrayBuffer();
            const newFile: ProcessedFile = {
              id: `file_${Date.now()}_0_${Math.random().toString(36).substring(2, 7)}`,
              name: replacement.name,
              size: replacement.size,
              type: replacement.type || 'image/jpeg',
              lastModified: replacement.lastModified,
              data: buffer,
              previewUrl: url,
            };
            const nextFiles = [...files];
            nextFiles[retakeIndex] = newFile;
            onFilesChange(nextFiles);
            setRetakeIndex(null);
          }
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* Screen 1: Live Camera Viewfinder Modal with Corner Detection & Auto-Capture */}
      <CameraViewfinder
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCapturePages={handleCameraCapture}
        initialCount={capturedRawFiles.length}
        onOpenReview={() => {
          setIsCameraOpen(false);
          setIsEditorOpen(true);
        }}
      />

      {/* Screen 2: Scanned Document Editor & Review Studio (Crop, Retake, Rotate, Filters, Adjust, Cleanup, Reorder, Resize) */}
      <DocumentEditorModal
        isOpen={isEditorOpen}
        pages={capturedRawFiles}
        scanItems={capturedScanItems}
        onClose={() => setIsEditorOpen(false)}
        onKeepScanning={() => {
          if (isMobile) {
            setIsEditorOpen(false);
            setIsCameraOpen(true);
          } else {
            fileInputRef.current?.click();
          }
        }}
        onRetakePage={(idx) => {
          setRetakeIndex(idx);
          if (isMobile) {
            setIsEditorOpen(false);
            setIsCameraOpen(true);
          } else {
            replaceInputRef.current?.click();
          }
        }}
        onSavePdf={(_pdfBlob, _filename) => {
          // Download is handled inside modal, keep pages synced
          setIsEditorOpen(false);
        }}
      />

      {/* TOP STUDIO TOOLBAR (Responsive, hidden during camera/editor overlays) */}
      {!isCameraOpen && !isEditorOpen && (
        <div className="shrink-0 px-3 sm:px-6 py-2.5 bg-surface-subtle border-b border-surface-border flex items-center justify-between gap-3 overflow-x-auto no-scrollbar">
        {/* Left: Title & Page Count */}
        <div className="flex items-center gap-2 shrink-0">
          <h2 className="text-sm font-semibold text-text-main truncate max-w-[140px] xs:max-w-[200px] sm:max-w-xs">
            Document Scanner
          </h2>
          <Badge variant="accent" size="sm">
            {files.length} {files.length === 1 ? 'Page' : 'Pages'}
          </Badge>
        </div>

        {/* Right: Quick Action Buttons & Presets */}
        <div className="flex items-center gap-2 shrink-0">
            {/* Filter preset selector */}
            <div className="inline-flex items-center p-0.5 rounded-control bg-surface-panel border border-surface-border">
              <button
                type="button"
                onClick={() => handleFilterChange('bw')}
                className={`min-h-[36px] px-2.5 text-xs font-medium rounded-control transition-colors cursor-pointer whitespace-nowrap ${
                  activeFilter === 'bw'
                    ? 'bg-accent text-accent-contrast font-semibold'
                    : 'text-text-muted hover:text-text-main hover:bg-surface-subtle'
                }`}
              >
                Magic B&W
              </button>
              <button
                type="button"
                onClick={() => handleFilterChange('grayscale')}
                className={`min-h-[36px] px-2.5 text-xs font-medium rounded-control transition-colors cursor-pointer whitespace-nowrap ${
                  activeFilter === 'grayscale'
                    ? 'bg-accent text-accent-contrast font-semibold'
                    : 'text-text-muted hover:text-text-main hover:bg-surface-subtle'
                }`}
              >
                Grayscale
              </button>
              <button
                type="button"
                onClick={() => handleFilterChange('color')}
                className={`min-h-[36px] px-2.5 text-xs font-medium rounded-control transition-colors cursor-pointer whitespace-nowrap ${
                  activeFilter === 'color'
                    ? 'bg-accent text-accent-contrast font-semibold'
                    : 'text-text-muted hover:text-text-main hover:bg-surface-subtle'
                }`}
              >
                Color
              </button>
              <button
                type="button"
                onClick={() => handleFilterChange('none')}
                className={`min-h-[36px] px-2.5 text-xs font-medium rounded-control transition-colors cursor-pointer whitespace-nowrap ${
                  activeFilter === 'none'
                    ? 'bg-accent text-accent-contrast font-semibold'
                    : 'text-text-muted hover:text-text-main hover:bg-surface-subtle'
                }`}
              >
                Original
              </button>
            </div>

          <div className="h-4 w-px bg-surface-border mx-0.5 hidden sm:block" />

          {/* Add Page Button: Camera Scan on mobile, Add Files on desktop */}
          {isMobile ? (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Camera className="w-3.5 h-3.5" />}
              onClick={() => setIsCameraOpen(true)}
            >
              <span className="hidden xs:inline">Camera</span> Scan
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              leftIcon={<FolderPlus className="w-3.5 h-3.5" />}
              onClick={() => fileInputRef.current?.click()}
            >
              Add Files
            </Button>
          )}

          {isMobile && (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<FolderPlus className="w-3.5 h-3.5" />}
              onClick={() => fileInputRef.current?.click()}
            >
              + Images
            </Button>
          )}

          <Button
            variant="secondary"
            size="sm"
            leftIcon={<FileText className="w-3.5 h-3.5" />}
            onClick={() => pdfInputRef.current?.click()}
            className="hidden sm:inline-flex"
          >
            + PDF
          </Button>

          {capturedRawFiles.length > 0 && (
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Crop className="w-3.5 h-3.5" />}
              onClick={() => setIsEditorOpen(true)}
            >
              Open Editor
            </Button>
          )}

          {files.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onFilesChange([]);
                setCapturedRawFiles([]);
              }}
              className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-control text-text-muted hover:text-status-error hover:bg-status-error-bg border border-transparent hover:border-status-error-border transition-colors cursor-pointer"
              title="Clear all pages"
              aria-label="Clear all pages"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      )}

      {/* RESULT STATE: Scanned Document Ready */}
      {result && (
        <div className="m-3 sm:m-5 p-4 rounded-sheet bg-surface-panel border border-surface-border flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <CheckCircle2 className="w-5 h-5 text-status-success shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-text-main truncate">
                {result.title || 'Document Scan Complete'}
              </h3>
              <p className="text-xs text-text-muted mt-0.5 font-mono">
                {result.filename} &bull; {formatBytes(result.size)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
            {onDismissResult && (
              <Button variant="secondary" size="sm" onClick={onDismissResult}>
                Back to Studio
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              disabled={isSavingResult}
              isLoading={isSavingResult}
              leftIcon={<Save className="w-4 h-4" />}
              onClick={async () => {
                if (!result) return;
                if (isMobile && result.fileType === 'zip' && result.items && result.items.length > 0) {
                  setIsSavingResult(true);
                  try {
                    await saveMultipleBlobs(result.items.map((it) => ({ blob: it.blob, name: it.name })));
                  } finally {
                    setIsSavingResult(false);
                  }
                } else {
                  downloadBlob(result.blob, result.filename);
                }
              }}
            >
              Save {result.fileType === 'pdf' ? 'PDF' : (isMobile ? 'All Scans' : 'Archive')}
            </Button>
          </div>
        </div>
      )}

      {/* MAIN STUDIO VIEWPORT */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-5">
        {/* STATE 0: EMPTY STATE (One plain line, clear primary action) */}
        {files.length === 0 ? (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`h-full min-h-[300px] rounded-sheet border flex flex-col items-center justify-center p-6 text-center transition-colors ${
              isDragOver
                ? 'border-accent bg-surface-hover shadow-lifted'
                : 'border-surface-border bg-surface-panel'
            }`}
          >
            <div className="max-w-md flex flex-col items-center gap-3">
              <p className="text-sm text-text-muted">
                {isMobile
                  ? 'Scan pages with your camera or choose files from your device.'
                  : 'Choose document images or PDF files, or drop them onto the desk.'}
              </p>

              {/* Action buttons */}
              <div className="flex items-center gap-2.5 flex-wrap justify-center pt-1">
                {isMobile ? (
                  <>
                    <Button
                      variant="primary"
                      size="md"
                      leftIcon={<Camera className="w-4 h-4" />}
                      onClick={() => setIsCameraOpen(true)}
                    >
                      Scan with Camera
                    </Button>
                    <Button
                      variant="secondary"
                      size="md"
                      leftIcon={<FolderPlus className="w-4 h-4" />}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Choose files
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="primary"
                    size="md"
                    leftIcon={<FolderPlus className="w-4 h-4" />}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Add Files
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="md"
                  leftIcon={<FileText className="w-4 h-4" />}
                  onClick={() => pdfInputRef.current?.click()}
                >
                  Choose PDF
                </Button>
              </div>
            </div>
          </div>
        ) : (
          /* STATE 1: MULTI-PAGE DOCUMENT GRID */
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-semibold text-text-muted">
                Document Pages ({files.length})
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (isMobile) {
                      setIsCameraOpen(true);
                    } else {
                      fileInputRef.current?.click();
                    }
                  }}
                  className="min-h-[44px] inline-flex items-center gap-1.5 px-3 rounded-control bg-surface-panel hover:bg-surface-hover border border-surface-border text-xs font-semibold text-text-main cursor-pointer transition-colors"
                >
                  <Plus className="w-4 h-4 text-accent" />
                  <span>{isMobile ? 'Add Page' : 'Add Files'}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
              {files.map((file, idx) => {
                const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

                return (
                  <div
                    key={file.id}
                    className="paper-sheet group relative overflow-hidden flex flex-col"
                  >
                    {/* Top Page Number Badge */}
                    <div className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded-chip bg-surface-panel text-text-main border border-surface-border shadow-xs font-mono text-xs font-medium">
                      Page {idx + 1}
                    </div>

                    {/* Remove button */}
                    <button
                      type="button"
                      onClick={() => handleRemovePage(idx)}
                      className="absolute top-2 right-2 z-10 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-control bg-surface-panel hover:bg-status-error text-text-muted hover:text-white border border-surface-border shadow-xs transition-colors cursor-pointer"
                      title="Remove page"
                      aria-label="Remove page"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>

                    {/* Page Preview Thumbnail */}
                    <div className="aspect-[1/1.3] bg-surface-subtle flex items-center justify-center overflow-hidden relative">
                      {file.previewUrl ? (
                        <img
                          src={file.previewUrl}
                          alt={file.name}
                          className={`w-full h-full object-contain p-2 ${
                            activeFilter === 'bw'
                              ? 'contrast-200 grayscale'
                              : activeFilter === 'grayscale'
                              ? 'grayscale contrast-125'
                              : activeFilter === 'color'
                              ? 'saturate-150 contrast-110'
                              : ''
                          }`}
                        />
                      ) : isPdf ? (
                        <div className="flex flex-col items-center justify-center p-4 text-center text-text-muted">
                          <FileText className="w-9 h-9 mb-1" />
                          <span className="text-xs font-mono">PDF</span>
                        </div>
                      ) : (
                        <FileImage className="w-8 h-8 text-text-muted" />
                      )}
                    </div>

                    {/* Bottom Page Controls */}
                    <div className="p-2 border-t border-surface-border bg-surface-panel flex items-center justify-between">
                      <span className="text-xs font-mono text-text-muted truncate max-w-[70px]">
                        {formatBytes(file.size)}
                      </span>

                      {/* Reorder Arrows */}
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleMovePage(idx, 'prev')}
                          className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center rounded-control hover:bg-surface-subtle disabled:text-text-disabled disabled:cursor-not-allowed text-text-muted hover:text-text-main cursor-pointer"
                          title="Move left"
                          aria-label="Move page earlier"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === files.length - 1}
                          onClick={() => handleMovePage(idx, 'next')}
                          className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center rounded-control hover:bg-surface-subtle disabled:text-text-disabled disabled:cursor-not-allowed text-text-muted hover:text-text-main cursor-pointer"
                          title="Move right"
                          aria-label="Move page later"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* BOTTOM EXECUTE BAR */}
      {!isCameraOpen && !isEditorOpen && (
        <div className="shrink-0 px-4 sm:px-6 py-3 bg-surface-subtle border-t border-surface-border flex items-center justify-between gap-3">
          {/* Output format segmented control */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-muted hidden xs:inline">Output:</span>
            <div className="inline-flex items-center p-0.5 rounded-control bg-surface-panel border border-surface-border text-xs">
              <button
                type="button"
                onClick={() => handleOutputModeChange('pdf')}
                className={`min-h-[36px] px-2.5 text-xs font-semibold rounded-control transition-colors cursor-pointer ${
                  outputMode === 'pdf'
                    ? 'bg-accent text-accent-contrast'
                    : 'text-text-muted hover:text-text-main'
                }`}
              >
                PDF
              </button>
              <button
                type="button"
                onClick={() => handleOutputModeChange('images')}
                className={`min-h-[36px] px-2.5 text-xs font-semibold rounded-control transition-colors cursor-pointer ${
                  outputMode === 'images'
                    ? 'bg-accent text-accent-contrast'
                    : 'text-text-muted hover:text-text-main'
                }`}
              >
                Images
              </button>
            </div>
          </div>

          {/* Action Button */}
          <Button
            variant="primary"
            size="md"
            disabled={files.length === 0 || isProcessing}
            isLoading={isProcessing}
            leftIcon={<Sparkles className="w-4 h-4" />}
            onClick={onExecute}
          >
            {isProcessing
              ? 'Compiling...'
              : outputMode === 'pdf'
              ? `Export ${files.length} PDF`
              : `Export ${files.length} Images`}
          </Button>
        </div>
      )}
    </div>
  );
};

export default ScannerStudio;

