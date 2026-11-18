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

/**
 * Generates a unique scan title given a proposed base title and a list of existing titles.
 * If proposedTitle already exists, appends (2), (3), etc.
 */
export function generateUniqueScanTitle(
  baseTitle: string,
  existingTitles: string[]
): string {
  const trimmedBase = (baseTitle || 'Paperweight Scan').trim();
  const existingSet = new Set(existingTitles.map((t) => t.trim().toLowerCase()));

  if (!existingSet.has(trimmedBase.toLowerCase())) {
    return trimmedBase;
  }

  // Parse if it already has a trailing (N)
  const match = trimmedBase.match(/^(.*?)\s*\((\d+)\)$/);
  const root = match ? match[1].trim() : trimmedBase;
  let counter = match ? parseInt(match[2], 10) + 1 : 2;

  while (existingSet.has(`${root} (${counter})`.toLowerCase())) {
    counter++;
  }

  return `${root} (${counter})`;
}

/**
 * Deduplicates any identical scan titles in a list.
 * Sorts chronologically (oldest first) so the initial scan keeps the base title,
 * and subsequent duplicate scans receive (2), (3), etc.
 */
export function deduplicateScanTitles(
  scans: StoredScanDoc[],
  db?: IDBDatabase
): StoredScanDoc[] {
  if (!scans || scans.length === 0) return [];

  // Sort chronological (oldest first) so the original scan stays as base title
  const sorted = [...scans].sort((a, b) => a.createdAt - b.createdAt);
  const seenTitles = new Map<string, number>();
  const modifiedScans: StoredScanDoc[] = [];

  for (const scan of sorted) {
    const rawTitle = (scan.title || 'Paperweight Scan').trim();
    // Normalize root title
    const match = rawTitle.match(/^(.*?)\s*\((\d+)\)$/);
    const root = match ? match[1].trim() : rawTitle;
    const lowerRoot = root.toLowerCase();

    if (!seenTitles.has(lowerRoot)) {
      seenTitles.set(lowerRoot, 1);
    } else {
      const nextCount = seenTitles.get(lowerRoot)! + 1;
      seenTitles.set(lowerRoot, nextCount);
      const newTitle = `${root} (${nextCount})`;
      if (scan.title !== newTitle) {
        scan.title = newTitle;
        modifiedScans.push(scan);
      }
    }
  }

  // If any scans were renamed to fix duplicates, persist them back to storage
  if (modifiedScans.length > 0) {
    if (db) {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        for (const mod of modifiedScans) {
          store.put(mod);
        }
      } catch (err) {
        console.warn('Failed to persist deduplicated scan titles to IndexedDB:', err);
      }
    }
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(sorted.slice(0, 15)));
    } catch {
      // Ignore quota errors
    }
  }

  return sorted;
}

export async function getAllScans(): Promise<StoredScanDoc[]> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        let list: StoredScanDoc[] = (req.result as StoredScanDoc[]) || [];
        list = deduplicateScanTitles(list, db);
        // Sort newest first for display
        list.sort((a, b) => b.createdAt - a.createdAt);
        resolve(list);
      };
      req.onerror = () => {
        let list = getFallbackScans();
        list = deduplicateScanTitles(list);
        list.sort((a, b) => b.createdAt - a.createdAt);
        resolve(list);
      };
    });
  } catch {
    let list = getFallbackScans();
    list = deduplicateScanTitles(list);
    list.sort((a, b) => b.createdAt - a.createdAt);
    return list;
  }
}

export async function saveScan(scan: StoredScanDoc): Promise<void> {
  try {
    // Before saving, ensure scan title is distinct from any existing scan in the database
    const existing = await getAllScans();
    const otherTitles = existing.filter((s) => s.id !== scan.id).map((s) => s.title);
    scan.title = generateUniqueScanTitle(scan.title, otherTitles);

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

