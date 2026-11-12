/**
 * Free 4-Corner Perspective Document Cropper & Unwarper
 * Performs continuous pixel-level projective homography unwarping with bilinear sampling.
 * Eliminates triangle mesh clipping seams and avoids grid lines on exported documents.
 */

export interface QuadCorners {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
}

/**
 * Computes the 3x3 projective transformation matrix mapping unit square [0,1]^2
 * to the quadrilateral (x0,y0)-(x1,y1)-(x2,y2)-(x3,y3).
 */
function squareToQuad(
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number
) {
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const sx = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const sy = y0 - y1 + y2 - y3;

  if (Math.abs(sx) < 1e-6 && Math.abs(sy) < 1e-6) {
    // Parallelogram / Affine case
    return {
      a11: x1 - x0, a12: x3 - x0, a13: x0,
      a21: y1 - y0, a22: y3 - y0, a23: y0,
      a31: 0, a32: 0, a33: 1,
    };
  }

  const det = dx1 * dy2 - dx2 * dy1;
  const a31 = (sx * dy2 - sy * dx2) / det;
  const a32 = (dx1 * sy - dy1 * sx) / det;
  return {
    a11: x1 - x0 + a31 * x1,
    a12: x3 - x0 + a32 * x3,
    a13: x0,
    a21: y1 - y0 + a31 * y1,
    a22: y3 - y0 + a32 * y3,
    a23: y0,
    a31, a32, a33: 1,
  };
}

/**
 * Transforms an image quadrilateral into a flattened rectangular document page
 * using continuous bilinear inverse homography sampling.
 */
export async function cropPerspectiveQuad(
  image: HTMLImageElement | HTMLCanvasElement,
  corners: QuadCorners
): Promise<Blob> {
  const origW = (image as HTMLImageElement).naturalWidth || image.width;
  const origH = (image as HTMLImageElement).naturalHeight || image.height;

  // Convert normalized (0..1) to pixel coordinates
  const tl = { x: corners.topLeft.x * origW, y: corners.topLeft.y * origH };
  const tr = { x: corners.topRight.x * origW, y: corners.topRight.y * origH };
  const br = { x: corners.bottomRight.x * origW, y: corners.bottomRight.y * origH };
  const bl = { x: corners.bottomLeft.x * origW, y: corners.bottomLeft.y * origH };

  // Calculate target rectangular dimensions
  const topW = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const botW = Math.hypot(br.x - bl.x, br.y - bl.y);
  const leftH = Math.hypot(bl.x - tl.x, bl.y - bl.y);
  const rightH = Math.hypot(br.x - tr.x, br.y - tr.y);

  const outW = Math.max(100, Math.round(Math.max(topW, botW)));
  const outH = Math.max(100, Math.round(Math.max(leftH, rightH)));

  // Source pixel buffer via offscreen canvas
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = origW;
  srcCanvas.height = origH;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) throw new Error('Canvas 2D context unavailable');
  srcCtx.drawImage(image, 0, 0);
  const srcImageData = srcCtx.getImageData(0, 0, origW, origH);
  const srcData = srcImageData.data;

  // Destination canvas and ImageData
  const destCanvas = document.createElement('canvas');
  destCanvas.width = outW;
  destCanvas.height = outH;
  const destCtx = destCanvas.getContext('2d');
  if (!destCtx) throw new Error('Canvas 2D context unavailable');
  const destImageData = destCtx.createImageData(outW, outH);
  const destData = destImageData.data;

  // Projective homography mapping destination [0,1]^2 to source quadrilateral
  const H = squareToQuad(tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y);
  const a11 = H.a11, a12 = H.a12, a13 = H.a13;
  const a21 = H.a21, a22 = H.a22, a23 = H.a23;
  const a31 = H.a31, a32 = H.a32;

  let dstIdx = 0;
  for (let y = 0; y < outH; y++) {
    const t = y / outH;
    const numU_base = a12 * t + a13;
    const numV_base = a22 * t + a23;
    const denom_base = a32 * t + 1;

    for (let x = 0; x < outW; x++) {
      const s = x / outW;
      const denom = a31 * s + denom_base;
      const invDenom = 1 / denom;
      const u = (a11 * s + numU_base) * invDenom;
      const v = (a21 * s + numV_base) * invDenom;

      const x0 = Math.floor(u);
      const y0 = Math.floor(v);

      if (x0 >= 0 && x0 < origW - 1 && y0 >= 0 && y0 < origH - 1) {
        const fx = u - x0;
        const fy = v - y0;
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;

        const idx00 = (y0 * origW + x0) * 4;
        const idx10 = idx00 + 4;
        const idx01 = ((y0 + 1) * origW + x0) * 4;
        const idx11 = idx01 + 4;

        destData[dstIdx] = (srcData[idx00] * w00 + srcData[idx10] * w10 + srcData[idx01] * w01 + srcData[idx11] * w11) | 0;
        destData[dstIdx + 1] = (srcData[idx00 + 1] * w00 + srcData[idx10 + 1] * w10 + srcData[idx01 + 1] * w01 + srcData[idx11 + 1] * w11) | 0;
        destData[dstIdx + 2] = (srcData[idx00 + 2] * w00 + srcData[idx10 + 2] * w10 + srcData[idx01 + 2] * w01 + srcData[idx11 + 2] * w11) | 0;
        destData[dstIdx + 3] = 255;
      } else {
        const cx = Math.max(0, Math.min(origW - 1, Math.round(u)));
        const cy = Math.max(0, Math.min(origH - 1, Math.round(v)));
        const cIdx = (cy * origW + cx) * 4;
        destData[dstIdx] = srcData[cIdx];
        destData[dstIdx + 1] = srcData[cIdx + 1];
        destData[dstIdx + 2] = srcData[cIdx + 2];
        destData[dstIdx + 3] = 255;
      }
      dstIdx += 4;
    }
  }

  destCtx.putImageData(destImageData, 0, 0);

  return new Promise((resolve) => {
    destCanvas.toBlob((b) => resolve(b || new Blob()), 'image/jpeg', 0.95);
  });
}
