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
