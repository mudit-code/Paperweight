import { PDFDocument } from 'pdf-lib';
import type { ProcessedFile, ProgressReport } from '../types';
import type { CancellationToken } from '../worker/cancellation';
import { OperationCancelledError, PaperweightError } from '../errors';
import type { BatchResult } from './types';

// Standard paper dimensions in points (72 pt = 1 inch)
const PAGE_DIMENSIONS = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612.0, height: 792.0 },
};

const MARGIN_SIZES = {
  none: 0,
  small: 28.35, // 10mm
  standard: 56.7, // 20mm
};

async function renderImageToPngBuffer(
  file: ProcessedFile
): Promise<{ buffer: ArrayBuffer; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const blob = new Blob([file.data], { type: file.type || 'image/png' });
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0);

      canvas.toBlob(async (pngBlob) => {
        if (!pngBlob) {
          reject(new Error(`Failed to rasterize image ${file.name}`));
          return;
        }
        const buffer = await pngBlob.arrayBuffer();
        resolve({ buffer, width, height });
      }, 'image/png');
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new PaperweightError({
          code: 'ERR_IMAGE_DECODE',
          title: `Cannot Read Image: ${file.name}`,
          message: 'The file appears corrupted or uses an unsupported image encoding.',
        })
      );
    };

    img.src = url;
  });
}

export async function processImageToPdf(
  files: ProcessedFile[],
  options: Record<string, unknown>,
  onProgress: (report: ProgressReport) => void,
  cancellationToken?: CancellationToken
): Promise<BatchResult> {
  if (files.length === 0) {
    throw new PaperweightError({
      code: 'ERR_NO_FILES',
      title: 'No Images Selected',
      message: 'Please add at least one image to convert.',
    });
  }

  const pageSizeOpt = (options.pageSize as string) || 'a4';
  const orientationOpt = (options.orientation as string) || 'auto';
  const marginOpt = (options.margin as string) || 'none';
  const margin = MARGIN_SIZES[marginOpt as keyof typeof MARGIN_SIZES] ?? 0;

  onProgress({
    taskId: 'task_exec',
    phase: 'Initializing document',
    current: 0,
    total: files.length,
    percentage: 5,
    message: 'Creating PDF on device...',
  });

  const pdfDoc = await PDFDocument.create();

  for (let i = 0; i < files.length; i++) {
    if (cancellationToken?.isCancelled) {
      throw new OperationCancelledError('Image to PDF');
    }

    const file = files[i];
    const pct = Math.round(5 + ((i + 0.5) / files.length) * 85);

    onProgress({
      taskId: 'task_exec',
      phase: `Processing image ${i + 1} of ${files.length}`,
      current: i + 1,
      total: files.length,
      percentage: pct,
      message: file.name,
    });

    let embeddedImage;
    let imgWidth = 0;
    let imgHeight = 0;

    const isJpeg = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name);
    const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);

    // Try direct native embedding if possible for speed
    let directSuccess = false;
    if (isJpeg) {
      try {
        embeddedImage = await pdfDoc.embedJpg(file.data);
        imgWidth = embeddedImage.width;
        imgHeight = embeddedImage.height;
        directSuccess = true;
      } catch {
        // Fall back to canvas
      }
    } else if (isPng) {
      try {
        embeddedImage = await pdfDoc.embedPng(file.data);
        imgWidth = embeddedImage.width;
        imgHeight = embeddedImage.height;
        directSuccess = true;
      } catch {
        // Fall back to canvas
      }
    }

    // Canvas fallback handles WebP, transparent PNGs with tricky color profiles, etc.
    if (!directSuccess) {
      const rendered = await renderImageToPngBuffer(file);
      embeddedImage = await pdfDoc.embedPng(rendered.buffer);
      imgWidth = rendered.width;
      imgHeight = rendered.height;
    }

    if (!embeddedImage) {
      throw new Error(`Could not embed image ${file.name}`);
    }

    // Determine Page Width and Height
    let targetPageWidth: number;
    let targetPageHeight: number;

    if (pageSizeOpt === 'fit') {
      targetPageWidth = imgWidth + margin * 2;
      targetPageHeight = imgHeight + margin * 2;
    } else {
      const baseDim =
        PAGE_DIMENSIONS[pageSizeOpt as keyof typeof PAGE_DIMENSIONS] || PAGE_DIMENSIONS.a4;
      const isLandscape = imgWidth > imgHeight;

      let useLandscape = false;
      if (orientationOpt === 'landscape') {
        useLandscape = true;
      } else if (orientationOpt === 'portrait') {
        useLandscape = false;
      } else {
        useLandscape = isLandscape;
      }

      if (useLandscape) {
        targetPageWidth = Math.max(baseDim.width, baseDim.height);
        targetPageHeight = Math.min(baseDim.width, baseDim.height);
      } else {
        targetPageWidth = Math.min(baseDim.width, baseDim.height);
        targetPageHeight = Math.max(baseDim.width, baseDim.height);
      }
    }

    const printableWidth = Math.max(1, targetPageWidth - margin * 2);
    const printableHeight = Math.max(1, targetPageHeight - margin * 2);

    const scale = Math.min(printableWidth / imgWidth, printableHeight / imgHeight);
    const drawWidth = imgWidth * scale;
    const drawHeight = imgHeight * scale;

    const x = margin + (printableWidth - drawWidth) / 2;
    const y = margin + (printableHeight - drawHeight) / 2;

    const page = pdfDoc.addPage([targetPageWidth, targetPageHeight]);
    page.drawImage(embeddedImage, {
      x,
      y,
      width: drawWidth,
      height: drawHeight,
    });
  }

  if (cancellationToken?.isCancelled) {
    throw new OperationCancelledError('Image to PDF');
  }

  onProgress({
    taskId: 'task_exec',
    phase: 'Generating PDF',
    current: files.length,
    total: files.length,
    percentage: 95,
    message: 'Compiling PDF document on device...',
  });

  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
  const downloadUrl = URL.createObjectURL(blob);

  const baseFilename =
    files.length === 1
      ? files[0].name.replace(/\.[^/.]+$/, '')
      : 'converted_images';
  const filename = `${baseFilename}.pdf`;

  onProgress({
    taskId: 'task_exec',
    phase: 'Complete',
    current: files.length,
    total: files.length,
    percentage: 100,
    message: 'Batch processed successfully on device.',
  });

  return {
    id: `res_${Date.now()}`,
    toolId: 'image-to-pdf',
    title: 'PDF Document Ready',
    filename,
    blob,
    size: blob.size,
    downloadUrl,
    itemCount: files.length,
    timestamp: Date.now(),
    fileType: 'pdf',
  };
}
