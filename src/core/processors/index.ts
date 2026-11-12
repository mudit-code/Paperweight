import { processImageToPdf } from './image-to-pdf';
import { processPdfMerge } from './pdf-merge';
import { processImageResizer, processCompressor } from './image-resizer';
import { processScanner } from './scanner';
import { processPdfToImage } from './pdf-to-image';
import { processImageConverter } from './image-converter';
import { processResizer } from './resizer';
import { processOcr } from './ocr';
import { FEATURE_FLAGS } from '../config/feature-flags';
import { PaperweightError } from '../errors';
import type { ProcessorFn, BatchResult } from './types';
import type { ProcessedFile, ProgressReport } from '../types';
import type { CancellationToken } from '../worker/cancellation';

export * from './types';
export * from './download';
export { processCompressor, processImageResizer, processImageConverter, processResizer };

/**
 * Unified Converter dispatcher for the Converter tab.
 */
export async function processConverter(
  files: ProcessedFile[],
  options: Record<string, unknown>,
  onProgress: (report: ProgressReport) => void,
  cancellationToken?: CancellationToken
): Promise<BatchResult> {
  const mode = (options.converterMode as string) || 'pdf-to-img';
  if (mode === 'pdf-to-img') {
    return processPdfToImage(files, options, onProgress, cancellationToken);
  }
  if (mode === 'img-to-pdf') {
    return processImageToPdf(files, options, onProgress, cancellationToken);
  }
  if (mode === 'img-to-img') {
    return processImageConverter(files, options, onProgress, cancellationToken);
  }
  if (mode === 'word-to-pdf' || mode === 'excel-to-pdf' || mode === 'ppt-to-pdf') {
    if (FEATURE_FLAGS.ENABLE_OFFICE_CONVERTER) {
      const { processOfficeToPdf } = await import('./office-to-pdf');
      return processOfficeToPdf(files, options, onProgress, cancellationToken);
    }
    throw new PaperweightError({
      code: 'ERR_FEATURE_DISABLED',
      title: 'Feature Not Available',
      message: 'Office document conversion is an experimental feature and is currently disabled.',
    });
  }
  return processPdfToImage(files, options, onProgress, cancellationToken);
}

export const processors: Record<string, ProcessorFn> = {
  'converter': processConverter,
  'image-to-pdf': processImageToPdf,
  'pdf-to-image': processPdfToImage,
  'pdf-merge': processPdfMerge,
  'image-resizer': processImageResizer,
  'compressor': processCompressor,
  'resizer': processResizer,
  'scanner': processScanner,
  'ocr': processOcr,
};
