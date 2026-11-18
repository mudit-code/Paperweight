import React from 'react';
import { ArrowLeft, Sliders, Settings, Menu } from 'lucide-react';
import { BrandLogo } from '../brand/BrandLogo';
import { isMobileApp } from '../../core/processors/download';

export interface HeaderProps {
  onToggleSidebar?: () => void;
  onToggleOptions?: () => void;
  onOpenSettings?: () => void;
  isOptionsOpen?: boolean;
  hasOptionsPanel?: boolean;
  activeToolName?: string;
  onBack?: () => void;
  canGoBack?: boolean;
  backTooltip?: string;
  rightAction?: React.ReactNode;
  isOnlineMode?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleSidebar,
  onToggleOptions,
  onOpenSettings,
  isOptionsOpen = false,
  hasOptionsPanel = false,
  activeToolName,
  onBack,
  canGoBack = false,
  backTooltip,
  rightAction,
  isOnlineMode = false,
}) => {
  const isMobile = isMobileApp();
  const websiteHref =
    typeof window !== 'undefined' &&
    window.location.port === '5173' &&
    !window.location.pathname.includes('/app')
      ? '/website/index.html'
      : '../';

  return (
    <header className="w-full border-b border-surface-border bg-surface-panel shrink-0 select-none pt-[var(--safe-area-top)] pl-[var(--safe-area-left)] pr-[var(--safe-area-right)] transition-[padding] duration-fast ease-out relative">
      <div className="h-14 px-3 sm:px-6 flex items-center justify-between gap-2 relative">
        {/* Left: Navigation Drawer Trigger (small desktop) or Mobile Brand/Back + Tool Name */}
        <div className="flex items-center gap-2 min-w-0 z-10">
          {!isMobile && onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              className="lg:hidden min-w-[40px] min-h-[40px] px-2 -ml-1 rounded-control text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors duration-fast ease-out cursor-pointer shrink-0 inline-flex items-center justify-center gap-1.5"
              aria-label="Open navigation sidebar"
              title="Open navigation sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          {isMobile ? (
            canGoBack && onBack ? (
              <button
                type="button"
                onClick={onBack}
                title={backTooltip || 'Go back'}
                aria-label={backTooltip || 'Back'}
                className="inline-flex items-center gap-1.5 h-9 sm:h-[38px] px-3 rounded-control border border-surface-border bg-surface-bg hover:bg-surface-subtle hover:border-surface-border-focus text-xs font-semibold text-text-main transition-colors duration-fast ease-out cursor-pointer shrink-0 shadow-2xs"
              >
                <ArrowLeft className="w-4 h-4 text-text-muted shrink-0" />
                <span>Back</span>
              </button>
            ) : (
              <div className="flex items-center min-w-0 h-9">
                <BrandLogo size={28} className="w-7 h-7 rounded-xs shrink-0 shadow-xs" />
              </div>
            )
          ) : (
            canGoBack && onBack && (
              <button
                type="button"
                onClick={onBack}
                title={backTooltip || 'Go back'}
                aria-label={backTooltip || 'Back'}
                className="inline-flex items-center gap-1.5 h-9 sm:h-[38px] px-3 rounded-control border border-surface-border bg-surface-bg hover:bg-surface-subtle hover:border-surface-border-focus text-xs font-semibold text-text-main transition-colors duration-fast ease-out cursor-pointer shrink-0"
              >
                <ArrowLeft className="w-4 h-4 text-text-muted shrink-0" />
                <span>Back</span>
              </button>
            )
          )}
        </div>

        {/* Center: Heading in the exact middle of the workspace area */}
        <div
          className={`absolute inset-0 flex items-center justify-center pointer-events-none px-14 sm:px-20 ${
            !isMobile && hasOptionsPanel ? 'lg:right-80' : ''
          }`}
        >
          <h1 className="text-base sm:text-lg font-bold text-text-main tracking-tight truncate text-center select-none">
            {activeToolName || 'Paperweight'}
          </h1>
        </div>

        {/* Right: Library, Options Toggle (Mobile/Tablet), Settings or Back to website */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 z-10">
          {rightAction}

          {isMobile && canGoBack && !rightAction && (
            <div className="w-[74px] shrink-0" aria-hidden="true" />
          )}

          {(!isMobile || !canGoBack) && onToggleOptions && (
            <button
              type="button"
              onClick={onToggleOptions}
              className={`lg:hidden inline-flex items-center justify-center gap-1.5 h-9 sm:h-[38px] px-3 rounded-control border text-xs font-semibold transition-colors duration-fast ease-out cursor-pointer shrink-0 ${
                isOptionsOpen
                  ? 'bg-accent text-accent-contrast border-accent-border'
                  : 'bg-surface-bg hover:bg-surface-subtle border-surface-border text-text-main'
              }`}
              aria-label="Toggle options panel"
              title="Toggle options panel"
            >
              <Sliders className="w-4 h-4 shrink-0" />
              <span>Options</span>
            </button>
          )}

          {isOnlineMode ? (
            <a
              href={websiteHref}
              className="inline-flex items-center justify-center gap-1.5 h-9 sm:h-[38px] px-2.5 sm:px-3 rounded-control border border-surface-border bg-surface-bg hover:bg-surface-subtle text-text-main text-xs font-semibold transition-colors duration-fast ease-out cursor-pointer shrink-0 shadow-2xs"
              aria-label="Back to website"
              title="Back to Paperweight website"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-text-muted shrink-0" />
              <span>
                <span className="sm:hidden">Website</span>
                <span className="hidden sm:inline">Back to website</span>
              </span>
            </a>
          ) : (
            (!isMobile || !canGoBack) && onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className={`inline-flex items-center justify-center gap-1.5 h-9 rounded-control border border-surface-border bg-surface-bg hover:bg-surface-subtle text-text-main text-xs font-semibold transition-colors duration-fast ease-out cursor-pointer shrink-0 shadow-2xs ${
                  isMobile ? 'w-9 p-0' : 'px-3 sm:h-[38px]'
                }`}
                aria-label="Settings"
                title="Settings and appearance"
              >
                <Settings className="w-4 h-4 shrink-0" />
                <span className={isMobile ? 'hidden' : 'hidden sm:inline'}>Settings</span>
              </button>
            )
          )}
        </div>
      </div>
    </header>
  );
};
