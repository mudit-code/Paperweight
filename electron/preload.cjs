const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getInitialFiles: () => ipcRenderer.invoke('get-initial-files'),
  setTheme: (theme) => ipcRenderer.send('theme-changed', theme),
  getSystemIsDark: () => ipcRenderer.invoke('get-system-is-dark'),
  onSystemThemeUpdated: (callback) => {
    const listener = (_event, isDark) => callback(isDark);
    ipcRenderer.on('system-theme-updated', listener);
    return () => {
      ipcRenderer.removeListener('system-theme-updated', listener);
    };
  },
  onOpenFiles: (callback) => {
    const listener = (_event, files) => callback(files);
    ipcRenderer.on('open-incoming-files', listener);
    return () => {
      ipcRenderer.removeListener('open-incoming-files', listener);
    };
  },
});
