import UPNG from 'upng-js';
import type { ProcessedFile } from '../types';
import { probePdfSize } from './pdf-compress-helper';

export interface SizeEstimate {
  originalBytes: number;
  estimatedBytes: number;
  savingsPercent: number;
  isCalculating: boolean;
}

// In-memory cache of decoded images to avoid repeated re-decoding
const imageElementCache = new Map<string, HTMLImageElement>();

export function clearImageCache(): void {
  imageElementCache.clear();
}

async function getOrLoadImage(file: ProcessedFile): Promise<HTMLImageElement> {
  const cached = imageElementCache.get(file.id);
  if (cached && (cached.naturalWidth || cached.width)) {
    return cached;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const blob = new Blob([file.data], { type: file.type || 'image/png' });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      imageElementCache.set(file.id, img);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load ${file.name}`));
    };
    img.src = url;
  });
}

export async function estimateCompressedFileSize(
  file: ProcessedFile,
  options: Record<string, unknown>
): Promise<number> {
  let qualityNum = 60;
  if (typeof options.compressionLevel === 'number') {
    qualityNum = Math.max(5, Math.min(100, 100 - options.compressionLevel));
  } else if (typeof options.quality === 'number') {
    qualityNum = Math.max(5, Math.min(100, options.quality));
  }
  const qualityRatio = Math.max(0.05, Math.min(1, qualityNum / 100));
  const maxDimOpt = (options.maxDimension as string) || 'original';
  const targetFormat = (options.targetFormat as string) || 'keep';

  // PDF Estimation
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const pdfMode = (options.pdfMode as string) || 'auto';
    const compLevel =
      typeof options.compressionLevel === 'number'
        ? options.compressionLevel
        : typeof options.quality === 'number'
        ? 100 - options.quality
        : 40;

    if (pdfMode === 'stream') {
      // Pure lossless stream optimization (typically 15-20% reduction)
      return Math.max(512, Math.round(file.size * 0.82));
    }

    // Try real-time page probe matching engine rasterization and stream optimization
    const probedBytes = await probePdfSize(file.data, file.size, compLevel, maxDimOpt, pdfMode);
    if (typeof probedBytes === 'number' && probedBytes > 0) {
      return Math.max(512, probedBytes);
    }

    // Fallback formula when running in Node or when probe canvas is unavailable
    if (pdfMode === 'raster' || (pdfMode === 'auto' && compLevel >= 25)) {
      const compFactor = compLevel / 100;
      const ratio = Math.max(0.18, 0.75 - compFactor * 0.55);
      return Math.max(512, Math.round(file.size * ratio));
    }

    // Auto mode with light compression (< 25%): lossless stream optimization used
    return Math.max(512, Math.round(file.size * 0.82));
  }

  // DOCX / Word Document Estimation
  if (
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file.type === 'application/msword' ||
    /\.(docx|doc)$/i.test(file.name)
  ) {
    const docxRatio = Math.max(0.35, Math.min(0.85, 0.35 + qualityRatio * 0.45));
    return Math.max(512, Math.round(file.size * docxRatio));
  }

  // Non-image fallback
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name)) {
    return Math.round(file.size * 0.85);
  }

  const img = await getOrLoadImage(file);
  const origWidth = img.naturalWidth || img.width;
  const origHeight = img.naturalHeight || img.height;

  let targetWidth = origWidth;
  let targetHeight = origHeight;

  if (maxDimOpt !== 'original') {
    const maxDim = parseInt(maxDimOpt, 10);
    if (!isNaN(maxDim) && (origWidth > maxDim || origHeight > maxDim)) {
      if (origWidth >= origHeight) {
        targetWidth = maxDim;
        targetHeight = Math.round((origHeight * maxDim) / origWidth);
      } else {
        targetHeight = maxDim;
        targetWidth = Math.round((origWidth * maxDim) / origHeight);
      }
    }
  }

  let outMime = file.type || 'image/png';
  if (targetFormat === 'image/webp') {
    outMime = 'image/webp';
  } else if (targetFormat === 'image/jpeg') {
    outMime = 'image/jpeg';
  } else if (targetFormat === 'image/png') {
    outMime = 'image/png';
  } else {
    if (outMime === 'image/jpeg' || /\.jpe?g$/i.test(file.name)) {
      outMime = 'image/jpeg';
    } else if (outMime === 'image/webp' || /\.webp$/i.test(file.name)) {
      outMime = 'image/webp';
    } else {
      outMime = 'image/png';
    }
  }

  const dimensionScale = (targetWidth * targetHeight) / (origWidth * origHeight);

  if (outMime === 'image/png') {
    // Lossless PNG at quality >= 98
    if (qualityNum >= 98) {
      return Math.round(file.size * dimensionScale);
    }

    // Palette quantization for lossy PNG
    let cnum = 128;
    if (qualityNum >= 85) cnum = 256;
    else if (qualityNum >= 65) cnum = 128;
    else if (qualityNum >= 45) cnum = 64;
    else if (qualityNum >= 25) cnum = 32;
    else cnum = 16;

    // Use a fast probe canvas (max 480px on longest side for <20ms execution)
    const maxProbe = 480;
    const probeScale = Math.min(1, maxProbe / Math.max(targetWidth, targetHeight));
    const probeW = Math.max(16, Math.round(targetWidth * probeScale));
    const probeH = Math.max(16, Math.round(targetHeight * probeScale));

    const canvas = document.createElement('canvas');
    canvas.width = probeW;
    canvas.height = probeH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return Math.round(file.size * dimensionScale * (cnum / 256));

    ctx.drawImage(img, 0, 0, probeW, probeH);
    const imgData = ctx.getImageData(0, 0, probeW, probeH);

    const probePng = UPNG.encode([imgData.data.buffer], probeW, probeH, cnum);
    const probeBytes = probePng.byteLength;

    if (probeScale >= 1) {
      return probeBytes;
    }

    // Extrapolate to full resolution
    const pixelIndexRatio = (targetWidth * targetHeight) / (probeW * probeH);
    const estimated = Math.round(probeBytes * Math.pow(pixelIndexRatio, 0.82));
    return Math.min(Math.round(file.size * 0.92), estimated);
  }

  // WebP / JPEG: Canvas toBlob is native C++ and blazingly fast (<10ms)
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Math.round(file.size * dimensionScale * qualityRatio);

  if (outMime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
  }
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, outMime, qualityRatio)
  );

  return blob ? blob.size : Math.round(file.size * dimensionScale * qualityRatio);
}

export async function calculateBatchSizeEstimate(
  files: ProcessedFile[],
  options: Record<string, unknown>
): Promise<SizeEstimate | null> {
  if (files.length === 0) return null;

  const originalBytes = files.reduce((acc, f) => acc + f.size, 0);

  const sampleCount = Math.min(files.length, 3);
  let sampleOrigBytes = 0;
  let sampleEstBytes = 0;

  for (let i = 0; i < sampleCount; i++) {
    const f = files[i];
    sampleOrigBytes += f.size;
    const est = await estimateCompressedFileSize(f, options);
    sampleEstBytes += est;
  }

  const ratio = sampleOrigBytes > 0 ? sampleEstBytes / sampleOrigBytes : 0.5;
  const estimatedBytes = Math.round(originalBytes * ratio);

  const savingsPercent =
    originalBytes > 0 && estimatedBytes < originalBytes
      ? Math.round(((originalBytes - estimatedBytes) / originalBytes) * 100)
      : 0;

  return {
    originalBytes,
    estimatedBytes,
    savingsPercent,
    isCalculating: false,
  };
}
