import { FileValidationError, MemoryLimitError } from '../errors';
import { detectMimeFromBytes } from './mime';

export interface ValidationRules {
  acceptedMimes?: string[];
  maxFileSize?: number; // In bytes (default 250 MB)
  maxBatchCount?: number; // In files (default 250)
  maxBatchBytes?: number; // In bytes (default 1.5 GB)
}

export const DEFAULT_RULES: ValidationRules = {
  maxFileSize: 250 * 1024 * 1024, // 250MB single file limit
  maxBatchCount: 250, // 250 file batch ceiling
  maxBatchBytes: 1500 * 1024 * 1024, // 1.5GB total batch ceiling
};

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export async function validateFile(
  file: File,
  rules: ValidationRules = DEFAULT_RULES
): Promise<void> {
  // Check empty files
  if (file.size === 0) {
    throw new FileValidationError(
      `"${file.name}" is completely empty (0 bytes).`,
      'Please select a valid, non-empty file.',
      file.name
    );
  }

  // Check single file size
  const maxSingle = rules.maxFileSize ?? DEFAULT_RULES.maxFileSize!;
  if (file.size > maxSingle) {
    throw new FileValidationError(
      `"${file.name}" is ${formatBytes(file.size)}, exceeding the single file limit of ${formatBytes(maxSingle)}.`,
      'Consider compressing or splitting the file before importing.',
      file.name
    );
  }

  // Check MIME acceptance if specified
  if (rules.acceptedMimes && rules.acceptedMimes.length > 0) {
    const fileNameLower = file.name.toLowerCase();
    const isAcceptedType = rules.acceptedMimes.some((mime) => {
      if (mime.startsWith('.')) {
        return fileNameLower.endsWith(mime.toLowerCase());
      }
      if (mime.endsWith('/*')) {
        const prefix = mime.split('/')[0];
        return file.type.startsWith(`${prefix}/`);
      }
      return file.type === mime;
    });

    if (!isAcceptedType) {
      // Validate with magic bytes check as fallback if browser MIME detection was blank
      const headerSlice = await file.slice(0, 32).arrayBuffer();
      const detectedMime = detectMimeFromBytes(headerSlice);

      const matchesMagic =
        detectedMime &&
        rules.acceptedMimes.some((mime) => {
          if (mime.startsWith('.')) return false;
          if (mime.endsWith('/*')) {
            const prefix = mime.split('/')[0];
            return detectedMime.startsWith(`${prefix}/`);
          }
          return detectedMime === mime;
        });

      // Extension fallback for document and PDF formats
      const matchesExtension = rules.acceptedMimes.some((mime) => {
        if (
          (mime === 'application/pdf' || mime === '.pdf') &&
          fileNameLower.endsWith('.pdf')
        ) {
          return true;
        }
        if (
          (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            mime === 'application/msword' ||
            mime === '.docx' ||
            mime === '.doc') &&
          (fileNameLower.endsWith('.docx') || fileNameLower.endsWith('.doc'))
        ) {
          return true;
        }
        return false;
      });

      if (!matchesMagic && !matchesExtension) {
        throw new FileValidationError(
          `"${file.name}" (${file.type || 'unknown format'}) is not supported by this tool.`,
          `Supported formats: ${rules.acceptedMimes.join(', ')}`,
          file.name
        );
      }
    }
  }
}

export function validateBatchLimits(files: File[], rules: ValidationRules = DEFAULT_RULES): void {
  const maxBatch = rules.maxBatchCount ?? DEFAULT_RULES.maxBatchCount!;
  if (files.length > maxBatch) {
    throw new FileValidationError(
      `You selected ${files.length} files. The maximum batch size is ${maxBatch} files.`,
      `Please process in smaller groups of up to ${maxBatch} files.`
    );
  }

  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
  const maxBytes = rules.maxBatchBytes ?? DEFAULT_RULES.maxBatchBytes!;
  if (totalBytes > maxBytes) {
    throw new MemoryLimitError(files.length, totalBytes);
  }
}

/**
 * Safely reads a File or Blob into an ArrayBuffer with resilient fallback strategies.
 * On mobile browsers and Android WebViews, reading File objects can fail with NotReadableError
 * if the temporary handle expires or if the browser stream locks. This helper sequentially tries:
 * 1. file.arrayBuffer()
 * 2. FileReader.readAsArrayBuffer()
 * 3. URL.createObjectURL() + fetch()
 * 4. file.slice().arrayBuffer()
 * 5. Image drawing fallback (for image files)
 */
export async function readFileAsArrayBuffer(file: File | Blob): Promise<ArrayBuffer> {
  // Strategy 1: Native file.arrayBuffer()
  try {
    if (typeof file.arrayBuffer === 'function') {
      const buf = await file.arrayBuffer();
      if (buf && buf.byteLength > 0) return buf;
    }
  } catch (err) {
    console.warn('Native file.arrayBuffer() failed, trying FileReader...', err);
  }

  // Strategy 2: FileReader
  try {
    const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(reader.result);
        } else {
          reject(new Error('FileReader returned non-ArrayBuffer'));
        }
      };
      reader.onerror = () => reject(reader.error || new Error('FileReader read error'));
      reader.onabort = () => reject(new Error('FileReader aborted'));
      reader.readAsArrayBuffer(file);
    });
    if (buf && buf.byteLength > 0) return buf;
  } catch (err) {
    console.warn('FileReader failed, trying blob URL fetch...', err);
  }

  // Strategy 3: Object URL + fetch
  try {
    const blobUrl = URL.createObjectURL(file);
    try {
      const res = await fetch(blobUrl);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        if (buf && buf.byteLength > 0) return buf;
      }
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  } catch (err) {
    console.warn('Object URL fetch failed, trying slice...', err);
  }

  // Strategy 4: Sliced file
  try {
    const slice = file.slice(0, file.size, file.type);
    if (typeof slice.arrayBuffer === 'function') {
      const buf = await slice.arrayBuffer();
      if (buf && buf.byteLength > 0) return buf;
    }
  } catch (err) {
    console.warn('Slice reading failed...', err);
  }

  // Strategy 5: Image element draw to canvas (for images)
  const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp|avif|bmp|gif)$/i.test((file as File).name || '');
  if (isImage && typeof document !== 'undefined') {
    try {
      const blobUrl = URL.createObjectURL(file);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Image decode error'));
        img.src = blobUrl;
      });
      URL.revokeObjectURL(blobUrl);

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width || 300;
      canvas.height = img.naturalHeight || img.height || 300;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const mime = file.type || 'image/jpeg';
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.95));
        if (blob) {
          const buf = await blob.arrayBuffer();
          if (buf && buf.byteLength > 0) return buf;
        }
      }
    } catch (err) {
      console.warn('Image canvas fallback failed...', err);
    }
  }

  throw new FileValidationError(
    `Unable to read "${(file as File).name || 'the selected file'}".`,
    'The file handle was revoked by the device. Please choose the photo again from your gallery or files.',
    (file as File).name
  );
}
