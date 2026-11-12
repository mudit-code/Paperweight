import React, { useEffect } from 'react';
import { ThemeProvider } from './core/theme/ThemeContext';
import { AppShell } from './components/layout/AppShell';
import { initializeToolRegistry } from './tools/registry-init';

// Synchronously register all tools before initial render so tool state is immediately hydrated
initializeToolRegistry();

export const App: React.FC = () => {
  useEffect(() => {
    const syncSafeAreas = () => {
      try {
        const bridge = (window as unknown as { AndroidBridge?: { getStatusBarHeight?: () => number; getNavigationBarHeight?: () => number } }).AndroidBridge;
        if (bridge && typeof bridge.getStatusBarHeight === 'function') {
          const top = bridge.getStatusBarHeight();
          const bottom = bridge.getNavigationBarHeight?.() ?? 0;
          if (top > 0) {
            document.documentElement.style.setProperty('--safe-area-inset-top', `${top}px`);
          }
          if (bottom > 0) {
            document.documentElement.style.setProperty('--safe-area-inset-bottom', `${bottom}px`);
          }
        }
      } catch {
        // Non-Android environments
      }
    };

    syncSafeAreas();
    window.addEventListener('resize', syncSafeAreas);
    window.addEventListener('orientationchange', syncSafeAreas);
    return () => {
      window.removeEventListener('resize', syncSafeAreas);
      window.removeEventListener('orientationchange', syncSafeAreas);
    };
  }, []);

  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
};

export default App;
