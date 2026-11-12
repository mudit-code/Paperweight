const { app, BrowserWindow, shell, ipcMain, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

// Single-instance lock so double-clicking or "Open with" in Windows focuses existing window
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

// Keep a global reference so the window isn't garbage collected
let mainWindow = null;
let pendingIncomingFiles = [];

const MIME_MAP = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

const SUPPORTED_EXTS = new Set(Object.keys(MIME_MAP));

async function readIncomingFile(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_MAP[ext];
    if (!mime) return null;

    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) return null;

    const nodeBuffer = await fs.promises.readFile(filePath);
    // Convert Node Buffer to standard ArrayBuffer for structured-clone serialization across IPC
    const arrayBuffer = nodeBuffer.buffer.slice(
      nodeBuffer.byteOffset,
      nodeBuffer.byteOffset + nodeBuffer.byteLength
    );

    return {
      name: path.basename(filePath),
      path: filePath,
      size: stats.size,
      type: mime,
      lastModified: stats.mtimeMs,
      buffer: arrayBuffer,
    };
  } catch (err) {
    console.error('Failed to read incoming file:', filePath, err);
    return null;
  }
}

async function parseArgvFiles(argv, cwd = process.cwd()) {
  const results = [];
  if (!Array.isArray(argv)) return results;

  const isResize = argv.some((a) => typeof a === 'string' && (a === '--resize' || a.includes('action=resize')));
  const isCompress = argv.some((a) => typeof a === 'string' && (a === '--compress' || a.includes('action=compress')));
  const targetAction = isResize ? 'resize' : (isCompress ? 'compress' : undefined);

  for (const rawArg of argv) {
    if (!rawArg || typeof rawArg !== 'string') continue;
    const cleanArg = rawArg.trim().replace(/^"(.*)"$/, '$1');

    // Skip flags and runtime arguments
    if (cleanArg.startsWith('-') || cleanArg.startsWith('/')) continue;
    if (cleanArg === '.' || cleanArg === '..') continue;
    if (cleanArg.toLowerCase().endsWith('.exe') || cleanArg.toLowerCase().endsWith('node')) continue;

    const ext = path.extname(cleanArg).toLowerCase();
    if (!SUPPORTED_EXTS.has(ext)) continue;

    const absolutePath = path.isAbsolute(cleanArg) ? cleanArg : path.resolve(cwd, cleanArg);
    try {
      if (fs.existsSync(absolutePath)) {
        const item = await readIncomingFile(absolutePath);
        if (item) {
          if (targetAction) item.action = targetAction;
          results.push(item);
        }
      }
    } catch {
      // Ignore unreadable paths
    }
  }

  return results;
}

function deliverFilesToRenderer(files) {
  if (!files || files.length === 0) return;

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.webContents.isLoading()) {
      pendingIncomingFiles.push(...files);
    } else {
      mainWindow.webContents.send('open-incoming-files', files);
    }
  } else {
    pendingIncomingFiles.push(...files);
  }
}

// IPC handler to deliver initial files on renderer mount
ipcMain.handle('get-initial-files', () => {
  const items = [...pendingIncomingFiles];
  pendingIncomingFiles = [];
  return items;
});

// Sync native OS titlebar and window border with dark / light mode
ipcMain.on('theme-changed', (_event, theme) => {
  if (theme === 'dark' || theme === 'light' || theme === 'system') {
    nativeTheme.themeSource = theme;
    if (mainWindow && !mainWindow.isDestroyed()) {
      const isDark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
      mainWindow.setBackgroundColor(isDark ? '#141312' : '#fbfaf8');
    }
  }
});

function createWindow() {
  const isDark = nativeTheme.shouldUseDarkColors;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    title: 'Paperweight — Private Offline Document & Image Workspace',
    icon: path.join(__dirname, '..', 'build-resources', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: isDark ? '#141312' : '#fbfaf8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    show: false,
  });

  // Load the Vite-built index.html from the dist folder
  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // Show window once content is ready (avoids white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Flush any pending files after initial content load
  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingIncomingFiles.length > 0) {
      setTimeout(() => {
        if (pendingIncomingFiles.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('open-incoming-files', pendingIncomingFiles);
          pendingIncomingFiles = [];
        }
      }, 250);
    }
  });

  // Open external links in the system browser, not inside the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Windows/Linux: Second instance opened (e.g. user right clicks another file and selects "Open with Paperweight")
app.on('second-instance', async (_event, commandLine, workingDirectory) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }

  const files = await parseArgvFiles(commandLine, workingDirectory);
  if (files.length > 0) {
    deliverFilesToRenderer(files);
  }
});

// macOS: File opened with Paperweight via Finder
app.on('open-file', async (event, filePath) => {
  event.preventDefault();
  const file = await readIncomingFile(filePath);
  if (file) {
    deliverFilesToRenderer([file]);
  }
});

// macOS: re-create window when dock icon is clicked and no windows are open
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(async () => {
  // Capture any files passed on cold start
  const initialFiles = await parseArgvFiles(process.argv);
  if (initialFiles.length > 0) {
    pendingIncomingFiles.push(...initialFiles);
  }

  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
