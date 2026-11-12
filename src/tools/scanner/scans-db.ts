/**
 * Local IndexedDB Storage for Scanned Documents
 * Stores scanned documents completely offline on device with thumbnails,
 * page states (filters, crops, adjustments, rotations), and PDF metadata.
 */

export interface StoredScanPage {
  id: string;
  dataUrl: string; // Current processed image data
  originalDataUrl: string;
  rotation: number;
  filter: string;
  adjustments: { brightness: number; contrast: number };
  format: string;
  cropCorners?: {
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
  };
}

export interface StoredScanDoc {
  id: string;
  title: string;
  createdAt: number;
  thumbnailUrl: string;
  pageCount: number;
  pages: StoredScanPage[];
}

const DB_NAME = 'paperweight_scanner_db';
const DB_VERSION = 1;
const STORE_NAME = 'scans';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllScans(): Promise<StoredScanDoc[]> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const list: StoredScanDoc[] = (req.result as StoredScanDoc[]) || [];
        // Sort newest first
        list.sort((a, b) => b.createdAt - a.createdAt);
        resolve(list);
      };
      req.onerror = () => resolve(getFallbackScans());
    });
  } catch {
    return getFallbackScans();
  }
}

export async function saveScan(scan: StoredScanDoc): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(scan);
      req.onsuccess = () => {
        saveFallbackScan(scan);
        resolve();
      };
      req.onerror = () => {
        saveFallbackScan(scan);
        resolve();
      };
    });
  } catch {
    saveFallbackScan(scan);
  }
}

export async function deleteScan(id: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => {
        deleteFallbackScan(id);
        resolve();
      };
      req.onerror = () => {
        deleteFallbackScan(id);
        resolve();
      };
    });
  } catch {
    deleteFallbackScan(id);
  }
}

// Fallback to localStorage if IndexedDB is unavailable
const LOCAL_STORAGE_KEY = 'paperweight_scans_fallback';

function getFallbackScans(): StoredScanDoc[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveFallbackScan(scan: StoredScanDoc): void {
  try {
    const list = getFallbackScans().filter((s) => s.id !== scan.id);
    list.unshift(scan);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list.slice(0, 15)));
  } catch {
    // Ignore quota errors
  }
}

function deleteFallbackScan(id: string): void {
  try {
    const list = getFallbackScans().filter((s) => s.id !== id);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Ignore
  }
}

