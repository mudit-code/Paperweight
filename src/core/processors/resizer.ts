import type { ProcessedFile, ProgressReport } from '../types';
import type { CancellationToken } from '../worker/cancellation';
import { OperationCancelledError, PaperweightError } from '../errors';
import type { BatchResult, CompressedItemResult } from './types';

export type DimensionUnit = 'px' | 'in' | 'cm';

export interface CropRect {
  x: number; // 0 to 1 normalized
  y: number; // 0 to 1 normalized
  width: number; // 0 to 1 normalized
  height: number; // 0 to 1 normalized
}

export interface EditorCropData {
  relX: number; // normalized position relative to frame width: (imgLeft - frameLeft) / frameWidth
  relY: number; // normalized position relative to frame height: (imgTop - frameTop) / frameHeight
  relW: number; // normalized width: displayedImgWidth / frameWidth
  relH: number; // normalized height: displayedImgHeight / frameHeight
  rotation?: number; // arbitrary degrees or steps
  flipH?: boolean; // flip horizontally
  flipV?: boolean; // flip vertically
  bgColor?: string; // background fill color for margins (default: '#ffffff')
}

export interface ResizerOptions {
  unit?: DimensionUnit;
  targetWidth?: number;
  targetHeight?: number;
  dpi?: number;
  outputFormat?: 'jpeg' | 'png' | 'webp';
  targetSizeEnabled?: boolean;
  maxSizeKB?: number;
  minSizeKB?: number;
  cropRect?: CropRect;
  editorCrop?: EditorCropData;
  cropEnabled?: boolean;
}

/**
 * Converts physical dimensions (in, cm) to exact pixels based on DPI.
 */
export function convertToPixels(value: number, unit: DimensionUnit, dpi: number = 300): number {
  if (unit === 'px') {
    return Math.max(1, Math.round(value));
  }
  if (unit === 'in') {
    return Math.max(1, Math.round(value * dpi));
  }
  if (unit === 'cm') {
    return Math.max(1, Math.round((value / 2.54) * dpi));
  }
  return Math.max(1, Math.round(value));
}

/**
 * Converts pixels to physical unit (in, cm).
 */
export function convertFromPixels(pixels: number, unit: DimensionUnit, dpi: number = 300): number {
  if (unit === 'px') {
    return pixels;
  }
  if (unit === 'in') {
    return Number((pixels / dpi).toFixed(2));
  }
  if (unit === 'cm') {
    return Number(((pixels / dpi) * 2.54).toFixed(2));
  }
  return pixels;
}

/**
 * Crops, resizes, and optimizes an image to exact dimensions and target file size range.
 */
export async function processSingleResizerImage(
  file: ProcessedFile,
  options: ResizerOptions,
  cancellationToken?: CancellationToken,
  onStepProgress?: (pct: number, message: string) => void
): Promise<{
  blob: Blob;
  filename: string;
  width: number;
  height: number;
  size: number;
  originalSize: number;
}> {
  if (cancellationToken?.isCancelled) {
    throw new OperationCancelledError();
  }

  onStepProgress?.(15, 'Loading image into memory...');
  await new Promise((r) => setTimeout(r, 20));

  const unit: DimensionUnit = options.unit || 'px';
  const dpi = Number(options.dpi) || 300;
  const targetWidthPx = convertToPixels(Number(options.targetWidth) || 1200, unit, dpi);
  const targetHeightPx = convertToPixels(Number(options.targetHeight) || 1200, unit, dpi);

  const format = options.outputFormat || 'jpeg';
  const mimeType = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
  const extension = format === 'jpeg' ? '.jpg' : `.${format}`;

  const targetSizeEnabled = Boolean(options.targetSizeEnabled);
  const maxSizeKB = Number(options.maxSizeKB) || 0;
  const minSizeKB = Number(options.minSizeKB) || 0;

  // 1. Load source image
  const imgBlob = new Blob([file.data], { type: file.type });
  const objectUrl = URL.createObjectURL(imgBlob);

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new PaperweightError({
      code: 'ERR_INVALID_IMAGE',
      title: 'Failed to load image',
      message: `Could not decode image "${file.name}".`,
    }));
    el.src = objectUrl;
  }).finally(() => {
    URL.revokeObjectURL(objectUrl);
  });

  const naturalWidth = img.naturalWidth || img.width;
  const naturalHeight = img.naturalHeight || img.height;

  if (naturalWidth <= 0 || naturalHeight <= 0) {
    throw new PaperweightError({
      code: 'ERR_INVALID_IMAGE_DIMENSIONS',
      title: 'Invalid Image',
      message: 'Image has invalid or zero dimensions.',
    });
  }

  // 3. Render cropped/zoomed area to target dimensions on offscreen canvas
  const canvas = document.createElement('canvas');
  canvas.width = targetWidthPx;
  canvas.height = targetHeightPx;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new PaperweightError({
      code: 'ERR_CANVAS_FAILED',
      title: 'Canvas Error',
      message: 'Failed to create 2D canvas context for rendering.',
    });
  }

  // Use high-quality image smoothing
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const cropEnabled = options.cropEnabled !== false;

  if (!cropEnabled) {
    // Cropper is toggled off: preserve full image without cropping, scaled to target frame
    const bgColor = options.editorCrop?.bgColor || (format === 'jpeg' ? '#FFFFFF' : 'transparent');
    if (format === 'jpeg' || (bgColor && bgColor !== 'transparent')) {
      ctx.fillStyle = bgColor === 'transparent' ? '#FFFFFF' : bgColor;
      ctx.fillRect(0, 0, targetWidthPx, targetHeightPx);
    }

    const fitScale = Math.min(targetWidthPx / naturalWidth, targetHeightPx / naturalHeight);
    const destW = Math.round(naturalWidth * fitScale);
    const destH = Math.round(naturalHeight * fitScale);
    const destX = Math.round((targetWidthPx - destW) / 2);
    const destY = Math.round((targetHeightPx - destH) / 2);

    const rotation = options.editorCrop?.rotation || 0;
    const flipH = options.editorCrop?.flipH ?? false;
    const flipV = options.editorCrop?.flipV ?? false;
    if (rotation !== 0 || flipH || flipV) {
      ctx.save();
      const centerX = destX + destW / 2;
      const centerY = destY + destH / 2;
      ctx.translate(centerX, centerY);
      if (rotation !== 0) {
        ctx.rotate((rotation * Math.PI) / 180);
      }
      if (flipH || flipV) {
        ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      }
      ctx.drawImage(img, -destW / 2, -destH / 2, destW, destH);
      ctx.restore();
    } else {
      ctx.drawImage(img, destX, destY, destW, destH);
    }
  } else if (options.editorCrop) {
    const { relX, relY, relW, relH, rotation = 0, flipH = false, flipV = false, bgColor = '#FFFFFF' } = options.editorCrop;

    // Background fill (essential when zoomed out so margins have clean background)
    if (format === 'jpeg' || (bgColor && bgColor !== 'transparent')) {
      ctx.fillStyle = bgColor === 'transparent' ? '#FFFFFF' : bgColor;
      ctx.fillRect(0, 0, targetWidthPx, targetHeightPx);
    }

    const destX = relX * targetWidthPx;
    const destY = relY * targetHeightPx;
    const destW = relW * targetWidthPx;
    const destH = relH * targetHeightPx;

    if (rotation !== 0 || flipH || flipV) {
      ctx.save();
      const centerX = destX + destW / 2;
      const centerY = destY + destH / 2;
      ctx.translate(centerX, centerY);
      if (rotation !== 0) {
        ctx.rotate((rotation * Math.PI) / 180);
      }
      if (flipH || flipV) {
        ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      }
      ctx.drawImage(img, -destW / 2, -destH / 2, destW, destH);
      ctx.restore();
    } else {
      ctx.drawImage(img, destX, destY, destW, destH);
    }
  } else {
    // Fallback legacy cropRect: ensure aspect-ratio preservation to prevent stretching
    const targetAspect = targetWidthPx / targetHeightPx;
    const crop = options.cropRect || { x: 0, y: 0, width: 1, height: 1 };
    let cropX = Math.max(0, Math.min(naturalWidth - 1, Math.round(crop.x * naturalWidth)));
    let cropY = Math.max(0, Math.min(naturalHeight - 1, Math.round(crop.y * naturalHeight)));
    let cropW = Math.max(1, Math.min(naturalWidth - cropX, Math.round(crop.width * naturalWidth)));
    let cropH = Math.max(1, Math.min(naturalHeight - cropY, Math.round(crop.height * naturalHeight)));

    const currentAspect = cropW / cropH;
    if (Math.abs(currentAspect - targetAspect) > 0.01) {
      if (currentAspect > targetAspect) {
        // Wider than target: reduce width centered
        const adjustedW = cropH * targetAspect;
        cropX += (cropW - adjustedW) / 2;
        cropW = adjustedW;
      } else {
        // Taller than target: reduce height centered
        const adjustedH = cropW / targetAspect;
        cropY += (cropH - adjustedH) / 2;
        cropH = adjustedH;
      }
    }

    if (format === 'jpeg') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetWidthPx, targetHeightPx);
    }

    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, targetWidthPx, targetHeightPx);
  }

  onStepProgress?.(30, 'Applied target dimensions & crop geometry...');
  await new Promise((r) => setTimeout(r, 20));

  if (cancellationToken?.isCancelled) {
    throw new OperationCancelledError();
  }

  // 4. Encode to blob with target size optimization
  const toBlobWithQuality = (q: number): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas export failed'));
        },
        mimeType,
        q
      );
    });
  };

  let finalBlob: Blob;

  if (targetSizeEnabled && maxSizeKB > 0 && (format === 'jpeg' || format === 'webp')) {
    const maxSizeBytes = maxSizeKB * 1024;
    const minSizeBytes = minSizeKB > 0 ? minSizeKB * 1024 : 0;

    // Binary search quality between 0.10 and 0.96 to match file size constraints
    let lowQ = 0.10;
    let highQ = 0.96;
    let bestBlob: Blob | null = null;
    const maxIters = 7;

    for (let iter = 0; iter < maxIters; iter++) {
      if (cancellationToken?.isCancelled) throw new OperationCancelledError();
      const midQ = Number(((lowQ + highQ) / 2).toFixed(2));
      const stepPct = Math.round(35 + ((iter + 1) / maxIters) * 55); // 43% -> 90%
      onStepProgress?.(stepPct, `Optimizing file size (pass ${iter + 1}/${maxIters})...`);
      await new Promise((r) => setTimeout(r, 20));

      const testBlob = await toBlobWithQuality(midQ);

      if (testBlob.size <= maxSizeBytes) {
        bestBlob = testBlob;
        if (minSizeBytes > 0 && testBlob.size >= minSizeBytes) {
          // Exact hit within range [min, max]
          break;
        }
        // Try higher quality while staying under max
        lowQ = midQ;
      } else {
        // Exceeded max size, reduce quality
        highQ = midQ;
      }
    }

    onStepProgress?.(92, 'Finalizing size optimization...');
    await new Promise((r) => setTimeout(r, 20));
    finalBlob = bestBlob || (await toBlobWithQuality(0.15));
  } else {
    // Standard high-quality export
    onStepProgress?.(55, 'Encoding image pixels...');
    await new Promise((r) => setTimeout(r, 20));
    const defaultQuality = format === 'jpeg' ? 0.92 : format === 'webp' ? 0.90 : undefined;
    finalBlob = await toBlobWithQuality(defaultQuality ?? 0.92);
    onStepProgress?.(92, 'Finalizing image blob...');
    await new Promise((r) => setTimeout(r, 20));
  }

  onStepProgress?.(96, 'Saving processed image...');
  await new Promise((r) => setTimeout(r, 20));
  const baseName = file.name.replace(/\.[^/.]+$/, '');
  const outFilename = `${baseName}_${targetWidthPx}x${targetHeightPx}${extension}`;

  return {
    blob: finalBlob,
    filename: outFilename,
    width: targetWidthPx,
    height: targetHeightPx,
    size: finalBlob.size,
    originalSize: file.size,
  };
}

/**
 * Universal batch processor for Resizer & Cropper tool.
 */
export async function processResizer(
  files: ProcessedFile[],
  options: Record<string, unknown>,
  onProgress: (report: ProgressReport) => void,
  cancellationToken?: CancellationToken
): Promise<BatchResult> {
  if (files.length === 0) {
    throw new PaperweightError({
      code: 'ERR_NO_FILES',
      title: 'No Images Selected',
      message: 'Please add at least one image to resize and crop.',
    });
  }

  const resizerOptions: ResizerOptions = {
    unit: (options.unit as DimensionUnit) || 'px',
    targetWidth: Number(options.targetWidth) || 1200,
    targetHeight: Number(options.targetHeight) || 1200,
    dpi: Number(options.dpi) || 300,
    outputFormat: (options.outputFormat as 'jpeg' | 'png' | 'webp') || 'jpeg',
    targetSizeEnabled: Boolean(options.targetSizeEnabled),
    maxSizeKB: Number(options.maxSizeKB) || 200,
    minSizeKB: Number(options.minSizeKB) || 0,
    cropRect: options.cropRect as CropRect | undefined,
  };

  const items: CompressedItemResult[] = [];
  const total = files.length;

  for (let i = 0; i < total; i++) {
    if (cancellationToken?.isCancelled) {
      throw new OperationCancelledError();
    }

    const file = files[i];
    const fileBasePct = (i / total) * 92;
    const fileRange = (1 / total) * 92;

    onProgress({
      taskId: 'resizer',
      phase: `Processing ${file.name}`,
      current: i + 1,
      total,
      percentage: Math.max(5, Math.round(fileBasePct + 5)),
      message: `Preparing ${file.name}...`,
    });

    const res = await processSingleResizerImage(
      file,
      resizerOptions,
      cancellationToken,
      (subPct, subMsg) => {
        const overall = Math.min(95, Math.round(fileBasePct + (subPct / 100) * fileRange));
        onProgress({
          taskId: 'resizer',
          phase: `Resizing and cropping ${file.name}`,
          current: i + 1,
          total,
          percentage: overall,
          message: subMsg,
        });
      }
    );

    items.push({
      id: file.id,
      name: res.filename,
      blob: res.blob,
      originalSize: res.originalSize,
      compressedSize: res.size,
      fileType: 'image',
      savingsPercent: Math.max(0, Math.round(((res.originalSize - res.size) / res.originalSize) * 100)),
    });
  }

  onProgress({
    taskId: 'resizer',
    phase: 'Complete',
    current: total,
    total,
    percentage: 100,
    message: 'Finished resizing and cropping!',
  });

  const firstItem = items[0];
  const downloadUrl = typeof URL !== 'undefined' ? URL.createObjectURL(firstItem.blob) : '';

  return {
    id: `resizer_${Date.now()}`,
    toolId: 'resizer',
    title: 'Cropped & Resized Image Ready',
    filename: total === 1 ? firstItem.name : `resized_images_${Date.now()}.zip`,
    blob: firstItem.blob,
    size: items.reduce((acc, it) => acc + it.compressedSize, 0),
    downloadUrl,
    itemCount: items.length,
    timestamp: Date.now(),
    fileType: 'image',
    originalSize: items.reduce((acc, it) => acc + it.originalSize, 0),
    savingsPercent: firstItem.savingsPercent,
    items,
  };
}
