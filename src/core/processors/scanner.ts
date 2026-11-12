import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ProcessedFile, ProgressReport } from '../types';
import type { CancellationToken } from '../worker/cancellation';
import { OperationCancelledError, PaperweightError } from '../errors';
import type { BatchResult } from './types';

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export interface ScannerProcessorOptions {
  filter?: 'bw' | 'grayscale' | 'color' | 'none';
  outputMode?: 'pdf' | 'images';
  documentName?: string;
  [key: string]: unknown;
}

/**
 * Applies document enhancement filter to canvas context ImageData
 */
function applyFilterToContext(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  filter: string
) {
  if (filter === 'none') return;

  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  if (filter === 'bw') {
    // Dynamic adaptive thresholding for clean document background
    let sum = 0;
    const totalPixels = width * height;
    const step = Math.max(1, Math.floor(totalPixels / 10000));
    let sampleCount = 0;
    for (let p = 0; p < data.length; p += 4 * step) {
      sum += 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      sampleCount++;
    }
    const avgLum = sampleCount > 0 ? sum / sampleCount : 128;
    const threshold = Math.max(70, Math.min(195, avgLum - 8));

    for (let p = 0; p < data.length; p += 4) {
      const lum = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      const val = lum > threshold ? 255 : 0;
      data[p] = val;
      data[p + 1] = val;
      data[p + 2] = val;
    }
  } else if (filter === 'grayscale') {
    for (let p = 0; p < data.length; p += 4) {
      let lum = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      lum = (lum - 128) * 1.35 + 128;
      lum = Math.max(0, Math.min(255, lum));
      data[p] = lum;
      data[p + 1] = lum;
      data[p + 2] = lum;
    }
  } else if (filter === 'color') {
    for (let p = 0; p < data.length; p += 4) {
      data[p] = Math.max(0, Math.min(255, (data[p] - 128) * 1.25 + 128));
      data[p + 1] = Math.max(0, Math.min(255, (data[p + 1] - 128) * 1.25 + 128));
      data[p + 2] = Math.max(0, Math.min(255, (data[p + 2] - 128) * 1.25 + 128));
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

export async function processScanner(
  files: ProcessedFile[],
  options: Record<string, unknown>,
  onProgress: (report: ProgressReport) => void,
  cancellationToken?: CancellationToken
): Promise<BatchResult> {
  if (files.length === 0) {
    throw new PaperweightError({
      code: 'ERR_NO_FILES',
      title: 'No Documents Selected',
      message: 'Please capture or add at least one document image or PDF to process.',
    });
  }

  const filter = (options.filter as string) || 'bw';
  const outputMode = (options.outputMode as string) || 'pdf';
  const docName = ((options.documentName as string) || 'scanned_document').trim();

  const processedOutputs: { name: string; blob: Blob; width: number; height: number }[] = [];

  for (let i = 0; i < files.length; i++) {
    if (cancellationToken?.isCancelled) {
      throw new OperationCancelledError('Document Scanner');
    }

    const file = files[i];
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

    onProgress({
      taskId: 'task_exec',
      phase: `Scanning ${i + 1} of ${files.length}`,
      current: i + 1,
      total: files.length,
      percentage: Math.round(5 + ((i + 0.5) / files.length) * 80),
      message: file.name,
    });

    if (isPdf) {
      // Extract pages from PDF using PDF.js
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(file.data),
      });
      const pdf = await loadingTask.promise;

      for (let p = 1; p <= pdf.numPages; p++) {
        if (cancellationToken?.isCancelled) {
          throw new OperationCancelledError('Document Scanner');
        }

        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 2.0 }); // 2x scale for sharp document text
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport } as unknown as Parameters<typeof page.render>[0]).promise;

        applyFilterToContext(ctx, canvas.width, canvas.height, filter);

        const outBlob = await new Promise<Blob | null>((res) =>
          canvas.toBlob(res, 'image/png')
        );

        if (outBlob) {
          const baseName = file.name.replace(/\.[^/.]+$/, '');
          processedOutputs.push({
            name: `${baseName}_page_${p}_${filter}.png`,
            blob: outBlob,
            width: canvas.width,
            height: canvas.height,
          });
        }
      }
    } else {
      // Process standard image file
      const img = new Image();
      const sourceBlob = new Blob([file.data], { type: file.type || 'image/png' });
      const imgUrl = URL.createObjectURL(sourceBlob);

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`Failed to decode image ${file.name}`));
        img.src = imgUrl;
      });
      URL.revokeObjectURL(imgUrl);

      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context not available');

      ctx.drawImage(img, 0, 0);
      applyFilterToContext(ctx, width, height, filter);

      const outBlob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, 'image/png')
      );
      if (!outBlob) throw new Error(`Could not save scan for ${file.name}`);

      const baseName = file.name.replace(/\.[^/.]+$/, '');
      processedOutputs.push({
        name: `${baseName}_scan_${filter}.png`,
        blob: outBlob,
        width,
        height,
      });
    }
  }

  if (processedOutputs.length === 0) {
    throw new PaperweightError({
      code: 'ERR_EMPTY_SCAN',
      title: 'Processing Failed',
      message: 'No document pages could be processed from the selected files.',
    });
  }

  // OUTPUT MODE 1: Standard Multi-page PDF (default for document scanners)
  if (outputMode === 'pdf') {
    onProgress({
      taskId: 'task_exec',
      phase: 'Compiling PDF',
      current: files.length,
      total: files.length,
      percentage: 92,
      message: 'Generating unified PDF document...',
    });

    const pdfDoc = await PDFDocument.create();

    for (const item of processedOutputs) {
      const pngBytes = await item.blob.arrayBuffer();
      const embeddedImg = await pdfDoc.embedPng(pngBytes);

      // Fit page to image aspect ratio (standard 72 pt/in display)
      const targetW = Math.round(item.width * 0.72);
      const targetH = Math.round(item.height * 0.72);
      const page = pdfDoc.addPage([targetW, targetH]);

      page.drawImage(embeddedImg, {
        x: 0,
        y: 0,
        width: targetW,
        height: targetH,
      });
    }

    const pdfBytes = await pdfDoc.save();
    const pdfBlob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
    const downloadUrl = URL.createObjectURL(pdfBlob);
    const filename = docName.endsWith('.pdf') ? docName : `${docName}.pdf`;

    return {
      id: `res_${Date.now()}`,
      toolId: 'scanner',
      title: 'Scanned PDF Ready',
      filename,
      blob: pdfBlob,
      size: pdfBlob.size,
      downloadUrl,
      itemCount: processedOutputs.length,
      timestamp: Date.now(),
      fileType: 'pdf',
    };
  }

  // OUTPUT MODE 2: Images / ZIP
  if (processedOutputs.length === 1) {
    const single = processedOutputs[0];
    const downloadUrl = URL.createObjectURL(single.blob);
    return {
      id: `res_${Date.now()}`,
      toolId: 'scanner',
      title: 'Scanned Document Image Ready',
      filename: single.name,
      blob: single.blob,
      size: single.blob.size,
      downloadUrl,
      itemCount: 1,
      timestamp: Date.now(),
      fileType: 'image',
    };
  }

  onProgress({
    taskId: 'task_exec',
    phase: 'Creating Archive',
    current: files.length,
    total: files.length,
    percentage: 95,
    message: 'Compressing scans into zip archive...',
  });

  const zip = new JSZip();
  for (const item of processedOutputs) {
    zip.file(item.name, item.blob);
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const downloadUrl = URL.createObjectURL(zipBlob);

  return {
    id: `res_${Date.now()}`,
    toolId: 'scanner',
    title: 'Scanned Batch Archive Ready',
    filename: `${docName}.zip`,
    blob: zipBlob,
    size: zipBlob.size,
    downloadUrl,
    itemCount: processedOutputs.length,
    timestamp: Date.now(),
    fileType: 'zip',
  };
}
