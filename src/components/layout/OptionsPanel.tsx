import React, { useState } from 'react';
import type { ToolManifest } from '../../core/tools/types';

type ToolOptionDef = ToolManifest['availableOptions'][number];
import type { ProcessedFile } from '../../core/types';
import type { SizeEstimate } from '../../core/processors/estimate-size';
import type { BatchResult } from '../../core/processors/types';
import { formatBytes } from '../../core/files/validation';
import { downloadBlob, saveMultipleBlobs, shareBlob, shareMultipleBlobs } from '../../core/processors/download';
import { parsePageRange } from '../../core/processors/image-encoders';
import type { GalleryItem } from '../ui/ImageGalleryModal';
import { Button } from '../ui/Button';
import { FEATURE_FLAGS } from '../../core/config/feature-flags';
import {
  Play,
  Sliders,
  ChevronUp,
  ChevronDown,
  GripVertical,
  FileText,
  FileImage,
  ArrowDownUp,
  ArrowDownAZ,
  X,
  Layers,
  Crop,
  Check,
  Save,
  ExternalLink,
  Share2,
  RotateCcw,
} from 'lucide-react';

export interface OptionsPanelProps {
  tool: ToolManifest;
  files: ProcessedFile[];
  onFilesChange?: (files: ProcessedFile[]) => void;
  options: Record<string, unknown>;
  onOptionsChange: (options: Record<string, unknown>) => void;
  isProcessing: boolean;
  sizeEstimate?: SizeEstimate | null;
  onExecute: () => void;
  selectedFileId?: string | null;
  onSelectFile?: (id: string | null) => void;
  className?: string;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
  isInline?: boolean;
  result?: BatchResult | null;
  onDismissResult?: () => void;
  onViewFile?: (file: ProcessedFile) => void;
  onViewImages?: (images: GalleryItem[], initialIndex?: number) => void;
}

export const OptionsPanel: React.FC<OptionsPanelProps> = ({
  tool,
  files,
  onFilesChange,
  options,
  onOptionsChange,
  isProcessing,
  sizeEstimate: _sizeEstimate,
  onExecute,
  selectedFileId,
  onSelectFile,
  className = '',
  isOpenMobile: _isOpenMobile = false,
  onCloseMobile,
  isInline = false,
  result,
  onDismissResult,
  onViewFile,
  onViewImages,
}) => {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);
  const [openSelectId, setOpenSelectId] = useState<string | null>(null);

  const currentSelectedId = selectedFileId !== undefined ? selectedFileId : localSelectedId;
  const setCurrentSelectedId = onSelectFile || setLocalSelectedId;

  const handleOptionChange = (key: string, value: unknown) => {
    const nextOptions = {
      ...options,
      [key]: value,
    };

    if (key === 'compressorMode') {
      nextOptions.compressionPreset = 'balanced';
      nextOptions.compressionLevel = 40;
      nextOptions.maxDimension = 'original';
    } else if (key === 'compressionPreset') {
      if (value === 'balanced') {
        nextOptions.compressionLevel = 40;
        nextOptions.maxDimension = 'original';
      } else if (value === 'maximum') {
        nextOptions.compressionLevel = 75;
        nextOptions.maxDimension = '1280';
      } else if (value === 'light') {
        nextOptions.compressionLevel = 15;
        nextOptions.maxDimension = 'original';
      }
    } else if (key === 'compressionLevel' || key === 'quality' || key === 'maxDimension') {
      nextOptions.compressionPreset = 'custom';
    } else if (tool.id === 'resizer' && key === 'unit') {
      const oldUnit = (options.unit as string) || 'px';
      const newUnit = value as string;
      const dpi = Number(options.dpi) || 300;
      const curW = Number(options.targetWidth) || 1200;
      const curH = Number(options.targetHeight) || 1200;

      if (oldUnit !== newUnit) {
        const pxW = oldUnit === 'in' ? curW * dpi : oldUnit === 'cm' ? (curW / 2.54) * dpi : curW;
        const pxH = oldUnit === 'in' ? curH * dpi : oldUnit === 'cm' ? (curH / 2.54) * dpi : curH;

        let nextW = pxW;
        let nextH = pxH;
        if (newUnit === 'in') {
          nextW = Number((pxW / dpi).toFixed(2));
          nextH = Number((pxH / dpi).toFixed(2));
        } else if (newUnit === 'cm') {
          nextW = Number(((pxW / dpi) * 2.54).toFixed(2));
          nextH = Number(((pxH / dpi) * 2.54).toFixed(2));
        } else {
          nextW = Math.round(pxW);
          nextH = Math.round(pxH);
        }

        nextOptions.targetWidth = String(nextW);
        nextOptions.targetHeight = String(nextH);
      }
    }

    if (result && onDismissResult) {
      onDismissResult();
    }
    onOptionsChange(nextOptions);
  };

  const handleMoveFile = (index: number, direction: 'up' | 'down', e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!onFilesChange) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= files.length) return;
    const updated = Array.from(files);
    const [moved] = updated.splice(index, 1);
    updated.splice(targetIndex, 0, moved);
    onFilesChange(updated);
    setCurrentSelectedId(moved.id);
  };

  const handleRemoveFile = (index: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!onFilesChange) return;
    const target = files[index];
    if (target && target.id === currentSelectedId) {
      setCurrentSelectedId(null);
    }
    const updated = files.filter((_, i) => i !== index);
    onFilesChange(updated);
  };

  const handleSortAlphabetical = () => {
    if (!onFilesChange) return;
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
    onFilesChange(sorted);
  };

  const handleReverseOrder = () => {
    if (!onFilesChange) return;
    const reversed = [...files].reverse();
    onFilesChange(reversed);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `${index}`);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedIndex === null || draggedIndex === index) return;
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedIndex === null || draggedIndex === targetIndex || !onFilesChange) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }
    const updated = Array.from(files);
    const [moved] = updated.splice(draggedIndex, 1);
    updated.splice(targetIndex, 0, moved);
    onFilesChange(updated);
    setCurrentSelectedId(moved.id);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);

  const isCompressor = tool.id === 'image-resizer';
  const compressorMode = (options.compressorMode as string) || 'pdf';
  const isConverter = tool.id === 'converter';
  const converterMode =
    (options.converterMode as string | undefined) || (isConverter ? 'pdf-to-img' : undefined);
  const isResizer = tool.id === 'resizer';
  const resizerUnit = (options.unit as string) || 'px';
  const resizerTargetSize = Boolean(options.targetSizeEnabled ?? true);
  const isPdfToImage = tool.id === 'pdf-to-image' || (isConverter && converterMode === 'pdf-to-img');
  const pageRange = (options.pageRange as string) || 'all';
  const isCustomPagesInvalid =
    isPdfToImage &&
    pageRange === 'custom' &&
    (!options.customPages || parsePageRange(String(options.customPages), 99999).length === 0);

  const visibleOptions = tool.availableOptions.filter((opt) => {
    if (isResizer) {
      if (opt.id === 'dpi') return resizerUnit === 'in' || resizerUnit === 'cm';
      if (opt.id === 'maxSizeKB' || opt.id === 'minSizeKB') return resizerTargetSize;
      return true;
    }
    if (isCompressor) {
      if (['compressorMode', 'compressionPreset', 'maxDimension', 'pdfMode', 'deflateLevel'].includes(opt.id)) {
        return false;
      }
      if (opt.id === 'targetFormat') return compressorMode === 'image';
      return true;
    }
    if (isConverter) {
      if (!converterMode || opt.id === 'converterMode') return false;
      if (converterMode === 'pdf-to-img') {
        if (opt.id === 'format' || opt.id === 'pageRange') return true;
        if (opt.id === 'customPages') return pageRange === 'custom';
        return false;
      }
      if (converterMode === 'img-to-pdf') {
        return ['pageSize', 'orientation', 'margin'].includes(opt.id);
      }
      if (converterMode === 'img-to-img') {
        if (opt.id === 'targetFormat') return true;
        if (opt.id === 'quality') {
          const tf = ((options.targetFormat as string) || 'png').toLowerCase();
          return ['jpeg', 'jpg', 'webp', 'avif'].includes(tf);
        }
        return false;
      }
      if (FEATURE_FLAGS.ENABLE_OFFICE_CONVERTER) {
        if (converterMode === 'word-to-pdf') return ['pageSize', 'orientation'].includes(opt.id);
        if (converterMode === 'excel-to-pdf') return ['orientation'].includes(opt.id);
        if (converterMode === 'ppt-to-pdf') return ['slideRatio'].includes(opt.id);
      }
      return false;
    }
    if (isPdfToImage && opt.id === 'customPages') {
      return pageRange === 'custom';
    }
    return true;
  });

  const actionLabel = isProcessing
    ? 'Processing Batch...'
    : isCompressor
    ? 'Compress Files'
    : tool.id === 'pdf-merge'
    ? 'Merge'
    : tool.id === 'resizer'
    ? (options.targetSizeEnabled ? 'Compress & Resize' : 'Crop & Resize')
    : tool.id === 'converter'
    ? converterMode === 'pdf-to-img'
      ? 'Convert to Images'
      : converterMode === 'img-to-img'
      ? 'Convert images'
      : converterMode
      ? 'Convert to PDF'
      : 'Convert'
    : tool.id === 'pdf-to-image'
    ? 'Convert to Images'
    : `Run ${tool.shortName}`;

  const actionIcon =
    tool.id === 'pdf-merge' ? (
      <Layers className="w-4 h-4" />
    ) : tool.id === 'resizer' ? (
      <Crop className="w-4 h-4" />
    ) : (
      <Play className="w-4 h-4 fill-current" />
    );

  const renderOptionField = (opt: ToolOptionDef, idPrefix: string) => {
    const inputId = `${idPrefix}-${opt.id}`;
    return (
      <div key={opt.id} className="space-y-1.5">
        {opt.type !== 'toggle' && (
          <div className="flex justify-between items-center text-xs">
            <label htmlFor={inputId} className="font-mono uppercase tracking-wider text-text-muted">
              {isResizer && (opt.id === 'targetWidth' || opt.id === 'targetHeight')
                ? `${opt.label} (${resizerUnit})`
                : opt.label}
            </label>
            {opt.type === 'range' && (
              <span className="font-mono text-text-main font-semibold text-xs bg-surface-bg px-2 py-0.5 rounded-control border border-surface-border">
                {String(options[opt.id] ?? opt.defaultValue)}%
              </span>
            )}
          </div>
        )}

        {opt.type === 'text' && (() => {
          const rawVal = options[opt.id] !== undefined ? String(options[opt.id]) : String(opt.defaultValue ?? '');
          const isCustomPages = opt.id === 'customPages';
          const isInvalidCustomPages = isCustomPages && (
            rawVal.trim() === '' || parsePageRange(rawVal, 99999).length === 0
          );

          return (
            <div className="space-y-1">
              <input
                id={inputId}
                type="text"
                inputMode={isCustomPages ? 'numeric' : 'text'}
                value={rawVal}
                placeholder={isCustomPages ? 'e.g. 1-3, 5' : undefined}
                onChange={(e) => {
                  let nextVal = e.target.value;
                  if (isCustomPages) {
                    // Block characters other than numbers, commas, hyphens, and spaces (e.g. 4*8)
                    nextVal = nextVal.replace(/[^0-9,\- ]/g, '');
                  }
                  handleOptionChange(opt.id, nextVal);
                }}
                data-no-shortcut="true"
                disabled={isProcessing}
                className={`w-full min-h-[44px] text-sm rounded-control px-3 py-2 focus:outline-none bg-surface-bg border ${
                  isInvalidCustomPages ? 'border-status-error' : 'border-surface-border focus:border-surface-border-focus'
                } text-text-main font-mono`}
              />
              {isInvalidCustomPages && (
                <p className="text-[11px] text-status-error font-medium">
                  {rawVal.trim() === '' ? 'Please enter a page range' : 'Invalid page range (e.g. 1-3, 5)'}
                </p>
              )}
            </div>
          );
        })()}

        {opt.id === 'unit' && isResizer ? (
          <div className="grid grid-cols-3 gap-1 p-1 bg-surface-bg border border-surface-border rounded-control">
            {opt.options?.map((o) => {
              const isSelected = String(options.unit ?? opt.defaultValue) === String(o.value);
              return (
                <button
                  key={String(o.value)}
                  type="button"
                  onClick={() => handleOptionChange('unit', o.value)}
                  disabled={isProcessing}
                  title={o.label}
                  aria-pressed={isSelected}
                  className={`min-h-[40px] px-1 text-xs font-semibold rounded-control transition-colors duration-fast ease-out cursor-pointer text-center whitespace-nowrap flex items-center justify-center ${
                    isSelected
                      ? 'bg-accent text-accent-contrast'
                      : 'text-text-muted hover:text-text-main hover:bg-surface-subtle'
                  }`}
                >
                  {o.value === 'px' ? 'px' : o.value === 'in' ? 'in' : 'cm'}
                </button>
              );
            })}
          </div>
        ) : opt.type === 'select' ? (
          <div className="relative">
            <button
              id={inputId}
              type="button"
              disabled={isProcessing}
              onClick={() => setOpenSelectId(openSelectId === opt.id ? null : opt.id)}
              className="w-full min-h-[44px] text-xs sm:text-sm font-medium rounded-control px-3.5 py-2 flex items-center justify-between bg-surface-bg border border-surface-border hover:border-surface-border-focus text-text-main transition-colors cursor-pointer"
            >
              <span className="truncate">
                {opt.options?.find((o) => String(o.value) === String(options[opt.id] ?? opt.defaultValue))?.label ||
                  String(options[opt.id] ?? opt.defaultValue)}
              </span>
              <ChevronDown
                className={`w-4 h-4 text-text-muted transition-transform duration-200 shrink-0 ml-2 ${
                  openSelectId === opt.id ? 'rotate-180 text-text-main' : ''
                }`}
              />
            </button>

            {openSelectId === opt.id && (
              <>
                {/* Backdrop to close on tap outside */}
                <div
                  className="fixed inset-0 z-40 bg-black/10"
                  onClick={() => setOpenSelectId(null)}
                />

                {/* Custom Paperweight UI Dropdown Menu */}
                <div className="absolute left-0 right-0 bottom-full mb-1 sm:bottom-auto sm:top-full sm:mt-1.5 z-50 rounded-sheet bg-surface-panel border border-surface-border shadow-lifted overflow-hidden py-1 max-h-60 overflow-y-auto animate-in fade-in">
                  {opt.options?.map((o) => {
                    const isSelected = String(options[opt.id] ?? opt.defaultValue) === String(o.value);
                    return (
                      <button
                        key={String(o.value)}
                        type="button"
                        onClick={() => {
                          handleOptionChange(opt.id, o.value);
                          setOpenSelectId(null);
                        }}
                        className={`w-full px-3.5 py-2.5 text-xs sm:text-sm flex items-center justify-between transition-colors cursor-pointer text-left ${
                          isSelected
                            ? 'bg-accent text-accent-contrast font-bold'
                            : 'text-text-main hover:bg-surface-hover'
                        }`}
                      >
                        <span className="truncate">{o.label}</span>
                        {isSelected && <Check className="w-4 h-4 shrink-0 ml-2" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        ) : null}

        {opt.type === 'range' && (
          <div className="space-y-1.5 pt-1">
            <input
              id={inputId}
              type="range"
              min={opt.min ?? 0}
              max={opt.max ?? 100}
              step={opt.step ?? 1}
              value={Number(options[opt.id] ?? opt.defaultValue)}
              onChange={(e) => handleOptionChange(opt.id, Number(e.target.value))}
              disabled={isProcessing}
              className="w-full min-h-[44px] accent-accent cursor-pointer"
            />

            {opt.id === 'compressionLevel' && (
              <div className="flex justify-between items-center text-xs font-mono text-text-muted px-0.5">
                <span>Light</span>
                <span className="text-text-main font-semibold">Balanced</span>
                <span>Maximum</span>
              </div>
            )}
          </div>
        )}

        {opt.type === 'toggle' && (
          <label className="flex items-center gap-2.5 min-h-[44px] cursor-pointer">
            <input
              id={inputId}
              type="checkbox"
              checked={Boolean(options[opt.id] ?? opt.defaultValue)}
              onChange={(e) => handleOptionChange(opt.id, e.target.checked)}
              disabled={isProcessing}
              className="w-4 h-4 rounded-control border-surface-border accent-accent cursor-pointer shrink-0"
            />
            <span className="text-sm font-medium text-text-main">
              {isResizer ? opt.label : opt.description || opt.label}
            </span>
          </label>
        )}

        {opt.description &&
          !isResizer &&
          opt.type !== 'toggle' &&
          opt.id !== 'quality' &&
          opt.id !== 'compressionLevel' && (
            <p className="text-xs text-text-muted">{opt.description}</p>
          )}
      </div>
    );
  };

  const renderMergeOrderSection = () => {
    if (tool.id !== 'pdf-merge' || files.length === 0) return null;

    return (
      <div className="pt-3 border-t border-surface-border flex-1 min-h-0 flex flex-col space-y-2">
        <div className="flex items-center justify-between shrink-0 gap-2">
          <div className="flex items-center gap-1.5">
            <ArrowDownUp className="w-4 h-4 text-text-muted" />
            <span className="text-xs font-mono font-semibold text-text-main uppercase tracking-wider">
              Order ({files.length})
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleSortAlphabetical}
              disabled={isProcessing}
              title="Sort alphabetically (A to Z)"
              aria-label="Sort merge order alphabetically"
              className="min-h-[36px] px-2.5 rounded-control text-xs font-mono text-text-muted hover:text-text-main hover:bg-surface-subtle border border-surface-border transition-colors duration-fast ease-out cursor-pointer inline-flex items-center gap-1"
            >
              <ArrowDownAZ className="w-3.5 h-3.5" />
              <span>A–Z</span>
            </button>
            <button
              type="button"
              onClick={handleReverseOrder}
              disabled={isProcessing}
              title="Reverse merge order"
              aria-label="Reverse merge order"
              className="min-h-[36px] px-2.5 rounded-control text-xs font-mono text-text-muted hover:text-text-main hover:bg-surface-subtle border border-surface-border transition-colors duration-fast ease-out cursor-pointer"
            >
              Reverse
            </button>
          </div>
        </div>

        <div className={`space-y-2 overflow-y-auto pr-0.5 ${isInline ? 'max-h-56' : 'flex-1 min-h-0'}`}>
          {files.map((file, idx) => {
            const isImg =
              file.type.startsWith('image/') ||
              /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name);
            const isBeingDragged = draggedIndex === idx;
            const isTarget = dragOverIndex === idx;
            const isSelected = currentSelectedId === file.id;

            return (
              <div
                key={file.id}
                draggable={!isProcessing}
                onClick={() => setCurrentSelectedId(file.id)}
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={(e) => handleDrop(e, idx)}
                onDragEnd={() => {
                  setDraggedIndex(null);
                  setDragOverIndex(null);
                }}
                className={`paper-sheet flex items-center justify-between p-2 text-xs select-none cursor-pointer ${
                  isBeingDragged
                    ? 'shadow-lifted border-surface-border-focus'
                    : isTarget || isSelected
                    ? 'border-surface-border-focus bg-surface-panel-raised'
                    : 'hover:border-surface-border-focus'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1 mr-1">
                  <GripVertical className="w-3.5 h-3.5 text-text-muted shrink-0 cursor-grab active:cursor-grabbing" />
                  <span
                    className={`font-mono text-xs font-bold px-1.5 py-0.5 rounded-chip border shrink-0 ${
                      isSelected
                        ? 'bg-accent text-accent-contrast border-accent-border'
                        : 'bg-surface-bg text-text-main border-surface-border'
                    }`}
                  >
                    #{idx + 1}
                  </span>
                  {isImg ? (
                    <FileImage className="w-3.5 h-3.5 text-text-muted shrink-0" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 text-text-main shrink-0" />
                  )}
                  <span className="truncate font-mono text-text-main text-xs font-medium" title={file.name}>
                    {file.name}
                  </span>
                </div>

                <div className="flex items-center shrink-0">
                  <button
                    type="button"
                    disabled={idx === 0 || isProcessing}
                    onClick={(e) => handleMoveFile(idx, 'up', e)}
                    title="Move Up"
                    aria-label={`Move ${file.name} up`}
                    className="min-w-[44px] min-h-[44px] -mx-1 flex items-center justify-center rounded-control text-text-muted hover:text-text-main hover:bg-surface-subtle disabled:text-text-disabled disabled:pointer-events-none transition-colors duration-fast ease-out cursor-pointer"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === files.length - 1 || isProcessing}
                    onClick={(e) => handleMoveFile(idx, 'down', e)}
                    title="Move Down"
                    aria-label={`Move ${file.name} down`}
                    className="min-w-[44px] min-h-[44px] -mx-1 flex items-center justify-center rounded-control text-text-muted hover:text-text-main hover:bg-surface-subtle disabled:text-text-disabled disabled:pointer-events-none transition-colors duration-fast ease-out cursor-pointer"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={(e) => handleRemoveFile(idx, e)}
                    title="Remove file"
                    aria-label={`Remove ${file.name}`}
                    className="min-w-[44px] min-h-[44px] -mr-1 flex items-center justify-center rounded-control text-text-muted hover:text-status-error hover:bg-surface-subtle transition-colors duration-fast ease-out cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Result metadata & actions shared between mobile inline card and desktop sidebar
  const isMultiImage = Boolean(
    result?.items &&
    result.items.length > 1 &&
    (result.items[0]?.fileType === 'image' || result.fileType === 'image' || result.fileType === 'zip')
  );
  const isSingle = !result?.items || result.items.length <= 1;
  const displayName = isMultiImage
    ? `${result!.items!.length} Images Ready`
    : result?.filename || (isSingle && result?.items?.[0]?.name) || 'converted_document';
  const displaySize = isMultiImage
    ? result!.items!.reduce((acc, it) => acc + (it.blob?.size || it.compressedSize || 0), 0)
    : result?.size || (isSingle ? result?.items?.[0]?.compressedSize : 0);
  const isPdf = Boolean(
    result &&
    !isMultiImage &&
    (displayName.toLowerCase().endsWith('.pdf') || result.blob?.type === 'application/pdf')
  );

  const handleOpen = async () => {
    if (!result) return;
    // 1. If result has multiple images (e.g. from PDF to Image or Image conversion), open ImageGalleryModal directly!
    if (result.items && result.items.length > 0 && result.items[0]?.blob) {
      const galleryItems: GalleryItem[] = result.items.map((it, idx) => ({
        id: it.id || `conv_img_${idx}`,
        name: it.name,
        blob: it.blob,
        size: it.blob?.size || it.compressedSize,
        type: it.blob?.type || 'image/png',
        url: URL.createObjectURL(it.blob),
      }));
      if (onViewImages) {
        onViewImages(galleryItems, 0);
        return;
      }
    }

    // 2. If single PDF file, open in built-in PDF viewer
    if (isPdf && onViewFile && result.blob) {
      try {
        const buffer = await result.blob.arrayBuffer();
        onViewFile({
          id: `conv_${Date.now()}`,
          name: displayName,
          size: result.blob.size,
          type: 'application/pdf',
          lastModified: Date.now(),
          data: buffer,
          blob: result.blob,
        });
        return;
      } catch (e) {
        console.warn('Could not open preview in modal:', e);
      }
    }

    // 3. If single image, open in ImageGalleryModal
    if (result.blob && (result.blob.type.startsWith('image/') || result.fileType === 'image')) {
      const galleryItems: GalleryItem[] = [
        {
          id: result.id || `conv_img_${Date.now()}`,
          name: displayName,
          blob: result.blob,
          size: result.blob.size,
          type: result.blob.type || 'image/png',
          url: URL.createObjectURL(result.blob),
        },
      ];
      if (onViewImages) {
        onViewImages(galleryItems, 0);
        return;
      }
    }

    // 4. Fallback URL
    if (result.downloadUrl) {
      window.open(result.downloadUrl, '_blank');
    } else if (result.blob) {
      const url = URL.createObjectURL(result.blob);
      window.open(url, '_blank');
    }
  };

  const handleShare = async () => {
    if (!result) return;
    if (result.items && result.items.length > 1) {
      await shareMultipleBlobs(result.items.map((it) => ({ blob: it.blob, name: it.name })));
    } else if (result.blob) {
      await shareBlob(result.blob, displayName);
    }
  };

  const handleSave = async () => {
    if (!result) return;
    if (result.items && result.items.length > 1) {
      await saveMultipleBlobs(result.items.map((it) => ({ blob: it.blob, name: it.name })));
    } else if (result.blob) {
      await downloadBlob(result.blob, displayName);
    }
  };

  const handleConvertOther = () => {
    if (onDismissResult) onDismissResult();
    if (onFilesChange) onFilesChange([]);
  };

  // When conversion is complete on mobile inline view, display the Result Card in place of parameters
  if (isInline && result) {

    return (
      <div className={`w-full rounded-sheet border border-surface-border bg-surface-panel p-3.5 sm:p-4 space-y-3 shrink-0 shadow-2xs animate-in fade-in ${className}`}>
        {/* Header: File info + Status (without cross button) */}
        <div className="flex items-center justify-between text-xs pb-2 border-b border-surface-border">
          <div className="flex items-center gap-2 min-w-0">
            {isPdf ? (
              <FileText className="w-4 h-4 text-accent shrink-0" />
            ) : (
              <FileImage className="w-4 h-4 text-accent shrink-0" />
            )}
            <span className="font-mono font-medium text-text-main truncate" title={displayName}>
              {displayName}
            </span>
            {displaySize ? (
              <span className="font-mono text-text-muted shrink-0">
                ({formatBytes(displaySize)})
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] font-mono text-status-success font-semibold px-2 py-0.5 rounded-chip bg-status-success-bg border border-status-success-border">
              Ready
            </span>
          </div>
        </div>

        {/* Action Buttons: Save, Open, Share */}
        <div className="grid grid-cols-3 gap-2 pt-0.5">
          <Button
            variant="primary"
            size="md"
            leftIcon={<Save className="w-4 h-4" />}
            onClick={handleSave}
            className="w-full font-bold shadow-xs text-xs px-2"
          >
            {result.items && result.items.length > 1 ? 'Save All' : 'Save'}
          </Button>
          <Button
            variant="secondary"
            size="md"
            leftIcon={<ExternalLink className="w-4 h-4" />}
            onClick={handleOpen}
            className="w-full font-semibold text-xs px-2"
          >
            Open
          </Button>
          <Button
            variant="secondary"
            size="md"
            leftIcon={<Share2 className="w-4 h-4" />}
            onClick={handleShare}
            className="w-full font-semibold text-xs px-2"
          >
            Share
          </Button>
        </div>

        {/* Convert other button */}
        <Button
          variant="secondary"
          size="md"
          leftIcon={<RotateCcw className="w-4 h-4" />}
          onClick={handleConvertOther}
          className="w-full font-semibold text-xs"
        >
          Convert other
        </Button>
      </div>
    );
  }

  if (isInline) {
    return (
      <div
        aria-label="Tool configuration and options"
        className={`w-full rounded-sheet border border-surface-border bg-surface-panel p-3.5 sm:p-4 space-y-3 shrink-0 shadow-2xs ${className}`}
      >
        <div className="flex items-center gap-2 pb-2 border-b border-surface-border">
          <Sliders className="w-4 h-4 text-text-main shrink-0" />
          <h2 className="text-xs sm:text-sm font-bold text-text-main">Options</h2>
        </div>

        {/* Option fields and parameters */}
        <div className="space-y-2.5">
          {visibleOptions.map((opt) => renderOptionField(opt, 'opt-inline'))}
          {visibleOptions.length === 0 && (
            <p className="text-xs text-text-muted py-1">No options required for this tool.</p>
          )}
        </div>

        {renderMergeOrderSection()}
      </div>
    );
  }

  return (
    <aside
      aria-label="Tool configuration and options"
      className={`w-80 max-w-[340px] border-l bg-surface-panel border-surface-border text-text-main flex flex-col p-4 sm:p-5 pb-[max(1rem,var(--safe-area-bottom))] pr-[max(1rem,var(--safe-area-right))] space-y-4 shrink-0 overflow-y-auto select-none ${className}`}
    >
      <div className="w-9 h-1 rounded-chip mx-auto -mt-1 mb-1.5 sm:hidden shrink-0 bg-surface-border" />

      {/* Options Header */}
      <div className="flex items-center justify-between pb-3 border-b border-surface-border shrink-0">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-text-main shrink-0" />
          <h2 className="text-md font-bold text-text-main">Options</h2>
        </div>
        {onCloseMobile && (
          <button
            type="button"
            onClick={onCloseMobile}
            className="lg:hidden min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center rounded-control cursor-pointer text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors duration-fast ease-out"
            aria-label="Close options panel"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* SUMMARY Card */}
      <div className="rounded-sheet bg-surface-subtle border border-surface-border p-3.5 shrink-0">
        <div className="text-[11px] font-mono uppercase tracking-wider text-text-muted mb-1">Summary</div>
        {result ? (
          <>
            <div className="text-sm font-bold text-text-main">
              {formatBytes(totalBytes)} → {formatBytes(result.size || 0)}{' '}
              {result.savingsPercent !== undefined && result.savingsPercent > 0 && (
                <span className="text-xs font-mono font-semibold text-status-success bg-status-success-bg px-1.5 py-0.5 rounded-chip border border-status-success-border ml-1">
                  -{result.savingsPercent}%
                </span>
              )}
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              {result.savingsPercent !== undefined && result.savingsPercent <= 2
                ? <>Already well compressed. <span className="underline font-medium cursor-pointer" onClick={() => handleOptionChange('compressionPreset', 'maximum')}>Try Maximum</span> for a smaller file.</>
                : 'Processing complete.'}
            </p>
          </>
        ) : files.length === 0 ? (
          <>
            <div className="text-sm font-bold text-text-main">No files yet</div>
            <p className="text-xs text-text-muted mt-0.5">Choose {tool.id === 'pdf-merge' ? 'PDFs' : 'files'} to begin.</p>
          </>
        ) : (
          <>
            <div className="text-sm font-bold text-text-main">
              {files.length} {files.length === 1 ? 'file' : 'files'} · {formatBytes(totalBytes)}
            </div>
            <p className="text-xs text-text-muted mt-0.5">Ready to {isCompressor ? 'compress' : tool.id === 'pdf-merge' ? 'merge' : 'convert'}.</p>
          </>
        )}
      </div>

      {/* Options Fields & Controls */}
      <div className="flex-1 min-h-0 flex flex-col space-y-3 overflow-y-auto pr-0.5 pt-2">
        <div className="space-y-3 shrink-0">
          {visibleOptions.map((opt) => renderOptionField(opt, 'opt'))}
          {visibleOptions.length === 0 && (
            <p className="text-xs text-text-muted py-2">No options required for this tool.</p>
          )}
        </div>

        {renderMergeOrderSection()}
      </div>

      {/* Action Button at Bottom of Options Panel */}
      <div className="pt-3 mt-auto border-t border-surface-border shrink-0 space-y-2">
        {result ? (
          <>
            <Button
              variant="primary"
              size="md"
              className="w-full min-h-[46px] font-bold shadow-sm"
              leftIcon={<Save className="w-4 h-4" />}
              onClick={handleSave}
            >
              {result.items && result.items.length > 1 ? 'Save All' : 'Save'}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                size="md"
                className="w-full font-semibold"
                leftIcon={<ExternalLink className="w-4 h-4" />}
                onClick={handleOpen}
              >
                Open
              </Button>
              <Button
                variant="secondary"
                size="md"
                className="w-full font-semibold"
                leftIcon={<Share2 className="w-4 h-4" />}
                onClick={handleShare}
              >
                Share
              </Button>
            </div>
          </>
        ) : (
          <Button
            variant="primary"
            size="md"
            className="w-full min-h-[46px] font-bold shadow-sm"
            disabled={files.length === 0 || isProcessing || isCustomPagesInvalid}
            isLoading={isProcessing}
            leftIcon={actionIcon}
            onClick={onExecute}
          >
            {actionLabel}
          </Button>
        )}
      </div>
    </aside>
  );
};
