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
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-accent-subtle border border-accent/20 text-accent flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-text-main truncate max-w-[140px] xs:max-w-[200px] sm:max-w-xs">
                Document Scanner
              </h2>
              <Badge variant="accent" size="sm">
                {files.length} {files.length === 1 ? 'Page' : 'Pages'}
              </Badge>
            </div>
          </div>
        </div>

        {/* Right: Quick Action Buttons & Presets */}
        <div className="flex items-center gap-2 shrink-0">
            {/* Filter preset selector */}
            <div className="inline-flex items-center p-0.5 rounded-xl bg-surface-panel border border-surface-border shadow-2xs">
              <button
                type="button"
                onClick={() => handleFilterChange('bw')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all duration-150 cursor-pointer whitespace-nowrap active:scale-95 ${
                  activeFilter === 'bw'
                    ? 'bg-accent text-white font-semibold shadow-xs'
                    : 'text-text-muted hover:text-text-main hover:bg-surface-subtle'
                }`}
              >
                Magic B&W
              </button>
              <button
                type="button"
                onClick={() => handleFilterChange('grayscale')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all duration-150 cursor-pointer whitespace-nowrap active:scale-95 ${
                  activeFilter === 'grayscale'
                    ? 'bg-accent text-white font-semibold shadow-xs'
                    : 'text-text-muted hover:text-text-main hover:bg-surface-subtle'
                }`}
              >
                Grayscale
              </button>
              <button
                type="button"
                onClick={() => handleFilterChange('color')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all duration-150 cursor-pointer whitespace-nowrap active:scale-95 ${
                  activeFilter === 'color'
                    ? 'bg-accent text-white font-semibold shadow-xs'
                    : 'text-text-muted hover:text-text-main hover:bg-surface-subtle'
                }`}
              >
                Color
              </button>
              <button
                type="button"
                onClick={() => handleFilterChange('none')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all duration-150 cursor-pointer whitespace-nowrap active:scale-95 ${
                  activeFilter === 'none'
                    ? 'bg-accent text-white font-semibold shadow-xs'
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
              leftIcon={<Camera className="w-3.5 h-3.5 text-accent" />}
              onClick={() => setIsCameraOpen(true)}
              className="h-8 text-xs font-semibold px-2.5 sm:px-3 whitespace-nowrap"
            >
              <span className="hidden xs:inline">Camera</span> Scan
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              leftIcon={<FolderPlus className="w-3.5 h-3.5" />}
              onClick={() => fileInputRef.current?.click()}
              className="h-8 text-xs font-semibold px-2.5 sm:px-3 whitespace-nowrap"
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
              className="h-8 text-xs font-medium px-2.5 sm:px-3 whitespace-nowrap"
            >
              + Images
            </Button>
          )}

          <Button
            variant="secondary"
            size="sm"
            leftIcon={<FileText className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />}
            onClick={() => pdfInputRef.current?.click()}
            className="h-8 text-xs font-medium px-2.5 sm:px-3 whitespace-nowrap hidden sm:inline-flex"
          >
            + PDF
          </Button>

          {capturedRawFiles.length > 0 && (
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Crop className="w-3.5 h-3.5" />}
              onClick={() => setIsEditorOpen(true)}
              className="h-8 text-xs font-semibold px-2.5 sm:px-3 whitespace-nowrap bg-blue-600 hover:bg-blue-700 text-white"
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
              className="p-1.5 rounded-lg text-text-muted hover:text-status-error hover:bg-status-error-bg border border-transparent hover:border-status-error-border transition-colors cursor-pointer"
              title="Clear all pages"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      )}

      {/* RESULT STATE: Scanned Document Ready */}
      {result && (
        <div className="m-3 sm:m-5 p-4 sm:p-5 rounded-2xl bg-surface-panel border border-surface-border shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4 animate-in fade-in shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-text-main truncate">
                {result.title || 'Document Scan Complete'}
              </h3>
              <p className="text-xs text-text-muted mt-0.5">
                {result.filename} &bull; <span className="font-mono text-accent font-semibold">{formatBytes(result.size)}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
            {onDismissResult && (
              <Button variant="secondary" size="sm" onClick={onDismissResult} className="text-xs">
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
              className="text-xs font-semibold shadow-xs"
            >
              Save {result.fileType === 'pdf' ? 'PDF' : (isMobile ? 'All Scans' : 'Archive')}
            </Button>
          </div>
        </div>
      )}

      {/* MAIN STUDIO VIEWPORT */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-5">
        {/* STATE 0: EMPTY STATE (Dropzone with Camera prominent) */}
        {files.length === 0 ? (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`h-full min-h-[340px] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center p-6 text-center transition-all ${
              isDragOver
                ? 'border-accent bg-accent-subtle/30 ring-2 ring-accent/30'
                : 'border-surface-border bg-surface-subtle/40 hover:border-surface-border-focus'
            }`}
          >
            <div className="max-w-md flex flex-col items-center space-y-4">
              {/* Trigger icon: Camera on mobile, FolderPlus on desktop */}
              {isMobile ? (
                <button
                  type="button"
                  onClick={() => setIsCameraOpen(true)}
                  className="w-20 h-20 rounded-full bg-accent text-white shadow-xl shadow-accent/20 flex items-center justify-center hover:scale-105 active:scale-95 transition-all cursor-pointer group"
                  aria-label="Open Camera Scanner"
                >
                  <Camera className="w-8 h-8 group-hover:scale-110 transition-transform" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-20 h-20 rounded-full bg-accent-subtle text-accent border border-accent/20 shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-all cursor-pointer group"
                  aria-label="Add Files"
                >
                  <FolderPlus className="w-8 h-8 group-hover:scale-110 transition-transform" />
                </button>
              )}

              <div className="space-y-1.5">
                <h3 className="font-serif font-bold text-lg text-text-main">
                  {isMobile ? 'Scan Document' : 'Document Scanner & Enhancer'}
                </h3>
                <p className="text-xs text-text-muted">
                  {isMobile
                    ? 'Use your phone camera to capture multi-page documents, or drag and drop images and PDF files here.'
                    : 'Select or drop document images and PDF files here to crop edges, enhance readability, and convert offline.'}
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2.5 flex-wrap justify-center pt-2">
                {isMobile ? (
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      leftIcon={<Camera className="w-4 h-4" />}
                      onClick={() => setIsCameraOpen(true)}
                      className="text-xs font-semibold shadow-xs"
                    >
                      Scan with Camera
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<FolderPlus className="w-4 h-4" />}
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs font-medium"
                    >
                      Import Images
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    leftIcon={<FolderPlus className="w-4 h-4" />}
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs font-semibold shadow-xs"
                  >
                    Add Files
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<FileText className="w-4 h-4 text-amber-600 dark:text-amber-400" />}
                  onClick={() => pdfInputRef.current?.click()}
                  className="text-xs font-medium"
                >
                  Import PDF
                </Button>
              </div>

              {/* Offline & privacy pill */}
              <div className="pt-4 flex items-center gap-2 text-[11px] font-mono text-text-faint">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>100% On-Device Processing &bull; Zero Network Uploads</span>
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
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-subtle hover:bg-surface-panel border border-surface-border text-xs font-medium text-text-main cursor-pointer transition-colors shadow-2xs"
                >
                  <Plus className="w-3.5 h-3.5 text-accent" />
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
                    className="group relative rounded-xl border border-surface-border bg-surface-panel overflow-hidden shadow-2xs flex flex-col hover:border-accent hover:shadow-md transition-all duration-200"
                  >
                    {/* Top Page Number Badge */}
                    <div className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded-md bg-black/70 text-white font-mono text-[10px] font-semibold backdrop-blur-xs">
                      Page {idx + 1}
                    </div>

                    {/* Remove button */}
                    <button
                      type="button"
                      onClick={() => handleRemovePage(idx)}
                      className="absolute top-2 right-2 z-10 p-1 rounded-md bg-black/60 hover:bg-status-error text-white/90 hover:text-white transition-colors cursor-pointer shadow-xs"
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
                        <div className="flex flex-col items-center justify-center p-4 text-center">
                          <FileText className="w-10 h-10 text-amber-500 mb-1" />
                          <span className="text-[10px] font-mono text-text-muted">PDF Document</span>
                        </div>
                      ) : (
                        <FileImage className="w-8 h-8 text-text-faint" />
                      )}
                    </div>

                    {/* Bottom Page Controls */}
                    <div className="p-2 border-t border-surface-border bg-surface-panel flex items-center justify-between">
                      <span className="text-[10px] font-mono text-text-muted truncate max-w-[70px]">
                        {formatBytes(file.size)}
                      </span>

                      {/* Reorder Arrows */}
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleMovePage(idx, 'prev')}
                          className="p-1 rounded hover:bg-surface-subtle disabled:opacity-30 disabled:cursor-not-allowed text-text-muted hover:text-text-main cursor-pointer"
                          title="Move left"
                        >
                          <ArrowLeft className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === files.length - 1}
                          onClick={() => handleMovePage(idx, 'next')}
                          className="p-1 rounded hover:bg-surface-subtle disabled:opacity-30 disabled:cursor-not-allowed text-text-muted hover:text-text-main cursor-pointer"
                          title="Move right"
                        >
                          <ArrowRight className="w-3 h-3" />
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
          {/* Output format pill */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-muted hidden xs:inline">Output:</span>
            <div className="inline-flex items-center p-0.5 rounded-lg bg-surface-panel border border-surface-border text-xs">
              <button
                type="button"
                onClick={() => handleOutputModeChange('pdf')}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition-all cursor-pointer ${
                  outputMode === 'pdf'
                    ? 'bg-accent text-white shadow-2xs'
                    : 'text-text-muted hover:text-text-main'
                }`}
              >
                PDF Document
              </button>
              <button
                type="button"
                onClick={() => handleOutputModeChange('images')}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition-all cursor-pointer ${
                  outputMode === 'images'
                    ? 'bg-accent text-white shadow-2xs'
                    : 'text-text-muted hover:text-text-main'
                }`}
              >
                Images (ZIP)
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
            className="font-semibold text-xs px-4 sm:px-6 shadow-sm"
          >
            {isProcessing
              ? 'Scanning & Compiling...'
              : outputMode === 'pdf'
              ? `Export ${files.length} Pages as PDF`
              : `Export ${files.length} Scanned Images`}
          </Button>
        </div>
      )}
    </div>
  );
};

export default ScannerStudio;

