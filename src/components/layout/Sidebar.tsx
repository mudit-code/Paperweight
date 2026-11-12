import React from 'react';
import {
  FileImage,
  FileText,
  Layers,
  Crop,
  ArrowRightLeft,
  Wrench,
  Minimize2,
  FileArchive,
  FileCode,
  Scan,
  X,
  FolderArchive,
} from 'lucide-react';
import { BrandLogo } from '../brand/BrandLogo';
import type { ToolManifest } from '../../core/tools/types';
import { isMobileApp } from '../../core/processors/download';

export interface SidebarProps {
  tools: ToolManifest[];
  activeToolId: string;
  onSelectTool: (id: string) => void;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
  libraryCount?: number;
}

// Icon mapper for dynamic tool icons from manifest
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  FileImage,
  FileText,
  Layers,
  Crop,
  ArrowRightLeft,
  Wrench,
  Minimize2,
  FileArchive,
  FileCode,
};

export const Sidebar: React.FC<SidebarProps> = ({
  tools,
  activeToolId,
  onSelectTool,
  isOpenMobile = false,
  onCloseMobile,
  libraryCount = 0,
}) => {
  const displayTools = isMobileApp()
    ? tools
    : tools.filter((t) => t.id !== 'scanner' && t.id !== 'scans');

  const handleSelectTool = (id: string) => {
    onSelectTool(id);
    if (onCloseMobile) {
      onCloseMobile();
    }
  };

  const sidebarContent = (
    <>
      {/* Sidebar Brand Header (matching main header height including safe area) */}
      <div className="pt-[var(--safe-area-top)] border-b border-surface-border shrink-0 transition-[padding] duration-150">
        <div className="h-14 px-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <BrandLogo size={24} className="w-6 h-6 rounded-md shadow-xs" />
            <span className="font-serif font-bold text-lg tracking-tight text-text-main">
              Paperweight
            </span>
          </div>
          {onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="lg:hidden p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-subtle cursor-pointer transition-colors"
              aria-label="Close sidebar"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Tools list */}
      <nav
        role="navigation"
        aria-label="Available document and image tools"
        className="flex-1 overflow-y-auto p-2 space-y-1"
      >
        {/* Scans tab (desktop) */}
        {!isMobileApp() && (
          <div className="mb-1 pb-1">
            <button
              type="button"
              onClick={() => handleSelectTool('scans')}
              className={`w-full group flex items-center justify-between px-3 py-2.5 rounded-lg text-left text-xs font-medium transition-all duration-150 cursor-pointer ${
                activeToolId === 'scans'
                  ? 'bg-accent text-white font-semibold shadow-xs'
                  : 'text-text-muted hover:text-text-main hover:bg-surface-subtle'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Scan
                  className={`w-4 h-4 shrink-0 transition-colors ${
                    activeToolId === 'scans'
                      ? 'text-white'
                      : 'text-text-faint group-hover:text-text-muted'
                  }`}
                />
                <span className="truncate">Recent Scans</span>
              </div>
              <span
                className={`flex items-center justify-center w-4 h-4 rounded text-[11px] font-bold transition-colors ${
                  activeToolId === 'scans'
                    ? 'bg-white/20 text-white'
                    : 'bg-surface-subtle text-text-faint group-hover:text-accent group-hover:bg-accent-subtle'
                }`}
                title="Recent Scans"
              >
                +
              </span>
            </button>
          </div>
        )}

        {/* Library tab */}
        <div className="mb-2 pb-2 border-b border-surface-border">
          <button
            type="button"
            onClick={() => handleSelectTool('library')}
            className={`w-full group flex items-center justify-between px-3 py-2.5 rounded-lg text-left text-xs font-medium transition-all duration-150 cursor-pointer ${
              activeToolId === 'library'
                ? 'bg-accent text-white font-semibold shadow-xs'
                : 'text-text-muted hover:text-text-main hover:bg-surface-subtle'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <FolderArchive
                className={`w-4 h-4 shrink-0 transition-colors ${
                  activeToolId === 'library'
                    ? 'text-white'
                    : 'text-text-faint group-hover:text-text-muted'
                }`}
              />
              <span className="truncate">Library</span>
            </div>
            {libraryCount > 0 && (
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold transition-colors ${
                  activeToolId === 'library'
                    ? 'bg-white/20 text-white'
                    : 'bg-surface-subtle text-text-muted group-hover:text-accent'
                }`}
              >
                {libraryCount}
              </span>
            )}
          </button>
        </div>

        {displayTools.map((tool) => {
          const isActive = tool.id === activeToolId;
          const IconComponent = ICON_MAP[tool.iconName] || Wrench;

          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => handleSelectTool(tool.id)}
              className={`w-full group flex items-center justify-between px-3 py-2.5 rounded-lg text-left text-xs font-medium transition-all duration-150 cursor-pointer ${
                isActive
                  ? 'bg-accent-subtle text-accent font-semibold shadow-xs'
                  : 'text-text-muted hover:text-text-main hover:bg-surface-subtle'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <IconComponent
                  className={`w-4 h-4 shrink-0 transition-colors ${
                    isActive
                      ? 'text-accent'
                      : 'text-text-faint group-hover:text-text-muted'
                  }`}
                />
                <span className="truncate">{tool.name}</span>
              </div>
              {tool.shortcutIndex && (
                <kbd
                  aria-label={`Alt plus ${tool.shortcutIndex}`}
                  className={`hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono rounded border transition-colors ${
                    isActive
                      ? 'bg-accent/10 border-accent/30 text-accent font-bold'
                      : 'bg-surface-subtle border-surface-border-subtle text-text-faint group-hover:text-text-muted'
                  }`}
                >
                  ⌥{tool.shortcutIndex}
                </kbd>
              )}
            </button>
          );
        })}
      </nav>
    </>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar (>= lg) */}
      <aside className="hidden lg:flex static inset-y-0 left-0 w-64 border-r border-surface-border bg-surface-panel flex-col shrink-0 select-none pl-[var(--safe-area-left)]">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Overlay (Small desktop/web viewports only; removed in native mobile apps) */}
      {!isMobileApp() && isOpenMobile && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
            onClick={onCloseMobile}
          />
          {/* Slide-out Sidebar Panel */}
          <aside className="fixed inset-y-0 left-0 w-72 max-w-[85vw] h-full bg-surface-panel border-r border-surface-border flex flex-col shadow-2xl z-10 animate-in slide-in-from-left duration-200 select-none pl-[var(--safe-area-left)]">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
};
