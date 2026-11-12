import { PDFDocument } from 'pdf-lib';
import type { ProcessedFile, ProgressReport } from '../types';
import type { CancellationToken } from '../worker/cancellation';
import { OperationCancelledError, PaperweightError } from '../errors';
import type { BatchResult } from './types';

function isImageFile(file: ProcessedFile): boolean {
  return (
    file.type.startsWith('image/') ||
    /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name)
  );
}

async function renderImageToPngBuffer(
  file: ProcessedFile
): Promise<{ buffer: ArrayBuffer; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      reject(new Error('Canvas rasterization not available in Node environment'));
      return;
    }
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

export async function processPdfMerge(
  files: ProcessedFile[],
  options: Record<string, unknown>,
  onProgress: (report: ProgressReport) => void,
  cancellationToken?: CancellationToken
): Promise<BatchResult> {
  if (files.length === 0) {
    throw new PaperweightError({
      code: 'ERR_NO_FILES',
      title: 'No Files Selected',
      message: 'Please add at least one PDF or image file to merge.',
    });
  }

  const customFilename = (options.outputFilename as string)?.trim() || 'merged_document.pdf';
  const filename = customFilename.endsWith('.pdf') ? customFilename : `${customFilename}.pdf`;

  onProgress({
    taskId: 'task_exec',
    phase: 'Initializing Merge',
    current: 0,
    total: files.length,
    percentage: 5,
    message: 'Preparing document merge...',
  });

  const mergedDoc = await PDFDocument.create();
  let totalPagesMerged = 0;

  for (let i = 0; i < files.length; i++) {
    if (cancellationToken?.isCancelled) {
      throw new OperationCancelledError('PDF Merge');
    }

    const file = files[i];
    const isImage = isImageFile(file);

    onProgress({
      taskId: 'task_exec',
      phase: `Merging item ${i + 1} of ${files.length}`,
      current: i + 1,
      total: files.length,
      percentage: Math.round(10 + (i / files.length) * 80),
      message: file.name,
    });

    if (isImage) {
      try {
        let embeddedImage;
        let imgWidth = 0;
        let imgHeight = 0;

        const isJpeg = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name);
        const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);

        let directSuccess = false;
        if (isJpeg) {
          try {
            embeddedImage = await mergedDoc.embedJpg(file.data);
            imgWidth = embeddedImage.width;
            imgHeight = embeddedImage.height;
            directSuccess = true;
          } catch {
            // Fall back to canvas
          }
        } else if (isPng) {
          try {
            embeddedImage = await mergedDoc.embedPng(file.data);
            imgWidth = embeddedImage.width;
            imgHeight = embeddedImage.height;
            directSuccess = true;
          } catch {
            // Fall back to canvas
          }
        }

        if (!directSuccess) {
          const rendered = await renderImageToPngBuffer(file);
          embeddedImage = await mergedDoc.embedPng(rendered.buffer);
          imgWidth = rendered.width;
          imgHeight = rendered.height;
        }

        if (!embeddedImage) {
          throw new Error(`Failed to embed image ${file.name}`);
        }

        // Standard A4 dimensions in points (72 pt/inch)
        const a4Width = 595.28;
        const a4Height = 841.89;
        const margin = 28.35; // 10mm margin
        const maxWidth = a4Width - margin * 2;
        const maxHeight = a4Height - margin * 2;

        const scale = Math.min(maxWidth / imgWidth, maxHeight / imgHeight, 1);
        const renderWidth = imgWidth * scale;
        const renderHeight = imgHeight * scale;

        const page = mergedDoc.addPage([a4Width, a4Height]);
        page.drawImage(embeddedImage, {
          x: (a4Width - renderWidth) / 2,
          y: (a4Height - renderHeight) / 2,
          width: renderWidth,
          height: renderHeight,
        });

        totalPagesMerged += 1;
      } catch (err) {
        if (err instanceof OperationCancelledError) throw err;
        throw new PaperweightError({
          code: 'ERR_IMAGE_EMBED',
          title: `Failed to Add Image: ${file.name}`,
          message: 'Could not process and embed image into PDF.',
        });
      }
    } else {
      try {
        const donorDoc = await PDFDocument.load(file.data, { ignoreEncryption: true });
        const donorPages = await mergedDoc.copyPages(donorDoc, donorDoc.getPageIndices());
        donorPages.forEach((page) => mergedDoc.addPage(page));
        totalPagesMerged += donorPages.length;
      } catch {
        throw new PaperweightError({
          code: 'ERR_PDF_MERGE',
          title: `Failed to Merge: ${file.name}`,
          message: 'The PDF may be password-protected or uses unsupported compression.',
        });
      }
    }
  }

  onProgress({
    taskId: 'task_exec',
    phase: 'Compiling Merged PDF',
    current: files.length,
    total: files.length,
    percentage: 95,
    message: `Finalizing ${totalPagesMerged} pages...`,
  });

  const pdfBytes = await mergedDoc.save();
  const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
  const downloadUrl = URL.createObjectURL(blob);

  onProgress({
    taskId: 'task_exec',
    phase: 'Complete',
    current: files.length,
    total: files.length,
    percentage: 100,
    message: `Successfully merged ${files.length} items (${totalPagesMerged} pages).`,
  });

  return {
    id: `res_${Date.now()}`,
    toolId: 'pdf-merge',
    title: 'Merged PDF Ready',
    filename,
    blob,
    size: blob.size,
    downloadUrl,
    itemCount: totalPagesMerged,
    timestamp: Date.now(),
    fileType: 'pdf',
  };
}
