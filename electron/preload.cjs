const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getInitialFiles: () => ipcRenderer.invoke('get-initial-files'),
  setTheme: (theme) => ipcRenderer.send('theme-changed', theme),
  onOpenFiles: (callback) => {
    const listener = (_event, files) => callback(files);
    ipcRenderer.on('open-incoming-files', listener);
    return () => {
      ipcRenderer.removeListener('open-incoming-files', listener);
    };
  },
});
