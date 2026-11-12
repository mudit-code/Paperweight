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
  Settings,
  X,
  Check,
  Play,
  FileClock,
  Sparkles,
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
import { downloadBlob, isMobileApp } from '../../core/processors/download';
import { Button } from '../../components/ui/Button';

export interface LibraryViewProps {
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
  onOpenInTool,
  onResumeDraft,
  onViewPdf,
  onViewImages,
  onOpenSettings,
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
  const [isMultiMenuOpen, setIsMultiMenuOpen] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        setIsMultiMenuOpen(false);
      }
    };
    const handleScrollOrResize = () => {
      setMenuAnchor(null);
      setIsMultiMenuOpen(false);
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
  const hasImages = selectedAssets.some((a) => a.kind === 'image');
  const hasPdfs = selectedAssets.some((a) => a.kind === 'pdf');

  // Multi-selection actions
  const handleMultiMerge = () => {
    if (selectedAssets.length === 0) return;
    const processed = selectedAssets.map(assetToProcessedFile);
    onOpenInTool('pdf-merge', processed);
  };

  const handleMultiCreatePdf = () => {
    if (selectedAssets.length === 0) return;
    const imageAssets = selectedAssets.filter((a) => a.kind === 'image');
    const processed = imageAssets.map(assetToProcessedFile);
    onOpenInTool('converter', processed, { converterMode: 'img-to-pdf' });
  };

  const handleMultiDownload = () => {
    for (const asset of selectedAssets) {
      const blob = new Blob([asset.data], { type: asset.type });
      downloadBlob(blob, asset.name);
    }
    setSelectedIds(new Set());
    setIsMultiMenuOpen(false);
  };

  const handleMultiDelete = async () => {
    const ids = Array.from(selectedIds);
    await deleteLibraryAssets(ids);
    setSelectedIds(new Set());
    setIsMultiMenuOpen(false);
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
        <div className="h-14 px-3 sm:px-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {!isMobileApp() && onToggleSidebar && (
              <button
                type="button"
                onClick={onToggleSidebar}
                className="lg:hidden p-1.5 -ml-1 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer shrink-0"
                title="Open Navigation"
                aria-label="Open Navigation"
              >
                <Menu className="w-5 h-5" />
              </button>
            )}
            <div className="flex items-center gap-2 truncate">
              <FolderArchive className="w-4 h-4 text-accent shrink-0" />
              <h1 className="text-sm font-semibold tracking-tight text-text-main font-serif">
                Library
              </h1>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-surface-subtle text-text-muted border border-surface-border">
                {assets.length} {assets.length === 1 ? 'asset' : 'assets'}
              </span>
            </div>
          </div>

          {/* Header Right: Settings & Add */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="p-2 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer"
                title="Settings & Appearance"
                aria-label="Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}

            <Button
              variant="primary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              leftIcon={<Plus className="w-3.5 h-3.5" />}
              className="h-8 px-2.5 sm:px-3 text-xs font-semibold shadow-xs"
            >
              Add to Library
            </Button>
          </div>
        </div>
      </div>

      {/* Library Hierarchy: Top Section Tabs (Recently Processed | Drafts) & Subcategories */}
      <div className="shrink-0 bg-surface-panel/85 border-b border-surface-border px-3 sm:px-4 pt-2 pb-2.5 space-y-2">
        {/* Top-Level Section Switcher */}
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex items-center p-0.5 rounded-xl bg-surface-subtle border border-surface-border shadow-2xs">
            <button
              type="button"
              onClick={() => {
                setActiveSection('recent');
                setSelectedIds(new Set());
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeSection === 'recent'
                  ? 'bg-accent text-accent-contrast shadow-xs'
                  : 'text-text-muted hover:text-text-main'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>Recently Processed</span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono leading-none ${
                  activeSection === 'recent'
                    ? 'bg-black/20 text-white'
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
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeSection === 'drafts'
                  ? 'bg-accent text-accent-contrast shadow-xs'
                  : 'text-text-muted hover:text-text-main'
              }`}
            >
              <FileClock className="w-3.5 h-3.5 shrink-0" />
              <span>Drafts</span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono leading-none ${
                  activeSection === 'drafts'
                    ? 'bg-black/20 text-white'
                    : 'bg-surface-panel text-text-muted border border-surface-border'
                }`}
              >
                {draftAssets.length}
              </span>
            </button>
          </div>
        </div>

        {/* Category Tabs: Compression | Conversion | Merges | Resizes */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
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
                }}
                className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all cursor-pointer ${
                  isSel
                    ? 'bg-accent/15 text-accent border-accent font-semibold shadow-2xs'
                    : 'bg-surface-subtle/70 border-surface-border text-text-muted hover:text-text-main hover:bg-surface-subtle'
                }`}
              >
                <span>{cat.label}</span>
                {count > 0 && (
                  <span
                    className={`text-[10px] font-mono ${
                      isSel ? 'text-accent font-bold' : 'text-text-faint'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Toolbar & Filter Bar */}
      {sectionAssets.length > 0 && (
        <div className="shrink-0 px-3 sm:px-4 py-2 bg-surface-panel/60 border-b border-surface-border flex flex-wrap items-center justify-between gap-2 text-xs">
          {/* Left: Search input & Kind filter buttons */}
          <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-md">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder={activeSection === 'drafts' ? 'Search drafts...' : 'Search processed...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-7 pl-8 pr-2.5 text-xs bg-surface-subtle border border-surface-border rounded-lg text-text-main placeholder:text-text-faint focus:outline-none focus:border-accent"
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

            {/* Kind Filter Tabs */}
            <div className="flex items-center p-0.5 rounded-lg bg-surface-subtle border border-surface-border shrink-0">
              {(['all', 'image', 'pdf'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setFilterKind(kind)}
                  className={`px-2 py-0.5 text-[11px] font-medium rounded-md transition-all cursor-pointer ${
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

          {/* Right: Select All / Selection Count */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={selectAll}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer border border-surface-border"
            >
              {selectedIds.size > 0 && selectedIds.size === filteredAssets.length ? (
                <CheckSquare className="w-3.5 h-3.5 text-accent" />
              ) : (
                <Square className="w-3.5 h-3.5" />
              )}
              <span>Select All</span>
            </button>
          </div>
        </div>
      )}

      {/* Floating Multi-Selection Action Bar (Shown when >= 1 asset is selected) */}
      {selectedIds.size > 0 && (
        <div className="shrink-0 px-4 py-2.5 bg-accent/10 border-b border-accent/25 flex items-center justify-between gap-3 text-xs animate-in fade-in slide-in-from-top-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-accent font-mono">
              {selectedIds.size} {selectedIds.size === 1 ? 'asset' : 'assets'} selected
            </span>
          </div>

          {/* Multi-Selection Three Dots Menu */}
          <div className="relative flex items-center gap-2" data-library-menu="multi">
            {/* Direct Quick Merge/Create buttons if applicable */}
            {hasImages && !hasPdfs && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleMultiCreatePdf}
                leftIcon={<FileText className="w-3.5 h-3.5" />}
                className="h-7 px-2.5 text-xs font-semibold shadow-xs"
              >
                Create a PDF
              </Button>
            )}

            {hasPdfs && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleMultiMerge}
                leftIcon={<Layers className="w-3.5 h-3.5" />}
                className="h-7 px-2.5 text-xs font-semibold shadow-xs"
              >
                {hasImages ? 'Merge Assets' : 'Merge PDFs'}
              </Button>
            )}

            {/* Three Dots Button for Multi-Selection */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsMultiMenuOpen((prev) => !prev);
              }}
              className="p-1.5 rounded-lg border border-surface-border bg-surface-panel text-text-main hover:bg-surface-subtle transition-colors cursor-pointer shadow-xs"
              title="More actions for selected assets"
              aria-label="Selection options"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {/* Multi-Selection Dropdown Menu */}
            {isMultiMenuOpen && (
              <div className="absolute right-0 top-9 w-52 rounded-xl bg-surface-panel border border-surface-border shadow-2xl p-1 z-50 text-xs space-y-0.5 animate-in fade-in zoom-in-95">
                {/* 1. If PDFs and IMGs are BOTH selected -> Option: Merge assets */}
                {hasPdfs && hasImages && (
                  <button
                    type="button"
                    onClick={handleMultiMerge}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-text-main hover:bg-surface-subtle hover:text-accent text-left cursor-pointer font-medium"
                  >
                    <Layers className="w-4 h-4 text-accent" />
                    <span>Merge assets</span>
                  </button>
                )}

                {/* 2. If ONLY Images are selected -> Option: Create a PDF */}
                {hasImages && !hasPdfs && (
                  <button
                    type="button"
                    onClick={handleMultiCreatePdf}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-text-main hover:bg-surface-subtle hover:text-accent text-left cursor-pointer font-medium"
                  >
                    <FileText className="w-4 h-4 text-accent" />
                    <span>Create a PDF</span>
                  </button>
                )}

                {/* 3. If ONLY PDFs are selected -> Option: Merge PDFs */}
                {hasPdfs && !hasImages && (
                  <button
                    type="button"
                    onClick={handleMultiMerge}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-text-main hover:bg-surface-subtle hover:text-accent text-left cursor-pointer font-medium"
                  >
                    <Layers className="w-4 h-4 text-accent" />
                    <span>Merge PDFs</span>
                  </button>
                )}

                <div className="h-px bg-surface-border my-1" />

                {/* Download Selected */}
                <button
                  type="button"
                  onClick={handleMultiDownload}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-text-main hover:bg-surface-subtle text-left cursor-pointer"
                >
                  <Download className="w-4 h-4 text-text-muted" />
                  <span>Download selected</span>
                </button>

                {/* Delete Selected */}
                <button
                  type="button"
                  onClick={handleMultiDelete}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-status-error hover:bg-status-error-bg/20 text-left cursor-pointer font-medium"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Delete from Library</span>
                </button>
              </div>
            )}

            {/* Deselect / Close */}
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="p-1 rounded-md text-text-muted hover:text-text-main cursor-pointer"
              title="Deselect all"
            >
              <X className="w-4 h-4" />
            </button>
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
          /* Empty State */
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4">
            <div className="w-16 h-16 rounded-3xl bg-accent/10 border border-accent/20 text-accent flex items-center justify-center shadow-xs">
              {activeSection === 'drafts' ? (
                <FileClock className="w-8 h-8" />
              ) : (
                <FolderArchive className="w-8 h-8" />
              )}
            </div>
            <div className="space-y-1.5 max-w-sm">
              <h3 className="text-base font-serif font-bold text-text-main">
                {sectionAssets.length === 0
                  ? activeSection === 'drafts'
                    ? 'No in-progress Drafts'
                    : 'No Recently Processed files'
                  : 'No matching assets'}
              </h3>
              <p className="text-xs text-text-muted leading-relaxed">
                {sectionAssets.length === 0
                  ? activeSection === 'drafts'
                    ? 'When you leave an active tool before processing, saving to Drafts preserves your files and settings to resume anytime.'
                    : 'Files you compress, convert, merge, or resize appear here automatically for quick viewing and offline reuse.'
                  : 'No files match the selected category or search filter.'}
              </p>
            </div>
            {sectionAssets.length === 0 && activeSection === 'recent' ? (
              <Button
                variant="primary"
                size="md"
                onClick={() => fileInputRef.current?.click()}
                leftIcon={<Plus className="w-4 h-4" />}
                className="px-5 py-2 font-semibold text-xs shadow-sm"
              >
                Add Assets to Library
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
          /* Assets Grid View */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
            {filteredAssets.map((asset) => {
              const isSelected = selectedIds.has(asset.id);
              const isDraft = isDraftAsset(asset);
              const draftDetail = isDraft ? getDraftProcessDetail(asset) : null;

              return (
                <div
                  key={asset.id}
                  onClick={() => {
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
                  className={`group relative flex flex-col rounded-none border transition-all cursor-pointer overflow-hidden ${
                    isSelected
                      ? 'border-accent bg-accent/5 ring-2 ring-accent/30 shadow-md'
                      : 'border-surface-border bg-surface-panel hover:border-surface-border-focus hover:shadow-md'
                  }`}
                >
                  {/* Selection Checkbox OR Draft/Category Badge (Top Left) */}
                  {selectedIds.size > 0 ? (
                    <div
                      onClick={(e) => toggleSelect(asset.id, e)}
                      className="absolute top-2 left-2 z-20"
                    >
                      <div
                        className={`w-5 h-5 rounded-none flex items-center justify-center transition-all border ${
                          isSelected
                            ? 'bg-accent border-accent text-white shadow-xs ring-1 ring-white/40'
                            : 'bg-surface-panel/95 border-2 border-text-muted/60 text-transparent hover:border-accent shadow-xs'
                        }`}
                      >
                        {isSelected && (
                          <Check className="w-3.5 h-3.5 text-white stroke-[3]" />
                        )}
                      </div>
                    </div>
                  ) : isDraft ? (
                    <div className="absolute top-2 left-2 z-20">
                      <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/35 shadow-2xs">
                        DRAFT
                      </span>
                    </div>
                  ) : asset.category ? (
                    <div className="absolute top-2 left-2 z-20">
                      <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 bg-surface-panel/90 text-text-muted border border-surface-border shadow-2xs">
                        {CATEGORY_LABELS[asset.category]}
                      </span>
                    </div>
                  ) : null}

                  {/* Asset Format Badge */}
                  <div className="absolute top-2 right-2 z-20">
                    <span
                      className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-none shadow-2xs ${
                        asset.kind === 'pdf'
                          ? 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/25'
                          : 'bg-accent/15 text-accent border border-accent/25'
                      }`}
                    >
                      {asset.kind === 'pdf' ? 'PDF' : asset.name.split('.').pop()?.toUpperCase() || 'IMG'}
                    </span>
                  </div>

                  {/* Thumbnail Stage */}
                  <div className="h-32 sm:h-36 w-full bg-white dark:bg-black/30 flex items-center justify-center overflow-hidden relative rounded-none p-1 border-b border-surface-border-subtle">
                    {asset.thumbnailUrl ? (
                      <img
                        src={asset.thumbnailUrl}
                        alt={asset.name}
                        className="w-full h-full object-contain rounded-none group-hover:scale-105 transition-transform duration-200"
                        loading="lazy"
                      />
                    ) : asset.kind === 'pdf' ? (
                      <div className="flex flex-col items-center justify-center gap-1.5 text-accent animate-pulse">
                        <FileText className="w-8 h-8" />
                        <span className="text-[10px] font-mono text-text-muted">Loading preview...</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-1 text-text-muted">
                        <FileImage className="w-8 h-8 text-accent/70" />
                        <span className="text-[10px] font-mono">Image</span>
                      </div>
                    )}
                  </div>

                  {/* Asset Metadata & Three Dots Menu */}
                  <div className="p-2.5 flex items-center justify-between gap-1.5 bg-surface-panel border-t border-surface-border/50 rounded-none relative">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-text-main truncate" title={asset.name}>
                        {asset.name}
                      </p>
                      <p className="text-[10px] font-mono text-text-muted truncate">
                        {draftDetail ? `${draftDetail} · ${formatBytes(asset.size)}` : formatBytes(asset.size)}
                      </p>
                    </div>

                    {/* Single Asset Three Dots Button */}
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
                        className="p-1 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer"
                        title="Asset actions"
                        aria-label="More options"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </div>
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
            className="rounded-xl bg-surface-panel border border-surface-border shadow-2xl p-1.5 text-xs space-y-0.5 animate-in fade-in zoom-in-95 backdrop-blur-md select-none"
          >
            {/* Resume Draft Action (if Draft) */}
            {isDraftAsset(asset) && onResumeDraft && (
              <button
                type="button"
                onClick={() => {
                  onResumeDraft(asset);
                  setMenuAnchor(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-accent bg-accent/10 hover:bg-accent/20 text-left cursor-pointer font-semibold"
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
              className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-status-error hover:bg-status-error-bg/20 text-left cursor-pointer font-medium"
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
