import React, { useState, useEffect } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Button } from './Button';
import { registerSW } from 'virtual:pwa-register';

export const PWAUpdateToast: React.FC = () => {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateFunction, setUpdateFunction] = useState<((reloadPage?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    try {
      const updateSW = registerSW({
        onNeedRefresh() {
          setNeedRefresh(true);
        },
        onOfflineReady() {
          console.log('Paperweight is cached and ready for offline use.');
        },
      });
      setUpdateFunction(() => updateSW);
    } catch {
      // PWA service worker registration inactive in dev
    }
  }, []);

  if (!needRefresh) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-5 right-5 z-50 flex items-center gap-3 p-4 bg-surface-panel border border-surface-border rounded-sheet shadow-lifted transition-colors duration-fast ease-out"
    >
      <div className="w-9 h-9 rounded-control bg-surface-subtle border border-surface-border text-text-main flex items-center justify-center shrink-0">
        <RefreshCw className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-text-main">Update Available</p>
        <p className="text-xs text-text-muted">A newer offline build is cached and ready.</p>
      </div>
      <div className="flex items-center gap-1.5 ml-1">
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            if (updateFunction) {
              updateFunction(true);
            } else {
              window.location.reload();
            }
          }}
        >
          Update
        </Button>
        <button
          type="button"
          onClick={() => setNeedRefresh(false)}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-control text-text-muted hover:text-text-main hover:bg-surface-subtle transition-colors duration-fast ease-out cursor-pointer"
          aria-label="Dismiss update notification"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
