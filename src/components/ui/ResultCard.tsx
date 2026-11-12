import React from 'react';
import {
  CheckCircle2,
  Save,
  FileText,
  FileArchive,
  Image as ImageIcon,
  FileCode,
  X,
  ExternalLink,
  TrendingDown,
} from 'lucide-react';
import type { BatchResult } from '../../core/processors/types';
import { formatBytes } from '../../core/files/validation';
import { downloadBlob, saveMultipleBlobs, isMobileApp } from '../../core/processors/download';
import { Button } from './Button';
import { Badge } from './Badge';

export interface ResultCardProps {
  result: BatchResult;
  onDismiss: () => void;
  className?: string;
}

export const ResultCard: React.FC<ResultCardProps> = ({
  result,
  onDismiss,
  className = '',
}) => {
  const isMobile = isMobileApp();
  const [isSavingAll, setIsSavingAll] = React.useState(false);

  const handleDownload = async () => {
    if (isMobile && result.items && result.items.length > 1) {
      setIsSavingAll(true);
      try {
        await saveMultipleBlobs(result.items.map((it) => ({ blob: it.blob, name: it.name })));
      } finally {
        setIsSavingAll(false);
      }
    } else {
      downloadBlob(result.blob, result.filename);
    }
  };

  const getFileIcon = () => {
    switch (result.fileType) {
      case 'pdf':
      case 'document':
        return <FileText className="w-6 h-6 text-accent" />;
      case 'zip':
        return isMobile ? <ImageIcon className="w-6 h-6 text-accent" /> : <FileArchive className="w-6 h-6 text-accent" />;
      case 'image':
        return <ImageIcon className="w-6 h-6 text-accent" />;
      default:
        return <FileCode className="w-6 h-6 text-accent" />;
    }
  };

  const hasSavings =
    result.originalSize !== undefined &&
    result.originalSize > result.size &&
    result.savingsPercent !== undefined &&
    result.savingsPercent > 0;

  const displayBadge = isMobile && result.fileType === 'zip' ? 'IMAGES' : result.fileType.toUpperCase();
  const displayTitle =
    isMobile && result.filename.toLowerCase().endsWith('.zip')
      ? `${result.itemCount} ${result.itemCount === 1 ? 'Image' : 'Images'} Ready`
      : result.filename;

  return (
    <div
      role="region"
      aria-label="Processing Result"
      className={`relative overflow-hidden rounded-xl bg-surface-panel border border-accent-border shadow-panel p-5 transition-all animate-in fade-in slide-in-from-top-2 duration-300 ${className}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Left Side: Icon & Details */}
        <div className="flex items-start sm:items-center gap-3.5 min-w-0">
          <div className="p-3 rounded-lg bg-accent-subtle text-accent border border-accent-border shrink-0">
            {getFileIcon()}
          </div>

          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-accent">
                <CheckCircle2 className="w-4 h-4" />
                Processed Successfully
              </span>
              <Badge size="sm" variant="accent">
                {displayBadge}
              </Badge>
              {hasSavings && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-accent-subtle text-accent border border-accent-border">
                  <TrendingDown className="w-3 h-3" />
                  -{result.savingsPercent}% reduction
                </span>
              )}
            </div>

            <p
              className="text-sm sm:text-base font-serif font-bold text-text-main truncate"
              title={displayTitle}
            >
              {displayTitle}
            </p>

            <div className="flex items-center gap-2 text-xs text-text-muted font-mono flex-wrap">
              {hasSavings ? (
                <>
                  <span className="line-through text-text-faint">
                    {formatBytes(result.originalSize!)}
                  </span>
                  <span>→</span>
                  <span className="font-semibold text-text-main">
                    {formatBytes(result.size)}
                  </span>
                </>
              ) : (
                <span>{formatBytes(result.size)}</span>
              )}
              <span>•</span>
              <span>
                {result.itemCount} {result.itemCount === 1 ? 'item' : 'items'}
              </span>
            </div>
          </div>
        </div>

        {/* Right Side: Action Buttons */}
        <div className="flex items-center gap-2.5 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-surface-border">
          <Button
            variant="primary"
            size="md"
            disabled={isSavingAll}
            isLoading={isSavingAll}
            onClick={handleDownload}
            leftIcon={<Save className="w-4 h-4" />}
            className="font-medium shadow-md"
          >
            {isMobile && result.items && result.items.length > 1 ? 'Save All' : 'Save File'}
          </Button>

          {result.fileType === 'pdf' && (
            <Button
              variant="secondary"
              size="md"
              onClick={() => window.open(result.downloadUrl, '_blank')}
              leftIcon={<ExternalLink className="w-3.5 h-3.5" />}
              className="text-xs"
              title="Open PDF in new tab"
            >
              Preview
            </Button>
          )}

          <button
            type="button"
            onClick={onDismiss}
            className="p-2 rounded-md text-text-faint hover:text-text-main hover:bg-surface-subtle transition-colors"
            aria-label="Dismiss result"
            title="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
