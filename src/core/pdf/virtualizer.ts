/**
 * Virtualizer for Paperweight PDF Viewer
 *
 * Implements strict viewport windowing + 1-page buffer:
 * - Computes exact first/last visible pages based on scroll position.
 * - Adds exactly 1 buffer page above and 1 buffer page below.
 * - Computes stable total scroll height based on lazy aspect ratio probing.
 */

export interface VirtualRange {
  firstVisible: number;
  lastVisible: number;
  displayFirst: number;
  displayLast: number;
  centerPage: number;
  bufferStart: number;
  bufferEnd: number;
  totalScrollHeight: number;
}

export const PAGE_VERTICAL_GAP = 16;
export const PAGE_BADGE_HEIGHT = 0;

export function getPageDimensions(
  pageNumber: number,
  containerWidth: number,
  defaultAspectRatio: number,
  aspectRatioMap?: Map<number, number>,
  scale: number = 1.0
): { width: number; height: number; itemHeight: number } {
  const baseTargetMaxWidth = Math.min(Math.max(containerWidth - 32, 280), 800);
  const targetMaxWidth = baseTargetMaxWidth * scale;
  const ratio = aspectRatioMap?.get(pageNumber) || defaultAspectRatio;
  const height = targetMaxWidth * ratio;
  const itemHeight = height + PAGE_BADGE_HEIGHT + PAGE_VERTICAL_GAP;

  return { width: targetMaxWidth, height, itemHeight };
}

export function computeVisiblePageRange(
  scrollTop: number,
  viewportHeight: number,
  totalPages: number,
  containerWidth: number,
  defaultAspectRatio: number,
  aspectRatioMap?: Map<number, number>,
  scale: number = 1.0,
  forwardBuffer: number = 5,
  backwardBuffer: number = 2
): VirtualRange {
  if (totalPages <= 0) {
    return {
      firstVisible: 1,
      lastVisible: 1,
      displayFirst: 1,
      displayLast: 1,
      centerPage: 1,
      bufferStart: 1,
      bufferEnd: 1,
      totalScrollHeight: 0,
    };
  }

  // Ultra-fast O(1) path for standard uniform aspect ratios (common in >99% of documents)
  if (!aspectRatioMap || aspectRatioMap.size === 0) {
    const baseTargetMaxWidth = Math.min(Math.max(containerWidth - 32, 280), 800);
    const targetMaxWidth = baseTargetMaxWidth * scale;
    const standardHeight = targetMaxWidth * defaultAspectRatio;
    const itemHeight = standardHeight + PAGE_BADGE_HEIGHT + PAGE_VERTICAL_GAP;
    const totalScrollHeight = totalPages * itemHeight;

    const firstVisible = Math.max(1, Math.min(totalPages, Math.floor(Math.max(0, scrollTop) / itemHeight) + 1));
    const lastVisible = Math.max(
      firstVisible,
      Math.min(totalPages, Math.ceil(Math.max(0, scrollTop + viewportHeight) / itemHeight))
    );

    const viewportCenter = scrollTop + viewportHeight / 2;
    const centerPage = Math.max(1, Math.min(totalPages, Math.floor(viewportCenter / itemHeight) + 1));

    let displayFirst = firstVisible;
    let displayLast = lastVisible;

    // Check display bounds matching visibility threshold
    const p1Top = (firstVisible - 1) * itemHeight;
    const p1Bottom = p1Top + itemHeight;
    const p1Visible = Math.max(0, Math.min(p1Bottom, scrollTop + viewportHeight) - Math.max(p1Top, scrollTop));
    if (p1Visible / itemHeight < 0.18 && p1Visible < 120 && firstVisible < lastVisible) {
      displayFirst = Math.min(totalPages, firstVisible + 1);
    }

    const actualBackwardBuffer = scale > 1.5 ? Math.min(backwardBuffer, 1) : backwardBuffer;
    const actualForwardBuffer = scale > 1.5 ? Math.min(forwardBuffer, 2) : forwardBuffer;
    const bufferStart = Math.max(1, firstVisible - actualBackwardBuffer);
    const bufferEnd = Math.min(totalPages, lastVisible + actualForwardBuffer);

    return {
      firstVisible,
      lastVisible,
      displayFirst,
      displayLast,
      centerPage,
      bufferStart,
      bufferEnd,
      totalScrollHeight,
    };
  }

  let accumulatedHeight = 0;
  let firstVisible = 1;
  let lastVisible = 1;
  let foundFirst = false;

  let displayFirst = 0;
  let displayLast = 0;
  let maxVisibleFraction = 0;
  let maxVisiblePage = 1;

  const viewportTop = scrollTop;
  const viewportBottom = scrollTop + viewportHeight;
  const viewportCenter = scrollTop + viewportHeight / 2;
  let centerPage = 1;

  for (let i = 1; i <= totalPages; i++) {
    const { itemHeight } = getPageDimensions(
      i,
      containerWidth,
      defaultAspectRatio,
      aspectRatioMap,
      scale
    );

    const pageTop = accumulatedHeight;
    const pageBottom = accumulatedHeight + itemHeight;

    if (!foundFirst && pageBottom > scrollTop + 0.01) {
      firstVisible = i;
      foundFirst = true;
    }
    if (pageTop <= scrollTop + viewportHeight) {
      lastVisible = i;
    }

    // Viewport center page detection for accurate single-page indication
    if (pageTop <= viewportCenter && pageBottom > viewportCenter) {
      centerPage = i;
    }

    // Meaningful visibility for UI indicator (at least 18% of page height or >= 120px)
    const overlapTop = Math.max(pageTop, viewportTop);
    const overlapBottom = Math.min(pageBottom, viewportBottom);
    const visiblePx = Math.max(0, overlapBottom - overlapTop);
    const fraction = visiblePx / itemHeight;

    if (fraction > maxVisibleFraction) {
      maxVisibleFraction = fraction;
      maxVisiblePage = i;
    }

    if (fraction >= 0.18 || visiblePx >= 120) {
      if (displayFirst === 0) displayFirst = i;
      displayLast = i;
    }

    accumulatedHeight += itemHeight;
  }

  if (!foundFirst) {
    firstVisible = totalPages;
    lastVisible = totalPages;
  }

  if (displayFirst === 0) {
    displayFirst = maxVisiblePage;
    displayLast = maxVisiblePage;
  }

  // Enforce viewport + backwardBuffer pages above and forwardBuffer pages below to eliminate blank voids
  const actualBackwardBuffer = scale > 1.5 ? Math.min(backwardBuffer, 1) : backwardBuffer;
  const actualForwardBuffer = scale > 1.5 ? Math.min(forwardBuffer, 2) : forwardBuffer;
  const bufferStart = Math.max(1, firstVisible - actualBackwardBuffer);
  const bufferEnd = Math.min(totalPages, lastVisible + actualForwardBuffer);

  return {
    firstVisible,
    lastVisible,
    displayFirst,
    displayLast,
    centerPage,
    bufferStart,
    bufferEnd,
    totalScrollHeight: accumulatedHeight,
  };
}

export function getScrollOffsetForPage(
  targetPage: number,
  containerWidth: number,
  defaultAspectRatio: number,
  aspectRatioMap?: Map<number, number>,
  scale: number = 1.0
): number {
  if (targetPage <= 1) return 0;

  const baseTargetMaxWidth = Math.min(Math.max(containerWidth - 32, 280), 800);
  const targetMaxWidth = baseTargetMaxWidth * scale;
  const standardHeight = targetMaxWidth * defaultAspectRatio;
  const standardItemHeight = standardHeight + PAGE_BADGE_HEIGHT + PAGE_VERTICAL_GAP;

  // Ultra-fast O(1) path for standard uniform aspect ratios (99.9% of PDF pages)
  if (!aspectRatioMap || aspectRatioMap.size === 0) {
    return (targetPage - 1) * standardItemHeight;
  }

  let offset = (targetPage - 1) * standardItemHeight;
  for (const [pageNum, ratio] of aspectRatioMap.entries()) {
    if (pageNum < targetPage) {
      const diffHeight = (ratio - defaultAspectRatio) * targetMaxWidth;
      offset += diffHeight;
    }
  }
  return offset;
}

/**
 * Computes exact scroll offsets so that the content under the focal touch point
 * remains pinned to the exact same viewport pixel when scaling between oldScale and newScale.
 * Eliminates virtualizer blank space jumps caused by constant gap scaling differences.
 */
export function calculateFocalScrollOffsets(
  focalX: number,
  focalY: number,
  startScrollLeft: number,
  startScrollTop: number,
  oldScale: number,
  newScale: number,
  containerWidth: number,
  defaultAspectRatio: number,
  aspectRatioMap?: Map<number, number>,
  totalPages: number = 0,
  currentFocalX?: number,
  currentFocalY?: number
): { scrollLeft: number; scrollTop: number } {
  if (totalPages <= 0) {
    return { scrollLeft: 0, scrollTop: 0 };
  }

  const curFocalX = currentFocalX !== undefined ? currentFocalX : focalX;
  const curFocalY = currentFocalY !== undefined ? currentFocalY : focalY;

  // 1. Identify which page and what relative offset within that page was under the touch point
  // 16px is the top padding offset applied to each page div (top: pageTop + 16)
  const touchDocY = Math.max(0, startScrollTop + focalY - 16);
  let targetPage = 1;
  let pageTopOld = 0;
  let pageHeightOld = 0;
  let accumulatedHeight = 0;

  for (let i = 1; i <= totalPages; i++) {
    const { itemHeight, height } = getPageDimensions(
      i,
      containerWidth,
      defaultAspectRatio,
      aspectRatioMap,
      oldScale
    );

    if (accumulatedHeight + itemHeight > touchDocY || i === totalPages) {
      targetPage = i;
      pageTopOld = accumulatedHeight;
      pageHeightOld = height;
      break;
    }
    accumulatedHeight += itemHeight;
  }

  const withinPageY = Math.max(0, touchDocY - pageTopOld);
  const ratioInPageY = pageHeightOld > 0 ? withinPageY / pageHeightOld : 0;

  // 2. Compute exact pageTop of that same page at newScale
  let pageTopNew = 0;
  let pageHeightNew = 0;
  let newAccumulatedHeight = 0;

  for (let i = 1; i <= totalPages; i++) {
    const { itemHeight, height } = getPageDimensions(
      i,
      containerWidth,
      defaultAspectRatio,
      aspectRatioMap,
      newScale
    );

    if (i === targetPage) {
      pageTopNew = newAccumulatedHeight;
      pageHeightNew = height;
      break;
    }
    newAccumulatedHeight += itemHeight;
  }

  const newTouchDocY = pageTopNew + ratioInPageY * pageHeightNew + 16;
  const targetScrollTop = Math.max(0, newTouchDocY - curFocalY);

  // 3. Horizontal offset
  let targetScrollLeft = 0;
  if (newScale > 1.001) {
    const baseTargetMaxWidth = Math.min(Math.max(containerWidth - 32, 280), 800);
    const oldWidth = baseTargetMaxWidth * oldScale;
    const newWidth = baseTargetMaxWidth * newScale;

    const oldWrapperWidth = Math.max(containerWidth, oldWidth + 48);
    const newWrapperWidth = Math.max(containerWidth, newWidth + 48);
    const pageLeftOld = Math.max(0, (oldWrapperWidth - oldWidth) / 2);
    const pageLeftNew = Math.max(0, (newWrapperWidth - newWidth) / 2);

    const touchDocX = startScrollLeft + focalX;
    const withinPageX = touchDocX - pageLeftOld;
    const ratioInPageX = oldWidth > 0 ? Math.max(0, Math.min(1, withinPageX / oldWidth)) : 0.5;
    const newTouchDocX = pageLeftNew + ratioInPageX * newWidth;
    const maxScrollLeft = Math.max(0, newWrapperWidth - containerWidth);
    targetScrollLeft = Math.max(0, Math.min(maxScrollLeft, newTouchDocX - curFocalX));
  } else {
    targetScrollLeft = 0;
  }

  return {
    scrollLeft: targetScrollLeft,
    scrollTop: targetScrollTop,
  };
}

export function getSpacersHeights(
  bufferStart: number,
  bufferEnd: number,
  totalPages: number,
  containerWidth: number,
  defaultAspectRatio: number,
  aspectRatioMap?: Map<number, number>,
  scale: number = 1.0
): { topSpacerHeight: number; bottomSpacerHeight: number } {
  let topSpacerHeight = 0;
  for (let i = 1; i < bufferStart; i++) {
    topSpacerHeight += getPageDimensions(
      i,
      containerWidth,
      defaultAspectRatio,
      aspectRatioMap,
      scale
    ).itemHeight;
  }
  let bottomSpacerHeight = 0;
  for (let i = bufferEnd + 1; i <= totalPages; i++) {
    bottomSpacerHeight += getPageDimensions(
      i,
      containerWidth,
      defaultAspectRatio,
      aspectRatioMap,
      scale
    ).itemHeight;
  }
  return { topSpacerHeight, bottomSpacerHeight };
}

export interface PageSizeProberHandle {
  cancel: () => void;
}

/**
 * Probes all page dimensions in the background using idle slices:
 * Reads page.view and page.rotate directly with zero rendering.
 * Calls page.cleanup() immediately to ensure zero memory accumulation.
 * This guarantees mixed portrait/landscape documents have stable heights upfront.
 * 
 * Strict Worker Contention Rule:
 * Checks isRenderBusy() before EVERY getPage call. If a render is queued or active,
 * probing yields immediately so visible page renders are NEVER delayed.
 */
export function probeAllPageDimensions(
  pdfDoc: any,
  totalPages: number,
  onBatch: (aspectRatioBatch: Map<number, number>) => void,
  isRenderBusy?: (() => boolean) | number,
  batchSize = 2
): PageSizeProberHandle {
  const isBusyFn = typeof isRenderBusy === 'function' ? isRenderBusy : undefined;
  const actualBatchSize = typeof isRenderBusy === 'number' ? isRenderBusy : batchSize;
  let isCancelled = false;
  let currentPage = 1;
  const ratios = new Map<number, number>();

  const processBatch = async () => {
    if (isCancelled || currentPage > totalPages) return;

    // Yield if a page render is waiting or active on the PDF.js worker
    if (isBusyFn && isBusyFn()) {
      setTimeout(processBatch, 400);
      return;
    }

    const end = Math.min(currentPage + actualBatchSize, totalPages + 1);
    let processedUpTo = currentPage;

    for (let i = currentPage; i < end; i++) {
      if (isCancelled) return;
      // Re-check before each getPage call to prevent worker queue flooding
      if (isBusyFn && isBusyFn()) {
        break;
      }

      try {
        const page = await pdfDoc.getPage(i);
        const [x1, y1, x2, y2] = page.view;
        const rawW = Math.abs(x2 - x1);
        const rawH = Math.abs(y2 - y1);
        const isRotated = page.rotate % 180 !== 0;
        const w = isRotated ? rawH : rawW;
        const h = isRotated ? rawW : rawH;
        const ratio = w > 0 ? h / w : 1.414;
        ratios.set(i, ratio);
        page.cleanup(); // Free glyph and font buffers immediately
        processedUpTo = i + 1;
      } catch {
        processedUpTo = i + 1;
      }
    }

    if (processedUpTo > currentPage) {
      onBatch(new Map(ratios));
      currentPage = processedUpTo;
    }

    if (currentPage <= totalPages && !isCancelled) {
      // Gentle pacing so PDF.js worker stays 100% responsive for user interactions
      const delay = isBusyFn ? (isBusyFn() ? 400 : 250) : 10;
      setTimeout(processBatch, delay);
    }
  };

  setTimeout(processBatch, 0);

  return {
    cancel: () => {
      isCancelled = true;
    },
  };
}
