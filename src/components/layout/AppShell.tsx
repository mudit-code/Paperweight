import React, { useState, useEffect, useRef, useCallback } from 'react';
import { toolRegistry } from '../../core/tools/registry';
import type { ToolManifest, ToolProps } from '../../core/tools/types';
import type { ProcessedFile, ProgressReport } from '../../core/types';
import { CancellationTokenSource } from '../../core/worker/cancellation';
import { processors, type BatchResult } from '../../core/processors';
import type { SizeEstimate } from '../../core/processors/estimate-size';
import { toUserFacingError, type UserFacingError, OperationCancelledError } from '../../core/errors';
import { isMobileApp } from '../../core/processors/download';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { OptionsPanel } from './OptionsPanel';
import { MobileNavBar } from './MobileNavBar';
import { SettingsModal } from '../settings/SettingsModal';
import { ScannedDocsHome } from '../scanner/ScannedDocsHome';
import { CameraViewfinder } from '../../tools/scanner/CameraViewfinder';
import { DocumentEditorModal } from '../../tools/scanner/DocumentEditorModal';
import { convertFilesToImagePages } from '../../tools/scanner/convert-pdf-pages';
import type { StoredScanDoc } from '../../tools/scanner/scans-db';
import { PWAUpdateToast } from '../ui/PWAUpdateToast';
import { PdfViewerModal } from '../ui/PdfViewerModal';
import { ImageGalleryModal, type GalleryItem } from '../ui/ImageGalleryModal';
import type { DesktopIncomingFile } from '../../vite-env';
import { FEATURE_FLAGS } from '../../core/config/feature-flags';

// Direct, reliable component imports for all tools
import ConverterTool from '../../tools/converter/ConverterTool';
import ImageToPdfTool from '../../tools/image-to-pdf/ImageToPdfTool';
import PdfToImageTool from '../../tools/pdf-to-image/PdfToImageTool';
import PdfMergeTool from '../../tools/pdf-merge/PdfMergeTool';
import ImageResizerTool from '../../tools/image-resizer/ImageResizerTool';
import ResizerTool from '../../tools/resizer/ResizerTool';
import ScannerTool from '../../tools/scanner/ScannerTool';
import { LibraryView } from '../../tools/library/LibraryView';
import { MoveToLibraryModal } from '../ui/MoveToLibraryModal';
import { LibraryToast } from '../ui/LibraryToast';
import {
  saveLibraryAssets,
  deleteLibraryAssets,
  getLibraryAssetCount,
  mapToolToLibraryCategory,
  type LibraryAsset,
  type LibrarySection,
  type LibraryCategory,
  type DraftWorkspaceSnapshot,
} from '../../core/library/library-db';

function buildWorkspaceSignature(files: ProcessedFile[], options: Record<string, unknown>): string {
  const fileSig = files.map((f) => `${f.id}:${f.name}:${f.size}`).join('|');
  let optsSig = '';
  try {
    optsSig = JSON.stringify(options);
  } catch {
    optsSig = String(Object.keys(options).length);
  }
  return `${fileSig}::${optsSig}`;
}

const TOOL_COMPONENTS: Record<string, React.ComponentType<ToolProps>> = {
  'converter': ConverterTool,
  'pdf-merge': PdfMergeTool,
  'image-resizer': ImageResizerTool,
  'resizer': ResizerTool,
  'scanner': ScannerTool,
  'image-to-pdf': ImageToPdfTool,
  'pdf-to-image': PdfToImageTool,
};

function base64ToBlob(base64Data: string, mimeType = 'application/pdf'): Blob {
  const base64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export const AppShell: React.FC = () => {
  // Detect if running on Electron desktop app
  const isElectron =
    typeof window !== 'undefined' && Boolean((window as unknown as { electronAPI?: unknown }).electronAPI);

  // Detect if running on mobile device (Android/Capacitor). Desktop apps (Electron and desktop browsers) are false.
  const isMobile = isMobileApp() && !isElectron;

  const [tools, setTools] = useState<ToolManifest[]>(() => toolRegistry.getAll());
  const [activeToolId, setActiveToolId] = useState<string>('scans');
  const previousToolIdRef = useRef<string>('scans');
  const [isSidebarOpenMobile, setIsSidebarOpenMobile] = useState<boolean>(false);
  const [isOptionsOpenMobile, setIsOptionsOpenMobile] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  // Camera & Scan Editor Global Overlays
  const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false);
  const [isEditorOpen, setIsEditorOpen] = useState<boolean>(false);
  const [cameraCapturedFiles, setCameraCapturedFiles] = useState<File[]>([]);
  const [editingScan, setEditingScan] = useState<StoredScanDoc | null>(null);
  const [retakeIndex, setRetakeIndex] = useState<number | null>(null);
  const [scansRefreshKey, setScansRefreshKey] = useState<number>(0);
  const isScanningOrEditing = isCameraOpen || isEditorOpen;

  // Hidden inputs for file import
  const scanImageInputRef = useRef<HTMLInputElement>(null);
  const scanPdfInputRef = useRef<HTMLInputElement>(null);
  const desktopScanFilesInputRef = useRef<HTMLInputElement>(null);
  const desktopReplaceFileInputRef = useRef<HTMLInputElement>(null);
  const resizerFileInputRef = useRef<HTMLInputElement>(null);

  // Active Tool State
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [options, setOptions] = useState<Record<string, unknown>>({});
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progress, setProgress] = useState<ProgressReport | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState<UserFacingError | null>(null);
  const [sizeEstimate] = useState<SizeEstimate | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

  // Library & Tab Navigation Interception State
  const [libraryAssetCount, setLibraryAssetCount] = useState<number>(0);
  const [pendingNavToolId, setPendingNavToolId] = useState<string | null>(null);
  const [isMoveToLibraryOpen, setIsMoveToLibraryOpen] = useState<boolean>(false);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const lastSavedSignatureRef = useRef<string | null>(null);

  // Gmail-style Library Toast state (5-second undo & dismiss)
  const [libraryToast, setLibraryToast] = useState<{
    isOpen: boolean;
    message: string;
    assetIds: string[];
  }>({
    isOpen: false,
    message: '',
    assetIds: [],
  });

  const addAssetsToLibraryWithToast = async (
    items: Array<{
      id?: string;
      name: string;
      type?: string;
      size: number;
      data: ArrayBuffer;
      section?: LibrarySection;
      category?: LibraryCategory;
      draftSnapshot?: DraftWorkspaceSnapshot;
    }>,
    customMessage?: string
  ) => {
    try {
      const saved = await saveLibraryAssets(items);
      const count = await getLibraryAssetCount();
      setLibraryAssetCount(count);
      const ids = saved.map((s) => s.id);
      const isSingle = ids.length === 1;
      setLibraryToast({
        isOpen: true,
        message: customMessage || (isSingle ? 'Added to library' : `${ids.length} assets added to library`),
        assetIds: ids,
      });
    } catch (err) {
      console.error('Failed to auto-add to library:', err);
    }
  };

  const handleUndoLibraryToast = async () => {
    if (libraryToast.assetIds.length > 0) {
      try {
        await deleteLibraryAssets(libraryToast.assetIds);
        const count = await getLibraryAssetCount();
        setLibraryAssetCount(count);
      } catch (err) {
        console.error('Failed to undo library addition:', err);
      }
    }
    setLibraryToast({ isOpen: false, message: '', assetIds: [] });
  };

  // Load initial library count
  useEffect(() => {
    getLibraryAssetCount().then(setLibraryAssetCount).catch(() => {});
  }, []);

  // Cancellation source for ongoing jobs
  const cancelSourceRef = useRef<CancellationTokenSource | null>(null);

  // Synchronize tools list if registry changes dynamically
  useEffect(() => {
    setTools(toolRegistry.getAll());
  }, []);

  // Handle external incoming shared images (from Android Gallery / Photos share sheet)
  const handleIncomingSharedImages = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const bridge = (window as unknown as {
      AndroidBridge?: {
        getPendingSharedImages?: () => string;
        clearPendingSharedImages?: () => void;
      };
    }).AndroidBridge;
    if (!bridge || !bridge.getPendingSharedImages) return;

    try {
      const jsonStr = bridge.getPendingSharedImages();
      if (!jsonStr || jsonStr.trim() === '') return;

      const items: Array<{ name: string; dataUrl: string; mimeType: string }> = JSON.parse(jsonStr);
      if (!Array.isArray(items) || items.length === 0) return;

      const newFiles: File[] = items.map((item, idx) => {
        const mime = item.mimeType || 'image/jpeg';
        const blob = base64ToBlob(item.dataUrl, mime);
        const fileName = item.name || `shared_doc_${idx + 1}.jpg`;
        return new File([blob], fileName, {
          type: mime,
          lastModified: Date.now(),
        });
      });

      if (newFiles.length > 0) {
        bridge.clearPendingSharedImages?.();
        setCameraCapturedFiles(newFiles);
        setEditingScan(null);
        setRetakeIndex(null);
        setIsCameraOpen(false);
        setIsEditorOpen(true);
      }
    } catch (err) {
      console.error('Failed to process incoming shared images:', err);
    }
  }, []);

  // Synchronous detection of incoming PDF on cold start (eliminates pre-screen flash/glitch)
  const [initialPendingPdfName] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const bridge = (window as unknown as {
        AndroidBridge?: {
          hasPendingPdf?: () => boolean;
          getPendingPdfName?: () => string;
        };
      }).AndroidBridge;
      if (bridge?.hasPendingPdf?.()) {
        return bridge.getPendingPdfName?.() || 'Document.pdf';
      }
    }
    return null;
  });

  // PDF Viewer state for incoming opened/shared PDFs
  const [openedPdf, setOpenedPdf] = useState<{ blob: Blob; name: string } | null>(null);
  const [isOpeningIncomingPdf, setIsOpeningIncomingPdf] = useState<boolean>(() => Boolean(initialPendingPdfName));
  const skipToolResetRef = useRef(false);

  // Image Gallery Viewer state for incoming opened images or in-app gallery inspection
  const [galleryImages, setGalleryImages] = useState<GalleryItem[]>([]);
  const [isGalleryOpen, setIsGalleryOpen] = useState<boolean>(false);
  const [galleryInitialIndex, setGalleryInitialIndex] = useState<number>(0);

  // Virtual keyboard visibility detection (smoothly hides MobileNavBar without unmounting)
  const [isKeyboardOpen, setIsKeyboardOpen] = useState<boolean>(false);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('keyboard-open', isKeyboardOpen);
    }
  }, [isKeyboardOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        setIsKeyboardOpen(true);
        setTimeout(() => {
          if (window.scrollY !== 0 || window.scrollX !== 0) {
            window.scrollTo(0, 0);
          }
          target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          if (window.scrollY !== 0 || window.scrollX !== 0) {
            window.scrollTo(0, 0);
          }
        }, 100);
      }
    };

    const handleFocusOut = () => {
      setTimeout(() => {
        if (window.scrollY !== 0 || window.scrollX !== 0) {
          window.scrollTo(0, 0);
        }
        if (!window.visualViewport || (window.innerHeight - window.visualViewport.height) <= 100) {
          setIsKeyboardOpen(false);
        }
      }, 100);
    };

    const handleViewportResize = () => {
      if (window.visualViewport) {
        const diff = window.innerHeight - window.visualViewport.height;
        const isOpen = diff > 100;
        setIsKeyboardOpen(isOpen);

        if (isOpen) {
          if (window.scrollY !== 0 || window.scrollX !== 0) {
            window.scrollTo(0, 0);
          }
          const active = document.activeElement as HTMLElement | null;
          if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
            setTimeout(() => {
              if (window.scrollY !== 0 || window.scrollX !== 0) {
                window.scrollTo(0, 0);
              }
              active.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              if (window.scrollY !== 0 || window.scrollX !== 0) {
                window.scrollTo(0, 0);
              }
            }, 60);
          }
        }
      }
    };

    const handleWindowScroll = () => {
      if (window.scrollY !== 0 || window.scrollX !== 0) {
        window.scrollTo(0, 0);
      }
    };

    window.addEventListener('scroll', handleWindowScroll, { passive: true });
    window.addEventListener('focusin', handleFocusIn);
    window.addEventListener('focusout', handleFocusOut);
    window.visualViewport?.addEventListener('resize', handleViewportResize);

    return () => {
      window.removeEventListener('scroll', handleWindowScroll);
      window.removeEventListener('focusin', handleFocusIn);
      window.removeEventListener('focusout', handleFocusOut);
      window.visualViewport?.removeEventListener('resize', handleViewportResize);
    };
  }, []);

  const handleViewImages = useCallback((images: GalleryItem[], initialIndex = 0) => {
    setGalleryImages(images);
    setGalleryInitialIndex(initialIndex);
    setIsGalleryOpen(true);
  }, []);

  const handleIncomingPdf = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const win = window as unknown as {
      AndroidBridge?: {
        getPendingPdf?: () => string;
        clearPendingPdf?: () => void;
        readCachedPdfBase64?: () => string;
      };
      Capacitor?: {
        convertFileSrc?: (filePath: string) => string;
      };
    };
    const bridge = win.AndroidBridge;
    if (!bridge || !bridge.getPendingPdf) return;

    try {
      const jsonStr = bridge.getPendingPdf();
      if (!jsonStr || jsonStr.trim() === '') return;

      const item = JSON.parse(jsonStr);
      if (!item) return;

      let blob: Blob | null = null;

      // Strategy 1: Fast in-memory Base64 embedded in JSON
      if (item.base64) {
        blob = base64ToBlob(item.base64, 'application/pdf');
      }

      // Strategy 2: Stream from local disk file using Capacitor bridge
      if (!blob && item.filePath && win.Capacitor?.convertFileSrc) {
        try {
          const fileUrl = win.Capacitor.convertFileSrc(item.filePath);
          const resp = await fetch(fileUrl);
          if (resp.ok) {
            blob = await resp.blob();
          }
        } catch (e) {
          console.warn('Capacitor convertFileSrc failed, falling back:', e);
        }
      }

      // Strategy 3: Read via native bridge helper method readCachedPdfBase64
      if (!blob && bridge.readCachedPdfBase64) {
        const b64 = bridge.readCachedPdfBase64();
        if (b64 && b64.length > 0) {
          blob = base64ToBlob(b64, 'application/pdf');
        }
      }

      // Strategy 4: Fallback dataUrl
      if (!blob && item.dataUrl) {
        blob = base64ToBlob(item.dataUrl, 'application/pdf');
      }

      if (blob && blob.size > 0) {
        bridge.clearPendingPdf?.();
        setIsOpeningIncomingPdf(false);
        setIsCameraOpen(false);
        setIsEditorOpen(false);
        setOpenedPdf({ blob, name: item.name || initialPendingPdfName || 'document.pdf' });
      }
    } catch (err) {
      console.error('Failed to process incoming PDF:', err);
    }
  }, []);

  const handleCompressPdfFromViewer = useCallback((blob: Blob, fileName: string) => {
    blob.arrayBuffer().then((buf) => {
      const pf: ProcessedFile = {
        id: `file_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        name: fileName,
        type: 'application/pdf',
        size: blob.size,
        data: buf,
        lastModified: Date.now(),
      };
      skipToolResetRef.current = true;
      setOpenedPdf(null);
      setFiles([pf]);
      setResult(null);
      setError(null);
      setProgress(null);
      setOptions((prev) => ({
        ...prev,
        compressorMode: 'pdf',
        compressionPreset: 'balanced',
        compressionLevel: 40,
      }));
      setActiveToolId('image-resizer');
    });
  }, []);

  // Handle desktop (Electron) incoming files from "Open with Paperweight" or CLI
  const handleDesktopIncomingFiles = useCallback((incomingFiles: DesktopIncomingFile[]) => {
    if (!Array.isArray(incomingFiles) || incomingFiles.length === 0) return;

    const pdfFiles: DesktopIncomingFile[] = [];
    const imageFiles: DesktopIncomingFile[] = [];

    for (const f of incomingFiles) {
      const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
      if (isPdf) {
        pdfFiles.push(f);
      } else if (f.type.startsWith('image/') || /\.(jpe?g|png|webp|avif|bmp|gif|tiff?)$/i.test(f.name)) {
        imageFiles.push(f);
      }
    }

    if (pdfFiles.length > 0) {
      const first = pdfFiles[0];
      const blob = new Blob([first.buffer], { type: 'application/pdf' });
      setIsCameraOpen(false);
      setIsEditorOpen(false);
      setIsGalleryOpen(false);
      setOpenedPdf({ blob, name: first.name });
    }

    if (imageFiles.length > 0) {
      const isResizeAction = imageFiles.some((f) => f.action === 'resize');
      const isCompressAction = imageFiles.some((f) => f.action === 'compress');

      if (isResizeAction) {
        const processed: ProcessedFile[] = imageFiles.map((f, idx) => ({
          id: `img_resize_${Date.now()}_${idx}`,
          name: f.name,
          type: f.type || 'image/jpeg',
          size: f.size,
          data: f.buffer,
          previewUrl: URL.createObjectURL(new Blob([f.buffer], { type: f.type || 'image/jpeg' })),
          lastModified: Date.now(),
        }));
        skipToolResetRef.current = true;
        setIsGalleryOpen(false);
        setFiles(processed);
        setResult(null);
        setError(null);
        setProgress(null);
        setActiveToolId('resizer');
        return;
      }

      if (isCompressAction) {
        const processed: ProcessedFile[] = imageFiles.map((f, idx) => ({
          id: `img_compress_${Date.now()}_${idx}`,
          name: f.name,
          type: f.type || 'image/jpeg',
          size: f.size,
          data: f.buffer,
          previewUrl: URL.createObjectURL(new Blob([f.buffer], { type: f.type || 'image/jpeg' })),
          lastModified: Date.now(),
        }));
        skipToolResetRef.current = true;
        setIsGalleryOpen(false);
        setFiles(processed);
        setResult(null);
        setError(null);
        setProgress(null);
        setOptions((prev) => ({
          ...prev,
          compressorMode: 'image',
          compressionPreset: 'balanced',
          compressionLevel: 40,
        }));
        setActiveToolId('image-resizer');
        return;
      }

      const newGalleryItems: GalleryItem[] = imageFiles.map((f, idx) => {
        const mime = f.type || 'image/jpeg';
        const blob = new Blob([f.buffer], { type: mime });
        const url = URL.createObjectURL(blob);
        return {
          id: `desktop_img_${Date.now()}_${idx}`,
          name: f.name,
          size: f.size,
          type: mime,
          blob,
          url,
        };
      });

      setIsCameraOpen(false);
      setIsEditorOpen(false);
      setGalleryImages((prev) => [...prev, ...newGalleryItems]);
      setGalleryInitialIndex(0);
      setIsGalleryOpen(true);
    }
  }, []);

  // Actions from Gallery Viewer
  const handleCompressImageFromGallery = useCallback((blob: Blob, fileName: string) => {
    blob.arrayBuffer().then((buf) => {
      const pf: ProcessedFile = {
        id: `img_compress_${Date.now()}`,
        name: fileName,
        type: blob.type || 'image/jpeg',
        size: blob.size,
        data: buf,
        previewUrl: URL.createObjectURL(blob),
        lastModified: Date.now(),
      };
      skipToolResetRef.current = true;
      setIsGalleryOpen(false);
      setFiles([pf]);
      setResult(null);
      setError(null);
      setProgress(null);
      setOptions((prev) => ({
        ...prev,
        compressorMode: 'image',
        compressionPreset: 'balanced',
        compressionLevel: 40,
      }));
      setActiveToolId('image-resizer');
    });
  }, []);

  const handleResizeImageFromGallery = useCallback((blob: Blob, fileName: string) => {
    blob.arrayBuffer().then((buf) => {
      const pf: ProcessedFile = {
        id: `img_resize_${Date.now()}`,
        name: fileName,
        type: blob.type || 'image/jpeg',
        size: blob.size,
        data: buf,
        previewUrl: URL.createObjectURL(blob),
        lastModified: Date.now(),
      };
      skipToolResetRef.current = true;
      setIsGalleryOpen(false);
      setFiles([pf]);
      setResult(null);
      setError(null);
      setProgress(null);
      setActiveToolId('resizer');
    });
  }, []);

  const handleConvertImagesFromGallery = useCallback(async (galleryItems: Array<{ blob: Blob; name: string }>) => {
    const processed: ProcessedFile[] = await Promise.all(
      galleryItems.map(async (item, idx) => {
        const buf = await item.blob.arrayBuffer();
        return {
          id: `conv_${Date.now()}_${idx}`,
          name: item.name,
          type: item.blob.type || 'image/jpeg',
          size: item.blob.size,
          data: buf,
          previewUrl: URL.createObjectURL(item.blob),
          lastModified: Date.now(),
        };
      })
    );

    skipToolResetRef.current = true;
    setIsGalleryOpen(false);
    setFiles(processed);
    setResult(null);
    setError(null);
    setProgress(null);
    setOptions((prev) => ({
      ...prev,
      converterMode: 'img-to-pdf',
    }));
    setActiveToolId('converter');
  }, []);

  const handleOpenGallery = useCallback((targetFile?: ProcessedFile) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|avif|bmp|gif|tiff?)$/i.test(f.name));
    if (imageFiles.length > 0) {
      const items: GalleryItem[] = imageFiles.map((f, idx) => {
        const blob = new Blob([f.data], { type: f.type });
        return {
          id: f.id || `f_${idx}`,
          name: f.name,
          size: f.size,
          type: f.type,
          blob,
          url: f.previewUrl || URL.createObjectURL(blob),
        };
      });
      setGalleryImages(items);
      if (targetFile) {
        const targetIdx = imageFiles.findIndex((f) => f.id === targetFile.id);
        setGalleryInitialIndex(targetIdx >= 0 ? targetIdx : 0);
      } else {
        setGalleryInitialIndex(0);
      }
    }
    setIsGalleryOpen(true);
  }, [files]);
  const handleViewFile = useCallback((file: ProcessedFile) => {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      const blob = new Blob([file.data], { type: 'application/pdf' });
      setOpenedPdf({ blob, name: file.name });
    } else if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|avif|bmp|gif|tiff?)$/i.test(file.name)) {
      const imageFiles = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|avif|bmp|gif|tiff?)$/i.test(f.name));
      if (imageFiles.length > 0 && imageFiles.some((f) => f.id === file.id)) {
        handleOpenGallery(file);
      } else {
        const blob = file.data && file.data.byteLength > 0 ? new Blob([file.data], { type: file.type || 'image/png' }) : undefined;
        const item: GalleryItem = {
          id: file.id || `f_${Date.now()}`,
          name: file.name,
          size: file.size,
          type: file.type,
          blob,
          url: file.previewUrl || (blob ? URL.createObjectURL(blob) : ''),
        };
        handleViewImages([item], 0);
      }
    }
  }, [files, handleOpenGallery, handleViewImages]);

  useEffect(() => {
    // 1. Process shared images / PDF if launched via system intent (cold start)
    handleIncomingSharedImages();
    handleIncomingPdf();

    // Double check after brief delays for background IO thread reading
    const t1 = setTimeout(() => handleIncomingPdf(), 200);
    const t2 = setTimeout(() => handleIncomingPdf(), 600);
    const t3 = setTimeout(() => handleIncomingPdf(), 1200);
    const t4 = setTimeout(() => handleIncomingPdf(), 2500);

    // 2. Listen for shared images & PDFs if app was already running (warm start)
    const onShared = () => {
      handleIncomingSharedImages();
    };
    const onOpenPdf = () => {
      setIsOpeningIncomingPdf(true);
      handleIncomingPdf();
    };

    window.addEventListener('paperweightSharedImages', onShared);
    window.addEventListener('paperweightOpenPdf', onOpenPdf);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      window.removeEventListener('paperweightSharedImages', onShared);
      window.removeEventListener('paperweightOpenPdf', onOpenPdf);
    };
  }, [handleIncomingSharedImages, handleIncomingPdf]);

  // Desktop (Electron): Listen for incoming files opened with Paperweight
  useEffect(() => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      // 1. Fetch initial files from cold start
      window.electronAPI
        .getInitialFiles()
        .then((initialFiles) => {
          if (initialFiles && initialFiles.length > 0) {
            handleDesktopIncomingFiles(initialFiles);
          }
        })
        .catch((err) => {
          console.error('Failed to get initial desktop files:', err);
        });

      // 2. Listen for subsequent files from warm start / open-with
      const unsubscribe = window.electronAPI.onOpenFiles((incomingFiles) => {
        handleDesktopIncomingFiles(incomingFiles);
      });

      return () => {
        unsubscribe?.();
      };
    }
  }, [handleDesktopIncomingFiles]);

  // Window-level Drag and Drop for PDF & Images (opens in dedicated viewers)
  useEffect(() => {
    const handleWindowDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleWindowDrop = async (e: DragEvent) => {
      if (e.defaultPrevented || !e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) {
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest('[role="button"]') || target?.closest('input') || target?.closest('[role="region"]')) {
        return;
      }

      e.preventDefault();
      const dropped = Array.from(e.dataTransfer.files);
      const pdf = dropped.find((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
      const imgs = dropped.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|avif|bmp|gif|tiff?)$/i.test(f.name));

      if (pdf) {
        const buf = await pdf.arrayBuffer();
        setOpenedPdf({ blob: new Blob([buf], { type: 'application/pdf' }), name: pdf.name });
      } else if (imgs.length > 0) {
        const newItems: GalleryItem[] = await Promise.all(
          imgs.map(async (f, idx) => {
            const buf = await f.arrayBuffer();
            const blob = new Blob([buf], { type: f.type || 'image/jpeg' });
            return {
              id: `dropped_img_${Date.now()}_${idx}`,
              name: f.name,
              size: f.size,
              type: f.type,
              blob,
              url: URL.createObjectURL(blob),
            };
          })
        );
        setGalleryImages((prev) => [...prev, ...newItems]);
        setGalleryInitialIndex(0);
        setIsGalleryOpen(true);
      }
    };

    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('drop', handleWindowDrop);
    return () => {
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, []);

  // Reset tool options, result, error, and progress when switching tools
  useEffect(() => {
    if (skipToolResetRef.current) {
      skipToolResetRef.current = false;
      return;
    }
    setActiveDraftId(null);
    lastSavedSignatureRef.current = null;
    setFiles([]);
    setResult(null);
    setError(null);
    setProgress(null);
    setSelectedFileId(null);
    setIsSidebarOpenMobile(false);
    setIsOptionsOpenMobile(false);

    const manifest = toolRegistry.getById(activeToolId);
    if (manifest) {
      const defaultOpts: Record<string, unknown> = {};
      for (const opt of manifest.availableOptions) {
        defaultOpts[opt.id] = opt.defaultValue;
      }
      if (activeToolId === 'converter') {
        const isNarrowScreen = isMobile || (typeof window !== 'undefined' && window.innerWidth < 768);
        if (isNarrowScreen) {
          delete defaultOpts.converterMode;
        } else {
          defaultOpts.converterMode = 'pdf-to-img';
        }
      }
      if (activeToolId === 'image-resizer') {
        delete defaultOpts.compressorMode;
      }
      setOptions(defaultOpts);
    }
  }, [activeToolId]);

  const hasInProcessUnsavedWork = () => {
    if (files.length === 0) return false;
    if (!result) return true;
    return buildWorkspaceSignature(files, options) !== lastSavedSignatureRef.current;
  };

  const getActionWording = () => {
    if (activeToolId === 'resizer') return 'resizing';
    if (activeToolId === 'converter') return 'converting';
    if (activeToolId === 'image-resizer') return 'compressing';
    if (activeToolId === 'pdf-merge') return 'merging';
    if (activeToolId === 'scanner' || activeToolId === 'scans') return 'scanning';
    return 'current work';
  };

  const requestSelectTool = (targetId: string) => {
    if (targetId === activeToolId) return;

    if (activeToolId !== 'library') {
      previousToolIdRef.current = activeToolId;
    }

    // Prompt MoveToLibraryModal only when workspace has in-process / modified unsaved work
    if (hasInProcessUnsavedWork() && activeToolId !== 'library' && activeToolId !== 'scans') {
      setPendingNavToolId(targetId);
      setIsMoveToLibraryOpen(true);
      return;
    }

    if (result) {
      setResult(null);
      setFiles([]);
    }
    setActiveDraftId(null);
    lastSavedSignatureRef.current = null;

    setActiveToolId(targetId);
  };

  const handleConfirmExitAndMove = async () => {
    try {
      const category = mapToolToLibraryCategory(activeToolId);

      // In-process workspace (unprocessed, or modified after prior processing) -> save full Draft state
      if (files.length > 0 && (!result || buildWorkspaceSignature(files, options) !== lastSavedSignatureRef.current)) {
        let clonedOptions: Record<string, unknown>;
        try {
          clonedOptions = JSON.parse(JSON.stringify(options));
        } catch {
          clonedOptions = { ...options };
        }
        const primaryFile = files[0];
        const draftName =
          files.length > 1 ? `${primaryFile.name} (+${files.length - 1} more)` : primaryFile.name;

        await addAssetsToLibraryWithToast(
          [
            {
              id: activeDraftId || undefined,
              name: draftName,
              type: primaryFile.type,
              size: files.reduce((sum, f) => sum + f.size, 0),
              data: primaryFile.data.slice(0),
              section: 'drafts',
              category,
              draftSnapshot: {
                toolId: activeToolId,
                options: clonedOptions,
                files: files.map((f) => ({
                  id: f.id,
                  name: f.name,
                  type: f.type,
                  size: f.size,
                  lastModified: f.lastModified,
                  data: f.data.slice(0),
                })),
              },
            },
          ],
          'Moved to Library Drafts'
        );
      } else if (result?.items && result.items.length > 0) {
        const producedToSave = await Promise.all(
          result.items.map(async (item) => {
            const buffer = await item.blob.arrayBuffer();
            return {
              name: item.name,
              type: item.blob.type || (item.fileType === 'pdf' ? 'application/pdf' : 'image/jpeg'),
              size: item.compressedSize || item.blob.size,
              data: buffer,
              section: 'recent' as LibrarySection,
              category,
            };
          })
        );
        await addAssetsToLibraryWithToast(producedToSave, 'Saved to Recents');
      } else if (result?.blob) {
        const buffer = await result.blob.arrayBuffer();
        await addAssetsToLibraryWithToast(
          [
            {
              name: result.filename || 'processed_asset',
              type: result.blob.type || (result.fileType === 'pdf' ? 'application/pdf' : 'image/jpeg'),
              size: result.size || result.blob.size,
              data: buffer,
              section: 'recent',
              category,
            },
          ],
          'Saved to Recents'
        );
      }
    } catch (err) {
      console.error('Failed to move assets to library:', err);
    }

    setIsMoveToLibraryOpen(false);
    setActiveDraftId(null);
    lastSavedSignatureRef.current = null;
    setFiles([]);
    setResult(null);
    if (pendingNavToolId === '__header_back__') {
      setOptions((prev) => {
        const next = { ...prev };
        delete next.converterMode;
        delete next.compressorMode;
        return next;
      });
      setPendingNavToolId(null);
    } else if (pendingNavToolId) {
      setActiveToolId(pendingNavToolId);
      setPendingNavToolId(null);
    }
  };

  const handleConfirmExitWithoutSaving = () => {
    setIsMoveToLibraryOpen(false);
    setActiveDraftId(null);
    lastSavedSignatureRef.current = null;
    setFiles([]);
    setResult(null);
    if (pendingNavToolId === '__header_back__') {
      setOptions((prev) => {
        const next = { ...prev };
        delete next.converterMode;
        delete next.compressorMode;
        return next;
      });
      setPendingNavToolId(null);
    } else if (pendingNavToolId) {
      setActiveToolId(pendingNavToolId);
      setPendingNavToolId(null);
    }
  };

  const handleCancelMoveToLibrary = () => {
    setIsMoveToLibraryOpen(false);
    setPendingNavToolId(null);
  };

  const handleOpenAssetInTool = (
    targetToolId: string,
    filesToLoad: ProcessedFile[],
    initialOptions?: Record<string, unknown>
  ) => {
    skipToolResetRef.current = true;
    setActiveDraftId(null);
    lastSavedSignatureRef.current = null;
    setResult(null);
    setError(null);
    setProgress(null);
    setFiles(filesToLoad);
    if (initialOptions) {
      setOptions((prev) => ({ ...prev, ...initialOptions }));
    }
    setActiveToolId(targetToolId);
  };

  const handleResumeDraft = (asset: LibraryAsset) => {
    if (asset.draftSnapshot) {
      const snap = asset.draftSnapshot;
      const restoredFiles: ProcessedFile[] = snap.files.map((f) => {
        const dataCopy = f.data.slice(0);
        const isImg = f.type.startsWith('image/');
        return {
          id: f.id,
          name: f.name,
          type: f.type,
          size: f.size,
          lastModified: f.lastModified,
          data: dataCopy,
          previewUrl: isImg ? URL.createObjectURL(new Blob([dataCopy], { type: f.type })) : undefined,
        };
      });

      skipToolResetRef.current = true;
      setActiveDraftId(asset.id);
      lastSavedSignatureRef.current = null;
      setResult(null);
      setError(null);
      setProgress(null);
      setFiles(restoredFiles);
      setOptions({ ...snap.options });
      setActiveToolId(snap.toolId);
      return;
    }

    // Fallback for drafts without snapshot: infer tool from category & asset kind
    const dataCopy = asset.data.slice(0);
    const pf: ProcessedFile = {
      id: `f_draft_${Date.now()}`,
      name: asset.name,
      type: asset.type,
      size: asset.size,
      lastModified: asset.createdAt,
      data: dataCopy,
      previewUrl: asset.kind === 'image' ? URL.createObjectURL(new Blob([dataCopy], { type: asset.type })) : undefined,
    };

    if (asset.category === 'compression') {
      handleOpenAssetInTool('image-resizer', [pf], { compressorMode: asset.kind === 'pdf' ? 'pdf' : 'image' });
    } else if (asset.category === 'merges') {
      handleOpenAssetInTool('pdf-merge', [pf]);
    } else if (asset.category === 'resizes' && asset.kind === 'image') {
      handleOpenAssetInTool('resizer', [pf]);
    } else {
      handleOpenAssetInTool('converter', [pf], { converterMode: asset.kind === 'pdf' ? 'pdf-to-img' : 'img-to-pdf' });
    }
  };

  // Alt+<number> shortcut handler: disabled when focused on inputs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

      const activeEl = document.activeElement;
      if (activeEl) {
        const tag = activeEl.tagName.toLowerCase();
        if (
          tag === 'input' ||
          tag === 'textarea' ||
          tag === 'select' ||
          activeEl.getAttribute('contenteditable') === 'true' ||
          activeEl.hasAttribute('data-no-shortcut')
        ) {
          return;
        }
      }

      const digit = parseInt(e.key, 10);
      if (!isNaN(digit) && digit >= 1 && digit <= 9) {
        const targetTool = toolRegistry.getByShortcutIndex(digit);
        if (targetTool) {
          e.preventDefault();
          requestSelectTool(targetTool.id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [files.length, activeToolId]);

  // Android hardware back button & system navigation handler
  useEffect(() => {
    const handleAppBack = (e: Event) => {
      // 1. If MoveToLibraryModal is open, dismiss it
      if (isMoveToLibraryOpen) {
        setIsMoveToLibraryOpen(false);
        setPendingNavToolId(null);
        e.preventDefault();
        return;
      }

      // 2. If settings modal is open, dismiss it
      if (isSettingsOpen) {
        setIsSettingsOpen(false);
        e.preventDefault();
        return;
      }

      // 3. If there are in-process unsaved files in current tool, prompt MoveToLibraryModal (Drafts)
      if (hasInProcessUnsavedWork() && activeToolId !== 'library' && activeToolId !== 'scans') {
        setPendingNavToolId('converter');
        setIsMoveToLibraryOpen(true);
        e.preventDefault();
        return;
      }

      // 4. If in a secondary tool, return to home (converter)
      if (activeToolId !== 'converter') {
        setActiveToolId('converter');
        e.preventDefault();
        return;
      }
    };

    window.addEventListener('paperweight:back', handleAppBack);
    return () => window.removeEventListener('paperweight:back', handleAppBack);
  }, [isMoveToLibraryOpen, isSettingsOpen, files, options, result, activeToolId]);

  const activeManifest = toolRegistry.getById(activeToolId) || tools[0];
  const ActiveToolComponent = TOOL_COMPONENTS[activeToolId] || ImageToPdfTool;

  const handleExecute = async () => {
    if (files.length === 0 || isProcessing) return;

    setIsProcessing(true);
    setError(null);
    setResult(null);

    setProgress({
      taskId: 'task_exec',
      phase: 'Preparing batch',
      current: 0,
      total: files.length,
      percentage: 5,
      message: 'Initializing local processing...',
    });

    const cancelSource = new CancellationTokenSource();
    cancelSourceRef.current = cancelSource;

    try {
      const processor = processors[activeToolId];
      if (!processor) {
        throw new Error(`Processor for "${activeManifest.name}" is not implemented.`);
      }

      // Execute on-device processing
      const batchResult = await processor(
        files,
        options,
        (rep) => {
          setProgress(rep);
        },
        cancelSource.token
      );

      setResult(batchResult);
      lastSavedSignatureRef.current = buildWorkspaceSignature(files, options);

      // Auto-save produced image or PDF to Library -> Recently Processed
      try {
        const category = mapToolToLibraryCategory(activeToolId);
        const producedToSave: Array<{
          name: string;
          type: string;
          size: number;
          data: ArrayBuffer;
          section: LibrarySection;
          category: LibraryCategory;
        }> = [];

        if (batchResult.items && batchResult.items.length > 0) {
          for (const item of batchResult.items) {
            if (item.blob) {
              const buffer = await item.blob.arrayBuffer();
              producedToSave.push({
                name: item.name || 'processed_asset',
                type: item.blob.type || (item.fileType === 'pdf' ? 'application/pdf' : 'image/jpeg'),
                size: item.compressedSize || item.blob.size,
                data: buffer,
                section: 'recent',
                category,
              });
            }
          }
        } else if (batchResult.blob) {
          const buffer = await batchResult.blob.arrayBuffer();
          producedToSave.push({
            name: batchResult.filename || 'processed_asset',
            type: batchResult.blob.type || (batchResult.fileType === 'pdf' ? 'application/pdf' : 'image/jpeg'),
            size: batchResult.size || batchResult.blob.size,
            data: buffer,
            section: 'recent',
            category,
          });
        }

        if (producedToSave.length > 0) {
          await addAssetsToLibraryWithToast(
            producedToSave,
            producedToSave.length === 1
              ? 'Saved to Recents'
              : `${producedToSave.length} items saved to Recents`
          );
        }

        if (activeDraftId) {
          await deleteLibraryAssets([activeDraftId]);
          const count = await getLibraryAssetCount();
          setLibraryAssetCount(count);
          setActiveDraftId(null);
        }
      } catch (saveErr) {
        console.error('Auto-save to library failed:', saveErr);
      }

      // Allow smooth transition to reach 100% before dismissing progress display
      setTimeout(() => {
        setIsProcessing(false);
        setProgress(null);
      }, 350);
    } catch (err) {
      if (err instanceof OperationCancelledError) {
        setProgress(null);
      } else {
        console.error('Execution error:', err);
        setError(toUserFacingError(err));
      }
      setIsProcessing(false);
      setProgress(null);
    } finally {
      cancelSourceRef.current = null;
    }
  };

  const handleCancel = () => {
    if (cancelSourceRef.current) {
      cancelSourceRef.current.cancel();
      cancelSourceRef.current = null;
    }
    setIsProcessing(false);
    setProgress(null);
  };

  const isNarrowViewport = isMobile || (typeof window !== 'undefined' && window.innerWidth < 768);
  const canGoBack =
    isNarrowViewport && (
      (activeToolId === 'converter' && Boolean(options.converterMode)) ||
      (activeToolId === 'image-resizer' && Boolean(options.compressorMode)) ||
      (activeToolId === 'resizer' && files.length > 0)
    );

  const handleHeaderBack = () => {
    if (
      hasInProcessUnsavedWork() &&
      ((activeToolId === 'converter' && Boolean(options.converterMode)) ||
        (activeToolId === 'image-resizer' && Boolean(options.compressorMode)) ||
        (activeToolId === 'resizer' && files.length > 0))
    ) {
      setPendingNavToolId('__header_back__');
      setIsMoveToLibraryOpen(true);
      return;
    }

    if (activeToolId === 'converter' && options.converterMode) {
      setOptions((prev) => {
        const next = { ...prev };
        delete next.converterMode;
        return next;
      });
      setActiveDraftId(null);
      lastSavedSignatureRef.current = null;
      setFiles([]);
      if (result) setResult(null);
      if (error) setError(null);
    } else if (activeToolId === 'image-resizer' && options.compressorMode) {
      setOptions((prev) => {
        const next = { ...prev };
        delete next.compressorMode;
        return next;
      });
      setActiveDraftId(null);
      lastSavedSignatureRef.current = null;
      setFiles([]);
      if (result) setResult(null);
      if (error) setError(null);
    } else if (activeToolId === 'resizer' && files.length > 0) {
      if (options.resizerStep === 'crop') {
        setOptions((prev) => ({ ...prev, resizerStep: 'settings' }));
        if (result) setResult(null);
      } else {
        setActiveDraftId(null);
        lastSavedSignatureRef.current = null;
        setFiles([]);
        if (result) setResult(null);
        if (error) setError(null);
      }
    }
  };

  // Android hardware back button and gesture navigation handler
  useEffect(() => {
    const handleGlobalBack = (e: Event) => {
      // Respect handlers that already consumed the event (e.g., PdfViewerModal)
      if (e.defaultPrevented) {
        return;
      }

      // If camera, editor, or in-app PDF viewer modal is open, they handle it via dedicated listeners
      if (
        isEditorOpen ||
        isCameraOpen ||
        Boolean(document.querySelector('[data-pdf-modal="true"]'))
      ) {
        return;
      }

      if (isMoveToLibraryOpen) {
        e.preventDefault();
        setIsMoveToLibraryOpen(false);
        setPendingNavToolId(null);
        return;
      }

      if (openedPdf) {
        e.preventDefault();
        setOpenedPdf(null);
        return;
      }

      if (isGalleryOpen) {
        e.preventDefault();
        setIsGalleryOpen(false);
        return;
      }

      if (isSettingsOpen) {
        e.preventDefault();
        setIsSettingsOpen(false);
        return;
      }

      if (isOptionsOpenMobile) {
        e.preventDefault();
        setIsOptionsOpenMobile(false);
        return;
      }

      if (activeToolId === 'converter' && Boolean(options.converterMode)) {
        e.preventDefault();
        handleHeaderBack();
        return;
      }

      if (activeToolId === 'image-resizer' && Boolean(options.compressorMode)) {
        e.preventDefault();
        handleHeaderBack();
        return;
      }

      if (activeToolId === 'resizer' && files.length > 0) {
        e.preventDefault();
        handleHeaderBack();
        return;
      }

      if (activeToolId !== 'scans') {
        e.preventDefault();
        requestSelectTool('scans');
        return;
      }
    };

    window.addEventListener('hardwareBackPress', handleGlobalBack);
    return () => window.removeEventListener('hardwareBackPress', handleGlobalBack);
  }, [
    isEditorOpen,
    isCameraOpen,
    isMoveToLibraryOpen,
    isSettingsOpen,
    isOptionsOpenMobile,
    activeToolId,
    options,
    openedPdf,
    isGalleryOpen,
    files,
    result,
  ]);

  const getToolDisplayName = () => {
    if (activeToolId === 'scans') return 'Scans';
    if (activeToolId === 'library') return 'Library';
    if (activeToolId === 'pdf-merge') return 'Merge';
    if (activeToolId === 'converter') {
      const mode = options.converterMode as string | undefined;
      if (mode === 'pdf-to-img') return 'PDF to Image';
      if (mode === 'img-to-pdf') return 'Image to PDF';
      if (mode === 'img-to-img') return 'Convert Images';
      if (FEATURE_FLAGS.ENABLE_OFFICE_CONVERTER) {
        if (mode === 'word-to-pdf') return 'Word to PDF';
        if (mode === 'excel-to-pdf') return 'Excel to PDF';
        if (mode === 'ppt-to-pdf') return 'PowerPoint to PDF';
      }
      return 'Converter';
    }
    if (activeToolId === 'image-resizer') {
      const mode = options.compressorMode as string | undefined;
      if (mode === 'pdf') return 'Compress PDF';
      if (mode === 'image') return 'Compress Images';
      if (mode === 'doc') return 'Compress Documents';
      return 'Compress';
    }
    if (activeToolId === 'resizer') {
      return 'Image Resizer';
    }
    return activeManifest?.name;
  };

  const isSelectingOption =
    (activeToolId === 'converter' && isNarrowViewport && !options.converterMode) ||
    (activeToolId === 'image-resizer' && isNarrowViewport && !options.compressorMode);

  const shouldShowOptionsPanel =
    activeToolId !== 'scans' && activeToolId !== 'library' && !isSelectingOption && Boolean(activeManifest);

  return (
    <div className="fixed inset-0 flex flex-col h-full w-full overflow-hidden bg-surface-bg text-text-main font-sans">
      {/* Main Workspace Frame */}
      <div className="flex flex-1 overflow-hidden min-h-0 relative">
        {/* Left Persistent Tools Sidebar (Full height) */}
        <Sidebar
          tools={tools}
          activeToolId={activeToolId}
          onSelectTool={requestSelectTool}
          isOpenMobile={isSidebarOpenMobile}
          onCloseMobile={() => setIsSidebarOpenMobile(false)}
          libraryCount={libraryAssetCount}
        />

        {/* Right Column: Top Header + Workspace Canvas (Hidden during full-screen camera/editor scanning) */}
        <div className={`flex-1 flex flex-col min-w-0 h-full overflow-hidden ${isScanningOrEditing ? 'hidden' : ''}`}>
        {/* Top Header of the Workspace Area (permanently fixed at top, never scrolls) */}
        {activeToolId !== 'library' && (
          <div className="shrink-0 sticky top-0 z-20 w-full">
            <Header
              activeToolName={getToolDisplayName()}
              hasOptionsPanel={shouldShowOptionsPanel}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onOpenLibrary={() => requestSelectTool('library')}
              libraryCount={libraryAssetCount}
              onToggleSidebar={isMobileApp() ? undefined : () => setIsSidebarOpenMobile(true)}
              canGoBack={canGoBack}
              onBack={handleHeaderBack}
              backTooltip={
                activeToolId === 'image-resizer'
                  ? 'Back to Compressors'
                  : activeToolId === 'resizer'
                  ? 'Back to Image Resizer'
                  : 'Back to Converters'
              }
            />
          </div>
        )}

        {/* Main 2-Pane Workspace */}
        <div className="flex flex-1 overflow-hidden relative">
          {/* Center Primary Workspace */}
          <main
            role="main"
            className={`flex-1 flex flex-col min-w-0 ${
              activeToolId === 'resizer' || activeToolId === 'scans' || activeToolId === 'library' || (isMobile && activeToolId === 'image-resizer') || (isMobile && activeToolId === 'pdf-merge') || (isMobile && activeToolId === 'converter' && Boolean(options.converterMode))
                ? 'p-0 bg-surface-bg overflow-hidden h-full'
                : `bg-surface-bg overflow-y-auto pl-[var(--safe-area-left)] pr-[var(--safe-area-right)] ${
                    isMobile
                      ? 'pb-[calc(4.5rem+var(--safe-area-bottom))] lg:pb-0'
                      : 'pb-6 lg:pb-6'
                  } p-2 sm:p-3 lg:p-6`
            }`}
          >
            {activeToolId === 'scans' ? (
              <ScannedDocsHome
                key={scansRefreshKey}
                onStartNewScan={() => {
                  if (isMobileApp()) {
                    setCameraCapturedFiles([]);
                    setEditingScan(null);
                    setIsCameraOpen(true);
                  } else {
                    desktopScanFilesInputRef.current?.click();
                  }
                }}
                onAddFiles={async (newFiles) => {
                  const converted = await convertFilesToImagePages(newFiles);
                  if (converted.length === 0) return;
                  setCameraCapturedFiles(converted);
                  setEditingScan(null);
                  setRetakeIndex(null);
                  setIsCameraOpen(false);
                  setIsEditorOpen(true);
                }}
                onModifyScan={(scan) => {
                  setEditingScan(scan);
                  setCameraCapturedFiles([]);
                  setIsEditorOpen(true);
                }}
                onViewPdf={(blob, name) => setOpenedPdf({ blob, name })}
              />
            ) : activeToolId === 'library' ? (
              <LibraryView
                onBack={() => requestSelectTool(previousToolIdRef.current || 'scans')}
                onOpenInTool={handleOpenAssetInTool}
                onResumeDraft={handleResumeDraft}
                onViewPdf={(blob, name) => setOpenedPdf({ blob, name })}
                onViewImages={(images, initialIndex = 0) => {
                  setGalleryImages(images);
                  setGalleryInitialIndex(initialIndex);
                  setIsGalleryOpen(true);
                }}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onToggleSidebar={isMobileApp() ? undefined : () => setIsSidebarOpenMobile(true)}
                onAssetCountChange={setLibraryAssetCount}
              />
            ) : (
              <ActiveToolComponent
                files={files}
                onFilesChange={setFiles}
                options={options}
                onOptionsChange={setOptions}
                isProcessing={isProcessing}
                progress={progress}
                result={result}
                onDismissResult={() => setResult(null)}
                error={error}
                onDismissError={() => setError(null)}
                sizeEstimate={sizeEstimate}
                onExecute={handleExecute}
                onCancel={handleCancel}
                selectedFileId={selectedFileId}
                onSelectFile={setSelectedFileId}
                onViewFile={handleViewFile}
                onViewImages={handleViewImages}
                onToggleSidebar={() => setIsSidebarOpenMobile(true)}
                onOpenSettings={() => setIsSettingsOpen(true)}
              />
            )}

            {/* Shift parameters below dropzone when there is less space (< lg) without overlapping anything (resizer, compressor, and pdf-merge embed their own controls on mobile) */}
            {shouldShowOptionsPanel && activeManifest && activeToolId !== 'resizer' && !(isMobile && activeToolId === 'image-resizer') && !(isMobile && activeToolId === 'pdf-merge') && (
              <div className={`lg:hidden w-full max-w-4xl mx-auto px-3 sm:px-6 lg:px-8 ${isKeyboardOpen ? 'pb-4' : 'pb-[calc(4.75rem+var(--safe-area-bottom))]'} pt-0 shrink-0 animate-in fade-in`}>
                <OptionsPanel
                  tool={activeManifest}
                  files={files}
                  onFilesChange={setFiles}
                  options={options}
                  onOptionsChange={setOptions}
                  isProcessing={isProcessing}
                  sizeEstimate={sizeEstimate}
                  onExecute={handleExecute}
                  selectedFileId={selectedFileId}
                  onSelectFile={setSelectedFileId}
                  isInline={true}
                  result={result}
                  onDismissResult={() => setResult(null)}
                  onViewFile={handleViewFile}
                  onViewImages={handleViewImages}
                />
              </div>
            )}
          </main>

          {/* Right Contextual Options Panel: visible ONLY on desktop (lg: >= 1024px) */}
          {shouldShowOptionsPanel && activeManifest && (
            <div className="hidden lg:flex shrink-0">
              <OptionsPanel
                tool={activeManifest}
                files={files}
                onFilesChange={setFiles}
                options={options}
                onOptionsChange={setOptions}
                isProcessing={isProcessing}
                sizeEstimate={sizeEstimate}
                onExecute={handleExecute}
                selectedFileId={selectedFileId}
                onSelectFile={setSelectedFileId}
                result={result}
                onDismissResult={() => setResult(null)}
                onViewFile={handleViewFile}
                onViewImages={handleViewImages}
              />
            </div>
          )}
        </div>
      </div>
    </div>

      {/* Hidden file inputs for Mobile Quick Scan Modal */}
      <input
        ref={scanImageInputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/avif,image/bmp,image/*"
        onChange={async (e) => {
          const selected = e.target.files;
          if (!selected || selected.length === 0) return;
          const processed: ProcessedFile[] = await Promise.all(
            Array.from(selected).map(async (file, idx) => {
              const buffer = await file.arrayBuffer();
              const previewUrl = file.type.startsWith('image/')
                ? URL.createObjectURL(new Blob([buffer], { type: file.type }))
                : undefined;
              return {
                id: `scan_input_${Date.now()}_${idx}`,
                name: file.name,
                size: file.size,
                type: file.type || 'application/octet-stream',
                lastModified: file.lastModified,
                data: buffer,
                previewUrl,
              };
            })
          );
          setFiles((prev) => [...prev, ...processed]);
          e.target.value = '';
        }}
        className="hidden"
      />
      <input
        ref={scanPdfInputRef}
        type="file"
        multiple
        accept="application/pdf,.pdf"
        onChange={async (e) => {
          const selected = e.target.files;
          if (!selected || selected.length === 0) return;
          const processed: ProcessedFile[] = await Promise.all(
            Array.from(selected).map(async (file, idx) => {
              const buffer = await file.arrayBuffer();
              return {
                id: `scan_pdf_${Date.now()}_${idx}`,
                name: file.name,
                size: file.size,
                type: file.type || 'application/pdf',
                lastModified: file.lastModified,
                data: buffer,
              };
            })
          );
          setFiles((prev) => [...prev, ...processed]);
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* Desktop Hidden File Inputs for Document Scanner & Editor */}
      <input
        ref={desktopScanFilesInputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/avif,image/bmp,image/*,application/pdf,.pdf"
        onChange={async (e) => {
          if (e.target.files && e.target.files.length > 0) {
            const selected = Array.from(e.target.files);
            const converted = await convertFilesToImagePages(selected);
            if (converted.length > 0) {
              setCameraCapturedFiles((prev) => [...prev, ...converted]);
              setEditingScan(null);
              setRetakeIndex(null);
              setIsCameraOpen(false);
              setIsEditorOpen(true);
            }
          }
          e.target.value = '';
        }}
        className="hidden"
      />
      <input
        ref={desktopReplaceFileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/bmp,image/*"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0 && retakeIndex !== null) {
            const replacement = e.target.files[0];
            setCameraCapturedFiles((prev) => {
              const next = [...prev];
              next[retakeIndex] = replacement;
              return next;
            });
            setRetakeIndex(null);
          }
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* Hidden input for Image Resizer Change Photo */}
      <input
        ref={resizerFileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/bmp,image/tiff,image/*"
        onChange={async (e) => {
          if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];
            const buffer = await file.arrayBuffer();
            const processed: ProcessedFile = {
              id: `f_resizer_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              name: file.name,
              size: file.size,
              type: file.type || 'image/jpeg',
              lastModified: file.lastModified,
              data: buffer,
            };
            if (result) setResult(null);
            setFiles([processed]);
          }
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* Mobile Bottom Navigation Bar (Visible on mobile devices < lg, NEVER on desktop apps, hidden when in Library) */}
      {isMobile && activeToolId !== 'library' && (
        <MobileNavBar
          activeToolId={activeToolId}
          onSelectTool={(id) => {
            requestSelectTool(id);
            setIsSidebarOpenMobile(false);
            setIsOptionsOpenMobile(false);
          }}
          onOpenScan={() => {
            setEditingScan(null);
            setCameraCapturedFiles([]);
            setRetakeIndex(null);
            setIsCameraOpen(true);
          }}
          isScanningOrEditing={isCameraOpen || isEditorOpen}
          isKeyboardOpen={isKeyboardOpen}
        />
      )}

      {/* Settings Modal (Theme, Offline Security, Info) */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* Screen 1: Camera Scanner Overlay (Rear camera only, 5 icons, multi-page append) */}
      <CameraViewfinder
        isOpen={isCameraOpen}
        onClose={() => {
          setIsCameraOpen(false);
          setRetakeIndex(null);
          setCameraCapturedFiles([]);
          setEditingScan(null);
          setActiveToolId('scans');
        }}
        onCapturePages={(newFiles) => {
          if (retakeIndex !== null) {
            // Replace ONLY the page being retaken
            setCameraCapturedFiles((prev) => {
              const updated = [...prev];
              if (newFiles[0]) {
                updated[retakeIndex] = newFiles[0];
              }
              return updated;
            });
            setRetakeIndex(null);
            setIsCameraOpen(false);
            setIsEditorOpen(true);
          } else {
            // Append new pages one after another and immediately open page adjuster
            setCameraCapturedFiles((prev) => [...prev, ...newFiles]);
            setIsCameraOpen(false);
            setIsEditorOpen(true);
          }
          setEditingScan(null);
        }}
        onOpenReview={() => {
          setIsCameraOpen(false);
          setIsEditorOpen(true);
        }}
        initialCount={cameraCapturedFiles.length}
      />

      {/* Screen 2: Document Editor Modal (High contrast, Retake, Delete confirmation, Discard warning) */}
      <DocumentEditorModal
        isOpen={isEditorOpen}
        pages={cameraCapturedFiles}
        initialScan={editingScan}
        onClose={() => {
          setIsEditorOpen(false);
          setEditingScan(null);
          setCameraCapturedFiles([]);
          setRetakeIndex(null);
          setActiveToolId('scans');
          setScansRefreshKey((prev) => prev + 1);
        }}
        onKeepScanning={() => {
          if (isMobileApp()) {
            setRetakeIndex(null);
            setIsEditorOpen(false);
            setIsCameraOpen(true);
          } else {
            desktopScanFilesInputRef.current?.click();
          }
        }}
        onRetakePage={(idx) => {
          setRetakeIndex(idx);
          if (isMobileApp()) {
            setIsEditorOpen(false);
            setIsCameraOpen(true);
          } else {
            desktopReplaceFileInputRef.current?.click();
          }
        }}
        onSavePdf={async (pdfBlob, filename) => {
          if (pdfBlob) {
            try {
              const buffer = await pdfBlob.arrayBuffer();
              const processed = {
                name: filename || `Scan_${new Date().toISOString().slice(0, 10)}.pdf`,
                type: 'application/pdf',
                size: pdfBlob.size,
                data: buffer,
                section: 'recent' as LibrarySection,
                category: 'conversion' as LibraryCategory,
              };
              await addAssetsToLibraryWithToast([processed], 'Saved to Recents');
            } catch (err) {
              console.error('Failed to add scan PDF to library:', err);
            }
          }
          setIsEditorOpen(false);
          setEditingScan(null);
          setCameraCapturedFiles([]);
          setRetakeIndex(null);
          setActiveToolId('scans');
          setScansRefreshKey((prev) => prev + 1);
        }}
        onScanSaved={() => {
          setScansRefreshKey((prev) => prev + 1);
        }}
      />

      {/* Global In-App PDF Viewer */}
      <PdfViewerModal
        isOpen={Boolean(openedPdf) || isOpeningIncomingPdf}
        onClose={() => {
          setOpenedPdf(null);
          setIsOpeningIncomingPdf(false);
        }}
        pdfBlob={openedPdf?.blob ?? null}
        fileName={openedPdf?.name || initialPendingPdfName || 'Document.pdf'}
        onCompress={handleCompressPdfFromViewer}
      />

      {/* Global Image Gallery Viewer */}
      <ImageGalleryModal
        isOpen={isGalleryOpen}
        onClose={() => setIsGalleryOpen(false)}
        images={galleryImages}
        initialIndex={galleryInitialIndex}
        onCompressImage={handleCompressImageFromGallery}
        onResizeImage={handleResizeImageFromGallery}
        onConvertImagesToPdf={handleConvertImagesFromGallery}
        onAddImages={(newItems) => setGalleryImages((prev) => [...prev, ...newItems])}
        onRemoveImage={(id) => setGalleryImages((prev) => prev.filter((it) => it.id !== id))}
      />

      {/* Confirmation modal for quitting work and moving assets to Library */}
      <MoveToLibraryModal
        isOpen={isMoveToLibraryOpen}
        actionWording={getActionWording()}
        itemCount={files.length}
        onExitAndMove={handleConfirmExitAndMove}
        onExitWithoutSaving={handleConfirmExitWithoutSaving}
        onCancel={handleCancelMoveToLibrary}
      />

      {/* Gmail-style Library Toast Notification with 5s Undo & Dismiss */}
      <LibraryToast
        isOpen={libraryToast.isOpen}
        message={libraryToast.message}
        onUndo={handleUndoLibraryToast}
        onClose={() => setLibraryToast((prev) => ({ ...prev, isOpen: false }))}
      />

      {/* PWA Prompt-based Service Worker Update Notification */}
      <PWAUpdateToast />
    </div>
  );
};
