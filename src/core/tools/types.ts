import type React from 'react';
import type { ProcessedFile, ProgressReport, ToolActionOption } from '../types';

import type { BatchResult } from '../processors/types';
import type { UserFacingError } from '../errors';

export type ToolCategory = 'pdf' | 'image' | 'scan' | 'ocr' | 'convert';

export interface ToolProps {
  files: ProcessedFile[];
  onFilesChange: (files: ProcessedFile[]) => void;
  options: Record<string, unknown>;
  onOptionsChange: (options: Record<string, unknown>) => void;
  isProcessing: boolean;
  progress: ProgressReport | null;
  result?: BatchResult | null;
  onDismissResult?: () => void;
  error?: UserFacingError | null;
  onDismissError?: () => void;
  sizeEstimate?: import('../processors/estimate-size').SizeEstimate | null;
  onExecute: () => Promise<void>;
  onCancel: () => void;
  selectedFileId?: string | null;
  onSelectFile?: (id: string | null) => void;
  onToggleSidebar?: () => void;
  onOpenSettings?: () => void;
}

export interface ToolManifest {
  id: string;
  name: string;
  shortName: string;
  tagline: string;
  description: string;
  category: ToolCategory;
  iconName: string;
  shortcutIndex?: number; // 1-9 for Alt+1 to Alt+9
  acceptedMimes: string[];
  maxFiles?: number;
  availableOptions: ToolActionOption[];
  // Dynamic import: lazy-loads the tool's React component
  loadComponent: () => Promise<{ default: React.ComponentType<ToolProps> }>;
}
