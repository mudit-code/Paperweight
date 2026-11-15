import React, { useState, useEffect, useRef } from 'react';
import {
  FolderArchive,
  MoreVertical,
  Layers,
  FileText,
  FileImage,
  Minimize2,
  Crop,
  ArrowRightLeft,
  Download,
  Trash2,
  CheckSquare,
  Square,
  Plus,
  Search,
  Eye,
  Menu,
  X,
  Check,
  Play,
  FileClock,
  Clock,
  ArrowLeft,
  Share2,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import {
  getLibraryAssets,
  deleteLibraryAssets,
  saveLibraryAssets,
  generateAssetThumbnail,
  type LibraryAsset,
  type LibraryCategory,
} from '../../core/library/library-db';
import type { ProcessedFile } from '../../core/types';
import { formatBytes } from '../../core/files/validation';
import { downloadBlob, shareMultipleBlobs, isMobileApp } from '../../core/processors/download';
import { Button } from '../../components/ui/Button';

export interface LibraryViewProps {
  onBack?: () => void;
  onOpenInTool: (toolId: string, files: ProcessedFile[], options?: Record<string, unknown>) => void;
  onResumeDraft?: (asset: LibraryAsset) => void;
  onViewPdf?: (blob: Blob, name: string) => void;
  onViewImages?: (images: Array<{ id: string; url: string; name: string; size: number }>, initialIndex?: number) => void;
  onOpenSettings?: () => void;
  onToggleSidebar?: () => void;
  onAssetCountChange?: (count: number) => void;
  className?: string;
}

const CATEGORY_TABS: Array<{ id: 'all' | LibraryCategory; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'compression', label: 'Compression' },
  { id: 'conversion', label: 'Conversion' },
  { id: 'merges', label: 'Merges' },
  { id: 'resizes', label: 'Resizes' },
];

const CATEGORY_LABELS: Record<LibraryCategory, string> = {
  compression: 'Compression',
  conversion: 'Conversion',
  merges: 'Merges',
  resizes: 'Resizes',
};

function isDraftAsset(asset: LibraryAsset): boolean {
  return asset.section === 'drafts' || Boolean(asset.draftSnapshot);
}

function getDraftProcessDetail(asset: LibraryAsset): string {
  const snap = asset.draftSnapshot;
  if (!snap) {
    return asset.category ? CATEGORY_LABELS[asset.category] : 'Draft';
  }
  const fileCount = snap.files?.length || 1;
  const countTag = fileCount > 1 ? ` · ${fileCount} files` : '';
  const opts = snap.options || {};

  if (snap.toolId === 'image-resizer') {
    const lvl = typeof opts.compressionLevel === 'number' ? ` (${opts.compressionLevel}%)` : '';
    return `Compression${lvl}${countTag}`;
  }
  if (snap.toolId === 'converter') {
    const mode = String(opts.converterMode || '');
    const modeLabel =
      mode === 'pdf-to-img'
        ? 'PDF → IMG'
        : mode === 'img-to-pdf'
        ? 'IMG → PDF'
        : mode === 'img-to-img'
        ? 'IMG → IMG'
        : 'Conversion';
    return `${modeLabel}${countTag}`;
  }
  if (snap.toolId === 'pdf-merge') {
    return `Merges${countTag}`;
  }
  if (snap.toolId === 'resizer') {
    const w = opts.targetWidth;
    const h = opts.targetHeight;
    const u = opts.unit || 'px';
    const dimTag = w && h ? ` (${w}×${h} ${u})` : '';
    return `Resizes${dimTag}`;
  }
  return `Draft${countTag}`;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  onBack,
  onOpenInTool,
  onResumeDraft,
  onViewPdf,
  onViewImages,
  onOpenSettings: _onOpenSettings,
  onToggleSidebar,
  onAssetCountChange,
  className = '',
}) => {
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeSection, setActiveSection] = useState<'recent' | 'drafts'>('recent');
  const [activeCategory, setActiveCategory] = useState<'all' | LibraryCategory>('all');
  const [hasAutoPickedInitialSection, setHasAutoPickedInitialSection] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterKind, setFilterKind] = useState<'all' | 'image' | 'pdf'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [menuAnchor, setMenuAnchor] = useState<{ id: string; rect: DOMRect } | null>(null);
  const setActiveMenuId = (_val?: string | null) => setMenuAnchor(null);
  const [isCategoryMenuOpen, setIsCategoryMenuOpen] = useState<boolean>(false);
  const [isSharing, setIsSharing] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Tap-and-hold & Drag-to-slide selection gesture refs
  const touchStartPosRef = useRef<{ x: number; y: number; assetId: string } | null>(null);
  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSlidingSelectRef = useRef<boolean>(false);
  const anchorIndexRef = useRef<number>(-1);
  const startSelectedIdsRef = useRef<Set<string>>(new Set());
  const lastSlidIndexRef = useRef<number>(-1);
  const hasSlidRef = useRef<boolean>(false);

  const handleTouchStartCard = (assetId: string, e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY, assetId };
    hasSlidRef.current = false;

    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }

    const assetIdx = filteredAssets.findIndex((a) => a.id === assetId);

    if (selectedIds.size > 0) {
      // Already in multi-selection mode:
      // Start a quick 160ms hold timer or prepare for slide-selection
      anchorIndexRef.current = assetIdx;
      startSelectedIdsRef.current = new Set(selectedIds);
      lastSlidIndexRef.current = assetIdx;
      touchTimerRef.current = setTimeout(() => {
        isSlidingSelectRef.current = true;
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try {
            navigator.vibrate?.(25);
          } catch {}
        }
        touchTimerRef.current = null;
      }, 160);
    } else {
      // Fresh tap & hold: 240ms triggers selection mode smoothly
      isSlidingSelectRef.current = false;
      anchorIndexRef.current = assetIdx;
      lastSlidIndexRef.current = assetIdx;
      touchTimerRef.current = setTimeout(() => {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try {
            navigator.vibrate?.(40);
          } catch {}
        }
        const freshSet = new Set([assetId]);
        setSelectedIds(freshSet);
        startSelectedIdsRef.current = freshSet;
        isSlidingSelectRef.current = true;
        touchTimerRef.current = null;
      }, 240);
    }
  };

  const handleTouchMoveCard = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touchStartPosRef.current) return;

    const dx = Math.abs(touch.clientX - touchStartPosRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartPosRef.current.y);

    // Cancel timer if finger moves > 18px before hold duration finishes (normal vertical scroll)
    if (touchTimerRef.current && (dx > 18 || dy > 18)) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
      return;
    }

    // When slide-selection is active
    if (isSlidingSelectRef.current) {
      if (e.cancelable) {
        e.preventDefault();
      }
      hasSlidRef.current = true;

      const targetEl = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null;
      const cardEl = targetEl?.closest('[data-asset-id]') as HTMLElement | null;
      const currentAssetId = cardEl?.dataset.assetId;

      if (!currentAssetId) return;

      const currentIndex = filteredAssets.findIndex((a) => a.id === currentAssetId);
      const anchorIndex = anchorIndexRef.current;

      if (currentIndex !== -1 && anchorIndex !== -1) {
        if (currentIndex !== lastSlidIndexRef.current) {
          lastSlidIndexRef.current = currentIndex;
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            try {
              navigator.vibrate?.(15);
            } catch {}
          }
        }

        const minIdx = Math.min(anchorIndex, currentIndex);
        const maxIdx = Math.max(anchorIndex, currentIndex);

        const next = new Set(startSelectedIdsRef.current);
        for (let i = minIdx; i <= maxIdx; i++) {
          const item = filteredAssets[i];
          if (item) {
            next.add(item.id);
          }
        }

        setSelectedIds(next);
      }
    }
  };

  const handleTouchEndCard = () => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
    touchStartPosRef.current = null;
    anchorIndexRef.current = -1;
    lastSlidIndexRef.current = -1;
    setTimeout(() => {
      hasSlidRef.current = false;
      isSlidingSelectRef.current = false;
    }, 80);
  };

  // Load assets from storage and generate missing PDF thumbnails dynamically
  const loadAssets = async () => {
    setLoading(true);
    try {
      const list = await getLibraryAssets();
      setAssets(list);
      onAssetCountChange?.(list.length);

      if (!hasAutoPickedInitialSection) {
        setHasAutoPickedInitialSection(true);
        const recentTotal = list.filter((a) => !isDraftAsset(a)).length;
        const draftsTotal = list.filter((a) => isDraftAsset(a)).length;
        if (recentTotal === 0 && draftsTotal > 0) {
          setActiveSection('drafts');
        }
      }

      // Asynchronously generate missing thumbnails (e.g. for PDFs) and update DB
      const missingThumbs = list.filter((a) => !a.thumbnailUrl && (a.kind === 'pdf' || a.type.includes('pdf')));
      if (missingThumbs.length > 0) {
        missingThumbs.forEach(async (asset) => {
          try {
            const thumb = await generateAssetThumbnail(asset.data, asset.type);
            if (thumb) {
              asset.thumbnailUrl = thumb;
              await saveLibraryAssets([asset]);
              setAssets((prev) =>
                prev.map((it) => (it.id === asset.id ? { ...it, thumbnailUrl: thumb } : it))
              );
            }
          } catch (err) {
            console.warn('Could not generate thumb for', asset.name, err);
          }
        });
      }
    } catch (err) {
      console.error('Failed to load library assets:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAssets();
  }, []);

  // Close menus on outside click, window resize, or scroll
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('[data-library-menu]')) {
        setMenuAnchor(null);
      }
      if (!target?.closest('[data-library-category-dropdown]')) {
        setIsCategoryMenuOpen(false);
      }
    };
    const handleScrollOrResize = () => {
      setMenuAnchor(null);
      setIsCategoryMenuOpen(false);
    };
    window.addEventListener('click', handleOutsideClick);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      window.removeEventListener('click', handleOutsideClick);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, []);

  // Section & Category partitions
  const draftAssets = assets.filter((a) => isDraftAsset(a));
  const recentAssets = assets.filter((a) => !isDraftAsset(a));
  const sectionAssets = activeSection === 'drafts' ? draftAssets : recentAssets;

  // Filter assets by active section, category, search query, and file kind
  const filteredAssets = sectionAssets.filter((asset) => {
    const matchesCategory = activeCategory === 'all' || asset.category === activeCategory;
    const matchesSearch = asset.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesKind = filterKind === 'all' || asset.kind === filterKind;
    return matchesCategory && matchesSearch && matchesKind;
  });

  // Handle uploading files directly into Library
  const handleUploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const rawFiles = Array.from(e.target.files);
    const toSave = await Promise.all(
      rawFiles.map(async (file) => {
        const buf = await file.arrayBuffer();
        const mime = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
        return {
          name: file.name,
          type: mime,
          size: file.size,
          data: buf,
          section: 'recent' as const,
        };
      })
    );
    await saveLibraryAssets(toSave);
    setActiveSection('recent');
    await loadAssets();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Convert LibraryAsset to ProcessedFile
  const assetToProcessedFile = (asset: LibraryAsset): ProcessedFile => {
    return {
      id: `f_lib_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: asset.name,
      size: asset.size,
      type: asset.type,
      lastModified: asset.createdAt,
      data: asset.data,
    };
  };

  // Selection helpers
  const toggleSelect = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filteredAssets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAssets.map((a) => a.id)));
    }
  };

  const selectedAssets = assets.filter((a) => selectedIds.has(a.id));

  // Multi-selection actions: Share all at once, Delete selected
  const handleMultiShare = async () => {
    if (selectedAssets.length === 0) return;
    setIsSharing(true);
    try {
      const items = selectedAssets.map((asset) => ({
        blob: new Blob([asset.data], { type: asset.type }),
        name: asset.name,
      }));
      await shareMultipleBlobs(items);
    } catch (err) {
      console.error('Error sharing assets:', err);
    } finally {
      setIsSharing(false);
    }
  };

  const handleMultiDelete = async () => {
    const ids = Array.from(selectedIds);
    await deleteLibraryAssets(ids);
    setSelectedIds(new Set());
    await loadAssets();
  };

  // Single asset actions
  const handleDeleteSingle = async (id: string) => {
    await deleteLibraryAssets([id]);
    setActiveMenuId(null);
    await loadAssets();
  };

  const handleDownloadSingle = (asset: LibraryAsset) => {
    const blob = new Blob([asset.data], { type: asset.type });
    downloadBlob(blob, asset.name);
    setActiveMenuId(null);
  };

  const handleOpenImageInResizer = (asset: LibraryAsset) => {
    const file = assetToProcessedFile(asset);
    onOpenInTool('resizer', [file]);
    setActiveMenuId(null);
  };

  const handleOpenImageInCompressor = (asset: LibraryAsset) => {
    const file = assetToProcessedFile(asset);
    onOpenInTool('image-resizer', [file], { compressorMode: 'image' });
    setActiveMenuId(null);
  };

  const handleOpenImageInConverter = (asset: LibraryAsset) => {
    const file = assetToProcessedFile(asset);
    onOpenInTool('converter', [file], { converterMode: 'img-to-img' });
    setActiveMenuId(null);
  };

  const handleOpenPdfInCompressor = (asset: LibraryAsset) => {
    const file = assetToProcessedFile(asset);
    onOpenInTool('image-resizer', [file], { compressorMode: 'pdf' });
    setActiveMenuId(null);
  };

  const handleOpenPdfInConverter = (asset: LibraryAsset) => {
    const file = assetToProcessedFile(asset);
    onOpenInTool('converter', [file], { converterMode: 'pdf-to-img' });
    setActiveMenuId(null);
  };

  const handleOpenPdfInMerger = (asset: LibraryAsset) => {
    const file = assetToProcessedFile(asset);
    onOpenInTool('pdf-merge', [file]);
    setActiveMenuId(null);
  };

  const handleViewPdfSingle = (asset: LibraryAsset) => {
    if (onViewPdf) {
      const blob = new Blob([asset.data], { type: 'application/pdf' });
      onViewPdf(blob, asset.name);
    }
    setActiveMenuId(null);
  };

  const handleViewImageSingle = (asset: LibraryAsset) => {
    if (!onViewImages) return;
    const imageAssets = filteredAssets.filter((a) => a.kind === 'image');
    const galleryItems = imageAssets.map((a) => {
      const blob = new Blob([a.data], { type: a.type });
      return {
        id: a.id,
        name: a.name,
        url: URL.createObjectURL(blob),
        blob,
        size: a.size,
        type: a.type,
      };
    });
    const idx = imageAssets.findIndex((a) => a.id === asset.id);
    onViewImages(galleryItems, Math.max(0, idx));
    setActiveMenuId(null);
  };

  return (
    <div className={`h-full w-full flex flex-col overflow-hidden select-none bg-surface-bg text-text-main ${className}`}>
      {/* Hidden file input for uploading assets */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,application/pdf"
        onChange={handleUploadFiles}
        className="hidden"
      />

      {/* Top Header Bar */}
      <div className="shrink-0 w-full bg-surface-panel border-b border-surface-border text-text-main z-20 pt-[var(--safe-area-top)] pl-[var(--safe-area-left)] pr-[var(--safe-area-right)] transition-[padding] duration-150">
        <div className="h-14 px-3 sm:px-4 flex items-center justify-between gap-2 relative">
          {/* Leftmost: Back Button */}
          <div className="flex items-center shrink-0">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="min-h-[44px] min-w-[44px] -ml-2 rounded-control text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer inline-flex items-center justify-center"
                title="Back"
                aria-label="Back"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            ) : !isMobileApp() && onToggleSidebar ? (
              <button
                type="button"
                onClick={onToggleSidebar}
                className="lg:hidden p-1.5 -ml-1 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer shrink-0"
                title="Open Navigation"
                aria-label="Open Navigation"
              >
                <Menu className="w-5 h-5" />
              </button>
            ) : (
              <div className="w-9" />
            )}
          </div>

          {/* Center: Library Heading with Icon and Count */}
          <div className="flex items-center justify-center gap-2">
            <FolderArchive className="w-5 h-5 text-accent shrink-0" />
            <h1 className="text-base font-semibold tracking-tight text-text-main">
              Library
            </h1>
            <span className="text-xs font-mono px-2 py-0.5 rounded-chip bg-surface-subtle text-text-muted border border-surface-border">
              {assets.length}
            </span>
          </div>

          {/* Right Spacer (no settings) to keep heading perfectly centered */}
          <div className="w-9 shrink-0" />
        </div>
      </div>

      {/* 1. TOP DUAL BAR: When selecting, converts Recents/Drafts into the Selection Bar; otherwise Recents / Drafts */}
      {selectedIds.size > 0 ? (
        <div className="shrink-0 bg-surface-panel-raised border-b border-surface-border px-3 sm:px-4 py-2 min-h-[48px] flex items-center justify-between gap-2 text-xs animate-in fade-in">
          {/* Left: Selected count */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-accent font-mono text-xs truncate">
              {selectedIds.size} {selectedIds.size === 1 ? 'selected' : 'selected'}
            </span>
          </div>

          {/* Right: Select All icon, Share, Delete, Cross (✕) in that exact order */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Compact Select All icon button (avoids writing long overflowing text) */}
            <button
              type="button"
              onClick={selectAll}
              className={`h-8 w-8 rounded-control border transition-colors inline-flex items-center justify-center cursor-pointer ${
                selectedIds.size > 0 && selectedIds.size === filteredAssets.length
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-surface-border bg-surface-subtle text-text-muted hover:text-text-main hover:bg-surface-hover'
              }`}
              title={selectedIds.size === filteredAssets.length ? 'Deselect all' : 'Select all'}
              aria-label="Select all"
            >
              {selectedIds.size > 0 && selectedIds.size === filteredAssets.length ? (
                <CheckSquare className="w-4 h-4 text-accent" />
              ) : (
                <Square className="w-4 h-4" />
              )}
            </button>

            {/* Share: shares all selected files at once */}
            <button
              type="button"
              onClick={handleMultiShare}
              disabled={isSharing}
              className="h-8 px-2.5 rounded-control border border-surface-border bg-surface-subtle hover:bg-surface-hover text-text-main text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              title="Share selected files"
              aria-label="Share selected files"
            >
              {isSharing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-accent shrink-0" />
              ) : (
                <Share2 className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>Share</span>
            </button>

            {/* Delete: deletes selected files */}
            <button
              type="button"
              onClick={handleMultiDelete}
              className="h-8 px-2.5 rounded-control border border-surface-border bg-surface-subtle hover:bg-status-error-bg text-status-error text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Delete selected files"
              aria-label="Delete selected files"
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" />
              <span>Delete</span>
            </button>

            {/* Cross: clear selection and exit selection mode */}
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="h-8 w-8 rounded-control border border-surface-border bg-surface-subtle hover:bg-surface-hover text-text-muted hover:text-text-main inline-flex items-center justify-center transition-colors cursor-pointer"
              title="Clear selection"
              aria-label="Clear selection"
            >
              <X className="w-4 h-4 shrink-0" />
            </button>
          </div>
        </div>
      ) : (
        <div className="shrink-0 bg-surface-panel border-b border-surface-border px-3 sm:px-4 py-2 min-h-[48px] flex items-center justify-center">
          <div className="inline-flex items-center p-0.5 rounded-control bg-surface-subtle border border-surface-border">
            <button
              type="button"
              onClick={() => {
                setActiveSection('recent');
                setSelectedIds(new Set());
              }}
              className={`min-h-[34px] h-8 flex items-center gap-1.5 px-3 rounded-control text-xs font-semibold transition-colors cursor-pointer ${
                activeSection === 'recent'
                  ? 'bg-accent text-accent-contrast shadow-2xs'
                  : 'text-text-muted hover:text-text-main'
              }`}
            >
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>Recents</span>
              <span
                className={`px-2 py-0.5 rounded-chip text-xs font-mono leading-none ${
                  activeSection === 'recent'
                    ? 'bg-surface-panel text-text-main border border-surface-border'
                    : 'bg-surface-panel text-text-muted border border-surface-border'
                }`}
              >
                {recentAssets.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveSection('drafts');
                setSelectedIds(new Set());
              }}
              className={`min-h-[34px] h-8 flex items-center gap-1.5 px-3 rounded-control text-xs font-semibold transition-colors cursor-pointer ${
                activeSection === 'drafts'
                  ? 'bg-accent text-accent-contrast shadow-2xs'
                  : 'text-text-muted hover:text-text-main'
              }`}
            >
              <FileClock className="w-3.5 h-3.5 shrink-0" />
              <span>Drafts</span>
              <span
                className={`px-2 py-0.5 rounded-chip text-xs font-mono leading-none ${
                  activeSection === 'drafts'
                    ? 'bg-surface-panel text-text-main border border-surface-border'
                    : 'bg-surface-panel text-text-muted border border-surface-border'
                }`}
              >
                {draftAssets.length}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* 2. SINGLE-LINE TOOLBAR: Search Bar, Category Dropdown & All/Images/PDFs Selector on ONE single row */}
      {sectionAssets.length > 0 && (
        <div className="shrink-0 px-3 sm:px-4 py-2 bg-surface-panel border-b border-surface-border flex items-center gap-1.5 sm:gap-2 text-xs min-h-[48px] flex-nowrap overflow-x-auto no-scrollbar">
          {/* 1. Search Input (small, compact, flexible) */}
          <div className="relative flex-1 min-w-[70px] max-w-sm">
            <Search className="w-3.5 h-3.5 text-text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-8 pl-8 pr-2.5 text-xs bg-surface-subtle border border-surface-border rounded-lg text-text-main placeholder:text-text-faint focus:outline-none focus:border-accent"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* 2. Selection List (Collapsible Category Dropdown) */}
          <div className="relative shrink-0" data-library-category-dropdown="true">
            <button
              type="button"
              onClick={() => setIsCategoryMenuOpen((prev) => !prev)}
              className={`h-8 flex items-center gap-1 px-2 rounded-lg border text-xs transition-colors cursor-pointer shrink-0 ${
                activeCategory !== 'all'
                  ? 'bg-accent/15 border-accent text-accent font-semibold'
                  : 'bg-surface-subtle border-surface-border text-text-muted hover:text-text-main hover:bg-surface-hover'
              }`}
              title="Filter by Category"
            >
              <span className="truncate max-w-[80px]">
                {CATEGORY_TABS.find((c) => c.id === activeCategory)?.label || 'All'}
              </span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isCategoryMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {isCategoryMenuOpen && (
              <div className="absolute left-0 sm:left-auto sm:right-0 top-9 w-44 rounded-xl bg-surface-panel border border-surface-border shadow-lifted p-1 z-40 text-xs space-y-0.5 animate-in fade-in zoom-in-95">
                {CATEGORY_TABS.map((cat) => {
                  const count =
                    cat.id === 'all'
                      ? sectionAssets.length
                      : sectionAssets.filter((a) => a.category === cat.id).length;
                  const isSel = activeCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => {
                        setActiveCategory(cat.id);
                        setSelectedIds(new Set());
                        setIsCategoryMenuOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                        isSel
                          ? 'bg-accent text-accent-contrast font-semibold'
                          : 'text-text-main hover:bg-surface-subtle'
                      }`}
                    >
                      <span>{cat.label}</span>
                      <span className={`text-[11px] font-mono ${isSel ? 'text-accent-contrast' : 'text-text-muted'}`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3. All / Images / PDFs Selector (in the end) */}
          <div className="flex items-center p-0.5 rounded-lg bg-surface-subtle border border-surface-border shrink-0">
            {(['all', 'image', 'pdf'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setFilterKind(kind)}
                className={`px-2 py-1 text-[11px] font-medium rounded-md transition-all cursor-pointer ${
                  filterKind === kind
                    ? 'bg-surface-panel text-accent font-semibold shadow-2xs'
                    : 'text-text-muted hover:text-text-main'
                }`}
              >
                {kind === 'all' ? 'All' : kind === 'image' ? 'Images' : 'PDFs'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Asset Grid Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-24 lg:pb-6 min-h-0">
        {loading ? (
          <div className="h-full flex items-center justify-center text-text-muted text-xs font-mono">
            Loading library assets...
          </div>
        ) : filteredAssets.length === 0 ? (
          /* Empty State: one plain line, one primary action, no illustration */
          <div className="h-full flex flex-col items-center justify-center text-center p-6 gap-3">
            <p className="text-sm text-text-muted max-w-sm">
              {sectionAssets.length === 0
                ? activeSection === 'drafts'
                  ? 'No saved drafts yet.'
                  : 'Processed files and saved items appear here.'
                : 'No assets match the current filter.'}
            </p>
            {sectionAssets.length === 0 && activeSection === 'recent' ? (
              <Button
                variant="primary"
                size="md"
                onClick={() => fileInputRef.current?.click()}
                leftIcon={<Plus className="w-4 h-4" />}
              >
                Choose files
              </Button>
            ) : sectionAssets.length > 0 ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setActiveCategory('all');
                  setSearchQuery('');
                  setFilterKind('all');
                }}
              >
                Clear Filters
              </Button>
            ) : null}
          </div>
        ) : (
          /* Assets Grid View (Paper Sheet Tiles) */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
            {filteredAssets.map((asset) => {
              const isSelected = selectedIds.has(asset.id);
              const isDraft = isDraftAsset(asset);
              const draftDetail = isDraft ? getDraftProcessDetail(asset) : null;

              return (
                <div
                  key={asset.id}
                  data-asset-id={asset.id}
                  onTouchStart={(e) => handleTouchStartCard(asset.id, e)}
                  onTouchEnd={handleTouchEndCard}
                  onTouchMove={handleTouchMoveCard}
                  onTouchCancel={handleTouchEndCard}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    toggleSelect(asset.id);
                  }}
                  onClick={(e) => {
                    if (hasSlidRef.current) {
                      e.preventDefault();
                      return;
                    }
                    if (selectedIds.size > 0) {
                      toggleSelect(asset.id);
                    } else if (isDraft && onResumeDraft) {
                      onResumeDraft(asset);
                    } else {
                      if (asset.kind === 'image') {
                        handleViewImageSingle(asset);
                      } else if (asset.kind === 'pdf') {
                        handleViewPdfSingle(asset);
                      }
                    }
                  }}
                  className={`paper-sheet group relative flex flex-col transition-colors cursor-pointer overflow-hidden ${
                    isSelected ? 'border-accent ring-1 ring-accent' : ''
                  }`}
                  style={{ WebkitTouchCallout: 'none', userSelect: 'none' }}
                >
                  {/* Selection Checkbox OR Draft/Category Badge (Top Left) */}
                  {selectedIds.size > 0 ? (
                    <div
                      onClick={(e) => toggleSelect(asset.id, e)}
                      className="absolute top-2 left-2 z-20"
                    >
                      <div
                        className={`w-6 h-6 rounded-control flex items-center justify-center transition-colors border ${
                          isSelected
                            ? 'bg-accent border-accent text-accent-contrast'
                            : 'bg-surface-panel border-surface-border text-transparent hover:border-accent shadow-xs'
                        }`}
                      >
                        {isSelected && (
                          <Check className="w-4 h-4 stroke-[3]" />
                        )}
                      </div>
                    </div>
                  ) : isDraft ? (
                    <div className="absolute top-2 left-2 z-20">
                      <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-chip bg-status-warning-bg text-status-warning border border-status-warning-border">
                        DRAFT
                      </span>
                    </div>
                  ) : asset.category ? (
                    <div className="absolute top-2 left-2 z-20">
                      <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-chip bg-surface-panel text-text-muted border border-surface-border shadow-xs">
                        {CATEGORY_LABELS[asset.category]}
                      </span>
                    </div>
                  ) : null}

                  {/* Asset Format Badge */}
                  <div className="absolute top-2 right-2 z-20">
                    <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-chip bg-surface-panel text-text-main border border-surface-border shadow-xs">
                      {asset.kind === 'pdf' ? 'PDF' : asset.name.split('.').pop()?.toUpperCase() || 'IMG'}
                    </span>
                  </div>

                  {/* Thumbnail Stage */}
                  <div className="h-32 sm:h-36 w-full bg-surface-subtle flex items-center justify-center overflow-hidden relative p-1 border-b border-surface-border-subtle">
                    {asset.thumbnailUrl ? (
                      <img
                        src={asset.thumbnailUrl}
                        alt={asset.name}
                        className="w-full h-full object-contain"
                        loading="lazy"
                      />
                    ) : asset.kind === 'pdf' ? (
                      <div className="flex flex-col items-center justify-center gap-1.5 text-text-muted">
                        <FileText className="w-8 h-8" />
                        <span className="text-xs font-mono">PDF</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-1 text-text-muted">
                        <FileImage className="w-8 h-8" />
                        <span className="text-xs font-mono">Image</span>
                      </div>
                    )}
                  </div>

                  {/* Asset Metadata & Three Dots Menu */}
                  <div className="p-2.5 flex items-center justify-between gap-1.5 bg-surface-panel relative">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-mono font-medium text-text-main truncate" title={asset.name}>
                        {asset.name}
                      </p>
                      <p className="text-xs font-mono text-text-muted truncate">
                        {draftDetail ? `${draftDetail} · ${formatBytes(asset.size)}` : formatBytes(asset.size)}
                      </p>
                    </div>

                    {/* Single Asset Three Dots Button: hidden while selecting so click solely toggles */}
                    {selectedIds.size === 0 && (
                      <div className="relative shrink-0" data-library-menu={asset.id}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const btnRect = e.currentTarget.getBoundingClientRect();
                            if (menuAnchor?.id === asset.id) {
                              setMenuAnchor(null);
                            } else {
                              setMenuAnchor({ id: asset.id, rect: btnRect });
                            }
                          }}
                          className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-control text-text-muted hover:text-text-main hover:bg-surface-hover transition-colors cursor-pointer"
                          title="Asset actions"
                          aria-label="More options"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Contextual Menu per Single Asset (Fixed viewport positioning with smart upwards/downwards detection, immune to parent clipping) */}
      {menuAnchor && (() => {
        const asset = assets.find((a) => a.id === menuAnchor.id);
        if (!asset) return null;
        const isSelected = selectedIds.has(asset.id);
        const menuWidth = 208; // 13rem
        const menuEstimatedHeight = (asset.kind === 'image' ? 290 : 250) + (isDraftAsset(asset) ? 38 : 0);

        // Smart space detection: open downwards if ample space below, else open upwards
        const spaceBelow = window.innerHeight - menuAnchor.rect.bottom;
        const openUpwards = spaceBelow < menuEstimatedHeight && menuAnchor.rect.top > spaceBelow;

        const top = openUpwards
          ? Math.max(8, menuAnchor.rect.top - menuEstimatedHeight - 4)
          : Math.min(window.innerHeight - menuEstimatedHeight - 8, menuAnchor.rect.bottom + 4);

        const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, menuAnchor.rect.right - menuWidth));

        return (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: `${Math.round(top)}px`,
              left: `${Math.round(left)}px`,
              width: `${menuWidth}px`,
              zIndex: 9999,
            }}
            className="rounded-sheet bg-surface-panel border border-surface-border shadow-lifted p-1.5 text-xs space-y-0.5 select-none"
          >
            {/* Resume Draft Action (if Draft) */}
            {isDraftAsset(asset) && onResumeDraft && (
              <button
                type="button"
                onClick={() => {
                  onResumeDraft(asset);
                  setMenuAnchor(null);
                }}
                className="w-full min-h-[36px] flex items-center gap-2 px-3 rounded-control text-accent-contrast bg-accent hover:bg-accent-hover text-left cursor-pointer font-semibold"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Resume Draft</span>
              </button>
            )}

            {/* 1. Select Item Action */}
            <button
              type="button"
              onClick={() => {
                toggleSelect(asset.id);
                setMenuAnchor(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-text-main hover:bg-surface-subtle hover:text-accent text-left cursor-pointer font-medium"
            >
              <CheckSquare className="w-3.5 h-3.5 text-accent" />
              <span>{isSelected ? 'Deselect item' : 'Select item'}</span>
            </button>

            {/* 2. Direct Viewer Action */}
            {asset.kind === 'image' ? (
              <button
                type="button"
                onClick={() => {
                  handleViewImageSingle(asset);
                  setMenuAnchor(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-text-main hover:bg-surface-subtle hover:text-accent text-left cursor-pointer font-medium"
              >
                <Eye className="w-3.5 h-3.5 text-accent" />
                <span>Open in Gallery</span>
              </button>
            ) : (
              onViewPdf && (
                <button
                  type="button"
                  onClick={() => {
                    handleViewPdfSingle(asset);
                    setMenuAnchor(null);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-text-main hover:bg-surface-subtle hover:text-accent text-left cursor-pointer font-medium"
                >
                  <Eye className="w-3.5 h-3.5 text-accent" />
                  <span>Open PDF Viewer</span>
                </button>
              )
            )}

            <div className="h-px bg-surface-border my-1" />

            {/* IMAGE OPTIONS */}
            {asset.kind === 'image' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    handleOpenImageInResizer(asset);
                    setMenuAnchor(null);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-text-main hover:bg-surface-subtle hover:text-accent text-left cursor-pointer font-medium"
                >
                  <Crop className="w-3.5 h-3.5 text-accent" />
                  <span>Resize image</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleOpenImageInCompressor(asset);
                    setMenuAnchor(null);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-text-main hover:bg-surface-subtle hover:text-accent text-left cursor-pointer font-medium"
                >
                  <Minimize2 className="w-3.5 h-3.5 text-accent" />
                  <span>Compress image</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleOpenImageInConverter(asset);
                    setMenuAnchor(null);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-text-main hover:bg-surface-subtle hover:text-accent text-left cursor-pointer font-medium"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5 text-accent" />
                  <span>Convert image</span>
                </button>
              </>
            )}

            {/* PDF OPTIONS */}
            {asset.kind === 'pdf' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    handleOpenPdfInCompressor(asset);
                    setMenuAnchor(null);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-text-main hover:bg-surface-subtle hover:text-accent text-left cursor-pointer font-medium"
                >
                  <Minimize2 className="w-3.5 h-3.5 text-accent" />
                  <span>Compress PDF</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleOpenPdfInConverter(asset);
                    setMenuAnchor(null);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-text-main hover:bg-surface-subtle hover:text-accent text-left cursor-pointer font-medium"
                >
                  <FileImage className="w-3.5 h-3.5 text-accent" />
                  <span>Convert PDF to Images</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleOpenPdfInMerger(asset);
                    setMenuAnchor(null);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-text-main hover:bg-surface-subtle hover:text-accent text-left cursor-pointer font-medium"
                >
                  <Layers className="w-3.5 h-3.5 text-accent" />
                  <span>Merge with other PDFs</span>
                </button>
              </>
            )}

            <div className="h-px bg-surface-border my-1" />

            {/* Common Actions: Download & Delete */}
            <button
              type="button"
              onClick={() => {
                handleDownloadSingle(asset);
                setMenuAnchor(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-text-main hover:bg-surface-subtle text-left cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-text-muted" />
              <span>Download</span>
            </button>

            <button
              type="button"
              onClick={() => {
                handleDeleteSingle(asset.id);
                setMenuAnchor(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-status-error hover:bg-status-error-bg text-left cursor-pointer font-medium"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete from Library</span>
            </button>
          </div>
        );
      })()}
    </div>
  );
};
export default LibraryView;
