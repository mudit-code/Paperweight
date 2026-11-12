import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
}

/**
 * Local IndexedDB Storage for Paperweight Asset Library
 * Stores imported and in-progress image and PDF assets locally on device.
 */

export type LibrarySection = 'drafts' | 'recent' | 'general';
export type LibraryCategory = 'compression' | 'conversion' | 'merges' | 'resizes';

export interface DraftFileEntry {
  id: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  data: ArrayBuffer;
}

export interface DraftWorkspaceSnapshot {
  toolId: string;
  options: Record<string, unknown>;
  files: DraftFileEntry[];
}

export function mapToolToLibraryCategory(toolId: string): LibraryCategory {
  if (toolId === 'image-resizer') return 'compression';
  if (toolId === 'pdf-merge') return 'merges';
  if (toolId === 'resizer') return 'resizes';
  return 'conversion';
}

export interface LibraryAsset {
  id: string;
  name: string;
  type: string; // MIME type e.g. 'image/jpeg', 'image/png', 'application/pdf'
  size: number;
  data: ArrayBuffer;
  createdAt: number;
  thumbnailUrl?: string;
  kind: 'image' | 'pdf';
  width?: number;
  height?: number;
  section?: LibrarySection;
  category?: LibraryCategory;
  draftSnapshot?: DraftWorkspaceSnapshot;
}

const DB_NAME = 'paperweight_library_db';
const DB_VERSION = 1;
const STORE_NAME = 'assets';

// In-memory fallback
let memoryFallbackAssets: LibraryAsset[] = [];

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not supported in this environment'));
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
 * Creates a thumbnail data URL or object URL for an image/PDF asset
 */
export async function generateAssetThumbnail(
  buffer: ArrayBuffer,
  type: string
): Promise<string | undefined> {
  if (type === 'application/pdf' || type.includes('pdf')) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
    try {
      let cMapUrl = './cmaps/';
      let standardFontDataUrl = './standard_fonts/';
      try {
        const baseHref = document.baseURI || window.location.href;
        cMapUrl = new URL('./cmaps/', baseHref).href;
        standardFontDataUrl = new URL('./standard_fonts/', baseHref).href;
      } catch {
        // Fallback to relative paths
      }

      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(buffer.slice(0)),
        cMapUrl,
        cMapPacked: true,
        standardFontDataUrl,
      });
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(1);
      const baseViewport = page.getViewport({ scale: 1.0 });
      const thumbScale = Math.min(1.0, Math.max(0.6, 400 / Math.max(1, baseViewport.width)));
      const viewport = page.getViewport({ scale: thumbScale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        page.cleanup();
        await pdf.cleanup();
        await loadingTask.destroy().catch(() => {});
        return undefined;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({
        canvasContext: ctx,
        viewport,
      } as unknown as Parameters<typeof page.render>[0]).promise;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
      await pdf.cleanup();
      await loadingTask.destroy().catch(() => {});
      return dataUrl;
    } catch (err) {
      console.warn('Failed to generate PDF library thumbnail:', err);
      return undefined;
    }
  }
  try {
    const blob = new Blob([buffer], { type });
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const maxDim = 200;
          let w = img.naturalWidth || 200;
          let h = img.naturalHeight || 200;
          if (w > h) {
            if (w > maxDim) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            }
          } else {
            if (h > maxDim) {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          canvas.width = Math.max(1, w);
          canvas.height = Math.max(1, h);
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const thumbUrl = canvas.toDataURL('image/jpeg', 0.7);
            URL.revokeObjectURL(url);
            resolve(thumbUrl);
            return;
          }
        } catch {
          // fallback to object url
        }
        URL.revokeObjectURL(url);
        resolve(undefined);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(undefined);
      };
      img.src = url;
    });
  } catch {
    return undefined;
  }
}

/**
 * Retrieves all assets stored in the Library, newest first
 */
export async function getLibraryAssets(): Promise<LibraryAsset[]> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = (req.result as LibraryAsset[]) || [];
        list.sort((a, b) => b.createdAt - a.createdAt);
        resolve(list);
      };
      req.onerror = () => {
        resolve([...memoryFallbackAssets].sort((a, b) => b.createdAt - a.createdAt));
      };
    });
  } catch {
    return [...memoryFallbackAssets].sort((a, b) => b.createdAt - a.createdAt);
  }
}

/**
 * Saves one or multiple assets to the Library
 */
export async function saveLibraryAssets(
  items: Array<{
    id?: string;
    name: string;
    type?: string;
    size: number;
    data: ArrayBuffer;
    createdAt?: number;
    thumbnailUrl?: string;
    kind?: 'image' | 'pdf';
    width?: number;
    height?: number;
    section?: LibrarySection;
    category?: LibraryCategory;
    draftSnapshot?: DraftWorkspaceSnapshot;
  }>
): Promise<LibraryAsset[]> {
  const assetsToSave: LibraryAsset[] = await Promise.all(
    items.map(async (item) => {
      const mime = item.type || (item.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
      const kind: 'image' | 'pdf' = mime.includes('pdf') || item.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image';
      const thumb = item.thumbnailUrl || (await generateAssetThumbnail(item.data, mime));

      return {
        id: item.id || `lib_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        name: item.name,
        type: mime,
        size: item.size,
        data: item.data,
        createdAt: item.createdAt || Date.now(),
        thumbnailUrl: thumb,
        kind,
        width: item.width,
        height: item.height,
        section: item.section,
        category: item.category,
        draftSnapshot: item.draftSnapshot,
      };
    })
  );

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const asset of assetsToSave) {
        store.put(asset);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Save to in-memory fallback
    for (const asset of assetsToSave) {
      const idx = memoryFallbackAssets.findIndex((a) => a.id === asset.id);
      if (idx >= 0) {
        memoryFallbackAssets[idx] = asset;
      } else {
        memoryFallbackAssets.push(asset);
      }
    }
  }

  return assetsToSave;
}

/**
 * Deletes assets by IDs from the Library
 */
export async function deleteLibraryAssets(ids: string[]): Promise<void> {
  const idSet = new Set(ids);
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const id of ids) {
        store.delete(id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // In-memory fallback
    memoryFallbackAssets = memoryFallbackAssets.filter((a) => !idSet.has(a.id));
  }
}

/**
 * Returns the total count of assets in the Library
 */
export async function getLibraryAssetCount(): Promise<number> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => resolve(memoryFallbackAssets.length);
    });
  } catch {
    return memoryFallbackAssets.length;
  }
}
