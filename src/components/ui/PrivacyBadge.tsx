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
        className="inline-flex items-center gap-2 min-h-[44px] px-3 py-1.5 rounded-chip border border-status-success-border bg-status-success-bg text-status-success text-xs font-mono font-medium transition-colors duration-fast ease-out hover:bg-surface-subtle cursor-pointer"
      >
        <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
        <span className="text-text-main">Runs fully on your device</span>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="privacy-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="w-full max-w-md bg-surface-panel border border-surface-border rounded-sheet shadow-lifted p-6 space-y-4 transition-colors duration-fast ease-out"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-control bg-status-success-bg text-status-success border border-status-success-border flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 id="privacy-dialog-title" className="text-lg font-bold text-text-main">
                    Privacy by Architecture
                  </h3>
                  <p className="text-xs text-text-muted">No telemetry. No cloud. Zero network egress.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="min-w-[44px] min-h-[44px] -mr-2 -mt-2 flex items-center justify-center rounded-control text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors duration-fast ease-out cursor-pointer"
                aria-label="Close dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 pt-1 text-xs text-text-muted leading-relaxed">
              <div className="flex gap-3 items-start p-3 rounded-control bg-surface-subtle border border-surface-border">
                <WifiOff className="w-4 h-4 text-text-main shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-text-main block mb-0.5">Airplane-Mode Native</span>
                  Every tool runs without internet access. You can disconnect your network completely at any time.
                </div>
              </div>

              <div className="flex gap-3 items-start p-3 rounded-control bg-surface-subtle border border-surface-border">
                <Lock className="w-4 h-4 text-text-main shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-text-main block mb-0.5">Strict CSP Enforcement</span>
                  Paperweight bundles all fonts and workers locally and prohibits remote uploads.
                </div>
              </div>

              <div className="flex gap-3 items-start p-3 rounded-control bg-surface-subtle border border-surface-border">
                <HardDrive className="w-4 h-4 text-text-main shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-text-main block mb-0.5">Local Memory Sandbox</span>
                  Documents and images are processed strictly in local memory and workers on this device.
                </div>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <Button size="sm" variant="primary" onClick={() => setIsOpen(false)}>
                Understood
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
