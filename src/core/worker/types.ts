import type { ProgressReport } from '../types';
import type { CancellationToken } from './cancellation';

export type WorkerTaskType =
  | 'image-convert'
  | 'image-resize'
  | 'pdf-merge'
  | 'pdf-render-page'
  | 'ocr-recognize'
  | 'scan-filter'
  | 'noop';

export interface WorkerJob<TInput = unknown, TOutput = unknown> {
  id: string;
  type: WorkerTaskType;
  payload: TInput;
  transferables?: Transferable[];
  timeoutMs?: number;
  cancellationToken?: CancellationToken;
  onProgress?: (report: ProgressReport) => void;
  resolve: (value: TOutput) => void;
  reject: (reason: unknown) => void;
  createdAt: number;
}

export interface WorkerInboundMessage<T = unknown> {
  type: 'execute' | 'cancel' | 'ping';
  jobId: string;
  taskType: WorkerTaskType;
  payload?: T;
}

export interface WorkerOutboundMessage<T = unknown> {
  type: 'progress' | 'success' | 'error' | 'cancelled' | 'pong';
  jobId: string;
  progress?: ProgressReport;
  result?: T;
  error?: {
    code: string;
    message: string;
    details?: string;
  };
}

export interface WorkerStats {
  totalJobsProcessed: number;
  activeWorkers: number;
  queuedJobs: number;
  maxWorkers: number;
}
