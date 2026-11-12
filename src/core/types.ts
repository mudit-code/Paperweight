/**
 * Core type definitions for Paperweight
 * Pure, framework-agnostic types used across core processing and UI layers.
 */

export interface ProcessedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  data: ArrayBuffer;
  previewUrl?: string;
  metadata?: Record<string, unknown>;
}

export type ProcessingStatus =
  | 'idle'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'cancelled'
  | 'error';

export interface ProgressReport {
  taskId: string;
  phase: string;
  current: number;
  total: number;
  percentage: number; // 0 to 100
  message?: string;
  etaSeconds?: number;
}

export type ProgressCallback = (report: ProgressReport) => void;

export interface ToolActionOption {
  id: string;
  label: string;
  type: 'select' | 'range' | 'toggle' | 'number' | 'text';
  defaultValue: unknown;
  options?: { label: string; value: unknown }[];
  min?: number;
  max?: number;
  step?: number;
  description?: string;
}

export interface ProcessingMetrics {
  durationMs: number;
  inputBytesTotal: number;
  outputBytesTotal: number;
  filesProcessed: number;
}
