/**
 * Offline client-side file saving and sharing utilities.
 * Supports Android Native Bridge (saving to Downloads & native sharing)
 * and falls back to standard Web/Electron downloads and Web Share API.
 */

declare global {
  interface Window {
    AndroidBridge?: {
      saveFile: (base64Data: string, filename: string, mimeType: string) => boolean;
      saveFiles?: (base64DataList: string[], filenames: string[], mimeTypes: string[]) => boolean;
      shareFile: (base64Data: string, filename: string, mimeType: string, caption: string) => boolean;
    };
    Capacitor?: {
      isNativePlatform?: () => boolean;
    };
  }
}

export const SHARE_CAPTION =
  'Made with Paperweight : private and offline document handler download yours from placeholder website';

/**
 * Detects whether the current runtime is running on a mobile environment
 * (Android Native Capacitor App, AndroidBridge, or mobile device).
 */
export function isMobileApp(): boolean {
  if (typeof window === 'undefined') return false;
  // 1. AndroidBridge presence
  if (Boolean(window.AndroidBridge)) return true;
  // 2. Capacitor native platform
  try {
    if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function') {
      if (window.Capacitor.isNativePlatform()) return true;
    }
  } catch {
    // ignore
  }
  // 3. User agent check
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
}

/**
 * Converts a Blob to a raw base64 string
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Saves a file directly to device storage.
 * On Android, uses AndroidBridge to write directly to the Downloads folder.
 * On Desktop / Browser, uses client-side anchor download.
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  // Check if native Android Bridge is available
  if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.saveFile === 'function') {
    try {
      const base64 = await blobToBase64(blob);
      const success = window.AndroidBridge.saveFile(base64, filename, blob.type || 'application/octet-stream');
      if (success) return;
    } catch (e) {
      console.warn('Native AndroidBridge save failed, falling back to browser download:', e);
    }
  }

  // Web / Electron fallback
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}

/**
 * Saves multiple files directly to device storage.
 * On Android, uses AndroidBridge.saveFiles if available, or sequential saveFile with delay.
 * On Web/Desktop, triggers sequential downloads.
 */
export async function saveMultipleBlobs(
  items: Array<{ blob: Blob; name: string }>,
  onProgress?: (savedCount: number, total: number) => void
): Promise<void> {
  if (!items || items.length === 0) return;

  // 1. Check if Android Bridge has batch saveFiles
  if (
    typeof window !== 'undefined' &&
    window.AndroidBridge &&
    typeof window.AndroidBridge.saveFiles === 'function'
  ) {
    try {
      const base64List: string[] = [];
      const filenames: string[] = [];
      const mimeTypes: string[] = [];
      for (const item of items) {
        base64List.push(await blobToBase64(item.blob));
        filenames.push(item.name);
        mimeTypes.push(item.blob.type || 'application/octet-stream');
      }
      const success = window.AndroidBridge.saveFiles(base64List, filenames, mimeTypes);
      if (success) {
        onProgress?.(items.length, items.length);
        return;
      }
    } catch (e) {
      console.warn('Native AndroidBridge saveFiles failed, falling back to sequential save:', e);
    }
  }

  // 2. Sequential saveFile with brief delay to avoid overwhelming the download queue
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    await downloadBlob(item.blob, item.name);
    onProgress?.(i + 1, items.length);
    if (i < items.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

// Alias for semantic clarity across all tools
export const saveBlob = downloadBlob;

/**
 * Shares a document with the required Paperweight caption.
 * On Android, uses AndroidBridge to open the native share sheet.
 * On Web, uses the Web Share API if supported.
 */
export async function shareBlob(blob: Blob, filename: string, caption = SHARE_CAPTION): Promise<void> {
  // Check if native Android Bridge is available
  if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.shareFile === 'function') {
    try {
      const base64 = await blobToBase64(blob);
      const success = window.AndroidBridge.shareFile(
        base64,
        filename,
        blob.type || 'application/octet-stream',
        caption
      );
      if (success) return;
    } catch (e) {
      console.warn('Native AndroidBridge share failed, falling back to Web Share API:', e);
    }
  }

  // Web Share API fallback
  if (typeof navigator !== 'undefined' && navigator.canShare) {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          title: filename,
          text: caption,
          files: [file],
        });
        return;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
      }
    }
  }

  // Final fallback: save to device
  await downloadBlob(blob, filename);
}
