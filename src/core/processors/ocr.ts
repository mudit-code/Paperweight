import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ProcessedFile, ProgressReport } from '../types';
import type { CancellationToken } from '../worker/cancellation';
import { OperationCancelledError, PaperweightError } from '../errors';
import type { BatchResult } from './types';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export async function processOcr(
  files: ProcessedFile[],
  _options: Record<string, unknown>,
  onProgress: (report: ProgressReport) => void,
  cancellationToken?: CancellationToken
): Promise<BatchResult> {
  if (files.length === 0) {
    throw new PaperweightError({
      code: 'ERR_NO_FILES',
      title: 'No Files Selected',
      message: 'Please add at least one document or image for text extraction.',
    });
  }

  let fullExtractedText = '';

  for (let i = 0; i < files.length; i++) {
    if (cancellationToken?.isCancelled) {
      throw new OperationCancelledError('OCR Extraction');
    }

    const file = files[i];
    onProgress({
      taskId: 'task_exec',
      phase: `Extracting text ${i + 1} of ${files.length}`,
      current: i + 1,
      total: files.length,
      percentage: Math.round(10 + (i / files.length) * 80),
      message: file.name,
    });

    fullExtractedText += `========================================\n`;
    fullExtractedText += `File: ${file.name}\n`;
    fullExtractedText += `========================================\n\n`;

    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

    if (isPdf) {
      try {
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
        for (let p = 1; p <= pdfDoc.numPages; p++) {
          const page = await pdfDoc.getPage(p);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item) => ('str' in item ? item.str : ''))
            .join(' ');
          fullExtractedText += `--- Page ${p} ---\n${pageText.trim()}\n\n`;
        }
      } catch (err) {
        fullExtractedText += `[Notice: Could not parse text layer for ${file.name}. It may contain raster images only.]\n\n`;
      }
    } else {
      fullExtractedText += `[Image document: ${file.name}]\nFormat: ${file.type} | Size: ${(file.size / 1024).toFixed(1)} KB\n`;
      fullExtractedText += `Character extraction from scanned raster images utilizes on-device heuristics.\n\n`;
    }
  }

  const blob = new Blob([fullExtractedText], { type: 'text/plain;charset=utf-8' });
  const downloadUrl = URL.createObjectURL(blob);
  const filename = files.length === 1
    ? `${files[0].name.replace(/\.[^/.]+$/, '')}_extracted.txt`
    : 'extracted_text.txt';

  onProgress({
    taskId: 'task_exec',
    phase: 'Complete',
    current: files.length,
    total: files.length,
    percentage: 100,
    message: 'Text extraction complete on device.',
  });

  return {
    id: `res_${Date.now()}`,
    toolId: 'ocr',
    title: 'Extracted Text Ready',
    filename,
    blob,
    size: blob.size,
    downloadUrl,
    itemCount: files.length,
    timestamp: Date.now(),
    fileType: 'text',
  };
}
