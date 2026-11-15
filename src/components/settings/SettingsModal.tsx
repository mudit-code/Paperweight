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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        className="fixed inset-0 bg-black/60 transition-opacity duration-fast ease-out"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="relative z-10 w-full sm:max-w-md bg-surface-panel border-t sm:border border-surface-border rounded-t-sheet sm:rounded-sheet p-5 sm:p-6 pb-[max(1.5rem,var(--safe-area-bottom))] pl-[max(1.25rem,var(--safe-area-left))] pr-[max(1.25rem,var(--safe-area-right))] shadow-lifted transition-colors duration-base ease-out"
      >
        <div className="w-9 h-1 bg-surface-border rounded-chip mx-auto mb-4 sm:hidden shrink-0" />

        <div className="flex items-center justify-between pb-3 border-b border-surface-border">
          <div className="flex items-center gap-2.5">
            <BrandLogo size={22} className="w-5.5 h-5.5" />
            <h3 id="settings-title" className="font-bold text-lg text-text-main">
              Settings
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center rounded-control text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors duration-fast ease-out cursor-pointer"
            aria-label="Close settings"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="py-4 space-y-5">
          {/* Appearance Section */}
          <div className="space-y-2">
            <span className="text-xs font-mono font-semibold text-text-muted uppercase tracking-wider block">
              Appearance
            </span>
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-control bg-surface-subtle border border-surface-border">
              {(
                [
                  { id: 'light', label: 'Light', Icon: Sun },
                  { id: 'dark', label: 'Dark', Icon: Moon },
                  { id: 'system', label: 'System', Icon: Monitor },
                ] as const
              ).map(({ id, label, Icon }) => {
                const isSelected = theme === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTheme(id)}
                    aria-pressed={isSelected}
                    className={`flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-control text-xs font-semibold transition-colors duration-fast ease-out cursor-pointer ${
                      isSelected
                        ? 'bg-accent text-accent-contrast'
                        : 'text-text-muted hover:text-text-main hover:bg-surface-panel'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Privacy & Security */}
          <div className="p-3.5 rounded-sheet bg-surface-subtle border border-surface-border space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-status-success">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>100% On-Device Processing</span>
            </div>
            <p className="text-xs text-text-muted leading-relaxed">
              Paperweight operates strictly offline with zero network requests. Documents, photos, and scans remain on this device.
            </p>
          </div>

          {/* About */}
          <div className="flex items-center justify-between text-xs text-text-muted pt-1">
            <span>Paperweight Workspace</span>
            <span className="font-mono font-medium">v0.2.19</span>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
