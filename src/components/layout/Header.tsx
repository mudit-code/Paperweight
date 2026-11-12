import React from 'react';
import { ArrowLeft, Sliders, Settings, Menu, FolderArchive } from 'lucide-react';
import { BrandLogo } from '../brand/BrandLogo';
import { isMobileApp } from '../../core/processors/download';

export interface HeaderProps {
  onToggleSidebar?: () => void;
  onToggleOptions?: () => void;
  onOpenSettings?: () => void;
  onOpenLibrary?: () => void;
  libraryCount?: number;
  isOptionsOpen?: boolean;
  activeToolName?: string;
  onBack?: () => void;
  canGoBack?: boolean;
  backTooltip?: string;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleSidebar,
  onToggleOptions,
  onOpenSettings,
  onOpenLibrary,
  libraryCount = 0,
  isOptionsOpen = false,
  activeToolName,
  onBack,
  canGoBack = false,
  backTooltip,
}) => {
  const isMobile = isMobileApp();

  return (
    <header className="w-full border-b border-surface-border bg-surface-panel shrink-0 select-none pt-[var(--safe-area-top)] pl-[var(--safe-area-left)] pr-[var(--safe-area-right)] transition-[padding] duration-150">
      <div className="h-14 px-3 sm:px-6 flex items-center justify-between">
        {/* Left: Hamburger Menu (Desktop small spaces only; hidden on mobile apps) + Back Button or Brand Logo + Tool name */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
          {!isMobile && onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              className="lg:hidden p-1.5 -ml-1 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer shrink-0"
              aria-label="Open navigation sidebar"
              title="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          {canGoBack && onBack ? (
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={onBack}
                title={backTooltip || 'Back to Converters'}
                className="inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-full border border-surface-border bg-surface-panel hover:bg-surface-subtle hover:border-accent-border text-xs font-semibold text-text-main transition-all cursor-pointer shadow-2xs group shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-text-muted group-hover:text-accent group-hover:-translate-x-0.5 transition-transform" />
                <span className="hidden sm:inline">Back</span>
                <span className="sm:hidden">Back</span>
              </button>
              <span className="text-surface-border hidden sm:inline">/</span>
              {activeToolName && (
                <span className="text-xs font-medium text-text-muted truncate max-w-[120px] sm:max-w-xs">
                  {activeToolName}
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0 lg:hidden">
              <BrandLogo size={20} className="w-5 h-5 rounded-xs shrink-0 shadow-2xs" />
              <span className="text-sm font-semibold text-text-main truncate max-w-[140px] sm:max-w-xs">
                {activeToolName || 'Paperweight'}
              </span>
            </div>
          )}
        </div>

        {/* Center: File Title in Gallery & Desktop Header matching Windows Photos */}
        {!canGoBack && (
          <div className="hidden lg:flex flex-1 items-center justify-center px-4 truncate pointer-events-none">
            <span className="text-xs sm:text-sm font-semibold font-mono text-text-main truncate max-w-md">
              {activeToolName || 'Paperweight'}
            </span>
          </div>
        )}

      {/* Right: Library (Mobile) + Parameters Toggle + Settings */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Mobile Header: Direct Library Button */}
        {onOpenLibrary && (
          <button
            type="button"
            onClick={onOpenLibrary}
            className="lg:hidden flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-surface-border bg-surface-subtle hover:bg-surface-panel text-text-main text-xs font-semibold transition-all cursor-pointer shadow-2xs relative"
            aria-label="Open Library"
            title="Library"
          >
            <FolderArchive className="w-3.5 h-3.5 text-accent shrink-0" />
            <span>Library</span>
            {libraryCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-accent text-accent-contrast text-[9px] font-mono font-bold leading-none">
                {libraryCount > 99 ? '99+' : libraryCount}
              </span>
            )}
          </button>
        )}

        {/* Mobile/Tablet Parameters Toggle */}
        {onToggleOptions && (
          <button
            type="button"
            onClick={onToggleOptions}
            className={`lg:hidden flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer shadow-2xs ${
              isOptionsOpen
                ? 'bg-accent text-white border-accent'
                : 'bg-surface-subtle hover:bg-surface-panel border-surface-border text-text-main'
            }`}
            aria-label="Toggle parameters panel"
            title="Toggle parameters panel"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span className="hidden xs:inline sm:inline">Parameters</span>
          </button>
        )}

        {/* Settings Icon (Houses Appearance / Theme switcher) */}
        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="p-2 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer"
            aria-label="Settings"
            title="Settings & Appearance"
          >
            <Settings className="w-4.5 h-4.5" />
          </button>
        )}
      </div>
      </div>
    </header>
  );
};
