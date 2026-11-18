import React, { createContext, useContext, useEffect, useState } from 'react';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  setTheme: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'paperweight-theme';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        const urlTheme = params.get('theme');
        if (urlTheme === 'light' || urlTheme === 'dark') {
          try {
            localStorage.setItem(STORAGE_KEY, urlTheme);
          } catch {}
          return urlTheme;
        }
      } catch {}
    }
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        return saved;
      }
    } catch {
      // Storage access disabled
    }
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
  });

  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'dark';
    try {
      const params = new URLSearchParams(window.location.search);
      const urlTheme = params.get('theme');
      if (urlTheme === 'light' || urlTheme === 'dark') return urlTheme;
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
      if (saved === 'system') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
    } catch {}
    if (window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const updateDOMTheme = (isDark: boolean) => {
      if (isDark) {
        root.classList.add('dark');
        root.setAttribute('data-theme', 'dark');
        setResolvedTheme('dark');
        if (Capacitor.isNativePlatform()) {
          SystemBars.setStyle({ style: SystemBarsStyle.Dark }).catch(() => {});
        }
        try {
          const bridge = (window as unknown as { AndroidBridge?: { setAppTheme?: (isDark: boolean) => void } }).AndroidBridge;
          bridge?.setAppTheme?.(true);
        } catch {}
        const themeColorMeta = document.querySelector('meta[name="theme-color"]');
        if (themeColorMeta) {
          themeColorMeta.setAttribute('content', '#1F1F22');
        }
      } else {
        root.classList.remove('dark');
        root.setAttribute('data-theme', 'light');
        setResolvedTheme('light');
        if (Capacitor.isNativePlatform()) {
          SystemBars.setStyle({ style: SystemBarsStyle.Light }).catch(() => {});
        }
        try {
          const bridge = (window as unknown as { AndroidBridge?: { setAppTheme?: (isDark: boolean) => void } }).AndroidBridge;
          bridge?.setAppTheme?.(false);
        } catch {}
        const themeColorMeta = document.querySelector('meta[name="theme-color"]');
        if (themeColorMeta) {
          themeColorMeta.setAttribute('content', '#E9E8E4');
        }
      }
    };

    // Listen to native Electron theme updates
    let unsubscribeElectron: (() => void) | undefined;
    try {
      const electron = (window as unknown as {
        electronAPI?: {
          onSystemThemeUpdated?: (cb: (isDark: boolean) => void) => () => void;
          getSystemIsDark?: () => Promise<boolean>;
          setTheme?: (theme: string) => void;
        };
      }).electronAPI;

      electron?.setTheme?.(theme);

      if (electron?.onSystemThemeUpdated) {
        unsubscribeElectron = electron.onSystemThemeUpdated((isDark) => {
          if (theme === 'system') {
            updateDOMTheme(isDark);
          }
        });
      }
    } catch {}

    const applyTheme = () => {
      const isDark =
        theme === 'dark' || (theme === 'system' && mediaQuery.matches);
      updateDOMTheme(isDark);
    };

    applyTheme();

    // Query Electron directly if in system mode to get instant sync
    if (theme === 'system') {
      try {
        const electron = (window as unknown as {
          electronAPI?: { getSystemIsDark?: () => Promise<boolean> };
        }).electronAPI;
        electron?.getSystemIsDark?.().then((isDark) => {
          if (typeof isDark === 'boolean') {
            updateDOMTheme(isDark);
          }
        }).catch(() => {});
      } catch {}
    }

    const handleChange = () => {
      if (theme === 'system') {
        applyTheme();
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
      unsubscribeElectron?.();
    };
  }, [theme]);

  const setTheme = (mode: ThemeMode) => {
    setThemeState(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Ignore storage errors in restricted contexts
    }
    try {
      const electron = (window as unknown as { electronAPI?: { setTheme?: (theme: string) => void } }).electronAPI;
      electron?.setTheme?.(mode);
    } catch {}
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
