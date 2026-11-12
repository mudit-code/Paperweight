import React, { useState } from 'react';
import type { ToolManifest } from '../../core/tools/types';
import type { ProcessedFile } from '../../core/types';
import type { SizeEstimate } from '../../core/processors/estimate-size';
import { formatBytes } from '../../core/files/validation';
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
}) => {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);

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
        // Convert to px first
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
  const converterMode = options.converterMode as string | undefined;
  const isResizer = tool.id === 'resizer';
  const resizerUnit = (options.unit as string) || 'px';
  const resizerTargetSize = Boolean(options.targetSizeEnabled ?? true);
  const isPdfToImage = tool.id === 'pdf-to-image' || (isConverter && converterMode === 'pdf-to-img');
  const pageRange = (options.pageRange as string) || 'all';

  const visibleOptions = tool.availableOptions.filter((opt) => {
    if (isResizer) {
      if (opt.id === 'dpi') return resizerUnit === 'in' || resizerUnit === 'cm';
      if (opt.id === 'maxSizeKB' || opt.id === 'minSizeKB') return resizerTargetSize;
      return true;
    }
    if (isCompressor) {
      if (opt.id === 'compressorMode') return false;
      if (opt.id === 'compressionPreset') return false;
      if (opt.id === 'maxDimension') return false;
      if (opt.id === 'pdfMode') return false;
      if (opt.id === 'deflateLevel') return false;
      if (opt.id === 'targetFormat') return compressorMode === 'image';
      return true;
    }
    if (isConverter) {
      if (!converterMode) return false;
      if (opt.id === 'converterMode') return false;
      if (converterMode === 'pdf-to-img') {
        if (opt.id === 'format') return true;
        if (opt.id === 'pageRange') return true;
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
        if (converterMode === 'word-to-pdf') {
          return ['pageSize', 'orientation'].includes(opt.id);
        }
        if (converterMode === 'excel-to-pdf') {
          return ['orientation'].includes(opt.id);
        }
        if (converterMode === 'ppt-to-pdf') {
          return ['slideRatio'].includes(opt.id);
        }
      }
      return false;
    }
    if (isPdfToImage) {
      if (opt.id === 'customPages') return pageRange === 'custom';
    }
    return true;
  });

  if (isInline) {
    return (
      <div
        aria-label="Tool configuration and export options"
        className={`w-full rounded-2xl border border-surface-border bg-surface-panel p-4 sm:p-5 shadow-xs space-y-4 ${className}`}
      >
        {/* Parameters Header */}
        <div className="flex items-center gap-2 pb-3 border-b border-surface-border">
          <Sliders className="w-4 h-4 text-accent shrink-0" />
          <h2 className="text-xs sm:text-sm font-serif font-bold uppercase tracking-wider text-text-main">
            Parameters
          </h2>
        </div>

        {/* Dynamic Options Controls */}
        <div className="space-y-4">
          <div className="space-y-3">
            {visibleOptions.map((opt) => (
              <div key={opt.id} className="space-y-1.5">
                {opt.type !== 'toggle' && (
                  <div className="flex justify-between items-center text-xs">
                    <label htmlFor={`opt-inline-${opt.id}`} className="font-semibold text-xs text-text-main">
                      {isResizer && (opt.id === 'targetWidth' || opt.id === 'targetHeight')
                        ? `${opt.label} (${resizerUnit})`
                        : opt.label}
                    </label>
                    {opt.type === 'range' && (
                      <span className="font-mono text-text-main font-semibold text-[11px] bg-surface-subtle px-1.5 py-0.5 rounded border border-surface-border-subtle">
                        {String(options[opt.id] ?? opt.defaultValue)}%
                      </span>
                    )}
                  </div>
                )}

                {opt.type === 'text' && (
                  <input
                    id={`opt-inline-${opt.id}`}
                    type="text"
                    value={String(options[opt.id] ?? opt.defaultValue)}
                    onChange={(e) => handleOptionChange(opt.id, e.target.value)}
                    data-no-shortcut="true"
                    disabled={isProcessing}
                    className="w-full text-xs bg-surface-subtle border border-surface-border rounded-md px-3 py-2 text-text-main focus:border-surface-border-focus focus:outline-none"
                  />
                )}

                {opt.id === 'unit' && isResizer ? (
                  <div className="grid grid-cols-3 gap-1 p-1 bg-surface-subtle border border-surface-border rounded-xl">
                    {opt.options?.map((o) => {
                      const isSelected = String(options.unit ?? opt.defaultValue) === String(o.value);
                      return (
                        <button
                          key={String(o.value)}
                          type="button"
                          onClick={() => handleOptionChange('unit', o.value)}
                          disabled={isProcessing}
                          title={o.label}
                          className={`py-1.5 px-1 text-[11px] font-semibold rounded-lg transition-all cursor-pointer text-center whitespace-nowrap flex items-center justify-center overflow-hidden ${
                            isSelected
                              ? 'bg-accent text-white shadow-xs'
                              : 'text-text-main/80 hover:text-text-main hover:bg-surface-panel'
                          }`}
                        >
                          <span className="whitespace-nowrap tracking-tight font-semibold">
                            {o.value === 'px' ? 'Pixels (px)' : o.value === 'in' ? 'Inches (in)' : 'Centimeters'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : opt.type === 'select' ? (
                  <select
                    id={`opt-inline-${opt.id}`}
                    value={String(options[opt.id] ?? opt.defaultValue)}
                    onChange={(e) => handleOptionChange(opt.id, e.target.value)}
                    data-no-shortcut="true"
                    disabled={isProcessing}
                    className="w-full text-xs bg-surface-subtle border border-surface-border rounded-md px-3 py-2 text-text-main focus:border-surface-border-focus focus:outline-none cursor-pointer"
                  >
                    {opt.options?.map((o) => (
                      <option key={String(o.value)} value={String(o.value)}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : null}

                {opt.type === 'range' && (
                  <div className="space-y-2">
                    <input
                      id={`opt-inline-${opt.id}`}
                      type="range"
                      min={opt.min ?? 0}
                      max={opt.max ?? 100}
                      step={opt.step ?? 1}
                      value={Number(options[opt.id] ?? opt.defaultValue)}
                      onChange={(e) => handleOptionChange(opt.id, Number(e.target.value))}
                      disabled={isProcessing}
                      className="w-full accent-accent cursor-pointer"
                    />

                    {opt.id === 'compressionLevel' && (
                      <div className="flex justify-between items-center text-[10px] font-mono text-text-faint px-0.5">
                        <span>Light (Min)</span>
                        <span className="text-accent font-medium">Balanced</span>
                        <span>Max Compression</span>
                      </div>
                    )}
                  </div>
                )}

                {opt.type === 'toggle' && (
                  <label className="flex items-center gap-2 cursor-pointer pt-1">
                    <input
                      id={`opt-inline-${opt.id}`}
                      type="checkbox"
                      checked={Boolean(options[opt.id] ?? opt.defaultValue)}
                      onChange={(e) => handleOptionChange(opt.id, e.target.checked)}
                      disabled={isProcessing}
                      className="rounded border-surface-border text-accent focus:ring-accent accent-accent cursor-pointer"
                    />
                    <span className="text-xs font-medium text-text-main">
                      {isResizer ? opt.label : opt.description || opt.label}
                    </span>
                  </label>
                )}

                {opt.description && !isResizer && opt.type !== 'toggle' && opt.id !== 'quality' && opt.id !== 'compressionLevel' && (
                  <p className="text-[11px] text-text-faint">{opt.description}</p>
                )}
              </div>
            ))}
          </div>

          {/* Merge sequence order if pdf-merge */}
          {tool.id === 'pdf-merge' && files.length > 0 && (
            <div className="pt-3 border-t border-surface-border flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <ArrowDownUp className="w-3.5 h-3.5 text-accent" />
                  <span className="text-xs font-semibold text-text-main">
                    Merge Order ({files.length})
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleSortAlphabetical}
                    disabled={isProcessing}
                    className="p-1 rounded text-text-muted hover:text-text-main hover:bg-surface-subtle"
                    title="Sort A-Z"
                  >
                    <ArrowDownAZ className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleReverseOrder}
                    disabled={isProcessing}
                    className="p-1 rounded text-text-muted hover:text-text-main hover:bg-surface-subtle"
                    title="Reverse order"
                  >
                    <ArrowDownUp className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {files.map((file, idx) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-surface-subtle border border-surface-border-subtle text-xs"
                  >
                    <span className="truncate max-w-[200px] text-text-main">{file.name}</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => handleMoveFile(idx, 'up', e)}
                        disabled={idx === 0 || isProcessing}
                        className="p-1 text-text-muted hover:text-text-main disabled:opacity-30 cursor-pointer"
                      >
                        <ChevronUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleMoveFile(idx, 'down', e)}
                        disabled={idx === files.length - 1 || isProcessing}
                        className="p-1 text-text-muted hover:text-text-main disabled:opacity-30 cursor-pointer"
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action Button & Batch Summary */}
        <div className="pt-3 border-t border-surface-border flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-text-muted font-mono self-start sm:self-center">
            <span>Batch total: </span>
            <span className="font-semibold text-text-main">{files.length} {files.length === 1 ? 'file' : 'files'}</span>
            {files.length > 0 && <span className="text-text-faint"> ({formatBytes(totalBytes)})</span>}
          </div>

          <Button
            variant="primary"
            size="md"
            className="w-full sm:w-auto px-6 font-semibold shadow-md"
            disabled={files.length === 0 || isProcessing}
            isLoading={isProcessing}
            leftIcon={
              tool.id === 'pdf-merge' ? (
                <Layers className="w-4 h-4" />
              ) : tool.id === 'resizer' ? (
                <Crop className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4 fill-current" />
              )
            }
            onClick={onExecute}
          >
            {isProcessing
              ? 'Processing Batch...'
              : isCompressor
              ? 'Compress Files'
              : tool.id === 'pdf-merge'
              ? 'Merge'
              : tool.id === 'resizer'
              ? 'Crop & Resize'
              : tool.id === 'converter'
              ? converterMode === 'pdf-to-img'
                ? 'Convert to Images'
                : converterMode === 'img-to-img'
                ? 'Convert Images'
                : converterMode
                ? 'Convert to PDF'
                : 'Convert'
              : tool.id === 'pdf-to-image'
              ? 'Convert to Images'
              : `Run ${tool.shortName}`}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <aside
      aria-label="Tool configuration and export options"
      className={`w-80 border-l bg-surface-panel border-surface-border text-text-main flex flex-col p-4 sm:p-5 pb-[max(1rem,var(--safe-area-bottom))] pr-[max(1rem,var(--safe-area-right))] space-y-4 shrink-0 overflow-y-auto select-none ${className}`}
    >
      {/* Mobile drag handle for bottom sheet */}
      <div className="w-9 h-1 rounded-full mx-auto -mt-1 mb-1.5 sm:hidden shrink-0 bg-surface-border" />

      {/* Parameters Header */}
      <div className="flex items-center justify-between pb-3 border-b border-surface-border shrink-0">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-accent shrink-0" />
          <h2 className="text-xs sm:text-sm font-serif font-bold uppercase tracking-wider text-text-main">
            Parameters
          </h2>
        </div>
        {onCloseMobile && (
          <button
            type="button"
            onClick={onCloseMobile}
            className="lg:hidden p-1.5 rounded-md cursor-pointer text-text-muted hover:text-text-main hover:bg-surface-subtle"
            aria-label="Close parameters panel"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Dynamic Options Controls & Stretched Merge Order Area */}
      <div className="flex-1 min-h-0 flex flex-col space-y-3 overflow-y-auto pr-0.5">

        {/* Tool Options (e.g. Merged Document Name) */}
        <div className="space-y-3 shrink-0">
          {visibleOptions.map((opt) => (
            <div key={opt.id} className="space-y-1.5">
              {opt.type !== 'toggle' && (
                <div className="flex justify-between items-center text-xs">
                  <label htmlFor={`opt-${opt.id}`} className="font-semibold text-xs text-text-main">
                    {isResizer && (opt.id === 'targetWidth' || opt.id === 'targetHeight')
                      ? `${opt.label} (${resizerUnit})`
                      : opt.label}
                  </label>
                  {opt.type === 'range' && (
                    <span className="font-mono text-text-main font-semibold text-[11px] bg-surface-subtle px-1.5 py-0.5 rounded border border-surface-border-subtle">
                      {String(options[opt.id] ?? opt.defaultValue)}%
                    </span>
                  )}
                </div>
              )}

              {opt.type === 'text' && (
                <input
                  id={`opt-${opt.id}`}
                  type="text"
                  value={String(options[opt.id] ?? opt.defaultValue)}
                  onChange={(e) => handleOptionChange(opt.id, e.target.value)}
                  data-no-shortcut="true"
                  disabled={isProcessing}
                  className="w-full text-xs rounded-md px-3 py-2 focus:outline-none bg-surface-subtle border border-surface-border text-text-main focus:border-surface-border-focus font-medium"
                />
              )}

              {opt.id === 'unit' && isResizer ? (
                <div className="grid grid-cols-3 gap-1 p-1 bg-surface-subtle border border-surface-border rounded-xl">
                  {opt.options?.map((o) => {
                    const isSelected = String(options.unit ?? opt.defaultValue) === String(o.value);
                    return (
                      <button
                        key={String(o.value)}
                        type="button"
                        onClick={() => handleOptionChange('unit', o.value)}
                        disabled={isProcessing}
                        title={o.label}
                        className={`py-1.5 px-1 text-[11px] font-semibold rounded-lg transition-all cursor-pointer text-center whitespace-nowrap flex items-center justify-center overflow-hidden ${
                          isSelected
                            ? 'bg-accent text-white shadow-xs'
                            : 'text-text-main/80 hover:text-text-main hover:bg-surface-panel'
                        }`}
                      >
                        <span className="whitespace-nowrap tracking-tight font-semibold">
                          {o.value === 'px' ? 'Pixels (px)' : o.value === 'in' ? 'Inches (in)' : 'Centimeters'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : opt.type === 'select' ? (
                <select
                  id={`opt-${opt.id}`}
                  value={String(options[opt.id] ?? opt.defaultValue)}
                  onChange={(e) => handleOptionChange(opt.id, e.target.value)}
                  data-no-shortcut="true"
                  disabled={isProcessing}
                  className="w-full text-xs rounded-md px-3 py-2 focus:outline-none bg-surface-subtle border border-surface-border text-text-main focus:border-surface-border-focus"
                >
                  {opt.options?.map((o) => (
                    <option key={String(o.value)} value={String(o.value)}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : null}

              {opt.type === 'range' && (
                <div className="space-y-2">
                  <input
                    id={`opt-${opt.id}`}
                    type="range"
                    min={opt.min ?? 0}
                    max={opt.max ?? 100}
                    step={opt.step ?? 1}
                    value={Number(options[opt.id] ?? opt.defaultValue)}
                    onChange={(e) => handleOptionChange(opt.id, Number(e.target.value))}
                    disabled={isProcessing}
                    className="w-full accent-accent cursor-pointer"
                  />

                  {/* Compression intensity indicators */}
                  {opt.id === 'compressionLevel' && (
                    <div className="flex justify-between items-center text-[10px] font-mono text-text-faint px-0.5">
                      <span>Light (Min)</span>
                      <span className="text-accent font-medium">Balanced</span>
                      <span>Max Compression</span>
                    </div>
                  )}
                </div>
              )}

              {opt.type === 'toggle' && (
                <label className="flex items-center gap-2 cursor-pointer pt-1">
                  <input
                    id={`opt-${opt.id}`}
                    type="checkbox"
                    checked={Boolean(options[opt.id] ?? opt.defaultValue)}
                    onChange={(e) => handleOptionChange(opt.id, e.target.checked)}
                    disabled={isProcessing}
                    className="rounded border-surface-border text-accent focus:ring-accent accent-accent cursor-pointer"
                  />
                  <span className="text-xs font-medium text-text-main">
                    {isResizer ? opt.label : opt.description || opt.label}
                  </span>
                </label>
              )}

              {opt.description && !isResizer && opt.type !== 'toggle' && opt.id !== 'quality' && opt.id !== 'compressionLevel' && (
                <p className="text-[11px] text-text-faint">{opt.description}</p>
              )}
            </div>
          ))}

          {tool.availableOptions.length === 0 && (
            <p className="text-xs text-text-faint italic py-2">
              No configurable options for this tool.
            </p>
          )}
        </div>

        {/* Dedicated Stretched Reorder Sequence for PDF Merge Tool */}
        {tool.id === 'pdf-merge' && files.length > 0 && (
          <div className="pt-3 border-t border-surface-border flex-1 min-h-0 flex flex-col space-y-2 animate-in fade-in">
            {/* Header with Title and Quick Sort Actions */}
            <div className="flex items-center justify-between shrink-0">
              <div className="flex items-center gap-1.5">
                <ArrowDownUp className="w-3.5 h-3.5 text-accent" />
                <span className="text-xs font-semibold text-text-main">
                  Merge Order ({files.length})
                </span>
              </div>

              {/* Quick sort buttons */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleSortAlphabetical}
                  title="Sort alphabetically (A to Z)"
                  className="px-2 py-0.5 rounded text-[10px] font-mono text-text-muted hover:text-text-main hover:bg-surface-subtle border border-surface-border transition-colors cursor-pointer"
                >
                  A-Z
                </button>
                <button
                  type="button"
                  onClick={handleReverseOrder}
                  title="Reverse sequence"
                  className="px-2 py-0.5 rounded text-[10px] font-mono text-text-muted hover:text-text-main hover:bg-surface-subtle border border-surface-border transition-colors cursor-pointer"
                >
                  Reverse
                </button>
              </div>
            </div>

            <p className="text-[11px] text-text-faint shrink-0">
              Drag rows or use arrows to change the merge sequence.
            </p>

            {/* Stretched scrollable list of items - stretches all the way to bottom */}
            <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1.5">
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
                    className={`flex items-center justify-between p-2 rounded-lg text-xs transition-all select-none cursor-pointer ${
                      isBeingDragged
                        ? 'opacity-40 border-dashed border-accent'
                        : isTarget
                        ? 'border-accent bg-accent-subtle/30 ring-1 ring-accent'
                        : isSelected
                        ? 'border-accent ring-2 ring-accent/60 bg-accent-subtle/50 font-semibold shadow-xs'
                        : 'border border-surface-border bg-surface-subtle hover:border-surface-border-focus'
                    }`}
                  >
                    {/* Left: Drag handle, sequence #, file type icon, name */}
                    <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                      <GripVertical className="w-3.5 h-3.5 text-text-faint hover:text-text-main shrink-0 cursor-grab active:cursor-grabbing" />
                      <span
                        className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 transition-colors ${
                          isSelected
                            ? 'bg-accent text-accent-contrast border-accent'
                            : 'bg-accent-subtle text-accent border-accent-border'
                        }`}
                      >
                        #{idx + 1}
                      </span>
                      {isImg ? (
                        <FileImage className="w-3.5 h-3.5 text-text-faint shrink-0" />
                      ) : (
                        <FileText className="w-3.5 h-3.5 text-accent shrink-0" />
                      )}
                      <span className="truncate text-text-main text-[11px] font-medium" title={file.name}>
                        {file.name}
                      </span>
                    </div>

                    {/* Right: Up / Down arrow buttons & Delete */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={idx === 0 || isProcessing}
                        onClick={(e) => handleMoveFile(idx, 'up', e)}
                        title="Move Up"
                        className={`p-1 rounded text-text-faint hover:text-text-main hover:bg-surface-panel transition-colors ${
                          idx === 0 ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'
                        }`}
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === files.length - 1 || isProcessing}
                        onClick={(e) => handleMoveFile(idx, 'down', e)}
                        title="Move Down"
                        className={`p-1 rounded text-text-faint hover:text-text-main hover:bg-surface-panel transition-colors ${
                          idx === files.length - 1 ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'
                        }`}
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={(e) => handleRemoveFile(idx, e)}
                        title="Remove file"
                        className="p-1 rounded text-text-faint hover:text-status-error hover:bg-status-error/10 transition-colors ml-0.5 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Batch Summary & Execute Button (Anchored to Bottom) */}
      <div className="pt-3 border-t border-surface-border space-y-3 shrink-0">
        <div className="flex justify-between items-center text-xs font-mono text-text-muted">
          <span>Batch total</span>
          <span className="font-semibold text-text-main">
            {files.length} {files.length === 1 ? 'file' : 'files'}
            {files.length > 0 && ` (${formatBytes(totalBytes)})`}
          </span>
        </div>

        <Button
          variant="primary"
          size="md"
          className="w-full font-semibold shadow-md"
          disabled={files.length === 0 || isProcessing}
          isLoading={isProcessing}
          leftIcon={
            tool.id === 'pdf-merge' ? (
              <Layers className="w-4 h-4" />
            ) : tool.id === 'resizer' ? (
              <Crop className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4 fill-current" />
            )
          }
          onClick={onExecute}
        >
          {isProcessing
            ? 'Processing Batch...'
            : isCompressor
            ? 'Compress Files'
            : tool.id === 'pdf-merge'
            ? 'Merge'
            : tool.id === 'resizer'
            ? 'Crop & Resize'
            : tool.id === 'converter'
            ? converterMode === 'pdf-to-img'
              ? 'Convert to Images'
              : converterMode === 'img-to-img'
              ? 'Convert Images'
              : converterMode
              ? 'Convert to PDF'
              : 'Convert'
            : tool.id === 'pdf-to-image'
            ? 'Convert to Images'
            : `Run ${tool.shortName}`}
        </Button>
      </div>
    </aside>
  );
};
