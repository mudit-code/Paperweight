/**
 * High-performance Document Enhancement & Transformation Engine
 * Supports: Original, Color Doc (Auto Color / Ink & Stamp Preservation),
 * Magic B&W (Adaptive Threshold), Grayscale (Photocopy), Light Text (Pencil & Faint Ink Clarity),
 * Brightness/Contrast adjustment, 90° rotation, cropping, standard page formatting (A4, Letter, A5).
 */

export type DocumentFilterType = 'original' | 'color' | 'bw' | 'grayscale' | 'light_text';
export type PageFormatType = 'fit' | 'a4' | 'letter' | 'a5';

export interface ImageAdjustments {
  brightness: number; // -50 to 50
  contrast: number;   // -50 to 50
}

export interface CropRect {
  x: number;      // normalized 0..1
  y: number;      // normalized 0..1
  width: number;  // normalized 0..1
  height: number; // normalized 0..1
}

/**
 * Loads an Image object from a Blob or URL
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Only set crossOrigin for external http(s) URLs. Blob and data URIs in WebViews break if crossOrigin is set.
    if (src.startsWith('http://') || src.startsWith('https://')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`Failed to load image: ${e}`));
    img.src = src;
  });
}

/**
 * Applies a filter to an ImageData pixel buffer in place
 */
export function applyFilterToImageData(
  imgData: ImageData,
  filter: DocumentFilterType,
  adjustments?: ImageAdjustments
) {
  const data = imgData.data;
  const len = data.length;

  const brightness = adjustments?.brightness ?? 0;
  const contrast = adjustments?.contrast ?? 0;

  // Calculate standard photographic contrast factor: (-50..50) -> factor
  const contrastFactor = (259 * (contrast * 2.55 + 255)) / (255 * (259 - contrast * 2.55));
  const brightnessOffset = brightness * 2.55;

  if (filter === 'bw') {
    // 1. Magic B&W: Adaptive Dynamic Thresholding for Crisp Binarized Text & Pure White Background
    let sum = 0;
    const step = 4 * 16;
    let count = 0;
    for (let i = 0; i < len; i += step) {
      sum += (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      count++;
    }
    const avgLum = count > 0 ? sum / count : 128;
    // Bias towards clean white background
    const threshold = Math.max(65, Math.min(205, avgLum - 8 + brightness * 0.8));

    for (let i = 0; i < len; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      if (brightness !== 0 || contrast !== 0) {
        r = contrastFactor * (r - 128) + 128 + brightnessOffset;
        g = contrastFactor * (g - 128) + 128 + brightnessOffset;
        b = contrastFactor * (b - 128) + 128 + brightnessOffset;
      }

      const lum = (r * 299 + g * 587 + b * 114) / 1000;
      // High-contrast clean paper threshold with soft anti-aliased edge transitions
      let val: number;
      if (lum >= threshold + 10) {
        val = 255;
      } else if (lum <= threshold - 14) {
        val = Math.max(0, (lum / Math.max(1, threshold - 14)) * 40);
      } else {
        val = ((lum - (threshold - 14)) / 24) * 215 + 40;
      }

      const clamped = Math.max(0, Math.min(255, Math.round(val)));
      data[i] = clamped;
      data[i + 1] = clamped;
      data[i + 2] = clamped;
    }
  } else if (filter === 'color') {
    // 2. Color Doc (Magic Color / Auto Color):
    // Whitens paper background shadows while PRESERVING and enhancing all colors (blue/red ink, stamps, logos, highlighters).
    for (let i = 0; i < len; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      if (brightness !== 0 || contrast !== 0) {
        r = contrastFactor * (r - 128) + 128 + brightnessOffset;
        g = contrastFactor * (g - 128) + 128 + brightnessOffset;
        b = contrastFactor * (b - 128) + 128 + brightnessOffset;
      }

      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));

      const lum = (r * 299 + g * 587 + b * 114) / 1000;
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const chroma = maxC - minC;
      const sat = maxC > 0 ? chroma / maxC : 0;

      // Detect background paper: low saturation (gray/yellow paper noise) and mid-to-high luminance
      if (lum > 135 && sat < 0.28) {
        // Smoothly stretch toward clean white
        const whitenProgress = Math.min(1, Math.max(0, (lum - 135) / (255 - 135)));
        const whitenFactor = Math.pow(whitenProgress, 0.85) * (1 - sat * 3);
        const finalWhiten = Math.max(0, Math.min(1, whitenFactor));

        r = r + (255 - r) * finalWhiten;
        g = g + (255 - g) * finalWhiten;
        b = b + (255 - b) * finalWhiten;
      } else if (chroma > 20) {
        // Colored stroke/stamp/ink: enhance vibrancy & saturation so signatures and stamps pop
        const colorBoost = 1.22;
        r = Math.max(0, Math.min(255, lum + (r - lum) * colorBoost));
        g = Math.max(0, Math.min(255, lum + (g - lum) * colorBoost));
        b = Math.max(0, Math.min(255, lum + (b - lum) * colorBoost));
      } else if (lum < 110) {
        // Dark printed or handwritten text: deepen to clean black
        const darkFactor = Math.pow(lum / 110, 1.25);
        r *= darkFactor;
        g *= darkFactor;
        b *= darkFactor;
      }

      data[i] = Math.max(0, Math.min(255, Math.round(r)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }
  } else if (filter === 'grayscale') {
    // 3. Grayscale (Photocopy / Xerox):
    // Smooth continuous tone photocopy tones with gentle paper whitening while preserving subtle shading & photos.
    for (let i = 0; i < len; i += 4) {
      let lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      if (brightness !== 0 || contrast !== 0) {
        lum = contrastFactor * (lum - 128) + 128 + brightnessOffset;
      }

      // Gentle white-point boost to brighten dingy paper while maintaining continuous tones
      if (lum > 165) {
        lum = 165 + Math.pow((lum - 165) / 90, 0.8) * 90;
      } else if (lum < 95) {
        lum = Math.pow(lum / 95, 1.2) * 95;
      }

      lum = Math.max(0, Math.min(255, Math.round(lum)));
      data[i] = lum;
      data[i + 1] = lum;
      data[i + 2] = lum;
    }
  } else if (filter === 'light_text') {
    // 4. Light Text (Pencil & Faint Ink Clarity):
    // Darkens faint pencil or light ink strokes while cleaning up paper background,
    // PRESERVING stroke color hue rather than flattening into monochrome gray!
    for (let i = 0; i < len; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      if (brightness !== 0 || contrast !== 0) {
        r = contrastFactor * (r - 128) + 128 + brightnessOffset;
        g = contrastFactor * (g - 128) + 128 + brightnessOffset;
        b = contrastFactor * (b - 128) + 128 + brightnessOffset;
      }

      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));

      const lum = (r * 299 + g * 587 + b * 114) / 1000;

      if (lum < 185) {
        // Deepen faint pencil or faded ballpoint ink
        const strokeProgress = Math.pow(lum / 185, 1.5);
        r = r * strokeProgress;
        g = g * strokeProgress;
        b = b * strokeProgress;
      } else {
        // Brighten paper noise into clean white paper
        const paperProgress = Math.min(1, (lum - 185) / (255 - 185));
        const whitenAmt = Math.pow(paperProgress, 0.7);
        r = r + (255 - r) * whitenAmt;
        g = g + (255 - g) * whitenAmt;
        b = b + (255 - b) * whitenAmt;
      }

      data[i] = Math.max(0, Math.min(255, Math.round(r)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }
  } else {
    // 5. Original Photo with seamless brightness & contrast adjustments
    if (brightness !== 0 || contrast !== 0) {
      for (let i = 0; i < len; i += 4) {
        const r = contrastFactor * (data[i] - 128) + 128 + brightnessOffset;
        const g = contrastFactor * (data[i + 1] - 128) + 128 + brightnessOffset;
        const b = contrastFactor * (data[i + 2] - 128) + 128 + brightnessOffset;
        data[i] = Math.max(0, Math.min(255, Math.round(r)));
        data[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
        data[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
      }
    }
  }
}

/**
 * High-performance rotation for an image by degrees (0, 90, 180, 270)
 * Uses hardware-accelerated ImageBitmap offscreen decoding when available for instant 60fps responsiveness.
 */
export async function rotateImage(imageSrc: string, degrees: number = 90): Promise<Blob> {
  let width = 0;
  let height = 0;
  let drawable: CanvasImageSource;
  let bitmapToClose: ImageBitmap | null = null;

  try {
    if (typeof createImageBitmap !== 'undefined') {
      const resp = await fetch(imageSrc);
      const blob = await resp.blob();
      const bmp = await createImageBitmap(blob);
      width = bmp.width;
      height = bmp.height;
      drawable = bmp;
      bitmapToClose = bmp;
    } else {
      const img = await loadImage(imageSrc);
      width = img.width;
      height = img.height;
      drawable = img;
    }
  } catch {
    const img = await loadImage(imageSrc);
    width = img.width;
    height = img.height;
    drawable = img;
  }

  const canvas = document.createElement('canvas');
  const normDeg = ((degrees % 360) + 360) % 360;
  const rad = (normDeg * Math.PI) / 180;

  const isSideways = normDeg === 90 || normDeg === 270;
  canvas.width = isSideways ? height : width;
  canvas.height = isSideways ? width : height;

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    if (bitmapToClose) bitmapToClose.close();
    throw new Error('Canvas 2D context unavailable');
  }

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(drawable, -width / 2, -height / 2);

  if (bitmapToClose) {
    bitmapToClose.close();
  }

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob || new Blob()),
      'image/jpeg',
      0.88
    );
  });
}

/**
 * Crops an image based on a normalized bounding box
 */
export async function cropImage(imageSrc: string, crop: CropRect): Promise<Blob> {
  const img = await loadImage(imageSrc);
  const canvas = document.createElement('canvas');

  const sx = Math.max(0, crop.x * img.width);
  const sy = Math.max(0, crop.y * img.height);
  const sw = Math.min(img.width - sx, crop.width * img.width);
  const sh = Math.min(img.height - sy, crop.height * img.height);

  canvas.width = Math.max(1, Math.round(sw));
  canvas.height = Math.max(1, Math.round(sh));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob || new Blob()), 'image/jpeg', 0.88);
  });
}

/**
 * Formats/Resizes an image into standard document page dimensions (A4, Letter, A5, Fit).
 * Maximally fits the document into the standard page aspect ratio without stretching.
 * Provides visible, realistic paper separation (subtle document drop shadow & hairline border)
 * so the scanned page clearly stands out on the clean white A4/A5 sheet without blending.
 */
export async function formatPageSize(imageSrc: string, format: PageFormatType): Promise<Blob> {
  const img = await loadImage(imageSrc);

  if (format === 'fit') {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable');
    ctx.drawImage(img, 0, 0);
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob || new Blob()), 'image/jpeg', 0.88);
    });
  }

  // Detect orientation: portrait or landscape
  const isLandscape = img.width > img.height;

  // Standard Aspect Ratios (width / height)
  // A4: 210 x 297 mm (~0.70707)
  // A5: 148 x 210 mm (~0.70476)
  // Letter: 8.5 x 11 inches (~0.77273)
  let portraitRatio = 210 / 297;
  if (format === 'letter') {
    portraitRatio = 8.5 / 11;
  } else if (format === 'a5') {
    portraitRatio = 148 / 210;
  }

  const targetRatio = isLandscape ? 1 / portraitRatio : portraitRatio;

  // Scale down oversized images (e.g. 12MP-48MP phone captures) to a high-res 2048px max dimension
  // so canvas operations execute in ~50ms without UI freezing or memory spikes
  let baseW = img.width;
  let baseH = img.height;
  const maxDim = 2048;
  if (baseW > maxDim || baseH > maxDim) {
    const scale = maxDim / Math.max(baseW, baseH);
    baseW = Math.round(baseW * scale);
    baseH = Math.round(baseH * scale);
  }

  const imgRatio = baseW / baseH;

  // Fit document maximally into the target page ratio without downscaling or stretching
  let canvasW: number;
  let canvasH: number;
  let drawW: number;
  let drawH: number;
  let offsetX: number;
  let offsetY: number;

  if (imgRatio > targetRatio) {
    // The scanned document is wider than the target aspect ratio:
    // Canvas width matches document width; canvas height expands to target ratio
    canvasW = baseW;
    canvasH = Math.round(canvasW / targetRatio);
    drawW = baseW;
    drawH = baseH;
    offsetX = 0;
    offsetY = Math.round((canvasH - drawH) / 2);
  } else {
    // The scanned document is taller than the target aspect ratio:
    // Canvas height matches document height; canvas width expands to target ratio
    canvasH = baseH;
    canvasW = Math.round(canvasH * targetRatio);
    drawW = baseW;
    drawH = baseH;
    offsetY = 0;
    offsetX = Math.round((canvasW - drawW) / 2);
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');

  // 1. Fill entire target sheet with crisp clean white paper (#FFFFFF)
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // 2. If the document has margins on the A4/A5 sheet, draw realistic paper separation
  const hasMargins = offsetX > 2 || offsetY > 2;
  if (hasMargins) {
    // Subtle, soft document paper drop shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.16)';
    ctx.shadowBlur = Math.max(6, Math.round(Math.min(canvasW, canvasH) * 0.012));
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = Math.max(2, Math.round(Math.min(canvasW, canvasH) * 0.005));
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(offsetX, offsetY, drawW, drawH);
    ctx.restore();
  }

  // 3. Draw scanned page centered without stretching
  ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

  // 4. Subtle, clean hairline border around the scanned document boundary so it clearly separates from the sheet
  if (hasMargins) {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.lineWidth = Math.max(1, Math.round(Math.min(canvasW, canvasH) * 0.0015));
    ctx.strokeRect(offsetX, offsetY, drawW, drawH);
  }

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob || new Blob()), 'image/jpeg', 0.88);
  });
}
