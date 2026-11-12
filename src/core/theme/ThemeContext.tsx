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
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        return saved;
      }
    } catch {
      // Storage access disabled
    }
    return 'system';
  });

  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'dark';
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      const isDark =
        theme === 'dark' || (theme === 'system' && mediaQuery.matches);
      
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
        try {
          const electron = (window as unknown as { electronAPI?: { setTheme?: (theme: string) => void } }).electronAPI;
          electron?.setTheme?.('dark');
        } catch {}
        const themeColorMeta = document.querySelector('meta[name="theme-color"]');
        if (themeColorMeta) {
          themeColorMeta.setAttribute('content', '#1b1a18');
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
        try {
          const electron = (window as unknown as { electronAPI?: { setTheme?: (theme: string) => void } }).electronAPI;
          electron?.setTheme?.('light');
        } catch {}
        const themeColorMeta = document.querySelector('meta[name="theme-color"]');
        if (themeColorMeta) {
          themeColorMeta.setAttribute('content', '#ffffff');
        }
      }
    };

    applyTheme();

    const handleChange = () => {
      if (theme === 'system') {
        applyTheme();
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  const setTheme = (mode: ThemeMode) => {
    setThemeState(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Ignore storage errors in restricted contexts
    }
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
