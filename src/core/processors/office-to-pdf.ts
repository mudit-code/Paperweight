/**
 * @experimental
 * EXPERIMENTAL / UNPUBLISHED OFFICE-TO-PDF PROCESSOR
 *
 * This client-side pure JS/TS text & table extractor is hidden behind FEATURE_FLAGS.ENABLE_OFFICE_CONVERTER.
 * It is kept for research/testing purposes only. Full pixel-perfect Office conversion is planned for the
 * desktop release via a bundled LibreOffice sidecar. Do not extend this XML text-extraction approach.
 */

import { PDFDocument, rgb, StandardFonts, PageSizes } from 'pdf-lib';
import JSZip from 'jszip';
import type { ProcessedFile, ProgressReport } from '../types';
import type { CancellationToken } from '../worker/cancellation';
import { OperationCancelledError, PaperweightError } from '../errors';
import type { BatchResult } from './types';

/**
 * Word (.docx) to PDF conversion completely offline using JSZip and pdf-lib.
 */
export async function convertWordToPdf(file: ProcessedFile): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(file.data);

  if (!zip.files['word/document.xml']) {
    throw new PaperweightError({
      code: 'ERR_INVALID_FILE',
      title: 'Invalid Word Document',
      message: `"${file.name}" does not contain a standard Word document.xml stream.`,
    });
  }

  const docXml = await zip.files['word/document.xml'].async('string');

  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const [pageWidth, pageHeight] = PageSizes.A4;
  const margin = 50;
  const usableWidth = pageWidth - margin * 2;
  const lineHeight = 16;
  const titleLineHeight = 26;

  let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
  let cursorY = pageHeight - margin - 20;
  let pageNumber = 1;

  const addNewPage = () => {
    currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
    pageNumber++;
    cursorY = pageHeight - margin - 20;
  };

  // Extract paragraphs <w:p>
  const paragraphMatches = docXml.match(/<w:p[\s\S]*?<\/w:p>/g) || [];

  if (paragraphMatches.length === 0) {
    // Fallback if empty document
    currentPage.drawText('(Empty Document)', {
      x: margin,
      y: cursorY,
      size: 11,
      font: fontRegular,
      color: rgb(0.5, 0.5, 0.5),
    });
  } else {
    for (const pXml of paragraphMatches) {
      const isHeading1 = /<w:pStyle\s+w:val="Heading1"/i.test(pXml);
      const isHeading2 = /<w:pStyle\s+w:val="Heading2"/i.test(pXml);

      // Extract all text chunks <w:t> inside this paragraph
      const textMatches = Array.from(pXml.matchAll(/<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>/g)).map(
        (m) => m[1]
      );
      const text = textMatches.join('').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

      if (!text.trim()) {
        // Empty paragraph = vertical space
        cursorY -= lineHeight * 0.8;
        if (cursorY < margin + 40) addNewPage();
        continue;
      }

      const isHeading = isHeading1 || isHeading2;
      const fontSize = isHeading1 ? 18 : isHeading2 ? 14 : 10.5;
      const font = isHeading ? fontBold : fontRegular;
      const currentLineHeight = isHeading ? titleLineHeight : lineHeight;
      const textColor = isHeading ? rgb(0.12, 0.12, 0.14) : rgb(0.2, 0.2, 0.22);

      // Simple word wrapping
      const words = text.split(/\s+/);
      let line = '';

      for (let w = 0; w < words.length; w++) {
        const testLine = line ? `${line} ${words[w]}` : words[w];
        const textWidth = font.widthOfTextAtSize(testLine, fontSize);

        if (textWidth > usableWidth && line) {
          if (cursorY < margin + 40) addNewPage();
          currentPage.drawText(line, {
            x: margin,
            y: cursorY,
            size: fontSize,
            font,
            color: textColor,
          });
          cursorY -= currentLineHeight;
          line = words[w];
        } else {
          line = testLine;
        }
      }

      if (line) {
        if (cursorY < margin + 40) addNewPage();
        currentPage.drawText(line, {
          x: margin,
          y: cursorY,
          size: fontSize,
          font,
          color: textColor,
        });
        cursorY -= currentLineHeight + (isHeading ? 6 : 2);
      }
    }
  }

  // Draw footer page numbers on all pages
  const totalPages = pdfDoc.getPageCount();
  for (let i = 0; i < totalPages; i++) {
    const page = pdfDoc.getPage(i);
    const footerText = `${file.name}  •  Page ${i + 1} of ${totalPages}`;
    const textWidth = fontRegular.widthOfTextAtSize(footerText, 8.5);
    page.drawText(footerText, {
      x: (pageWidth - textWidth) / 2,
      y: margin - 25,
      size: 8.5,
      font: fontRegular,
      color: rgb(0.6, 0.6, 0.65),
    });
  }

  return pdfDoc.save();
}

/**
 * Excel (.xlsx) to PDF conversion completely offline using JSZip and pdf-lib.
 */
export async function convertExcelToPdf(file: ProcessedFile): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(file.data);

  // 1. Parse shared strings lookup table
  const sharedStrings: string[] = [];
  if (zip.files['xl/sharedStrings.xml']) {
    const sstXml = await zip.files['xl/sharedStrings.xml'].async('string');
    const siMatches = sstXml.match(/<si[\s\S]*?<\/si>/g) || [];
    for (const si of siMatches) {
      const textParts = Array.from(si.matchAll(/<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g)).map((m) => m[1]);
      sharedStrings.push(textParts.join('').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    }
  }

  // 2. Find first worksheet
  const sheetEntry = Object.keys(zip.files).find((p) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(p));
  if (!sheetEntry) {
    throw new PaperweightError({
      code: 'ERR_INVALID_FILE',
      title: 'Invalid Excel Workbook',
      message: `"${file.name}" does not contain any readable worksheets.`,
    });
  }

  const sheetXml = await zip.files[sheetEntry].async('string');

  // 3. Parse cell data into rows
  const rowMatches = sheetXml.match(/<row[\s\S]*?<\/row>/g) || [];
  const tableData: string[][] = [];

  for (const rowXml of rowMatches) {
    const cellMatches = rowXml.match(/<c[\s\S]*?<\/c>/g) || [];
    const rowCells: string[] = [];

    for (const cellXml of cellMatches) {
      const isString = /t="s"/i.test(cellXml);
      const valMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/i);
      let value = valMatch ? valMatch[1] : '';

      if (isString) {
        const sIndex = parseInt(value, 10);
        value = !isNaN(sIndex) && sharedStrings[sIndex] !== undefined ? sharedStrings[sIndex] : value;
      }
      rowCells.push(value.trim());
    }

    if (rowCells.some((c) => c.length > 0)) {
      tableData.push(rowCells);
    }
  }

  // 4. Render to PDF (Landscape A4: 841.89 x 595.28)
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const [pageHeight, pageWidth] = PageSizes.A4; // Landscape
  const margin = 40;
  const usableWidth = pageWidth - margin * 2;
  const rowHeight = 22;

  let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
  let cursorY = pageHeight - margin - 30;

  // Title header
  currentPage.drawText(file.name.replace(/\.[^/.]+$/, ''), {
    x: margin,
    y: cursorY + 12,
    size: 14,
    font: fontBold,
    color: rgb(0.15, 0.15, 0.18),
  });

  const maxCols = Math.min(8, Math.max(...tableData.map((r) => r.length), 1));
  const colWidth = usableWidth / maxCols;

  const addNewPage = () => {
    currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
    cursorY = pageHeight - margin - 20;
  };

  for (let r = 0; r < tableData.length; r++) {
    if (cursorY < margin + 30) {
      addNewPage();
    }

    const row = tableData[r];
    const isHeader = r === 0;

    // Draw row background
    if (isHeader) {
      currentPage.drawRectangle({
        x: margin,
        y: cursorY - 4,
        width: usableWidth,
        height: rowHeight,
        color: rgb(0.92, 0.94, 0.97),
      });
    } else if (r % 2 === 1) {
      currentPage.drawRectangle({
        x: margin,
        y: cursorY - 4,
        width: usableWidth,
        height: rowHeight,
        color: rgb(0.98, 0.98, 0.99),
      });
    }

    // Draw cells
    for (let c = 0; c < maxCols; c++) {
      const cellText = (row[c] || '').slice(0, 28);
      const font = isHeader ? fontBold : fontRegular;
      const fontSize = isHeader ? 9.5 : 8.5;
      const color = isHeader ? rgb(0.1, 0.1, 0.15) : rgb(0.25, 0.25, 0.28);

      if (cellText) {
        currentPage.drawText(cellText, {
          x: margin + c * colWidth + 4,
          y: cursorY + 3,
          size: fontSize,
          font,
          color,
        });
      }

      // Draw vertical cell borders
      currentPage.drawLine({
        start: { x: margin + c * colWidth, y: cursorY - 4 },
        end: { x: margin + c * colWidth, y: cursorY + rowHeight - 4 },
        thickness: 0.5,
        color: rgb(0.85, 0.85, 0.88),
      });
    }

    // Rightmost border
    currentPage.drawLine({
      start: { x: margin + usableWidth, y: cursorY - 4 },
      end: { x: margin + usableWidth, y: cursorY + rowHeight - 4 },
      thickness: 0.5,
      color: rgb(0.85, 0.85, 0.88),
    });

    // Horizontal bottom border
    currentPage.drawLine({
      start: { x: margin, y: cursorY - 4 },
      end: { x: margin + usableWidth, y: cursorY - 4 },
      thickness: 0.5,
      color: rgb(0.85, 0.85, 0.88),
    });

    cursorY -= rowHeight;
  }

  // Draw footers
  const totalPages = pdfDoc.getPageCount();
  for (let i = 0; i < totalPages; i++) {
    const page = pdfDoc.getPage(i);
    const footerText = `${file.name}  •  Sheet 1  •  Page ${i + 1} of ${totalPages}`;
    const textWidth = fontRegular.widthOfTextAtSize(footerText, 8.5);
    page.drawText(footerText, {
      x: (pageWidth - textWidth) / 2,
      y: margin - 20,
      size: 8.5,
      font: fontRegular,
      color: rgb(0.6, 0.6, 0.65),
    });
  }

  return pdfDoc.save();
}

/**
 * PowerPoint (.pptx) to PDF conversion completely offline using JSZip and pdf-lib.
 */
export async function convertPptToPdf(file: ProcessedFile): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(file.data);

  // Find all slide XMLs
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
    .sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    });

  if (slidePaths.length === 0) {
    throw new PaperweightError({
      code: 'ERR_INVALID_FILE',
      title: 'Invalid PowerPoint File',
      message: `"${file.name}" does not contain any readable slides.`,
    });
  }

  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Standard 16:9 widescreen presentation: 960 x 540 pt
  const slideWidth = 960;
  const slideHeight = 540;
  const margin = 60;

  for (let s = 0; s < slidePaths.length; s++) {
    const slideXml = await zip.files[slidePaths[s]].async('string');
    const page = pdfDoc.addPage([slideWidth, slideHeight]);

    // Slide background
    page.drawRectangle({
      x: 0,
      y: 0,
      width: slideWidth,
      height: slideHeight,
      color: rgb(0.99, 0.985, 0.97),
    });

    // Slide border frame
    page.drawRectangle({
      x: 20,
      y: 20,
      width: slideWidth - 40,
      height: slideHeight - 40,
      borderWidth: 1,
      borderColor: rgb(0.88, 0.86, 0.82),
      color: rgb(1, 1, 1),
    });

    // Extract text paragraphs
    const paragraphs = Array.from(slideXml.matchAll(/<a:p[\s\S]*?<\/a:p>/g)).map((m) => m[0]);
    const textLines: { text: string; isTitle: boolean }[] = [];

    for (const pXml of paragraphs) {
      const texts = Array.from(pXml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)).map((m) => m[1]);
      const fullText = texts.join('').trim().replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      if (fullText) {
        const isTitle = textLines.length === 0;
        textLines.push({ text: fullText, isTitle });
      }
    }

    let cursorY = slideHeight - margin - 40;

    if (textLines.length > 0) {
      // First line is Title
      const title = textLines[0];
      page.drawText(title.text, {
        x: margin,
        y: cursorY,
        size: 26,
        font: fontBold,
        color: rgb(0.75, 0.35, 0.1), // Accent warm amber
      });
      cursorY -= 45;

      // Divider line
      page.drawLine({
        start: { x: margin, y: cursorY + 15 },
        end: { x: slideWidth - margin, y: cursorY + 15 },
        thickness: 1.5,
        color: rgb(0.9, 0.88, 0.84),
      });

      // Subsequent lines are content points
      for (let i = 1; i < textLines.length; i++) {
        const item = textLines[i];
        page.drawText(`•  ${item.text}`, {
          x: margin + 15,
          y: cursorY,
          size: 14,
          font: fontRegular,
          color: rgb(0.22, 0.22, 0.24),
        });
        cursorY -= 28;
        if (cursorY < margin + 40) break;
      }
    } else {
      page.drawText(`Slide ${s + 1}`, {
        x: margin,
        y: cursorY,
        size: 22,
        font: fontBold,
        color: rgb(0.3, 0.3, 0.3),
      });
    }

    // Slide footer
    const footerText = `${file.name.replace(/\.[^/.]+$/, '')}   •   Slide ${s + 1} of ${slidePaths.length}`;
    page.drawText(footerText, {
      x: margin,
      y: 35,
      size: 9,
      font: fontRegular,
      color: rgb(0.55, 0.55, 0.6),
    });
  }

  return pdfDoc.save();
}

/**
 * Universal Office to PDF batch processor.
 */
export async function processOfficeToPdf(
  files: ProcessedFile[],
  _options: Record<string, unknown>,
  onProgress: (report: ProgressReport) => void,
  cancellationToken?: CancellationToken
): Promise<BatchResult> {
  if (files.length === 0) {
    throw new PaperweightError({
      code: 'ERR_NO_FILES',
      title: 'No Documents Selected',
      message: 'Please add at least one Word (.docx), Excel (.xlsx), or PowerPoint (.pptx) file.',
    });
  }

  const convertedPdfs: { name: string; blob: Blob }[] = [];

  for (let i = 0; i < files.length; i++) {
    if (cancellationToken?.isCancelled) {
      throw new OperationCancelledError('Document to PDF');
    }

    const file = files[i];
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    const isDocx = /\.(docx|doc)$/i.test(file.name);
    const isXlsx = /\.(xlsx|xls)$/i.test(file.name);
    const isPptx = /\.(pptx|ppt)$/i.test(file.name);

    onProgress({
      taskId: 'task_exec',
      phase: `Converting document ${i + 1} of ${files.length}`,
      current: i + 1,
      total: files.length,
      percentage: Math.round(5 + ((i + 1) / files.length) * 85),
      message: file.name,
    });

    let pdfBytes: Uint8Array;
    if (isXlsx) {
      pdfBytes = await convertExcelToPdf(file);
    } else if (isPptx) {
      pdfBytes = await convertPptToPdf(file);
    } else if (isDocx) {
      pdfBytes = await convertWordToPdf(file);
    } else {
      throw new PaperweightError({
        code: 'ERR_UNSUPPORTED_TYPE',
        title: 'Unsupported Document',
        message: `File "${file.name}" must be Word (.docx), Excel (.xlsx), or PowerPoint (.pptx).`,
      });
    }

    const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
    convertedPdfs.push({
      name: `${baseName}.pdf`,
      blob,
    });
  }

  if (convertedPdfs.length === 1) {
    const single = convertedPdfs[0];
    const downloadUrl = URL.createObjectURL(single.blob);
    return {
      id: `res_${Date.now()}`,
      toolId: 'converter',
      title: 'Converted PDF Ready',
      filename: single.name,
      blob: single.blob,
      size: single.blob.size,
      downloadUrl,
      itemCount: 1,
      timestamp: Date.now(),
      fileType: 'pdf',
      items: [
        {
          id: `item_0`,
          name: single.name,
          blob: single.blob,
          originalSize: files[0].size,
          compressedSize: single.blob.size,
          fileType: 'pdf',
          savingsPercent: 0,
        },
      ],
    };
  }

  onProgress({
    taskId: 'task_exec',
    phase: 'Creating Archive',
    current: files.length,
    total: files.length,
    percentage: 95,
    message: `Packaging ${convertedPdfs.length} PDFs into ZIP...`,
  });

  const zip = new JSZip();
  for (const item of convertedPdfs) {
    zip.file(item.name, item.blob);
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const downloadUrl = URL.createObjectURL(zipBlob);

  return {
    id: `res_${Date.now()}`,
    toolId: 'converter',
    title: 'Converted PDFs Ready',
    filename: 'paperweight_converted_pdfs.zip',
    blob: zipBlob,
    size: zipBlob.size,
    downloadUrl,
    itemCount: convertedPdfs.length,
    timestamp: Date.now(),
    fileType: 'zip',
    items: convertedPdfs.map((item, idx) => ({
      id: `item_${idx}`,
      name: item.name,
      blob: item.blob,
      originalSize: files[idx]?.size || item.blob.size,
      compressedSize: item.blob.size,
      fileType: 'pdf',
      savingsPercent: 0,
    })),
  };
}
