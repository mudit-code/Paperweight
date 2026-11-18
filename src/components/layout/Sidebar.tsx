import React, { useState } from 'react';
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
  PanelLeftClose,
  PanelLeftOpen,
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
}

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

const NAV_ACTIVE_CLASSES =
  'bg-surface-panel-raised text-text-main font-semibold before:content-[""] before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:rounded-control before:bg-accent';
const NAV_IDLE_CLASSES = 'text-text-muted hover:text-text-main hover:bg-surface-subtle font-medium';

const NAV_ACTIVE_COLLAPSED =
  'w-12 h-12 mx-auto rounded-2xl border-2 border-accent text-accent bg-accent/10 flex items-center justify-center shadow-xs cursor-pointer';
const NAV_IDLE_COLLAPSED =
  'w-12 h-12 mx-auto rounded-2xl text-text-muted hover:text-text-main hover:bg-surface-subtle flex items-center justify-center transition-colors cursor-pointer';

export const Sidebar: React.FC<SidebarProps> = ({
  tools,
  activeToolId,
  onSelectTool,
  isOpenMobile = false,
  onCloseMobile,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return localStorage.getItem('paperweight_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('paperweight_sidebar_collapsed', String(next));
      } catch {}
      return next;
    });
  };

  const displayTools = isMobileApp()
    ? tools
    : tools.filter((t) => t.id !== 'scanner' && t.id !== 'scans');

  const handleSelectTool = (id: string) => {
    onSelectTool(id);
    if (onCloseMobile) {
      onCloseMobile();
    }
  };

  const renderSidebarContent = (collapsed: boolean) => (
    <>
      {/* Sidebar Brand Header with Top Collapse Toggle */}
      <div className="pt-[var(--safe-area-top)] border-b border-surface-border shrink-0">
        <div className={`h-14 ${collapsed ? 'px-0 justify-center' : 'px-4 justify-between'} flex items-center`}>
          {!collapsed ? (
            <>
              <div className="flex items-center gap-2.5 min-w-0">
                <BrandLogo size={24} className="w-6 h-6 shrink-0" />
                <span className="font-bold text-lg tracking-tight text-text-main truncate">
                  Paperweight
                </span>
              </div>

              {/* Desktop collapse toggle */}
              <button
                type="button"
                onClick={toggleCollapsed}
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
                className="hidden lg:flex min-w-[32px] min-h-[32px] items-center justify-center rounded-control text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer"
              >
                <PanelLeftClose className="w-4 h-4 shrink-0" />
              </button>
            </>
          ) : (
            /* Collapsed mode: brand logo and expand toggle side-by-side horizontally */
            <div className="w-full h-14 flex items-center justify-center gap-2.5 px-2">
              <BrandLogo size={26} className="w-[26px] h-[26px] shrink-0" />
              <button
                type="button"
                onClick={toggleCollapsed}
                title="Expand sidebar"
                aria-label="Expand sidebar"
                className="w-9 h-9 flex items-center justify-center rounded-control text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer shrink-0"
              >
                <PanelLeftOpen className="w-5 h-5 shrink-0" />
              </button>
            </div>
          )}

          {onCloseMobile && !collapsed && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="lg:hidden min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center rounded-control text-text-muted hover:text-text-main hover:bg-surface-subtle cursor-pointer transition-colors duration-fast ease-out"
              aria-label="Close sidebar"
              title="Close navigation"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Tools Navigation */}
      <nav
        role="navigation"
        aria-label="Available document and image tools"
        className="flex-1 overflow-y-auto p-2 space-y-1"
      >
        {!isMobileApp() && (
          <button
            type="button"
            onClick={() => handleSelectTool('scans')}
            aria-current={activeToolId === 'scans' ? 'page' : undefined}
            title="Recent Scans"
            className={
              collapsed
                ? activeToolId === 'scans'
                  ? NAV_ACTIVE_COLLAPSED
                  : NAV_IDLE_COLLAPSED
                : `relative w-full min-h-[44px] flex items-center justify-between px-3 py-2 rounded-control text-left text-sm transition-colors duration-fast ease-out cursor-pointer ${
                    activeToolId === 'scans' ? NAV_ACTIVE_CLASSES : NAV_IDLE_CLASSES
                  }`
            }
          >
            <div className={`flex items-center gap-2.5 ${collapsed ? 'justify-center' : 'min-w-0'}`}>
              <Scan className={collapsed ? 'w-5 h-5 shrink-0' : 'w-4 h-4 shrink-0'} />
              {!collapsed && <span className="truncate">Recent Scans</span>}
            </div>
            {!collapsed && (
              <span
                className="font-mono text-xs px-1.5 py-0.5 rounded-control border border-surface-border bg-surface-bg text-text-muted"
                title="Add or open scans"
              >
                +
              </span>
            )}
          </button>
        )}

        {displayTools.map((tool) => {
          const isActive = tool.id === activeToolId;
          const IconComponent = ICON_MAP[tool.iconName] || Wrench;
          const tooltip = `${tool.name}${tool.shortcutIndex ? ` (Alt+${tool.shortcutIndex})` : ''}`;

          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => handleSelectTool(tool.id)}
              aria-current={isActive ? 'page' : undefined}
              title={tooltip}
              className={
                collapsed
                  ? isActive
                    ? NAV_ACTIVE_COLLAPSED
                    : NAV_IDLE_COLLAPSED
                  : `relative w-full min-h-[44px] flex items-center justify-between px-3 py-2 rounded-control text-left text-sm transition-colors duration-fast ease-out cursor-pointer ${
                      isActive ? NAV_ACTIVE_CLASSES : NAV_IDLE_CLASSES
                    }`
              }
            >
              <div className={`flex items-center gap-2.5 ${collapsed ? 'justify-center' : 'min-w-0'}`}>
                <IconComponent className={collapsed ? 'w-5 h-5 shrink-0' : 'w-4 h-4 shrink-0'} />
                {!collapsed && <span className="truncate">{tool.name}</span>}
              </div>
            </button>
          );
        })}
      </nav>
    </>
  );

  return (
    <>
      <aside
        className={`hidden lg:flex static inset-y-0 left-0 ${
          isCollapsed ? 'w-[84px]' : 'w-60'
        } border-r border-surface-border bg-surface-panel flex-col shrink-0 select-none pl-[var(--safe-area-left)] transition-[width] duration-150`}
      >
        {renderSidebarContent(isCollapsed)}
      </aside>

      {!isMobileApp() && isOpenMobile && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="fixed inset-0 bg-black/60" onClick={onCloseMobile} />
          <aside className="fixed inset-y-0 left-0 w-72 max-w-[85vw] h-full bg-surface-panel border-r border-surface-border flex flex-col shadow-lifted z-10 select-none pl-[var(--safe-area-left)]">
            {renderSidebarContent(false)}
          </aside>
        </div>
      )}
    </>
  );
};
