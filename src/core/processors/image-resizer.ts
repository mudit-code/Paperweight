import JSZip from 'jszip';
import UPNG from 'upng-js';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ProcessedFile, ProgressReport } from '../types';
import type { CancellationToken } from '../worker/cancellation';
import { OperationCancelledError, PaperweightError } from '../errors';
import type { BatchResult, CompressedItemResult } from './types';
import { calculatePdfCompressionParams, compressCanvasPage } from './pdf-compress-helper';

// Set up worker source in browser environment
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
}

interface CompressedItem {
  name: string;
  blob: Blob;
  originalSize: number;
  fileType: 'image' | 'pdf' | 'document' | 'zip';
}

function isPdfFile(file: ProcessedFile): boolean {
  return (
    file.type === 'application/pdf' ||
    /\.pdf$/i.test(file.name)
  );
}

function isDocxFile(file: ProcessedFile): boolean {
  return (
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file.type === 'application/msword' ||
    /\.(docx|doc)$/i.test(file.name)
  );
}

function isImageFile(file: ProcessedFile): boolean {
  return (
    file.type.startsWith('image/') ||
    /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name)
  );
}

async function compressImageBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  mimeType: string,
  qualityNum: number,
  qualityRatio: number,
  maxDimOpt: string,
  targetFormat: string,
  onStepProgress?: (pct: number, message: string) => void
): Promise<{ blob: Blob; ext: string }> {
  onStepProgress?.(15, `Decoding ${fileName}...`);
  await new Promise((r) => setTimeout(r, 15));

  const img = new Image();
  const sourceBlob = new Blob([buffer], { type: mimeType || 'image/png' });
  const imgUrl = URL.createObjectURL(sourceBlob);

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Failed to decode image ${fileName}`));
    img.src = imgUrl;
  });
  URL.revokeObjectURL(imgUrl);

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

  onStepProgress?.(45, `Rescaling & rasterizing ${fileName}...`);
  await new Promise((r) => setTimeout(r, 15));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context not available');

  let outMime = mimeType || 'image/png';
  let outExt = 'png';

  if (targetFormat === 'image/webp') {
    outMime = 'image/webp';
    outExt = 'webp';
  } else if (targetFormat === 'image/jpeg') {
    outMime = 'image/jpeg';
    outExt = 'jpg';
  } else if (targetFormat === 'image/png') {
    outMime = 'image/png';
    outExt = 'png';
  } else {
    if (outMime === 'image/jpeg' || /\.jpe?g$/i.test(fileName)) {
      outMime = 'image/jpeg';
      outExt = 'jpg';
    } else if (outMime === 'image/webp' || /\.webp$/i.test(fileName)) {
      outMime = 'image/webp';
      outExt = 'webp';
    } else {
      outMime = 'image/png';
      outExt = 'png';
    }
  }

  onStepProgress?.(75, `Encoding compressed ${outExt.toUpperCase()}...`);
  await new Promise((r) => setTimeout(r, 15));

  let outBlob: Blob | null = null;

  if (outMime === 'image/png') {
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
    const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);

    let cnum = 128;
    if (qualityNum >= 98) {
      cnum = 0; // Pure lossless PNG
    } else if (qualityNum >= 85) {
      cnum = 256;
    } else if (qualityNum >= 65) {
      cnum = 128;
    } else if (qualityNum >= 45) {
      cnum = 64;
    } else if (qualityNum >= 25) {
      cnum = 32;
    } else {
      cnum = 16;
    }

    const pngArrayBuf = UPNG.encode([imgData.data.buffer], targetWidth, targetHeight, cnum);
    outBlob = new Blob([pngArrayBuf], { type: 'image/png' });

    if (cnum > 0 && outBlob.size >= buffer.byteLength && cnum > 16) {
      const fallbackBuf = UPNG.encode(
        [imgData.data.buffer],
        targetWidth,
        targetHeight,
        Math.max(16, Math.floor(cnum / 2))
      );
      if (fallbackBuf.byteLength < outBlob.size) {
        outBlob = new Blob([fallbackBuf], { type: 'image/png' });
      }
    }
  } else if (outMime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
    outBlob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, 'image/jpeg', qualityRatio)
    );
  } else {
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
    outBlob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, 'image/webp', qualityRatio)
    );
  }

  if (!outBlob) {
    throw new Error(`Could not compress image ${fileName}`);
  }

  return { blob: outBlob, ext: outExt };
}

async function rasterizePdfPages(
  fileData: ArrayBuffer,
  fileSize: number,
  compressionLevel: number,
  maxDimOpt: string,
  onPageProgress?: (current: number, total: number) => void
): Promise<Uint8Array | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }

  try {
    // IMPORTANT: slice(0) avoids transferring and detaching the original buffer
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(fileData.slice(0)),
    });

    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;
    if (numPages === 0) return null;

    const params = calculatePdfCompressionParams(fileSize, numPages, compressionLevel, maxDimOpt);
    let scale = params.dpi / 72;
    let quality = params.quality;
    const structuralOverhead = 2048 + 600 * numPages;
    const targetPayloadTotal = Math.max(10000 * numPages, params.targetTotalBytes - structuralOverhead);
    let accumulatedPayloadBytes = 0;

    const newPdf = await PDFDocument.create();

    for (let p = 1; p <= numPages; p++) {
      onPageProgress?.(p, numPages);

      // Yield event loop every 2 pages to keep UI, progress bars, and cancel responsive
      if (p % 2 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const pagesRemaining = Math.max(1, numPages - p + 1);
      const pageBudget = Math.max(8000, (targetPayloadTotal - accumulatedPayloadBytes) / pagesRemaining);

      const page = await pdfDoc.getPage(p);
      const originalViewport = page.getViewport({ scale: 1.0 });
      let scaledViewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(scaledViewport.width));
      canvas.height = Math.max(1, Math.floor(scaledViewport.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: ctx,
        viewport: scaledViewport,
      } as unknown as Parameters<typeof page.render>[0]).promise;

      let compressedPage = await compressCanvasPage(canvas, compressionLevel, quality);

      // Dynamic budget calibration: if this page exceeds remaining per-page budget, tighten scale & quality
      if (compressedPage.size > pageBudget * 1.12) {
        const maxAttempts = p <= 2 ? 2 : 1;
        for (let attempt = 0; attempt < maxAttempts && compressedPage.size > pageBudget * 1.12; attempt++) {
          const overshoot = compressedPage.size / pageBudget;
          scale = Math.max(0.32, Math.min(scale, scale / Math.sqrt(overshoot)));
          quality = Math.max(0.18, Math.min(0.88, quality / Math.pow(overshoot, 0.45)));

          scaledViewport = page.getViewport({ scale });
          canvas.width = Math.max(1, Math.floor(scaledViewport.width));
          canvas.height = Math.max(1, Math.floor(scaledViewport.height));
          const recalCtx = canvas.getContext('2d');
          if (!recalCtx) break;
          recalCtx.fillStyle = '#ffffff';
          recalCtx.fillRect(0, 0, canvas.width, canvas.height);

          await page.render({
            canvasContext: recalCtx,
            viewport: scaledViewport,
          } as unknown as Parameters<typeof page.render>[0]).promise;

          compressedPage = await compressCanvasPage(canvas, compressionLevel, quality);
        }
      }

      accumulatedPayloadBytes += compressedPage.size;

      let embeddedImage;
      if (compressedPage.format === 'png') {
        embeddedImage = await newPdf.embedPng(new Uint8Array(compressedPage.buffer));
      } else {
        embeddedImage = await newPdf.embedJpg(compressedPage.buffer);
      }

      const newPage = newPdf.addPage([originalViewport.width, originalViewport.height]);
      newPage.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width: originalViewport.width,
        height: originalViewport.height,
      });

      // Free canvas and PDF page memory immediately to avoid mobile OOM / crashes
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }

    // Cleanup PDF document resources
    try {
      await pdfDoc.cleanup();
    } catch {
      // Ignore
    }

    const compiledBytes = await newPdf.save({
      useObjectStreams: true,
      addDefaultPage: false,
    });

    return compiledBytes;
  } catch (err) {
    console.warn('PDF rasterization failed, falling back to stream optimization:', err);
    return null;
  }
}

async function compressPdf(
  file: ProcessedFile,
  options: Record<string, unknown>,
  compressionLevel: number,
  maxDimOpt: string,
  onPageProgress?: (current: number, total: number) => void
): Promise<CompressedItem> {
  const stripMetadata = options.stripMetadata !== false;
  const pdfMode = (options.pdfMode as string) || 'auto';
  const baseName = file.name.replace(/\.[^/.]+$/, '');

  // 1. Structure & Stream Optimization via pdf-lib
  const pdfDoc = await PDFDocument.load(file.data, { ignoreEncryption: true });

  if (stripMetadata) {
    try {
      pdfDoc.setTitle('');
      pdfDoc.setAuthor('');
      pdfDoc.setSubject('');
      pdfDoc.setKeywords([]);
      pdfDoc.setProducer('Paperweight Compressor');
      pdfDoc.setCreator('Paperweight Offline');
    } catch {
      // Ignore metadata stripping error on unusual catalog dictionaries
    }
  }

  const streamCompressedBytes = await pdfDoc.save({
    useObjectStreams: true,
    addDefaultPage: false,
    objectsPerTick: 50,
  });

  let bestBytes = streamCompressedBytes;
  const targetRatio = Math.max(0.08, Math.min(0.92, (100 - compressionLevel) / 100));
  const targetTotalBytes = Math.round(file.size * targetRatio);

  // 2. If raster mode is selected, or auto mode with compressionLevel >= 20,
  // resample pages using UPNG/JPEG calibrated to achieve the user's target compression percentage
  if (
    pdfMode === 'raster' ||
    (pdfMode === 'auto' && compressionLevel >= 20)
  ) {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const rasterBytes = await rasterizePdfPages(
        file.data,
        file.size,
        compressionLevel,
        maxDimOpt,
        onPageProgress
      );

      if (rasterBytes && rasterBytes.byteLength < file.size) {
        if (pdfMode === 'raster') {
          bestBytes = rasterBytes;
        } else if (pdfMode === 'auto') {
          // If stream compression alone already reached target size (e.g. text-only PDF), keep vector text
          if (streamCompressedBytes.byteLength <= targetTotalBytes * 1.05 && streamCompressedBytes.byteLength < file.size) {
            bestBytes = streamCompressedBytes;
          } else {
            // Select the result closest to the user's requested compression target
            const streamDiff = Math.abs(streamCompressedBytes.byteLength - targetTotalBytes);
            const rasterDiff = Math.abs(rasterBytes.byteLength - targetTotalBytes);
            if (rasterDiff <= streamDiff) {
              bestBytes = rasterBytes;
            } else if (streamCompressedBytes.byteLength < file.size) {
              bestBytes = streamCompressedBytes;
            } else {
              bestBytes = rasterBytes;
            }
          }
        }
      }
    }
  }

  // Ensure output is never larger than the original file
  if (bestBytes.byteLength >= file.size && streamCompressedBytes.byteLength < file.size) {
    bestBytes = streamCompressedBytes;
  }

  const blob = new Blob([bestBytes as unknown as BlobPart], { type: 'application/pdf' });

  return {
    name: `${baseName}_compressed.pdf`,
    blob,
    originalSize: file.size,
    fileType: 'pdf',
  };
}

async function compressDocx(
  file: ProcessedFile,
  options: Record<string, unknown>,
  qualityNum: number,
  qualityRatio: number,
  maxDimOpt: string
): Promise<CompressedItem> {
  const stripMetadata = options.stripMetadata !== false;
  const baseName = file.name.replace(/\.[^/.]+$/, '');
  const zip = await JSZip.loadAsync(file.data);

  // Check for embedded media in word/media/
  const mediaFilePaths = Object.keys(zip.files).filter((p) => {
    return /^word\/media\/.+\.(png|jpe?g|webp)$/i.test(p) && !zip.files[p].dir;
  });

  // Optimize embedded images if canvas is available in environment
  if (typeof document !== 'undefined' && mediaFilePaths.length > 0) {
    for (const mediaPath of mediaFilePaths) {
      try {
        const imgBuffer = await zip.files[mediaPath].async('arraybuffer');
        const mime = /\.png$/i.test(mediaPath)
          ? 'image/png'
          : /\.webp$/i.test(mediaPath)
          ? 'image/webp'
          : 'image/jpeg';

        const { blob: compBlob } = await compressImageBuffer(
          imgBuffer,
          mediaPath,
          mime,
          qualityNum,
          qualityRatio,
          maxDimOpt,
          'keep'
        );

        if (compBlob.size < imgBuffer.byteLength) {
          const compBuffer = await compBlob.arrayBuffer();
          zip.file(mediaPath, compBuffer);
        }
      } catch (err) {
        console.warn(`Could not compress embedded media ${mediaPath}:`, err);
      }
    }
  }

  // Strip metadata from docProps/core.xml if requested
  if (stripMetadata && zip.files['docProps/core.xml']) {
    try {
      let coreXml = await zip.files['docProps/core.xml'].async('string');
      coreXml = coreXml
        .replace(/<dc:creator>[\s\S]*?<\/dc:creator>/gi, '<dc:creator></dc:creator>')
        .replace(/<cp:lastModifiedBy>[\s\S]*?<\/cp:lastModifiedBy>/gi, '<cp:lastModifiedBy></cp:lastModifiedBy>')
        .replace(/<dc:title>[\s\S]*?<\/dc:title>/gi, '<dc:title></dc:title>')
        .replace(/<cp:keywords>[\s\S]*?<\/cp:keywords>/gi, '<cp:keywords></cp:keywords>');
      zip.file('docProps/core.xml', coreXml);
    } catch {
      // Ignore XML parsing issues
    }
  }

  const deflateLevelNum = options.deflateLevel ? parseInt(String(options.deflateLevel), 10) : 9;
  const level = !isNaN(deflateLevelNum) && deflateLevelNum >= 1 && deflateLevelNum <= 9 ? deflateLevelNum : 9;

  // Repack with DEFLATE compression
  const compressedBlob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
    compressionOptions: { level },
  });

  return {
    name: `${baseName}_compressed.docx`,
    blob: compressedBlob,
    originalSize: file.size,
    fileType: 'document',
  };
}

export async function processCompressor(
  files: ProcessedFile[],
  options: Record<string, unknown>,
  onProgress: (report: ProgressReport) => void,
  cancellationToken?: CancellationToken
): Promise<BatchResult> {
  if (files.length === 0) {
    throw new PaperweightError({
      code: 'ERR_NO_FILES',
      title: 'No Files Selected',
      message: 'Please add at least one image, PDF, or Word document to compress.',
    });
  }

  // Support compressionLevel (higher = compress more) and legacy quality (higher = higher quality)
  let qualityNum = 60;
  if (typeof options.compressionLevel === 'number') {
    qualityNum = Math.max(5, Math.min(100, 100 - options.compressionLevel));
  } else if (typeof options.quality === 'number') {
    qualityNum = Math.max(5, Math.min(100, options.quality));
  }
  const qualityRatio = Math.max(0.05, Math.min(1, qualityNum / 100));
  const maxDimOpt = (options.maxDimension as string) || 'original';
  const targetFormat = (options.targetFormat as string) || 'keep';

  const processedOutputs: CompressedItem[] = [];
  let totalOriginalBytes = 0;

  for (let i = 0; i < files.length; i++) {
    if (cancellationToken?.isCancelled) {
      throw new OperationCancelledError('Compressor');
    }

    const file = files[i];
    totalOriginalBytes += file.size;

    const fileBasePct = (i / files.length) * 88;
    const fileRange = (1 / files.length) * 88;

    onProgress({
      taskId: 'task_exec',
      phase: `Compressing file ${i + 1} of ${files.length}`,
      current: i + 1,
      total: files.length,
      percentage: Math.max(5, Math.round(5 + fileBasePct)),
      message: `Preparing ${file.name}...`,
    });

    const compLevel =
      typeof options.compressionLevel === 'number'
        ? options.compressionLevel
        : typeof options.quality === 'number'
        ? 100 - options.quality
        : 40;

    if (isPdfFile(file)) {
      // PDF Compression
      const pdfItem = await compressPdf(
        file,
        options,
        compLevel,
        maxDimOpt,
        (pCurrent, pTotal) => {
          const pageRatio = pTotal > 0 ? pCurrent / pTotal : 1;
          const overall = Math.min(95, Math.round(5 + fileBasePct + pageRatio * fileRange));
          onProgress({
            taskId: 'task_exec',
            phase: `Compressing PDF page ${pCurrent} of ${pTotal}`,
            current: files.length === 1 ? pCurrent : i + 1,
            total: files.length === 1 ? pTotal : files.length,
            percentage: overall,
            message: `${file.name} (page ${pCurrent}/${pTotal})`,
          });
        }
      );
      processedOutputs.push(pdfItem);
    } else if (isDocxFile(file)) {
      // DOCX Document Compression
      onProgress({
        taskId: 'task_exec',
        phase: `Compressing document ${file.name}`,
        current: i + 1,
        total: files.length,
        percentage: Math.round(5 + fileBasePct + fileRange * 0.3),
        message: `Extracting & compressing media in ${file.name}...`,
      });
      const docxItem = await compressDocx(
        file,
        options,
        qualityNum,
        qualityRatio,
        maxDimOpt
      );
      processedOutputs.push(docxItem);
    } else if (isImageFile(file)) {
      // Image Compression
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      const { blob: outBlob, ext: outExt } = await compressImageBuffer(
        file.data,
        file.name,
        file.type || 'image/png',
        qualityNum,
        qualityRatio,
        maxDimOpt,
        targetFormat,
        (subPct, subMsg) => {
          const overall = Math.min(95, Math.round(5 + fileBasePct + (subPct / 100) * fileRange));
          onProgress({
            taskId: 'task_exec',
            phase: `Compressing image ${file.name}`,
            current: i + 1,
            total: files.length,
            percentage: overall,
            message: subMsg,
          });
        }
      );
      processedOutputs.push({
        name: `${baseName}_optimized.${outExt}`,
        blob: outBlob,
        originalSize: file.size,
        fileType: 'image',
      });
    } else {
      // Fallback pass-through
      processedOutputs.push({
        name: file.name,
        blob: new Blob([file.data], { type: file.type }),
        originalSize: file.size,
        fileType: 'document',
      });
    }
  }

  const totalOutputBytes = processedOutputs.reduce((acc, o) => acc + o.blob.size, 0);
  const savingsPercent =
    totalOriginalBytes > 0 && totalOutputBytes < totalOriginalBytes
      ? Math.round(((totalOriginalBytes - totalOutputBytes) / totalOriginalBytes) * 100)
      : 0;

  const items: CompressedItemResult[] = processedOutputs.map((item, idx) => {
    const origSize = item.originalSize;
    const compSize = item.blob.size;
    const savings =
      origSize > 0 && compSize < origSize
        ? Math.round(((origSize - compSize) / origSize) * 100)
        : 0;
    return {
      id: files[idx]?.id || `item_${idx}`,
      name: item.name,
      blob: item.blob,
      originalSize: origSize,
      compressedSize: compSize,
      fileType: item.fileType,
      savingsPercent: savings,
    };
  });

  if (processedOutputs.length === 1) {
    const single = processedOutputs[0];
    const downloadUrl = URL.createObjectURL(single.blob);
    onProgress({
      taskId: 'task_exec',
      phase: 'Complete',
      current: 1,
      total: 1,
      percentage: 100,
      message: 'Compression finished successfully!',
    });
    return {
      id: `res_${Date.now()}`,
      toolId: 'image-resizer',
      title: 'Compressed File Ready',
      filename: single.name,
      blob: single.blob,
      size: single.blob.size,
      downloadUrl,
      itemCount: 1,
      timestamp: Date.now(),
      fileType: single.fileType,
      originalSize: single.originalSize,
      savingsPercent,
      items,
    };
  }

  onProgress({
    taskId: 'task_exec',
    phase: 'Creating Archive',
    current: files.length,
    total: files.length,
    percentage: 95,
    message: 'Compressing into zip archive...',
  });

  const zip = new JSZip();
  for (const item of processedOutputs) {
    zip.file(item.name, item.blob);
  }
  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
  const downloadUrl = URL.createObjectURL(zipBlob);

  onProgress({
    taskId: 'task_exec',
    phase: 'Complete',
    current: files.length,
    total: files.length,
    percentage: 100,
    message: 'Batch compression complete!',
  });

  return {
    id: `res_${Date.now()}`,
    toolId: 'image-resizer',
    title: 'Compressed Batch Archive Ready',
    filename: 'paperweight_compressed_files.zip',
    blob: zipBlob,
    size: zipBlob.size,
    downloadUrl,
    itemCount: processedOutputs.length,
    timestamp: Date.now(),
    fileType: 'zip',
    originalSize: totalOriginalBytes,
    savingsPercent,
    items,
  };
}

/**
 * Compresses an individual file on-demand with currently configured options.
 */
export async function compressSingleFile(
  file: ProcessedFile,
  options: Record<string, unknown>
): Promise<CompressedItemResult> {
  let qualityNum = 60;
  if (typeof options.compressionLevel === 'number') {
    qualityNum = Math.max(5, Math.min(100, 100 - options.compressionLevel));
  } else if (typeof options.quality === 'number') {
    qualityNum = Math.max(5, Math.min(100, options.quality));
  }
  const qualityRatio = Math.max(0.05, Math.min(1, qualityNum / 100));
  const maxDimOpt = (options.maxDimension as string) || 'original';
  const targetFormat = (options.targetFormat as string) || 'keep';

  const compLevel =
    typeof options.compressionLevel === 'number'
      ? options.compressionLevel
      : typeof options.quality === 'number'
      ? 100 - options.quality
      : 40;

  let item: CompressedItem;
  if (isPdfFile(file)) {
    item = await compressPdf(file, options, compLevel, maxDimOpt);
  } else if (isDocxFile(file)) {
    item = await compressDocx(file, options, qualityNum, qualityRatio, maxDimOpt);
  } else if (isImageFile(file)) {
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    const { blob: outBlob, ext: outExt } = await compressImageBuffer(
      file.data,
      file.name,
      file.type || 'image/png',
      qualityNum,
      qualityRatio,
      maxDimOpt,
      targetFormat
    );
    item = {
      name: `${baseName}_optimized.${outExt}`,
      blob: outBlob,
      originalSize: file.size,
      fileType: 'image',
    };
  } else {
    item = {
      name: file.name,
      blob: new Blob([file.data], { type: file.type }),
      originalSize: file.size,
      fileType: 'document',
    };
  }

  const origSize = item.originalSize;
  const compSize = item.blob.size;
  const savings =
    origSize > 0 && compSize < origSize
      ? Math.round(((origSize - compSize) / origSize) * 100)
      : 0;

  return {
    id: file.id,
    name: item.name,
    blob: item.blob,
    originalSize: origSize,
    compressedSize: compSize,
    fileType: item.fileType,
    savingsPercent: savings,
  };
}

// Backward-compatible alias
export const processImageResizer = processCompressor;
