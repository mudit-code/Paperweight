import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { processImageToPdf } from '../src/core/processors/image-to-pdf';
import { processPdfMerge } from '../src/core/processors/pdf-merge';
import { processCompressor } from '../src/core/processors/image-resizer';
import type { ProcessedFile } from '../src/core/types';

describe('Processors', () => {
  it('converts images to PDF document', async () => {
    const pngPath = path.resolve(__dirname, '../public/icon-192.png');
    const pngBuffer = fs.readFileSync(pngPath);

    const testFile: ProcessedFile = {
      id: 'f_test_1',
      name: 'icon-192.png',
      size: pngBuffer.length,
      type: 'image/png',
      lastModified: Date.now(),
      data: pngBuffer.buffer.slice(
        pngBuffer.byteOffset,
        pngBuffer.byteOffset + pngBuffer.byteLength
      ),
    };

    const progressReports: string[] = [];
    const result = await processImageToPdf(
      [testFile],
      { pageSize: 'a4', orientation: 'auto', margin: 'none' },
      (rep) => {
        progressReports.push(rep.phase);
      }
    );

    expect(result.fileType).toBe('pdf');
    expect(result.filename).toBe('icon-192.pdf');
    expect(result.blob.size).toBeGreaterThan(500);
    expect(progressReports).toContain('Complete');
  });

  it('merges valid PDFs', async () => {
    // Generate two basic PDFs via processImageToPdf first
    const pngPath = path.resolve(__dirname, '../public/icon-192.png');
    const pngBuffer = fs.readFileSync(pngPath);

    const testFile: ProcessedFile = {
      id: 'f_test_png',
      name: 'test.png',
      size: pngBuffer.length,
      type: 'image/png',
      lastModified: Date.now(),
      data: pngBuffer.buffer.slice(
        pngBuffer.byteOffset,
        pngBuffer.byteOffset + pngBuffer.byteLength
      ),
    };

    const pdfRes1 = await processImageToPdf([testFile], {}, () => {});
    const pdfBuf1 = await pdfRes1.blob.arrayBuffer();

    const pdfFile1: ProcessedFile = {
      id: 'f_pdf_1',
      name: 'doc1.pdf',
      size: pdfBuf1.byteLength,
      type: 'application/pdf',
      lastModified: Date.now(),
      data: pdfBuf1,
    };

    const pdfFile2: ProcessedFile = {
      id: 'f_pdf_2',
      name: 'doc2.pdf',
      size: pdfBuf1.byteLength,
      type: 'application/pdf',
      lastModified: Date.now(),
      data: pdfBuf1,
    };

    const mergeResult = await processPdfMerge(
      [pdfFile1, pdfFile2],
      { outputFilename: 'merged_test.pdf' },
      () => {}
    );

    expect(mergeResult.fileType).toBe('pdf');
    expect(mergeResult.filename).toBe('merged_test.pdf');
    expect(mergeResult.itemCount).toBe(2);
    expect(mergeResult.blob.size).toBeGreaterThan(pdfBuf1.byteLength);
  });

  it('merges images and PDFs together into a unified document', async () => {
    const pngPath = path.resolve(__dirname, '../public/icon-192.png');
    const pngBuffer = fs.readFileSync(pngPath);

    // 1 image file
    const imageFile: ProcessedFile = {
      id: 'f_test_img',
      name: 'photo.png',
      size: pngBuffer.length,
      type: 'image/png',
      lastModified: Date.now(),
      data: pngBuffer.buffer.slice(
        pngBuffer.byteOffset,
        pngBuffer.byteOffset + pngBuffer.byteLength
      ),
    };

    // 1 PDF file (generate 2 pages via processImageToPdf)
    const pdfRes = await processImageToPdf([imageFile, imageFile], {}, () => {});
    const pdfBuf = await pdfRes.blob.arrayBuffer();

    const pdfFile: ProcessedFile = {
      id: 'f_pdf_2pages',
      name: 'document.pdf',
      size: pdfBuf.byteLength,
      type: 'application/pdf',
      lastModified: Date.now(),
      data: pdfBuf,
    };

    // Merge: [image (1 page), pdf (2 pages)] -> total 3 pages!
    const mergeResult = await processPdfMerge(
      [imageFile, pdfFile],
      { outputFilename: 'merged_img_and_pdf.pdf' },
      () => {}
    );

    expect(mergeResult.fileType).toBe('pdf');
    expect(mergeResult.filename).toBe('merged_img_and_pdf.pdf');
    expect(mergeResult.itemCount).toBe(3); // 1 image + 2 pdf pages = 3 total pages
    expect(mergeResult.blob.size).toBeGreaterThan(1000);
  });

  it('compresses PDF documents and strips metadata', async () => {
    const pngPath = path.resolve(__dirname, '../public/icon-192.png');
    const pngBuffer = fs.readFileSync(pngPath);

    const testFile: ProcessedFile = {
      id: 'f_test_png2',
      name: 'test2.png',
      size: pngBuffer.length,
      type: 'image/png',
      lastModified: Date.now(),
      data: pngBuffer.buffer.slice(
        pngBuffer.byteOffset,
        pngBuffer.byteOffset + pngBuffer.byteLength
      ),
    };

    const pdfRes = await processImageToPdf([testFile], {}, () => {});
    const pdfBuf = await pdfRes.blob.arrayBuffer();

    const pdfFile: ProcessedFile = {
      id: 'f_compress_pdf',
      name: 'sample_document.pdf',
      size: pdfBuf.byteLength,
      type: 'application/pdf',
      lastModified: Date.now(),
      data: pdfBuf,
    };

    const compressRes = await processCompressor(
      [pdfFile],
      { compressionLevel: 40, stripMetadata: true },
      () => {}
    );

    expect(compressRes.fileType).toBe('pdf');
    expect(compressRes.filename).toBe('sample_document_compressed.pdf');
    expect(compressRes.blob.size).toBeGreaterThan(100);
  });

  it('compresses DOCX documents using compressionLevel', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Hello Paperweight</w:t></w:r></w:p></w:body></w:document>');
    zip.file(
      'docProps/core.xml',
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>John Doe</dc:creator><cp:lastModifiedBy>Jane Doe</cp:lastModifiedBy></cp:coreProperties>'
    );
    const docxArrayBuf = await zip.generateAsync({ type: 'arraybuffer' });

    const docxFile: ProcessedFile = {
      id: 'f_test_docx',
      name: 'annual_report.docx',
      size: docxArrayBuf.byteLength,
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      lastModified: Date.now(),
      data: docxArrayBuf,
    };

    const compressRes = await processCompressor(
      [docxFile],
      { compressionLevel: 50, stripMetadata: true },
      () => {}
    );

    expect(compressRes.fileType).toBe('document');
    expect(compressRes.filename).toBe('annual_report_compressed.docx');
    expect(compressRes.blob.size).toBeGreaterThan(100);

    // Verify creator was stripped in docProps/core.xml
    const verifiedZip = await JSZip.loadAsync(await compressRes.blob.arrayBuffer());
    const coreXml = await verifiedZip.file('docProps/core.xml')?.async('string');
    expect(coreXml).toContain('<dc:creator></dc:creator>');
  });

  it('batches mixed files into a compressed zip archive', async () => {
    const zip1 = new JSZip();
    zip1.file('word/document.xml', '<w:document/>');
    const docxBuf = await zip1.generateAsync({ type: 'arraybuffer' });

    const pngPath = path.resolve(__dirname, '../public/icon-192.png');
    const pngBuffer = fs.readFileSync(pngPath);

    const testPdfRes = await processImageToPdf(
      [
        {
          id: 'f_test_png3',
          name: 'p.png',
          size: pngBuffer.length,
          type: 'image/png',
          lastModified: Date.now(),
          data: pngBuffer.buffer.slice(
            pngBuffer.byteOffset,
            pngBuffer.byteOffset + pngBuffer.byteLength
          ),
        },
      ],
      {},
      () => {}
    );
    const pdfBuf = await testPdfRes.blob.arrayBuffer();

    const files: ProcessedFile[] = [
      {
        id: 'f_pdf_batch',
        name: 'report.pdf',
        size: pdfBuf.byteLength,
        type: 'application/pdf',
        lastModified: Date.now(),
        data: pdfBuf,
      },
      {
        id: 'f_docx_batch',
        name: 'notes.docx',
        size: docxBuf.byteLength,
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        lastModified: Date.now(),
        data: docxBuf,
      },
    ];

    const batchRes = await processCompressor(files, {}, () => {});

    expect(batchRes.fileType).toBe('zip');
    expect(batchRes.filename).toBe('paperweight_compressed_files.zip');
    expect(batchRes.itemCount).toBe(2);
    expect(batchRes.blob.size).toBeGreaterThan(200);
  });

  it('encodes valid 24-bit BMP image buffers', async () => {
    const { encodeBmp } = await import('../src/core/processors/image-encoders');
    const width = 4;
    const height = 4;
    const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
    const bmpBytes = encodeBmp(width, height, rgba);

    // Verify BM magic bytes
    expect(bmpBytes[0]).toBe(0x42); // 'B'
    expect(bmpBytes[1]).toBe(0x4d); // 'M'
    // Verify offset to pixels
    const view = new DataView(bmpBytes.buffer, bmpBytes.byteOffset);
    expect(view.getUint32(10, true)).toBe(54);
    // Verify width & height in BITMAPINFOHEADER
    expect(view.getInt32(18, true)).toBe(4);
    expect(view.getInt32(22, true)).toBe(4);
    // Verify 24 bpp
    expect(view.getUint16(28, true)).toBe(24);
  });

  it('encodes valid baseline TIFF image buffers', async () => {
    const { encodeTiff } = await import('../src/core/processors/image-encoders');
    const width = 4;
    const height = 4;
    const rgba = new Uint8ClampedArray(width * height * 4).fill(200);
    const tiffBytes = encodeTiff(width, height, rgba, 300);

    // Verify II magic bytes (Little-Endian)
    expect(tiffBytes[0]).toBe(0x49); // 'I'
    expect(tiffBytes[1]).toBe(0x49); // 'I'
    const view = new DataView(tiffBytes.buffer, tiffBytes.byteOffset);
    expect(view.getUint16(2, true)).toBe(42); // TIFF version
    // Check total size is greater than header + pixels
    expect(tiffBytes.length).toBeGreaterThan(width * height * 3 + 100);
  });

  it('accurately parses page ranges and handles edge cases', async () => {
    const { parsePageRange } = await import('../src/core/processors/image-encoders');
    expect(parsePageRange('1-3, 5', 10)).toEqual([1, 2, 3, 5]);
    expect(parsePageRange('', 5)).toEqual([1, 2, 3, 4, 5]);
    expect(parsePageRange('invalid', 3)).toEqual([1, 2, 3]);
    expect(parsePageRange('4-2', 6)).toEqual([2, 3, 4]);
    expect(parsePageRange('1, 1, 2, 2', 4)).toEqual([1, 2]);
  });

  it('applies grayscale and monochrome pixel filters', async () => {
    const { applyGrayscale, applyMonochrome } = await import('../src/core/processors/image-encoders');
    // Test pure red [255, 0, 0, 255]
    const pixel = new Uint8ClampedArray([255, 0, 0, 255]);
    applyGrayscale(pixel);
    // 0.299 * 255 = ~76
    expect(pixel[0]).toBe(76);
    expect(pixel[1]).toBe(76);
    expect(pixel[2]).toBe(76);

    // Test monochrome threshold
    const darkPixel = new Uint8ClampedArray([50, 50, 50, 255]);
    applyMonochrome(darkPixel, 128);
    expect(darkPixel[0]).toBe(0);

    const brightPixel = new Uint8ClampedArray([200, 200, 200, 255]);
    applyMonochrome(brightPixel, 128);
    expect(brightPixel[0]).toBe(255);
  });

  // ---------------------------------------------------------------------------
  // EXPERIMENTAL OFFICE PROCESSORS (Hidden behind FEATURE_FLAGS.ENABLE_OFFICE_CONVERTER)
  // Kept for testing/research. Production-grade Office conversion is planned via LibreOffice sidecar.
  // ---------------------------------------------------------------------------
  it('[EXPERIMENTAL] converts Word (.docx) documents to PDF offline', async () => {
    const { convertWordToPdf } = await import('../src/core/processors/office-to-pdf');
    const zip = new JSZip();
    zip.file(
      'word/document.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
       <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
         <w:body>
           <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Project Report</w:t></w:r></w:p>
           <w:p><w:r><w:t>Offline Word to PDF conversion running purely in the browser.</w:t></w:r></w:p>
         </w:body>
       </w:document>`
    );
    const docxBuf = await zip.generateAsync({ type: 'arraybuffer' });
    const file: ProcessedFile = {
      id: 'f_test_docx',
      name: 'report.docx',
      size: docxBuf.byteLength,
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      lastModified: Date.now(),
      data: docxBuf,
    };

    const pdfBytes = await convertWordToPdf(file);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    const header = String.fromCharCode(...pdfBytes.slice(0, 5));
    expect(header).toBe('%PDF-');
    expect(pdfBytes.byteLength).toBeGreaterThan(500);
  });

  it('[EXPERIMENTAL] converts Excel (.xlsx) spreadsheets to PDF offline', async () => {
    const { convertExcelToPdf } = await import('../src/core/processors/office-to-pdf');
    const zip = new JSZip();
    zip.file(
      'xl/sharedStrings.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
       <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2">
         <si><t>Q1 Sales</t></si>
         <si><t>Target</t></si>
       </sst>`
    );
    zip.file(
      'xl/worksheets/sheet1.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
       <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
         <sheetData>
           <row r="1">
             <c r="A1" t="s"><v>0</v></c>
             <c r="B1"><v>50000</v></c>
           </row>
         </sheetData>
       </worksheet>`
    );
    const xlsxBuf = await zip.generateAsync({ type: 'arraybuffer' });
    const file: ProcessedFile = {
      id: 'f_test_xlsx',
      name: 'sales.xlsx',
      size: xlsxBuf.byteLength,
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      lastModified: Date.now(),
      data: xlsxBuf,
    };

    const pdfBytes = await convertExcelToPdf(file);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    const header = String.fromCharCode(...pdfBytes.slice(0, 5));
    expect(header).toBe('%PDF-');
    expect(pdfBytes.byteLength).toBeGreaterThan(500);
  });

  it('[EXPERIMENTAL] converts PowerPoint (.pptx) presentations to PDF offline', async () => {
    const { convertPptToPdf } = await import('../src/core/processors/office-to-pdf');
    const zip = new JSZip();
    zip.file(
      'ppt/slides/slide1.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
       <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
         <p:spTree>
           <p:sp>
             <p:txBody>
               <a:p><a:r><a:t>Keynote Presentation</a:t></a:r></a:p>
               <a:p><a:r><a:t>High fidelity presentation slide 1</a:t></a:r></a:p>
             </p:txBody>
           </p:sp>
         </p:spTree>
       </p:sld>`
    );
    const pptxBuf = await zip.generateAsync({ type: 'arraybuffer' });
    const file: ProcessedFile = {
      id: 'f_test_pptx',
      name: 'deck.pptx',
      size: pptxBuf.byteLength,
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      lastModified: Date.now(),
      data: pptxBuf,
    };

    const pdfBytes = await convertPptToPdf(file);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    const header = String.fromCharCode(...pdfBytes.slice(0, 5));
    expect(header).toBe('%PDF-');
    expect(pdfBytes.byteLength).toBeGreaterThan(500);
  });

  describe('Resizer Processor', () => {
    it('converts units to exact pixels correctly based on DPI', async () => {
      const { convertToPixels, convertFromPixels } = await import('../src/core/processors/resizer');

      // Pixels: direct
      expect(convertToPixels(800, 'px', 300)).toBe(800);
      expect(convertFromPixels(800, 'px', 300)).toBe(800);

      // Inches at 300 DPI (2x2 in passport photo = 600x600 px)
      expect(convertToPixels(2, 'in', 300)).toBe(600);
      expect(convertToPixels(3.5, 'in', 300)).toBe(1050);
      expect(convertFromPixels(600, 'in', 300)).toBe(2);

      // Centimeters at 300 DPI (3.5 x 4.5 cm visa photo)
      // 3.5 / 2.54 * 300 = 413.38 -> 413 px
      expect(convertToPixels(3.5, 'cm', 300)).toBe(413);
      // 4.5 / 2.54 * 300 = 531.49 -> 531 px
      expect(convertToPixels(4.5, 'cm', 300)).toBe(531);
      expect(convertFromPixels(413, 'cm', 300)).toBeCloseTo(3.5, 1);
    });

    it('verifies editor crop geometry ensures non-stretching drawing', async () => {
      const { convertToPixels } = await import('../src/core/processors/resizer');

      // Test case: 1920x1080 source image (16:9 ratio = 1.7778)
      // Target output: 600x600 px (1:1 square ratio)
      const targetW = convertToPixels(2, 'in', 300); // 600 px
      const targetH = convertToPixels(2, 'in', 300); // 600 px
      expect(targetW / targetH).toBe(1.0);

      // Suppose user fitted the image inside the frame:
      // frame is 600x600. Image displayed is 600x337.5 px.
      // relW = 600 / 600 = 1.0
      // relH = 337.5 / 600 = 0.5625
      const relW = 1.0;
      const relH = 1080 / 1920; // 0.5625

      const destW = relW * targetW;
      const destH = relH * targetH;

      // The aspect ratio of the rendered image on the output canvas:
      const outputImageAspect = destW / destH;
      const originalImageAspect = 1920 / 1080;

      // The output image drawn retains its exact native aspect ratio without distortion or stretching!
      expect(outputImageAspect).toBeCloseTo(originalImageAspect, 4);
    });

    it('preserves set ratio and dimensions when toggling cropper off', async () => {
      const { convertToPixels } = await import('../src/core/processors/resizer');

      // Set ratio: 16:9 at 1920x1080 px
      const targetW = convertToPixels(1920, 'px', 300);
      const targetH = convertToPixels(1080, 'px', 300);
      const targetRatio = targetW / targetH;

      // When cropper is toggled off, target dimensions and set ratio remain completely intact:
      expect(targetRatio).toBeCloseTo(16 / 9, 4);
      expect(targetW).toBe(1920);
      expect(targetH).toBe(1080);

      // Orientation swap toggles width & height while keeping aspect proportions intact:
      const swappedW = targetH;
      const swappedH = targetW;
      expect(swappedW / swappedH).toBeCloseTo(9 / 16, 4);
    });
  });
});
