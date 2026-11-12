import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

if (typeof window !== 'undefined' && pdfjsLib?.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
}

/**
 * Converts an array of user-selected files (which may include PDFs and images)
 * into an array of image File objects suitable for display in DocumentEditorModal.
 * For any PDF file, each page is rendered onto an offscreen canvas at 2x scale
 * and exported as a crisp JPEG File. Standard images are passed through as-is.
 */
export async function convertFilesToImagePages(files: File[]): Promise<File[]> {
  const result: File[] = [];

  for (const file of files) {
    const isPdf =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

    if (!isPdf) {
      result.push(file);
      continue;
    }

    try {
      const buffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(buffer),
      });
      const pdf = await loadingTask.promise;
      const baseName = file.name.replace(/\.[^/.]+$/, '');

      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 2.0 }); // 2x scale for sharp document text
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({
          canvasContext: ctx,
          viewport,
        } as unknown as Parameters<typeof page.render>[0]).promise;

        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, 'image/jpeg', 0.92);
        });

        if (blob) {
          result.push(
            new File([blob], `${baseName}_p${p}.jpg`, {
              type: 'image/jpeg',
              lastModified: Date.now(),
            })
          );
        }
      }
    } catch (err) {
      console.error(`Failed to convert PDF "${file.name}" to images:`, err);
    }
  }

  return result;
}
