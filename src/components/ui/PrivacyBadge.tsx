import React, { useState } from 'react';
import { ShieldCheck, X, HardDrive, WifiOff, Lock } from 'lucide-react';
import { Button } from './Button';

export const PrivacyBadge: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="Privacy guarantee: Runs fully on your device. Click for details."
        className="group inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-status-offline-border bg-status-offline-bg text-status-offline text-xs font-medium tracking-tight transition-all duration-150 hover:bg-status-offline/20 focus-visible:ring-2 focus-visible:ring-status-offline"
      >
        <span className="relative flex h-2 w-2">
          <span className="relative inline-flex rounded-full h-2 w-2 bg-status-offline" />
        </span>
        <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
        <span className="text-text-main font-mono text-[11px] group-hover:text-status-offline transition-colors">
          Runs fully on your device
        </span>
      </button>

      {/* Reassuring Privacy Modal */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="privacy-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="w-full max-w-md bg-surface-panel border border-surface-border rounded-xl shadow-lg p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-status-offline-bg text-status-offline border border-status-offline-border">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 id="privacy-dialog-title" className="text-base font-serif font-semibold text-text-main">
                    Privacy by Architecture
                  </h3>
                  <p className="text-xs text-text-muted">No telemetry. No clouds. Zero egress.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-sm text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors"
                aria-label="Close dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 pt-2 text-xs text-text-muted leading-relaxed">
              <div className="flex gap-3 items-start p-3 rounded-md bg-surface-subtle border border-surface-border-subtle">
                <WifiOff className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-text-main block mb-0.5">Airplane-Mode Native</span>
                  Every tool runs without internet access. You can disconnect your network completely at any time.
                </div>
              </div>

              <div className="flex gap-3 items-start p-3 rounded-md bg-surface-subtle border border-surface-border-subtle">
                <Lock className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-text-main block mb-0.5">Strict Browser Enforcement</span>
                  Paperweight enforces a Content Security Policy with <code className="font-mono text-accent">connect-src 'none'</code>, prohibiting network connections.
                </div>
              </div>

              <div className="flex gap-3 items-start p-3 rounded-md bg-surface-subtle border border-surface-border-subtle">
                <HardDrive className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-text-main block mb-0.5">Local Memory Sandbox</span>
                  Documents and images are parsed strictly in local memory and web workers, and are discarded when closed.
                </div>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <Button size="sm" variant="secondary" onClick={() => setIsOpen(false)}>
                Understood
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
