# Paperweight

> **100% offline, privacy-first document and image workspace for Windows and Android.**

Paperweight processes PDFs and images strictly on-device using client-side WebAssembly, Web Workers, IndexedDB storage, Electron (Windows x64), and Capacitor (Android 8.0+). Zero cloud uploads, zero accounts, and zero background telemetry.

---

## Core Tools

- **Document Scanner**: Perspective quad detection, corner adjustment, high-contrast Magic B&W / grayscale / color filters, and multi-page PDF export.
- **Compressor**: Calibrated PDF, image (JPG, PNG, WebP), and Word (`.docx`) compression with live size savings, individual or ZIP export, and Android native share support.
- **Image Resizer & Precision Cropper**: Interactive rule-of-thirds cropper targeting exact `px`, `in`, or `cm` dimensions at configurable DPI with strict KB file size limits.
- **PDF Merger**: Combine multiple PDFs and images with visual page reordering and page-count tracking.
- **Converter**: Offline conversion across PDF-to-image, image-to-PDF, and image-to-image formats (`PNG`, `JPEG`, `WebP`, `AVIF`, `TIFF`, `BMP`).
- **60 FPS PDF Viewer & Gallery**: High-DPI vector zoom, text selection, yellow/blue keyword search (`Ctrl+F`), page thumbnails, and swipeable Android image gallery.
- **Library (`Recently Processed` & `Drafts`)**: Categorized on-device storage (`Compression`, `Conversion`, `Merges`, `Resizes`) with full draft state restoration.

---

## Repository Structure

```text
Paperweight/
├── src/
│   ├── components/      # Shared UI, modals (PDF viewer, gallery), layout shell
│   ├── core/            # Offline PDF/image processors, workers, render queue, Library DB
│   ├── styles/          # Light/Dark tokens and PDF text-layer styles
│   └── tools/           # Converter, Compressor, Resizer, Merger, Scanner, Library views
├── electron/            # Windows desktop main & preload scripts
├── android/             # Capacitor native Android wrapper project
├── website/             # Official download & real-app promotional walkthrough portal
├── scripts/             # Asset generation, APK builder & website static server
├── build-resources/     # NSIS installer icons and Windows installer script
├── public/              # Bundled fonts, PDF.js cmaps/standard fonts & app icons
└── tests/               # Vitest unit & performance test suite
```

---

## Development & Build Commands

```bash
# Install dependencies
npm install

# Start web development server
npm run dev

# Run unit & viewer test suite
npm test

# Typecheck and build production web bundle (dist/)
npm run build

# Build Windows NSIS installer (.exe into installer-output/)
npm run installer

# Build Android APK (.apk into android-output/)
npm run apk

# Serve website & download portal locally at http://localhost:3000/
npm run website
```

> **Note on Installers**: Compiled binaries (`*.exe`, `*.apk`) are excluded from Git tracking via `.gitignore`. Build them locally using `npm run installer` and `npm run apk`, or place releases in `website/downloads/` for local hosting.

---

## License

MIT
