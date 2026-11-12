/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

export interface DesktopIncomingFile {
  name: string;
  path: string;
  size: number;
  type: string;
  lastModified: number;
  buffer: ArrayBuffer;
  action?: string;
}

export interface ElectronAPI {
  isElectron?: boolean;
  getInitialFiles: () => Promise<DesktopIncomingFile[]>;
  onOpenFiles: (callback: (files: DesktopIncomingFile[]) => void) => () => void;
  setTheme?: (theme: string) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
