import React from 'react';
import type { ToolProps } from '../../core/tools/types';
import { BaseToolUI } from '../common/BaseToolUI';

const OcrTool: React.FC<ToolProps> = (props) => {
  return (
    <BaseToolUI
      {...props}
      toolName="OCR Text Extraction"
      tagline="Extract machine-readable text and produce searchable PDFs with local offline models."
      acceptedMimes={['image/jpeg', 'image/png', 'image/webp', 'application/pdf']}
      maxFiles={30}
    />
  );
};

export default OcrTool;
