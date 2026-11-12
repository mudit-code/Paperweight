import type { ProcessedFile, ProgressReport } from '../types';
import type { CancellationToken } from '../worker/cancellation';

export interface CompressedItemResult {
  id: string;
  name: string;
  blob: Blob;
  originalSize: number;
  compressedSize: number;
  fileType: 'pdf' | 'image' | 'zip' | 'text' | 'document';
  savingsPercent: number;
}

export interface BatchResult {
  id: string;
  toolId: string;
  title: string;
  filename: string;
  blob: Blob;
  size: number;
  downloadUrl: string;
  itemCount: number;
  timestamp: number;
  fileType: 'pdf' | 'image' | 'zip' | 'text' | 'document';
  originalSize?: number;
  savingsPercent?: number;
  items?: CompressedItemResult[];
}

export type ProcessorFn = (
  files: ProcessedFile[],
  options: Record<string, unknown>,
  onProgress: (report: ProgressReport) => void,
  cancellationToken?: CancellationToken
) => Promise<BatchResult>;
