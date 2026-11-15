import React, { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Zap,
  ZapOff,
  Images,
  Sparkles,
  AlertCircle,
  RefreshCw,
  FileText,
} from 'lucide-react';
import { DocumentDetector, type DetectionResult } from './document-detector';
import { cropPerspectiveQuad, type QuadCorners } from './perspective-crop';

export interface CapturedScanItem {
  file: File;
  rawFile?: File;
  rawUrl: string;
  displayUrl: string;
  cropCorners?: QuadCorners;
}

/**
 * Feature flag for Auto Capture & Edge Detection:
 * Set to `true` when re-enabling auto-capture on user request.
 * Currently flagged & hidden as requested.
 */
export const ENABLE_AUTO_CAPTURE = false;

interface CameraViewfinderProps {
  isOpen: boolean;
  onClose: () => void;
  onCapturePages: (files: File[], scanItems?: CapturedScanItem[]) => void;
  initialCount?: number;
  onOpenReview?: () => void;
}

export const CameraViewfinder: React.FC<CameraViewfinderProps> = ({
  isOpen,
  onClose,
  onCapturePages,
  initialCount = 0,
  onOpenReview,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const detectorRef = useRef<DocumentDetector>(new DocumentDetector());
  const animFrameRef = useRef<number | null>(null);

  const [sessionCapturedFiles, setSessionCapturedFiles] = useState<File[]>([]);
  const [sessionCapturedItems, setSessionCapturedItems] = useState<CapturedScanItem[]>([]);
  const [lastThumbUrl, setLastThumbUrl] = useState<string | null>(null);
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [isAutoCaptureOn, setIsAutoCaptureOn] = useState<boolean>(ENABLE_AUTO_CAPTURE);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [isStreamReady, setIsStreamReady] = useState<boolean>(false);
  const [freezeSnapshot, setFreezeSnapshot] = useState<string | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState<boolean>(false);
  const [showNoDocToast, setShowNoDocToast] = useState<boolean>(false);

  const noDocSearchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const noDocDismissTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Auto capture detection state
  const [detection, setDetection] = useState<DetectionResult>({
    quad: {
      topLeft: { x: 0.1, y: 0.12 },
      topRight: { x: 0.9, y: 0.12 },
      bottomRight: { x: 0.9, y: 0.88 },
      bottomLeft: { x: 0.1, y: 0.88 },
      confidence: 0.5,
    },
    isSteady: false,
    steadyProgress: 0,
    hasDocument: false,
  });

  // Turn off torch / flash cleanly
  const turnOffTorch = useCallback(async () => {
    if (streamRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      if (track) {
        try {
          await (track as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
            advanced: [{ torch: false }],
          });
        } catch {
          // ignore
        }
      }
    }
    setIsTorchOn(false);
  }, []);

  // Stop camera stream cleanly
  const stopStream = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (noDocSearchTimerRef.current) {
      clearTimeout(noDocSearchTimerRef.current);
      noDocSearchTimerRef.current = null;
    }
    if (noDocDismissTimerRef.current) {
      clearTimeout(noDocDismissTimerRef.current);
      noDocDismissTimerRef.current = null;
    }
    setShowNoDocToast(false);
    turnOffTorch();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreamReady(false);
  }, [turnOffTorch]);

  // Initialize strictly REAR CAMERA (environment) to avoid any camera switching flicker
  const startStream = useCallback(async () => {
    stopStream();
    setCameraError(null);
    setIsStreamReady(false);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Camera API is not supported on this device/browser.');
      return;
    }

    let stream: MediaStream | null = null;

    // 1. Try rear camera with ideal portrait-friendly resolution (no restrictive min bounds)
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
    } catch {
      // 2. Fallback to basic environment facingMode
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'environment' },
        });
      } catch {
        // 3. Fallback to default rear video device
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: true,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('Camera rear stream error:', msg);
          if (msg.includes('NotAllowedError') || msg.includes('Permission')) {
            setCameraError('Camera access denied. Please allow camera permission in settings or pick from gallery.');
          } else {
            setCameraError('Unable to open live camera stream. You can pick document photos directly from gallery below.');
          }
          return;
        }
      }
    }

    streamRef.current = stream;

    if (videoRef.current && stream) {
      const video = videoRef.current;
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      video.setAttribute('autoplay', 'true');
      video.setAttribute('muted', 'true');
      video.srcObject = stream;

      try {
        await video.play();
        setIsStreamReady(true);
      } catch (playErr) {
        console.warn('Video play interrupted:', playErr);
      }
    }

    // Check torch support
    const videoTrack = stream?.getVideoTracks()[0];
    if (videoTrack) {
      const caps = (videoTrack.getCapabilities ? videoTrack.getCapabilities() : {}) as { torch?: boolean };
      setHasTorch(Boolean(caps?.torch));
    }
  }, [stopStream]);

  // Shutter capture handler: immediate frame capture with document auto-crop
  const triggerCapture = useCallback(async () => {
    if (isCapturing) return;
    setIsCapturing(true);

    const video = videoRef.current;
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      const width = video.videoWidth;
      const height = video.videoHeight;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (ctx) {
        ctx.drawImage(video, 0, 0, width, height);

        // Immediate freeze-frame to prevent any ugly placeholder or black screen
        const snapshotUrl = canvas.toDataURL('image/jpeg', 0.95);
        setFreezeSnapshot(snapshotUrl);

        // Haptic vibration feedback on capture
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try {
            navigator.vibrate([40, 20, 50]);
          } catch {
            // ignore
          }
        }

        // 1. Raw uncropped frame (Full camera resolution)
        const rawBlob: Blob = await new Promise((resolve) => {
          canvas.toBlob((b) => resolve(b || new Blob()), 'image/jpeg', 0.95);
        });
        const rawUrl = URL.createObjectURL(rawBlob);

        const pageIndex = sessionCapturedFiles.length + initialCount + 1;
        const rawFile = new File([rawBlob], `scan_raw_${pageIndex}.jpg`, {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });

        // 2. Detected quad corners for auto-crop
        let croppedBlob = rawBlob;
        let croppedUrl = rawUrl;
        let quad: QuadCorners = {
          topLeft: { x: 0.05, y: 0.05 },
          topRight: { x: 0.95, y: 0.05 },
          bottomRight: { x: 0.95, y: 0.95 },
          bottomLeft: { x: 0.05, y: 0.95 },
        };

        if (ENABLE_AUTO_CAPTURE && detection.hasDocument) {
          quad = { ...detection.quad };
          try {
            croppedBlob = await cropPerspectiveQuad(canvas, quad);
            croppedUrl = URL.createObjectURL(croppedBlob);
          } catch (cropErr) {
            console.warn('Auto perspective crop error:', cropErr);
          }
        }

        const scanItem: CapturedScanItem = {
          file: rawFile,
          rawFile,
          rawUrl,
          displayUrl: croppedUrl,
          cropCorners: quad,
        };

        setLastThumbUrl(croppedUrl);
        setSessionCapturedFiles((prev) => [...prev, rawFile]);
        setSessionCapturedItems((prev) => [...prev, scanItem]);
        turnOffTorch();
        setIsCapturing(false);
        detectorRef.current.reset();

        // Immediately forward to page adjustment screen!
        onCapturePages([rawFile], [scanItem]);
        return;
      }
    }

    // Fallback if live video is not ready
    setIsCapturing(false);
    fileInputRef.current?.click();
  }, [detection, initialCount, isCapturing, onCapturePages, sessionCapturedFiles.length, turnOffTorch]);

  // Real-time detection loop for Auto Capture (active only when ENABLE_AUTO_CAPTURE is true)
  const runDetectionLoop = useCallback(() => {
    if (!ENABLE_AUTO_CAPTURE || !isAutoCaptureOn) return;

    if (!videoRef.current || videoRef.current.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(runDetectionLoop);
      return;
    }

    const res = detectorRef.current.detect(videoRef.current);
    setDetection(res);

    if (res.hasDocument) {
      // Document detected! Cancel no-doc toast and search timer
      if (noDocSearchTimerRef.current) {
        clearTimeout(noDocSearchTimerRef.current);
        noDocSearchTimerRef.current = null;
      }
      setShowNoDocToast(false);

      // Auto capture ONLY when an actual document is confirmed and held steady
      if (res.isSteady && res.steadyProgress >= 1.0 && !isCapturing) {
        triggerCapture();
      }
    } else {
      // No document in frame - schedule toast after 3.5s of searching without document
      if (!noDocSearchTimerRef.current && !showNoDocToast) {
        noDocSearchTimerRef.current = setTimeout(() => {
          setShowNoDocToast(true);
          if (noDocDismissTimerRef.current) clearTimeout(noDocDismissTimerRef.current);
          noDocDismissTimerRef.current = setTimeout(() => {
            setShowNoDocToast(false);
          }, 5000);
        }, 3500);
      }
    }

    animFrameRef.current = requestAnimationFrame(runDetectionLoop);
  }, [isCapturing, isAutoCaptureOn, showNoDocToast, triggerCapture]);

  // Open / Close stream lifecycle
  useEffect(() => {
    if (isOpen) {
      setShowDiscardConfirm(false);
      setFreezeSnapshot(null);
      startStream();
      if (ENABLE_AUTO_CAPTURE) {
        animFrameRef.current = requestAnimationFrame(runDetectionLoop);
      }
    } else {
      setFreezeSnapshot(null);
      setSessionCapturedFiles([]);
      setLastThumbUrl(null);
      stopStream();
    }
    return () => {
      stopStream();
    };
  }, [isOpen, runDetectionLoop, startStream, stopStream]);

  // Toggle flash / torch
  const handleToggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (track) {
      try {
        const next = !isTorchOn;
        await (track as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
          advanced: [{ torch: next }],
        });
        setIsTorchOn(next);
      } catch {
        // Torch constraint failed on this device
      }
    }
  };

  // Gallery file input handler (supports single or multi-page selection from gallery)
  const handleGalleryInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const added: File[] = Array.from(files);
      const last = added[added.length - 1];
      const lastUrl = URL.createObjectURL(last);
      setLastThumbUrl(lastUrl);
      setSessionCapturedFiles((prev) => [...prev, ...added]);
      turnOffTorch();

      const items: CapturedScanItem[] = added.map((f) => {
        const u = URL.createObjectURL(f);
        return {
          file: f,
          rawUrl: u,
          displayUrl: u,
          cropCorners: {
            topLeft: { x: 0.05, y: 0.05 },
            topRight: { x: 0.95, y: 0.05 },
            bottomRight: { x: 0.95, y: 0.95 },
            bottomLeft: { x: 0.05, y: 0.95 },
          },
        };
      });

      setSessionCapturedItems((prev) => [...prev, ...items]);
      // Immediately forward to page adjustment screen!
      onCapturePages(added, items);
    }
    e.target.value = '';
  };

  const totalCount = sessionCapturedFiles.length + initialCount;

  // Handle Back button navigation
  const handleBack = () => {
    if (totalCount > 0) {
      setShowDiscardConfirm(true);
    } else {
      turnOffTorch();
      onClose();
    }
  };

  const handleConfirmDiscard = () => {
    turnOffTorch();
    setShowDiscardConfirm(false);
    setSessionCapturedFiles([]);
    setLastThumbUrl(null);
    onClose();
  };

  // Intercept Android hardware back button and swipe gestures
  useEffect(() => {
    const handleHardwareBack = (e: Event) => {
      if (!isOpen) return;
      e.preventDefault();
      if (showDiscardConfirm) {
        setShowDiscardConfirm(false);
      } else if (totalCount > 0) {
        setShowDiscardConfirm(true);
      } else {
        turnOffTorch();
        onClose();
      }
    };

    window.addEventListener('hardwareBackPress', handleHardwareBack);
    return () => window.removeEventListener('hardwareBackPress', handleHardwareBack);
  }, [isOpen, showDiscardConfirm, totalCount, turnOffTorch, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-surface-bg text-text-main dark:bg-[#000000] dark:text-white flex flex-col justify-between overflow-hidden select-none">
      {/* Hidden Gallery Input (Multiple selection allowed) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleGalleryInput}
        className="hidden"
      />

      {/* 1. TOP BAR (Theme-aware with Safe Area Inset Padding) */}
      <div className="relative z-30 px-4 py-3 pt-[max(0.75rem,var(--safe-area-top))] pl-[max(1rem,var(--safe-area-left))] pr-[max(1rem,var(--safe-area-right))] flex items-center justify-between bg-surface-panel dark:bg-black text-text-main dark:text-white border-b border-surface-border dark:border-white/10 shrink-0 transition-[padding] duration-150">
        {/* Back Button */}
        <button
          type="button"
          onClick={handleBack}
          className="p-2 rounded-full bg-surface-subtle hover:bg-surface-hover dark:bg-white/10 dark:hover:bg-white/20 text-text-main dark:text-white cursor-pointer transition-colors active:scale-95"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {/* Center Title & Pages Count */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Document Scanner</span>
          {totalCount > 0 && (
            <span className="text-xs font-mono font-semibold px-2.5 py-0.5 rounded-chip bg-accent text-accent-contrast">
              {totalCount} {totalCount === 1 ? 'Page' : 'Pages'}
            </span>
          )}
        </div>

        {/* Right side spacer */}
        <div className="w-9 h-9" />
      </div>

      {/* 2. CENTER VIEWFINDER VIEWPORT (Camera Viewport Canvas) */}
      <div className="relative flex-1 w-full h-full flex items-center justify-center overflow-hidden bg-black">
        {/* Flash animation on capture */}
        {isCapturing && (
          <div className="absolute inset-0 bg-white z-40 opacity-75 animate-out fade-out duration-200 pointer-events-none" />
        )}

        {/* Live Video Feed with transparent 1x1 gif poster to eliminate browser play button */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          poster="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
          className={`w-full h-full object-cover bg-black ${isStreamReady ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200`}
        />

        {/* Freeze-frame image overlay on capture (Instant visual confirmation, zero ugly placeholder) */}
        {freezeSnapshot && (
          <img
            src={freezeSnapshot}
            alt="Captured frame"
            className="absolute inset-0 w-full h-full object-cover z-30 pointer-events-none animate-in fade-in duration-75"
          />
        )}

        {/* Real-time document detection overlay when auto-capture is active */}
        {ENABLE_AUTO_CAPTURE && isAutoCaptureOn && !cameraError && detection.hasDocument && (
          <>
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-20">
              <polygon
                points={`
                  ${detection.quad.topLeft.x * 100}%,${detection.quad.topLeft.y * 100}%
                  ${detection.quad.topRight.x * 100}%,${detection.quad.topRight.y * 100}%
                  ${detection.quad.bottomRight.x * 100}%,${detection.quad.bottomRight.y * 100}%
                  ${detection.quad.bottomLeft.x * 100}%,${detection.quad.bottomLeft.y * 100}%
                `}
                fill={detection.isSteady ? 'rgba(59, 130, 246, 0.12)' : 'rgba(59, 130, 246, 0.05)'}
                stroke="#3B82F6"
                strokeWidth="2.5"
                strokeDasharray={detection.isSteady ? 'none' : '6 4'}
                className="transition-all duration-75"
              />
            </svg>

            {/* 4 Corner Discs (Blue with crisp white circular border, matching Adobe Scan screenshot 2) */}
            {[
              { key: 'tl', p: detection.quad.topLeft },
              { key: 'tr', p: detection.quad.topRight },
              { key: 'br', p: detection.quad.bottomRight },
              { key: 'bl', p: detection.quad.bottomLeft },
            ].map(({ key, p }) => (
              <div
                key={key}
                style={{
                  left: `${p.x * 100}%`,
                  top: `${p.y * 100}%`,
                }}
                className="absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#3B82F6] border-[2.5px] border-white shadow-xl pointer-events-none z-25 transition-all duration-75"
              />
            ))}
          </>
        )}

        {/* Toast: No document found. Capture manually (Auto-dismisses after 5s) */}
        {ENABLE_AUTO_CAPTURE && showNoDocToast && !cameraError && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30 animate-in fade-in duration-200">
            <div className="px-6 py-2.5 rounded-full bg-black/85 backdrop-blur-md text-white border border-white/20 shadow-2xl flex items-center justify-center">
              <span className="text-xs sm:text-sm font-medium tracking-wide text-white/95">
                No document found. Capture manually.
              </span>
            </div>
          </div>
        )}

        {/* Adobe Scan Stage 1 & Stage 2 Status Center Pills */}
        {ENABLE_AUTO_CAPTURE && !showNoDocToast && isAutoCaptureOn && !cameraError && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30 animate-in fade-in duration-150">
            {detection.hasDocument && detection.isSteady && detection.steadyProgress >= 0.15 ? (
              /* Stage 2: Capturing... hold steady */
              <div className="px-6 py-2.5 rounded-full bg-black/80 backdrop-blur-md text-white border border-white/20 flex items-center gap-2 shadow-2xl animate-in zoom-in-95 duration-150">
                <div className="w-2.5 h-2.5 bg-blue-500 rounded-full animate-pulse" />
                <span className="text-xs sm:text-sm font-medium tracking-wide text-white/95">
                  Capturing... hold steady
                </span>
              </div>
            ) : (
              /* Stage 1: Looking for document */
              <div className="px-6 py-2.5 rounded-full bg-black/75 backdrop-blur-md text-white border border-white/15 flex items-center justify-center shadow-2xl animate-in fade-in duration-150">
                <span className="text-xs sm:text-sm font-medium tracking-wide text-white/95">
                  Looking for document
                </span>
              </div>
            )}
          </div>
        )}

        {/* Camera Permission / Error Fallback Overlay */}
        {cameraError && (
          <div className="absolute inset-6 z-30 flex flex-col items-center justify-center p-6 rounded-sheet bg-surface-panel border border-surface-border text-center max-w-sm mx-auto text-text-main shadow-lifted">
            <AlertCircle className="w-10 h-10 text-status-warning mb-3" />
            <h4 className="text-base font-semibold mb-1">Camera Stream Unavailable</h4>
            <p className="text-xs text-text-muted mb-5 leading-relaxed">{cameraError}</p>
            <div className="flex flex-col gap-2.5 w-full">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full min-h-[44px] px-4 rounded-control bg-accent hover:bg-accent-hover text-accent-contrast font-semibold text-sm transition-colors cursor-pointer"
              >
                Choose Photos from Device
              </button>
              <button
                type="button"
                onClick={startStream}
                className="w-full min-h-[44px] px-4 rounded-control bg-surface-subtle hover:bg-surface-hover border border-surface-border text-text-main font-medium text-sm transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Retry Live Camera</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3. BOTTOM SHUTTER BAR - Theme-aware light & dark mode */}
      <div className="relative z-30 bg-surface-panel dark:bg-black border-t border-surface-border dark:border-white/10 px-5 py-4 pb-[max(1.75rem,var(--safe-area-bottom))] pl-[max(1.25rem,var(--safe-area-left))] pr-[max(1.25rem,var(--safe-area-right))] flex items-center justify-between shrink-0 transition-[padding] duration-150">
        {/* LEFT SECTION: Gallery & Auto-Capture Toggle (when enabled) */}
        <div className="flex items-center gap-3 sm:gap-4 flex-1 justify-start">
          {/* OPTION 1: Gallery (Pick pages from gallery) */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-12 h-12 rounded-xl flex items-center justify-center text-text-muted hover:text-text-main dark:text-white/80 dark:hover:text-white cursor-pointer active:scale-90 transition-transform"
            title="Pick pages from gallery"
            aria-label="Pick pages from gallery"
          >
            <Images className="w-7 h-7 stroke-[1.75]" />
          </button>

          {/* OPTION 2: Auto Capture Toggle (Flagged & hidden when ENABLE_AUTO_CAPTURE is false) */}
          {ENABLE_AUTO_CAPTURE && (
            <button
              type="button"
              onClick={() => setIsAutoCaptureOn((prev) => !prev)}
              className={`w-12 h-12 rounded-xl flex items-center justify-center cursor-pointer active:scale-90 transition-all ${
                isAutoCaptureOn
                  ? 'bg-accent text-accent-contrast border border-accent shadow-xs'
                  : 'text-text-muted hover:text-text-main dark:text-white/80 dark:hover:text-white'
              }`}
              title={isAutoCaptureOn ? 'Auto-capture is ON' : 'Auto-capture is OFF'}
              aria-label="Toggle auto capture"
            >
              <Sparkles className="w-7 h-7 stroke-[1.75]" />
            </button>
          )}
        </div>

        {/* CENTER SECTION: Shutter Button (Always Centered) */}
        <div className="flex items-center justify-center shrink-0">
          <div className="relative w-[84px] h-[84px] flex items-center justify-center">
            {/* Animated SVG Progress Ring in Blue (#3B82F6) */}
            {ENABLE_AUTO_CAPTURE && isAutoCaptureOn && (
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none z-20"
                viewBox="0 0 84 84"
              >
                {/* Subtle track background */}
                <circle
                  cx="42"
                  cy="42"
                  r="38"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.5"
                  className="text-black/15 dark:text-white/20"
                />
                {/* Progress arc filling clockwise from top (12 o'clock) */}
                <circle
                  cx="42"
                  cy="42"
                  r="38"
                  fill="none"
                  stroke="#3B82F6"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={238.76}
                  strokeDashoffset={238.76 * (1 - detection.steadyProgress)}
                  transform="rotate(-90 42 42)"
                  className="transition-[stroke-dashoffset] duration-75 ease-linear"
                />
              </svg>
            )}

            {/* Shutter Button (Black with outline in light mode, White with outline in dark mode) */}
            <button
              type="button"
              onClick={triggerCapture}
              disabled={isCapturing}
              className="w-[68px] h-[68px] rounded-full border-[3px] border-black dark:border-white p-1 flex items-center justify-center cursor-pointer active:scale-90 transition-transform shadow-lg hover:opacity-95 disabled:opacity-50 z-10"
              aria-label="Take picture"
              title="Take picture"
            >
              <div className="w-full h-full rounded-full bg-black dark:bg-white active:bg-neutral-800 dark:active:bg-neutral-200 transition-colors shadow-sm" />
            </button>
          </div>
        </div>

        {/* RIGHT SECTION: Flash Toggle & Captured Pages Preview */}
        <div className="flex items-center gap-3 sm:gap-4 flex-1 justify-end">
          {/* OPTION 3: Flash Toggle (on/off) */}
          <button
            type="button"
            onClick={handleToggleTorch}
            disabled={!hasTorch}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
              !hasTorch
                ? 'opacity-30 cursor-not-allowed text-text-disabled dark:text-white/50'
                : isTorchOn
                ? 'bg-amber-500 text-black shadow-md cursor-pointer active:scale-90'
                : 'text-text-muted hover:text-text-main dark:text-white/80 dark:hover:text-white cursor-pointer active:scale-90'
            }`}
            title={!hasTorch ? 'Flash unavailable on this device' : isTorchOn ? 'Flash is ON' : 'Flash is OFF'}
            aria-label="Toggle flash"
          >
            {isTorchOn ? (
              <Zap className="w-7 h-7 fill-current" />
            ) : (
              <ZapOff className="w-7 h-7 stroke-[1.75]" />
            )}
          </button>

          {/* OPTION 4: Captured Pages Preview & Count (Click opens adjustment/review screen) */}
          <button
            type="button"
            onClick={() => {
              if (totalCount > 0) {
                turnOffTorch();
                if (onOpenReview) {
                  onOpenReview();
                } else if (sessionCapturedFiles.length > 0) {
                  onCapturePages(sessionCapturedFiles, sessionCapturedItems);
                  onClose();
                }
              }
            }}
            disabled={totalCount === 0}
            className={`relative w-11 h-14 rounded-none overflow-hidden border flex items-center justify-center transition-all cursor-pointer active:scale-90 ${
              totalCount > 0
                ? 'border-accent bg-surface-panel shadow-md hover:border-accent-hover text-accent'
                : 'border-surface-border dark:border-white/20 bg-surface-subtle dark:bg-white/5 opacity-40 cursor-default text-text-muted dark:text-white/40'
            }`}
            title={totalCount > 0 ? `Review ${totalCount} captured pages` : 'No pages captured'}
            aria-label="Review captured pages"
          >
            {lastThumbUrl ? (
              <img src={lastThumbUrl} alt="Last scan" className="w-full h-full object-cover" />
            ) : (
              <FileText className="w-5 h-5 text-text-muted dark:text-white/50" />
            )}

            {/* Page Count Badge: Visible subtle number without thick solid background */}
            {totalCount > 0 && (
              <div className="absolute top-1 right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-black/60 backdrop-blur-[2px] text-white font-mono text-[10px] font-bold border border-white/25 flex items-center justify-center leading-none shadow-sm pointer-events-none">
                {totalCount}
              </div>
            )}
          </button>
        </div>
      </div>

      {/* DISCARD SCAN CONFIRMATION WARNING MODAL */}
      {showDiscardConfirm && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-sheet bg-surface-panel border border-surface-border p-5 shadow-lifted text-center space-y-4"
          >
            <div className="space-y-1.5">
              <h3 className="font-semibold text-md text-text-main">
                Discard scan?
              </h3>
              <p className="text-sm text-text-muted">
                You have {totalCount} scanned {totalCount === 1 ? 'page' : 'pages'} that will be discarded.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDiscardConfirm(false)}
                className="flex-1 min-h-[44px] px-4 rounded-control border border-surface-border bg-surface-subtle hover:bg-surface-hover text-text-main font-semibold text-sm transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDiscard}
                className="flex-1 min-h-[44px] px-4 rounded-control bg-status-error hover:opacity-90 text-white font-semibold text-sm transition-colors cursor-pointer"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};

export default CameraViewfinder;
