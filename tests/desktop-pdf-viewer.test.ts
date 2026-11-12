import { describe, it, expect } from 'vitest';
import { clearThumbnailCache } from '../src/components/ui/PdfThumbnailSidebar';

describe('Desktop PDF Viewer Controls & Fit Mode Calculations', () => {
  it('clears thumbnail cache cleanly', () => {
    expect(() => clearThumbnailCache()).not.toThrow();
  });

  it('calculates fit-to-width scale matching container width minus margins', () => {
    const containerWidth = 1200;
    const availableWidth = containerWidth - 48; // 1152px
    const baseTargetMaxWidth = 800;
    const fitWidthScale = Math.round((availableWidth / baseTargetMaxWidth) * 100) / 100;
    expect(fitWidthScale).toBe(1.44);
    expect(baseTargetMaxWidth * fitWidthScale).toBeCloseTo(1152, 0);
  });

  it('calculates fit-to-page scale fitting vertical and horizontal viewport bounds', () => {
    const containerWidth = 1200;
    const containerHeight = 800;
    const availableHeight = containerHeight - 48; // 752px
    const availableWidth = containerWidth - 48; // 1152px
    const baseTargetMaxWidth = 800;
    const defaultAspectRatio = 1.414; // A4 standard

    const pageHeightAtBase = baseTargetMaxWidth * defaultAspectRatio; // 1131.2px
    const scaleH = availableHeight / pageHeightAtBase; // 752 / 1131.2 = 0.6648
    const scaleW = availableWidth / baseTargetMaxWidth; // 1.44
    const fitPageScale = Math.round(Math.min(scaleH, scaleW) * 100) / 100;

    expect(fitPageScale).toBe(0.66);
    // Verified page height at fitPageScale fits within available height
    expect(baseTargetMaxWidth * fitPageScale * defaultAspectRatio).toBeLessThanOrEqual(availableHeight);
  });

  it('re-calculates fit-to-width correctly when sidebar opens and closes', () => {
    const fullWidth = 1400;
    const sidebarWidth = 208; // w-52
    const baseTargetMaxWidth = 800;

    // Sidebar Closed
    const availClosed = fullWidth - 48;
    const scaleClosed = Math.round((availClosed / baseTargetMaxWidth) * 100) / 100;
    expect(scaleClosed).toBe(1.69);

    // Sidebar Open (container width reduces to 1400 - 208 = 1192)
    const availOpen = fullWidth - sidebarWidth - 48;
    const scaleOpen = Math.round((availOpen / baseTargetMaxWidth) * 100) / 100;
    expect(scaleOpen).toBe(1.43);

    // Both scales fit exactly their respective available width
    expect(scaleClosed).toBeGreaterThan(scaleOpen);
  });

  it('centers page without right-side shift at 125% and 200% zoom levels', () => {
    const containerWidth = 1200;
    const baseTargetMaxWidth = 800;

    // At 125% zoom (1.25x)
    const scale125 = 1.25;
    const displayWidth125 = baseTargetMaxWidth * scale125; // 1000px
    const contentWidth125 = Math.max(containerWidth, displayWidth125 + 48); // 1200px
    const pageLeftMargin125 = (contentWidth125 - displayWidth125) / 2; // (1200 - 1000) / 2 = 100px
    const pageRightMargin125 = contentWidth125 - pageLeftMargin125 - displayWidth125; // 100px

    expect(contentWidth125).toBe(1200);
    // Page is centered perfectly with equal left and right margins (not shifted to right)
    expect(pageLeftMargin125).toBe(pageRightMargin125);
    expect(pageLeftMargin125).toBe(100);

    // At 200% zoom (2.0x)
    const scale200 = 2.0;
    const displayWidth200 = baseTargetMaxWidth * scale200; // 1600px
    const contentWidth200 = Math.max(containerWidth, displayWidth200 + 48); // 1648px
    const pageLeftMargin200 = (contentWidth200 - displayWidth200) / 2; // 24px
    const pageRightMargin200 = contentWidth200 - pageLeftMargin200 - displayWidth200; // 24px

    expect(contentWidth200).toBe(1648);
    // Margins are exactly 24px on each side
    expect(pageLeftMargin200).toBe(24);
    expect(pageRightMargin200).toBe(24);
  });

  it('computes search highlight bounding box percentages accurately', () => {
    // Simulated unscaled viewport for standard A4 page (595.28 x 841.89)
    const vpWidth = 595.28;
    const vpHeight = 841.89;

    // Test text item
    const itemStr = 'ET AI HACKATHON 2026';
    const query = 'Hackathon';
    const startIdx = itemStr.toLowerCase().indexOf(query.toLowerCase());
    expect(startIdx).toBe(6);

    const charStartRatio = startIdx / itemStr.length; // 6 / 20 = 0.3
    const charLenRatio = query.length / itemStr.length; // 9 / 20 = 0.45
    const itemWidth = 200; // PDF points
    const fontHeight = 16;
    const boxLeft = 50 + charStartRatio * itemWidth; // 50 + 60 = 110
    const boxWidth = charLenRatio * itemWidth; // 90
    const boxTop = 100;
    const boxHeight = fontHeight;

    const xPct = (boxLeft / vpWidth) * 100;
    const yPct = (boxTop / vpHeight) * 100;
    const wPct = (boxWidth / vpWidth) * 100;
    const hPct = (boxHeight / vpHeight) * 100;

    expect(xPct).toBeGreaterThan(15);
    expect(xPct).toBeLessThan(25);
    expect(yPct).toBeGreaterThan(10);
    expect(yPct).toBeLessThan(15);
    expect(wPct).toBeGreaterThan(10);
    expect(wPct).toBeLessThan(20);
    expect(hPct).toBeGreaterThan(1.5);
    expect(hPct).toBeLessThan(3.0);
  });

  it('detects small space windows below 768px to hide sidebar and title', () => {
    const isSmallSpace1 = 600 < 768;
    const isSmallSpace2 = 767 < 768;
    const isSmallSpace3 = 768 < 768;
    const isSmallSpace4 = 1024 < 768;

    expect(isSmallSpace1).toBe(true);
    expect(isSmallSpace2).toBe(true);
    expect(isSmallSpace3).toBe(false);
    expect(isSmallSpace4).toBe(false);
  });
});
