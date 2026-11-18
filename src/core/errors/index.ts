/**
 * User-facing, strongly-typed error hierarchy for Paperweight.
 * Prevents raw stack traces from reaching the user.
 */

export type ErrorSeverity = 'warning' | 'error' | 'fatal';

export interface UserFacingError {
  code: string;
  title: string;
  message: string;
  suggestion?: string;
  severity: ErrorSeverity;
  cause?: unknown;
}

export class PaperweightError extends Error implements UserFacingError {
  public readonly code: string;
  public readonly title: string;
  public readonly suggestion?: string;
  public readonly severity: ErrorSeverity;

  constructor(options: {
    code: string;
    title: string;
    message: string;
    suggestion?: string;
    severity?: ErrorSeverity;
    cause?: unknown;
  }) {
    super(options.message);
    this.name = 'PaperweightError';
    this.code = options.code;
    this.title = options.title;
    this.suggestion = options.suggestion;
    this.severity = options.severity ?? 'error';
    if (options.cause) {
      this.cause = options.cause;
    }
  }

  toUserFacing(): UserFacingError {
    return {
      code: this.code,
      title: this.title,
      message: this.message,
      suggestion: this.suggestion,
      severity: this.severity,
    };
  }
}

export class FileValidationError extends PaperweightError {
  constructor(message: string, suggestion?: string, filename?: string) {
    super({
      code: 'ERR_FILE_VALIDATION',
      title: filename ? `Invalid File: ${filename}` : 'Invalid File',
      message,
      suggestion: suggestion ?? 'Please check the file format and ensure it is not damaged.',
    });
    this.name = 'FileValidationError';
  }
}

export class CorruptFileError extends PaperweightError {
  constructor(filename: string, details?: string) {
    super({
      code: 'ERR_FILE_CORRUPT',
      title: `Cannot Read ${filename}`,
      message: details ?? 'The file header appears damaged or incomplete.',
      suggestion: 'Try re-saving or re-exporting the file from the original application.',
    });
    this.name = 'CorruptFileError';
  }
}

export class MemoryLimitError extends PaperweightError {
  constructor(fileCount: number, approximateBytes: number) {
    const mb = Math.round(approximateBytes / (1024 * 1024));
    super({
      code: 'ERR_MEMORY_LIMIT',
      title: 'Batch Size Exceeds Safe Memory Limit',
      message: `The selected ${fileCount} files (~${mb} MB) would exceed your browser memory limit.`,
      suggestion: 'Process this batch in smaller chunks of 50-100 files at a time.',
      severity: 'warning',
    });
    this.name = 'MemoryLimitError';
  }
}

export class OperationCancelledError extends PaperweightError {
  constructor(operationName = 'Operation') {
    super({
      code: 'ERR_OPERATION_CANCELLED',
      title: 'Cancelled',
      message: `${operationName} was cancelled by user request.`,
      suggestion: 'No changes were saved.',
      severity: 'warning',
    });
    this.name = 'OperationCancelledError';
  }
}

export class WorkerTimeoutError extends PaperweightError {
  constructor(operationName: string) {
    super({
      code: 'ERR_WORKER_TIMEOUT',
      title: 'Processing Timed Out',
      message: `The background worker processing ${operationName} did not respond in time.`,
      suggestion: 'The file might be exceptionally dense or complex. Try lowering the output resolution or splitting the file.',
    });
    this.name = 'WorkerTimeoutError';
  }
}

/**
 * Normalizes any caught error into a safe, human-readable UserFacingError
 */
export function toUserFacingError(err: unknown, fallbackMessage = 'An unexpected error occurred.'): UserFacingError {
  if (err instanceof PaperweightError) {
    return err.toUserFacing();
  }

  if (err instanceof Error) {
    const msg = err.message || '';
    const errName = err.name || '';
    if (
      errName === 'NotReadableError' ||
      /not\s*readable|permission\s*problems|file\s*could\s*not\s*be\s*read/i.test(msg)
    ) {
      return {
        code: 'ERR_FILE_NOT_READABLE',
        title: 'File Access Restricted',
        message: 'The selected file could not be read. On mobile, this occurs if a cloud photo is not yet downloaded locally or storage access was revoked.',
        suggestion: 'Please tap "Choose files" again and pick a photo saved directly to your device gallery or storage.',
        severity: 'error',
      };
    }

    // Prevent cryptic browser errors like NS_ERROR_FAILURE or Failed to fetch
    return {
      code: 'ERR_UNKNOWN',
      title: 'Processing Error',
      message: err.message || fallbackMessage,
      suggestion: 'Ensure the file is not open in another application and try again.',
      severity: 'error',
    };
  }

  return {
    code: 'ERR_UNEXPECTED',
    title: 'Unexpected Error',
    message: typeof err === 'string' ? err : fallbackMessage,
    suggestion: 'Refresh the page or try a different file.',
    severity: 'error',
  };
}
