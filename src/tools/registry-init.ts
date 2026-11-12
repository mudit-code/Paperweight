import { toolRegistry } from '../core/tools/registry';
import { FEATURE_FLAGS } from '../core/config/feature-flags';

/**
 * Initializes and registers all Paperweight tools with dynamic import component loaders.
 */
export function initializeToolRegistry(): void {
  // Clear any existing registrations
  toolRegistry.clear();

  // 1. Unified Converter (PDF, Images)
  toolRegistry.register({
    id: 'converter',
    name: 'Converter',
    shortName: 'Converter',
    tagline: 'Universal offline document and image converter with zero network calls.',
    description: 'Convert between PDFs and images completely offline.',
    category: 'convert',
    iconName: 'ArrowRightLeft',
    shortcutIndex: 1,
    acceptedMimes: [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/avif',
      'image/bmp',
      'image/tiff',
      'image/*',
      '.pdf',
      ...(FEATURE_FLAGS.ENABLE_OFFICE_CONVERTER
        ? [
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.ms-powerpoint',
            '.docx',
            '.doc',
            '.xlsx',
            '.xls',
            '.pptx',
            '.ppt',
          ]
        : []),
    ],
    maxFiles: 200,
    availableOptions: [
      {
        id: 'converterMode',
        label: 'Conversion Type',
        type: 'select',
        defaultValue: '',
        options: [
          { label: 'PDF to Image', value: 'pdf-to-img' },
          { label: 'Image to PDF', value: 'img-to-pdf' },
          { label: 'Image to Any Format', value: 'img-to-img' },
          ...(FEATURE_FLAGS.ENABLE_OFFICE_CONVERTER
            ? [
                { label: 'Word to PDF (.docx)', value: 'word-to-pdf' },
                { label: 'Excel to PDF (.xlsx)', value: 'excel-to-pdf' },
                { label: 'PowerPoint to PDF (.pptx)', value: 'ppt-to-pdf' },
              ]
            : []),
        ],
      },
      // PDF to Image options
      {
        id: 'format',
        label: 'Output Format',
        type: 'select',
        defaultValue: 'png',
        options: [
          { label: 'PNG (Lossless & Crisp)', value: 'png' },
          { label: 'JPEG (Compact file size)', value: 'jpeg' },
          { label: 'WebP (Modern compressed)', value: 'webp' },
          { label: 'AVIF (Next-Gen High Efficiency)', value: 'avif' },
          { label: 'TIFF (Lossless Archival & Print)', value: 'tiff' },
          { label: 'BMP (Windows Bitmap)', value: 'bmp' },
        ],
      },
      {
        id: 'pageRange',
        label: 'Page Selection',
        type: 'select',
        defaultValue: 'all',
        options: [
          { label: 'All Pages', value: 'all' },
          { label: 'First Page Only (Cover)', value: 'first' },
          { label: 'Last Page Only', value: 'last' },
          { label: 'Custom Range (e.g. 1-3, 5)', value: 'custom' },
        ],
      },
      {
        id: 'customPages',
        label: 'Custom Page Range',
        type: 'text',
        defaultValue: '1',
        description: 'Specify page numbers or ranges, e.g. 1-3, 5',
      },
      // Image to PDF options
      {
        id: 'pageSize',
        label: 'Page Size',
        type: 'select',
        defaultValue: 'a4',
        options: [
          { label: 'A4 (210 × 297 mm)', value: 'a4' },
          { label: 'US Letter (8.5 × 11 in)', value: 'letter' },
          { label: 'Fit to Image Dimensions', value: 'fit' },
        ],
      },
      {
        id: 'orientation',
        label: 'Orientation',
        type: 'select',
        defaultValue: 'auto',
        options: [
          { label: 'Auto (match content)', value: 'auto' },
          { label: 'Portrait', value: 'portrait' },
          { label: 'Landscape', value: 'landscape' },
        ],
      },
      {
        id: 'margin',
        label: 'Page Margin',
        type: 'select',
        defaultValue: 'none',
        options: [
          { label: 'None (Full Bleed)', value: 'none' },
          { label: 'Small (10mm)', value: 'small' },
          { label: 'Standard (20mm)', value: 'standard' },
        ],
      },
      // Image to Image options
      {
        id: 'targetFormat',
        label: 'Target Image Format',
        type: 'select',
        defaultValue: 'png',
        options: [
          { label: 'PNG (Lossless & Crisp)', value: 'png' },
          { label: 'JPEG (Compact file size)', value: 'jpeg' },
          { label: 'WebP (Modern compressed)', value: 'webp' },
          { label: 'AVIF (Next-Gen High Efficiency)', value: 'avif' },
          { label: 'BMP (Windows Bitmap)', value: 'bmp' },
          { label: 'TIFF (Lossless Archival)', value: 'tiff' },
        ],
      },
      {
        id: 'quality',
        label: 'Image Quality',
        type: 'range',
        defaultValue: 92,
        min: 20,
        max: 100,
        step: 5,
        description: 'Quality level for JPEG, WebP, and AVIF.',
      },
    ],
    loadComponent: () => import('./converter/ConverterTool'),
  });

  // 2. PDF Merger
  toolRegistry.register({
    id: 'pdf-merge',
    name: 'PDF Merger',
    shortName: 'PDF Merger',
    tagline: 'Combine separate PDFs and images into a unified document with custom page ordering.',
    description: 'Reorder pages, merge files, and combine PDFs and images completely offline.',
    category: 'pdf',
    iconName: 'Layers',
    shortcutIndex: 2,
    acceptedMimes: [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/*',
      '.pdf',
      '.jpg',
      '.jpeg',
      '.png',
      '.webp',
    ],
    maxFiles: 100,
    availableOptions: [
      {
        id: 'outputFilename',
        label: 'Merged Document Name',
        type: 'text',
        defaultValue: 'merged_document.pdf',
        description: 'Target filename for the generated output.',
      },
    ],
    loadComponent: () => import('./pdf-merge/PdfMergeTool'),
  });

  // 4. Compressor (Images, PDFs & Documents)
  toolRegistry.register({
    id: 'image-resizer',
    name: 'Compressor',
    shortName: 'Compressor',
    tagline: 'Compress images, PDFs, and Word documents completely offline with custom presets.',
    description: 'Universal offline compressor for images (JPG, PNG, WebP), PDF documents, and DOCX files without uploading data.',
    category: 'image',
    iconName: 'Minimize2',
    shortcutIndex: 3,
    acceptedMimes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/*',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      '.docx',
      '.doc',
    ],
    maxFiles: 250,
    availableOptions: [
      {
        id: 'compressorMode',
        label: 'Compressor Target',
        type: 'select',
        defaultValue: 'pdf',
        options: [
          { label: 'PDF Document (.pdf)', value: 'pdf' },
          { label: 'Image (JPG, PNG, WebP)', value: 'image' },
          { label: 'Word Document (.docx)', value: 'doc' },
        ],
        description: 'Dedicated compressor tailored for PDF, Images, or Documents.',
      },
      {
        id: 'compressionPreset',
        label: 'Compression Preset',
        type: 'select',
        defaultValue: 'balanced',
        options: [
          { label: 'Balanced (Recommended - 40%)', value: 'balanced' },
          { label: 'Maximum Compression (75% / Smallest size)', value: 'maximum' },
          { label: 'Light Compression (15% / High fidelity)', value: 'light' },
          { label: 'Custom (Manual tuning)', value: 'custom' },
        ],
      },
      {
        id: 'pdfMode',
        label: 'PDF Optimization',
        type: 'select',
        defaultValue: 'auto',
        options: [
          { label: 'Auto (Stream & Image packing)', value: 'auto' },
          { label: 'Lossless Stream Optimization', value: 'stream' },
          { label: 'Rasterize & Resample Pages', value: 'raster' },
        ],
        description: 'Choose between lossless structure optimization or aggressive page rasterization.',
      },
      {
        id: 'compressionLevel',
        label: 'Compression Level',
        type: 'range',
        defaultValue: 40,
        min: 5,
        max: 95,
        step: 5,
      },
      {
        id: 'maxDimension',
        label: 'Max Dimension / DPI',
        type: 'select',
        defaultValue: 'original',
        options: [
          { label: 'Original Dimensions / Native DPI', value: 'original' },
          { label: 'Max 1920px (Full HD) / 150 DPI', value: '1920' },
          { label: 'Max 1280px (HD) / 120 DPI', value: '1280' },
          { label: 'Max 800px (Web thumb) / 72 DPI', value: '800' },
        ],
      },
      {
        id: 'targetFormat',
        label: 'Format Conversion (Images)',
        type: 'select',
        defaultValue: 'keep',
        options: [
          { label: 'Keep Original Format', value: 'keep' },
          { label: 'Convert to WebP', value: 'image/webp' },
          { label: 'Convert to JPEG', value: 'image/jpeg' },
          { label: 'Convert to PNG', value: 'image/png' },
        ],
      },
      {
        id: 'deflateLevel',
        label: 'Deflate Compression (Doc)',
        type: 'select',
        defaultValue: '9',
        options: [
          { label: 'Level 9 (Maximum Compression)', value: '9' },
          { label: 'Level 6 (Standard Zip)', value: '6' },
        ],
        description: 'Zip deflate compression intensity for Word XML.',
      },
      {
        id: 'stripMetadata',
        label: 'Strip Metadata',
        type: 'toggle',
        defaultValue: true,
        description: 'Remove EXIF, creator, and document revision metadata for privacy and size savings.',
      },
    ],
    loadComponent: () => import('./image-resizer/ImageResizerTool'),
  });

  // 4. Image Resizer & Cropper
  toolRegistry.register({
    id: 'resizer',
    name: 'Image Resizer',
    shortName: 'Resizer',
    tagline: 'Crop images to exact aspect ratios, resize to custom px, inches, or cm, and meet target file size limits.',
    description: 'Crop images with ratio-locked interactive cropper, resize by pixels, inches, or cm, and optimize for target file size ranges.',
    category: 'image',
    iconName: 'Crop',
    shortcutIndex: 4,
    acceptedMimes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/avif',
      'image/bmp',
      'image/tiff',
      'image/*',
      '.jpg',
      '.jpeg',
      '.png',
      '.webp',
    ],
    maxFiles: 50,
    availableOptions: [
      {
        id: 'unit',
        label: 'Measurement Unit',
        type: 'select',
        defaultValue: 'px',
        options: [
          { label: 'Pixels (px)', value: 'px' },
          { label: 'Inches (in)', value: 'in' },
          { label: 'Centimeters (cm)', value: 'cm' },
        ],
        description: 'Choose between screen pixels or physical print units.',
      },
      {
        id: 'targetWidth',
        label: 'Target Width',
        type: 'text',
        defaultValue: '1200',
        description: 'Target output width in selected unit.',
      },
      {
        id: 'targetHeight',
        label: 'Target Height',
        type: 'text',
        defaultValue: '1200',
        description: 'Target output height in selected unit.',
      },
      {
        id: 'dpi',
        label: 'Print Resolution (DPI)',
        type: 'select',
        defaultValue: '300',
        options: [
          { label: '300 DPI (High-Quality Print / Photos)', value: '300' },
          { label: '150 DPI (Standard Print)', value: '150' },
          { label: '96 DPI (Web & Screens)', value: '96' },
          { label: '72 DPI (Standard Web)', value: '72' },
        ],
        description: 'Resolution used to convert physical units (in, cm) to pixels.',
      },
      {
        id: 'targetSizeEnabled',
        label: 'Enforce File Size Limit',
        type: 'toggle',
        defaultValue: true,
        description: 'Compress image quality to stay within target file size range.',
      },
      {
        id: 'maxSizeKB',
        label: 'Max File Size (KB)',
        type: 'text',
        defaultValue: '200',
        description: 'Maximum allowable file size in kilobytes (e.g. 200 for passport/visa uploads).',
      },
      {
        id: 'minSizeKB',
        label: 'Min File Size (KB)',
        type: 'text',
        defaultValue: '0',
        description: 'Optional minimum file size threshold.',
      },
      {
        id: 'outputFormat',
        label: 'Output Format',
        type: 'select',
        defaultValue: 'jpeg',
        options: [
          { label: 'JPEG (Best for exact file sizes)', value: 'jpeg' },
          { label: 'PNG (Lossless)', value: 'png' },
          { label: 'WebP (Modern compressed)', value: 'webp' },
        ],
      },
    ],
    loadComponent: () => import('./resizer/ResizerTool'),
  });

  // 5. Document Scanner
  toolRegistry.register({
    id: 'scanner',
    name: 'Document Scanner',
    shortName: 'Scanner',
    tagline: 'Perspective edge correction and high-contrast document enhancements.',
    description: 'Turn smartphone photos of documents into flat, readable scans.',
    category: 'scan',
    iconName: 'Scan',
    shortcutIndex: 5,
    acceptedMimes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/bmp', 'application/pdf', '.pdf'],
    maxFiles: 50,
    availableOptions: [
      {
        id: 'outputMode',
        label: 'Output Format',
        type: 'select',
        defaultValue: 'pdf',
        options: [
          { label: 'PDF Document (.pdf)', value: 'pdf' },
          { label: 'Individual Images (.png)', value: 'images' },
        ],
      },
      {
        id: 'filter',
        label: 'Enhancement Filter',
        type: 'select',
        defaultValue: 'bw',
        options: [
          { label: 'Magic B&W (Clean Text)', value: 'bw' },
          { label: 'Grayscale Contrast', value: 'grayscale' },
          { label: 'Vibrant Color', value: 'color' },
          { label: 'Original Photo', value: 'none' },
        ],
      },
      {
        id: 'documentName',
        label: 'Document Filename',
        type: 'text',
        defaultValue: 'scanned_document',
      },
    ],
    loadComponent: () => import('./scanner/ScannerTool'),
  });
}
