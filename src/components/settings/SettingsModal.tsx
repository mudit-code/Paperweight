import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Sun, Moon, Monitor, X, ShieldCheck } from 'lucide-react';
import { useTheme } from '../../core/theme/ThemeContext';
import { BrandLogo } from '../brand/BrandLogo';
import { registerBackHandler } from '../../core/navigation/backButton';

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { theme, setTheme } = useTheme();

  // Mobile hardware back button synchronization
  useEffect(() => {
    if (!isOpen) return;
    const unregister = registerBackHandler(() => {
      onClose();
      return true;
    });
    return unregister;
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="relative z-10 w-full sm:max-w-md bg-surface-panel border-t sm:border border-surface-border rounded-t-[28px] sm:rounded-2xl p-5 sm:p-6 pb-[max(1.5rem,var(--safe-area-bottom))] pl-[max(1.25rem,var(--safe-area-left))] pr-[max(1.25rem,var(--safe-area-right))] shadow-2xl transition-all duration-200 animate-in slide-in-from-bottom"
      >
        {/* Drag handle on mobile */}
        <div className="w-9 h-1 bg-surface-border rounded-full mx-auto mb-4 sm:hidden shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-surface-border">
          <div className="flex items-center gap-2.5">
            <BrandLogo size={22} className="w-5.5 h-5.5 rounded-sm" />
            <h3 id="settings-title" className="font-serif font-bold text-base sm:text-lg text-text-main">
              Settings
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors cursor-pointer"
            aria-label="Close settings"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="py-4 space-y-5">
          {/* Appearance Section */}
          <div className="space-y-2">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Appearance
            </span>
            <div className="grid grid-cols-3 gap-2 p-1 rounded-xl bg-surface-subtle border border-surface-border">
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  theme === 'light'
                    ? 'bg-surface-panel text-accent shadow-xs border border-surface-border'
                    : 'text-text-muted hover:text-text-main'
                }`}
              >
                <Sun className="w-4 h-4" />
                <span>Light</span>
              </button>
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  theme === 'dark'
                    ? 'bg-surface-panel text-accent shadow-xs border border-surface-border'
                    : 'text-text-muted hover:text-text-main'
                }`}
              >
                <Moon className="w-4 h-4" />
                <span>Dark</span>
              </button>
              <button
                type="button"
                onClick={() => setTheme('system')}
                className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  theme === 'system'
                    ? 'bg-surface-panel text-accent shadow-xs border border-surface-border'
                    : 'text-text-muted hover:text-text-main'
                }`}
              >
                <Monitor className="w-4 h-4" />
                <span>System</span>
              </button>
            </div>
          </div>

          {/* Privacy & Security */}
          <div className="p-3.5 rounded-xl bg-surface-subtle border border-surface-border space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>100% On-Device Processing</span>
            </div>
            <p className="text-[11px] text-text-muted leading-relaxed">
              Paperweight operates strictly offline with zero network requests. Your documents, photos, and scans never leave your device.
            </p>
          </div>

          {/* About */}
          <div className="flex items-center justify-between text-xs text-text-muted pt-1">
            <span>Paperweight for Android</span>
            <span className="font-mono font-medium">v0.2.0</span>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
