import React from 'react';
import type { ToolProps } from '../../core/tools/types';
import { BaseToolUI } from '../common/BaseToolUI';

const ImageToPdfTool: React.FC<ToolProps> = (props) => {
  return (
    <BaseToolUI
      {...props}
      toolName="Image to PDF"
      tagline="Convert individual photos, scans, and graphic batches into structured PDF documents."
      acceptedMimes={['image/jpeg', 'image/png', 'image/webp', 'image/*']}
      maxFiles={200}
    />
  );
};

export default ImageToPdfTool;
