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
      className="fixed bottom-5 right-5 z-50 flex items-center gap-3 p-3.5 bg-surface-panel border border-accent rounded-lg shadow-lg animate-in slide-in-from-bottom-2"
    >
      <div className="p-2 rounded-md bg-accent-subtle text-accent">
        <RefreshCw className="w-4 h-4" />
      </div>
      <div>
        <p className="text-xs font-medium text-text-main">Update Available</p>
        <p className="text-[11px] text-text-muted">A newer offline build is cached and ready.</p>
      </div>
      <div className="flex items-center gap-2 ml-2">
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
          className="p-1 rounded-sm text-text-muted hover:text-text-main hover:bg-surface-subtle"
          aria-label="Dismiss update notification"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
