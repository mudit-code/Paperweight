import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import JSZip from 'jszip';
import type { ProcessedFile, ProgressReport } from '../types';
import type { CancellationToken } from '../worker/cancellation';
import { OperationCancelledError, PaperweightError } from '../errors';
import type { BatchResult } from './types';
import {
  encodeBmp,
  encodeTiff,
  applyGrayscale,
  applyMonochrome,
  parsePageRange,
} from './image-encoders';

// Set up worker source
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export async function processPdfToImage(
  files: ProcessedFile[],
  options: Record<string, unknown>,
  onProgress: (report: ProgressReport) => void,
  cancellationToken?: CancellationToken
): Promise<BatchResult> {
  if (files.length === 0) {
    throw new PaperweightError({
      code: 'ERR_NO_FILES',
      title: 'No PDFs Selected',
      message: 'Please add at least one PDF file to render into images.',
    });
  }

  const format = (options.format as string) || 'png';
  const resolutionDpi = parseInt((options.resolution as string) || '150', 10);
  const scale = resolutionDpi / 72; // Standard PDF DPI is 72

  const qualityNum = typeof options.quality === 'number'
    ? Math.max(0.1, Math.min(1.0, options.quality / 100))
    : 0.92;

  const colorMode = (options.colorMode as string) || 'color';
  const backgroundMode = (options.background as string) || 'white';
  const pageRangeMode = (options.pageRange as string) || 'all';
  const customPagesStr = (options.customPages as string) || '1';

  let defaultExt = 'png';
  if (format === 'jpeg') defaultExt = 'jpg';
  else if (format === 'webp') defaultExt = 'webp';
  else if (format === 'avif') defaultExt = 'avif';
  else if (format === 'tiff') defaultExt = 'tiff';
  else if (format === 'bmp') defaultExt = 'bmp';

  const renderedPages: { name: string; blob: Blob }[] = [];

  for (let f = 0; f < files.length; f++) {
    if (cancellationToken?.isCancelled) {
      throw new OperationCancelledError('PDF to Image');
    }

    const file = files[f];
    const baseName = file.name.replace(/\.[^/.]+$/, '');

    onProgress({
      taskId: 'task_exec',
      phase: `Reading PDF ${f + 1} of ${files.length}`,
      current: f + 1,
      total: files.length,
      percentage: Math.round(5 + (f / files.length) * 85),
      message: file.name,
    });

    let fileBytes: Uint8Array;
    const isDetached = (file.data as { detached?: boolean }).detached || file.data.byteLength === 0;
    if (isDetached && file.blob) {
      const fresh = await file.blob.arrayBuffer();
      file.data = fresh;
      fileBytes = new Uint8Array(fresh.slice(0));
    } else {
      fileBytes = new Uint8Array(file.data.slice(0));
    }

    const loadingTask = pdfjsLib.getDocument({
      data: fileBytes,
    });

    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;

    // Determine which pages to render based on page selection
    let pagesToRender: number[] = [];
    if (pageRangeMode === 'first') {
      pagesToRender = [1];
    } else if (pageRangeMode === 'last') {
      pagesToRender = [numPages];
    } else if (pageRangeMode === 'custom') {
      pagesToRender = parsePageRange(customPagesStr, numPages);
    } else {
      pagesToRender = Array.from({ length: numPages }, (_, i) => i + 1);
    }

    if (pagesToRender.length === 0) {
      throw new PaperweightError({
        code: 'ERR_INVALID_PAGE_RANGE',
        title: 'Invalid Page Range',
        message: `The page selection "${customPagesStr}" is invalid for ${file.name} (${numPages} ${numPages === 1 ? 'page' : 'pages'}). Please check your page range in options.`,
      });
    }

    for (let i = 0; i < pagesToRender.length; i++) {
      if (cancellationToken?.isCancelled) {
        throw new OperationCancelledError('PDF to Image');
      }

      const p = pagesToRender[i];

      onProgress({
        taskId: 'task_exec',
        phase: `Rendering page ${p} of ${numPages}`,
        current: i + 1,
        total: pagesToRender.length,
        percentage: Math.round(5 + ((f + (i + 1) / pagesToRender.length) / files.length) * 85),
        message: `${file.name} (page ${p})`,
      });

      const page = await pdfDoc.getPage(p);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');

      // Background handling
      const supportsTransparency = ['png', 'webp', 'avif'].includes(format);
      if (backgroundMode === 'transparent' && supportsTransparency) {
        // Leave canvas transparent
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      } else if (backgroundMode === 'paper') {
        ctx.fillStyle = '#faf7f2';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        // Solid white default
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      const renderContext = {
        canvasContext: ctx,
        viewport,
      };

      await page.render(renderContext as unknown as Parameters<typeof page.render>[0]).promise;

      let blob: Blob | null = null;
      let finalExt = defaultExt;

      if (format === 'bmp') {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        if (colorMode === 'grayscale') applyGrayscale(imgData.data);
        else if (colorMode === 'monochrome') applyMonochrome(imgData.data);
        const bytes = encodeBmp(canvas.width, canvas.height, imgData.data);
        blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'image/bmp' });
      } else if (format === 'tiff') {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        if (colorMode === 'grayscale') applyGrayscale(imgData.data);
        else if (colorMode === 'monochrome') applyMonochrome(imgData.data);
        const bytes = encodeTiff(canvas.width, canvas.height, imgData.data, resolutionDpi);
        blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'image/tiff' });
      } else {
        // Color filter transforms
        if (colorMode === 'grayscale') {
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          applyGrayscale(imgData.data);
          ctx.putImageData(imgData, 0, 0);
        } else if (colorMode === 'monochrome') {
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          applyMonochrome(imgData.data);
          ctx.putImageData(imgData, 0, 0);
        }

        if (format === 'avif') {
          blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/avif', qualityNum));
          // If browser does not support AVIF canvas export, fallback to WebP
          if (!blob) {
            blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', qualityNum));
            finalExt = 'webp';
          }
        } else if (format === 'jpeg') {
          blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', qualityNum));
        } else if (format === 'webp') {
          blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', qualityNum));
        } else {
          blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
        }
      }

      if (!blob) throw new Error(`Failed to render page ${p}`);

      const pageName = pagesToRender.length === 1 && files.length === 1
        ? `${baseName}.${finalExt}`
        : `${baseName}_page_${String(p).padStart(3, '0')}.${finalExt}`;

      renderedPages.push({ name: pageName, blob });
    }
  }

  const items = renderedPages.map((item, idx) => ({
    id: `img_${idx}_${Date.now()}`,
    name: item.name,
    blob: item.blob,
    originalSize: item.blob.size,
    compressedSize: item.blob.size,
    fileType: 'image' as const,
    savingsPercent: 0,
  }));

  if (renderedPages.length === 1) {
    const single = renderedPages[0];
    const downloadUrl = URL.createObjectURL(single.blob);
    return {
      id: `res_${Date.now()}`,
      toolId: 'pdf-to-image',
      title: 'Rendered Page Ready',
      filename: single.name,
      blob: single.blob,
      size: single.blob.size,
      downloadUrl,
      itemCount: 1,
      timestamp: Date.now(),
      fileType: 'image',
      items,
    };
  }

  onProgress({
    taskId: 'task_exec',
    phase: 'Creating Archive',
    current: files.length,
    total: files.length,
    percentage: 95,
    message: `Packaging ${renderedPages.length} rendered pages into ZIP...`,
  });

  const zip = new JSZip();
  for (const item of renderedPages) {
    zip.file(item.name, item.blob);
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const downloadUrl = URL.createObjectURL(zipBlob);

  const archiveName = files.length === 1
    ? `${files[0].name.replace(/\.[^/.]+$/, '')}_pages.zip`
    : 'paperweight_pdf_pages.zip';

  return {
    id: `res_${Date.now()}`,
    toolId: 'pdf-to-image',
    title: 'Rendered Pages Archive Ready',
    filename: archiveName,
    blob: zipBlob,
    size: zipBlob.size,
    downloadUrl,
    itemCount: renderedPages.length,
    timestamp: Date.now(),
    fileType: 'zip',
    items,
  };
}
