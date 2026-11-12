/**
 * Document Corner & Contour Detector for Real-Time Camera Scanning
 * Analyzes video frames to detect quadrilateral document boundaries,
 * tracks corner stability, and triggers auto-capture when held steady.
 */

export interface Point {
  x: number;
  y: number;
}

export interface DetectedQuad {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
  confidence: number;
}

export interface DetectionResult {
  quad: DetectedQuad;
  isSteady: boolean;
  steadyProgress: number; // 0.0 to 1.0
  hasDocument: boolean;
}

export class DocumentDetector {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private prevQuad: DetectedQuad | null = null;
  private steadyFrameCount: number = 0;
  private readonly requiredSteadyFrames: number = 10; // ~0.8 to 1.0s at 12fps
  private readonly maxMovementThreshold: number = 0.045; // 4.5% of frame dimension

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 240;
    this.canvas.height = 320;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  /**
   * Resets the detector state (e.g. after a capture)
   */
  public reset(): void {
    this.prevQuad = null;
    this.steadyFrameCount = 0;
  }

  /**
   * Analyzes the current video frame or image and returns detected quad and stability state.
   */
  public detect(source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement): DetectionResult {
    const origW = (source as HTMLVideoElement).videoWidth || (source as HTMLImageElement).naturalWidth || source.width;
    const origH = (source as HTMLVideoElement).videoHeight || (source as HTMLImageElement).naturalHeight || source.height;

    if (!this.ctx || !origW || !origH) {
      return this.fallbackResult();
    }

    const sampleW = 240;
    const sampleH = Math.round(240 * (origH / origW));
    if (this.canvas.height !== sampleH) {
      this.canvas.height = sampleH;
    }

    try {
      this.ctx.drawImage(source, 0, 0, sampleW, sampleH);
      const imgData = this.ctx.getImageData(0, 0, sampleW, sampleH);
      const data = imgData.data;

      // 1. Calculate average luminance and luminance histogram
      let totalLum = 0;
      const pixelCount = sampleW * sampleH;
      const lumArray = new Uint8Array(pixelCount);

      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
        lumArray[p] = lum;
        totalLum += lum;
      }

      const meanLum = totalLum / pixelCount;
      // Documents are typically brighter than background surface or vice versa
      const threshold = Math.max(50, Math.min(210, meanLum * 1.08));

      // 2. Find extreme corner points (TL, TR, BR, BL)
      let minSum = Infinity;   // TL: min(x + y)
      let maxSum = -Infinity;  // BR: max(x + y)
      let maxDiff = -Infinity; // TR: max(x - y)
      let minDiff = Infinity;  // BL: min(x - y)

      let tl = { x: sampleW * 0.1, y: sampleH * 0.1 };
      let tr = { x: sampleW * 0.9, y: sampleH * 0.1 };
      let br = { x: sampleW * 0.9, y: sampleH * 0.9 };
      let bl = { x: sampleW * 0.1, y: sampleH * 0.9 };

      let documentPixels = 0;

      // Scan image grid
      const step = 2;
      for (let y = 8; y < sampleH - 8; y += step) {
        for (let x = 8; x < sampleW - 8; x += step) {
          const idx = y * sampleW + x;
          const lum = lumArray[idx];

          // Check if pixel is high contrast against background
          if (lum > threshold) {
            documentPixels++;
            const sum = x + y;
            const diff = x - y;

            if (sum < minSum) {
              minSum = sum;
              tl = { x, y };
            }
            if (sum > maxSum) {
              maxSum = sum;
              br = { x, y };
            }
            if (diff > maxDiff) {
              maxDiff = diff;
              tr = { x, y };
            }
            if (diff < minDiff) {
              minDiff = diff;
              bl = { x, y };
            }
          }
        }
      }

      const docRatio = documentPixels / (pixelCount / (step * step));

      // Calculate candidate quadrilateral normalized coordinates (0.0 to 1.0)
      let normQuad: DetectedQuad = {
        topLeft: { x: tl.x / sampleW, y: tl.y / sampleH },
        topRight: { x: tr.x / sampleW, y: tr.y / sampleH },
        bottomRight: { x: br.x / sampleW, y: br.y / sampleH },
        bottomLeft: { x: bl.x / sampleW, y: bl.y / sampleH },
        confidence: 0.5,
      };

      // Clamp corners inside frame
      normQuad = this.clampQuad(normQuad);

      // Geometric Quadrilateral & Area Validation (Prevent false positives on keyboards/clutter)
      const topW = Math.hypot(normQuad.topRight.x - normQuad.topLeft.x, normQuad.topRight.y - normQuad.topLeft.y);
      const botW = Math.hypot(normQuad.bottomRight.x - normQuad.bottomLeft.x, normQuad.bottomRight.y - normQuad.bottomLeft.y);
      const leftH = Math.hypot(normQuad.bottomLeft.x - normQuad.topLeft.x, normQuad.bottomLeft.y - normQuad.topLeft.y);
      const rightH = Math.hypot(normQuad.bottomRight.x - normQuad.topRight.x, normQuad.bottomRight.y - normQuad.topRight.y);

      // Shoelace area formula
      const quadArea = 0.5 * Math.abs(
        (normQuad.topLeft.x * normQuad.topRight.y - normQuad.topRight.x * normQuad.topLeft.y) +
        (normQuad.topRight.x * normQuad.bottomRight.y - normQuad.bottomRight.x * normQuad.topRight.y) +
        (normQuad.bottomRight.x * normQuad.bottomLeft.y - normQuad.bottomLeft.x * normQuad.bottomRight.y) +
        (normQuad.bottomLeft.x * normQuad.topLeft.y - normQuad.topLeft.x * normQuad.bottomLeft.y)
      );

      const validArea = quadArea >= 0.14 && quadArea <= 0.88;
      const validWidths = topW >= 0.22 && botW >= 0.22 && (topW / botW >= 0.45 && topW / botW <= 2.2);
      const validHeights = leftH >= 0.22 && rightH >= 0.22 && (leftH / rightH >= 0.45 && leftH / rightH <= 2.2);
      const avgW = (topW + botW) / 2;
      const avgH = (leftH + rightH) / 2;
      const aspect = avgW / avgH;
      const validAspect = aspect >= 0.35 && aspect <= 2.8;

      // Sample center luminance vs frame margin corners to verify real contrast step
      const centerIdx = Math.floor(sampleH / 2) * sampleW + Math.floor(sampleW / 2);
      const centerLum = lumArray[centerIdx];
      const cornerLum = (lumArray[8 * sampleW + 8] + lumArray[8 * sampleW + sampleW - 8] +
                         lumArray[(sampleH - 8) * sampleW + 8] + lumArray[(sampleH - 8) * sampleW + sampleW - 8]) / 4;
      const contrastStep = Math.abs(centerLum - cornerLum);

      const hasDocument = validArea && validWidths && validHeights && validAspect && contrastStep >= 14 && docRatio > 0.14 && docRatio < 0.86;
      normQuad.confidence = hasDocument ? Math.min(1, quadArea * 1.6) : 0.2;

      // Smooth corners with previous frame
      if (this.prevQuad && hasDocument) {
        normQuad = this.smoothQuad(this.prevQuad, normQuad, 0.45);
      }

      // Check movement stability
      let isSteady = false;
      let progress = 0;

      if (this.prevQuad && hasDocument) {
        const movement = this.computeMovement(this.prevQuad, normQuad);
        if (movement < this.maxMovementThreshold) {
          this.steadyFrameCount++;
        } else {
          this.steadyFrameCount = Math.max(0, this.steadyFrameCount - 2);
        }

        progress = Math.min(1, this.steadyFrameCount / this.requiredSteadyFrames);
        isSteady = progress >= 0.15; // Start showing countdown when stable
      } else {
        this.steadyFrameCount = 0;
      }

      this.prevQuad = hasDocument ? normQuad : null;

      return {
        quad: normQuad,
        isSteady,
        steadyProgress: progress,
        hasDocument,
      };
    } catch {
      return this.fallbackResult();
    }
  }

  private clampQuad(q: DetectedQuad): DetectedQuad {
    const clamp = (v: number) => Math.max(0.04, Math.min(0.96, v));
    return {
      topLeft: { x: clamp(q.topLeft.x), y: clamp(q.topLeft.y) },
      topRight: { x: clamp(q.topRight.x), y: clamp(q.topRight.y) },
      bottomRight: { x: clamp(q.bottomRight.x), y: clamp(q.bottomRight.y) },
      bottomLeft: { x: clamp(q.bottomLeft.x), y: clamp(q.bottomLeft.y) },
      confidence: q.confidence,
    };
  }

  private smoothQuad(prev: DetectedQuad, next: DetectedQuad, alpha: number): DetectedQuad {
    const lerp = (a: number, b: number) => a * (1 - alpha) + b * alpha;
    return {
      topLeft: { x: lerp(prev.topLeft.x, next.topLeft.x), y: lerp(prev.topLeft.y, next.topLeft.y) },
      topRight: { x: lerp(prev.topRight.x, next.topRight.x), y: lerp(prev.topRight.y, next.topRight.y) },
      bottomRight: { x: lerp(prev.bottomRight.x, next.bottomRight.x), y: lerp(prev.bottomRight.y, next.bottomRight.y) },
      bottomLeft: { x: lerp(prev.bottomLeft.x, next.bottomLeft.x), y: lerp(prev.bottomLeft.y, next.bottomLeft.y) },
      confidence: next.confidence,
    };
  }

  private computeMovement(a: DetectedQuad, b: DetectedQuad): number {
    const dist = (p1: Point, p2: Point) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
    return (
      (dist(a.topLeft, b.topLeft) +
        dist(a.topRight, b.topRight) +
        dist(a.bottomRight, b.bottomRight) +
        dist(a.bottomLeft, b.bottomLeft)) / 4
    );
  }

  private fallbackResult(): DetectionResult {
    return {
      quad: {
        topLeft: { x: 0.08, y: 0.12 },
        topRight: { x: 0.92, y: 0.12 },
        bottomRight: { x: 0.92, y: 0.88 },
        bottomLeft: { x: 0.08, y: 0.88 },
        confidence: 0.5,
      },
      isSteady: false,
      steadyProgress: 0,
      hasDocument: false,
    };
  }
}

