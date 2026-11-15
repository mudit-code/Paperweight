import fs from 'fs';
import path from 'path';
import http from 'http';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Helper to create ICO binary from PNG buffers
function createICO(images) {
  // images: array of { size: number, buffer: Buffer }
  const headerSize = 6;
  const dirEntrySize = 16;
  const numImages = images.length;
  const dirSize = numImages * dirEntrySize;
  let dataOffset = headerSize + dirSize;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);     // Reserved
  header.writeUInt16LE(1, 2);     // Type: ICO
  header.writeUInt16LE(numImages, 4); // Count

  const dirEntries = [];
  const pngBuffers = [];

  for (let i = 0; i < numImages; i++) {
    const { size, buffer } = images[i];
    pngBuffers.push(buffer);
    const entry = Buffer.alloc(dirEntrySize);
    entry[0] = size >= 256 ? 0 : size; // Width (0 = 256)
    entry[1] = size >= 256 ? 0 : size; // Height
    entry[2] = 0;                      // Palette colors
    entry[3] = 0;                      // Reserved
    entry.writeUInt16LE(1, 4);         // Color planes
    entry.writeUInt16LE(32, 6);        // Bits per pixel
    entry.writeUInt32LE(buffer.length, 8); // Image byte size
    entry.writeUInt32LE(dataOffset, 12);   // File offset
    dataOffset += buffer.length;
    dirEntries.push(entry);
  }

  return Buffer.concat([header, ...dirEntries, ...pngBuffers]);
}

// 1. Read source SVGs
const svg16Source = fs.readFileSync(path.join(rootDir, 'logo assests/paperweight-small-16px.svg'), 'utf8');
const svgOpt1Source = fs.readFileSync(path.join(rootDir, 'logo assests/paperweight-small-opt1.svg'), 'utf8');

// 2. Prepare Round SVG for Android ic_launcher_round
const svgRoundSource = svgOpt1Source.replace(
  '<rect width="32" height="32" rx="7" fill="#F2D14B" stroke="#151517" stroke-opacity="0.16" stroke-width="0.75"/>',
  '<circle cx="16" cy="16" r="16" fill="#F2D14B"/>'
);

// 3. Prepare Maskable 512 SVG (square full-bleed background, safe mark inside)
const svgMaskableSource = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="opt1Body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#27272B"/>
      <stop offset="1" stop-color="#151517"/>
    </linearGradient>
  </defs>
  <!-- Full bleed highlighter yellow background for maskable safe-zone -->
  <rect width="512" height="512" fill="#F2D14B"/>
  
  <!-- Centered mark scaled to 360px (well within 409px 80% safe zone circle) -->
  <g transform="translate(256 256) scale(11.25) translate(-16 -16)">
    <!-- Back sheet -->
    <rect x="4" y="17.5" width="24" height="9.5" rx="1.5" fill="#E9E8E4" transform="rotate(-2 16 22)"/>
    <!-- Front sheet -->
    <rect x="4.5" y="18.5" width="23" height="8.5" rx="1.5" fill="#F7F5EF"/>
    <!-- Document stamp -->
    <rect x="6.5" y="20.5" width="4.5" height="4.5" rx="1" fill="#1F1F22"/>
    <!-- Text hint lines -->
    <rect x="13" y="21" width="12" height="1.5" rx="0.75" fill="#A9A79F"/>
    <rect x="13" y="23.5" width="8" height="1.5" rx="0.75" fill="#A9A79F"/>
    
    <!-- Cast-Iron Paperweight -->
    <ellipse cx="16" cy="18.5" rx="11" ry="1.5" fill="#151517" opacity="0.45"/>
    <path d="M12 12V8.5C12 6.6 13.8 5 16 5C18.2 5 20 6.6 20 8.5V12" fill="none" stroke="#1F1F22" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M13.5 8C14.2 6.8 15.1 6.2 16 6.2C16.9 6.2 17.8 6.8 18.5 8" fill="none" stroke="#6B6964" stroke-width="1.2" stroke-linecap="round"/>
    <path d="M9.5 12H22.5L26 18.5H6L9.5 12Z" fill="url(#opt1Body)" stroke="#151517" stroke-width="0.75" stroke-linejoin="round"/>
    <line x1="10" y1="12.5" x2="22" y2="12.5" stroke="#FFFFFF" stroke-opacity="0.25" stroke-width="0.9" stroke-linecap="round"/>
    <path d="M14 14.5L16 16.5L18 14.5" fill="none" stroke="#F2D14B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="16" y1="13.5" x2="16" y2="15" stroke="#F2D14B" stroke-width="1.5" stroke-linecap="round"/>
  </g>
</svg>`;

// 4. Prepare Adaptive Foreground SVG (108dp canvas, centered within 72dp safe circle)
const svgForegroundSource = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="108" height="108">
  <defs>
    <linearGradient id="opt1Body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#27272B"/>
      <stop offset="1" stop-color="#151517"/>
    </linearGradient>
  </defs>
  <!-- Foreground mark scaled to 66dp and centered at (54, 54) -->
  <g transform="translate(54 54) scale(2.06) translate(-16 -16)">
    <!-- Back sheet -->
    <rect x="4" y="17.5" width="24" height="9.5" rx="1.5" fill="#E9E8E4" transform="rotate(-2 16 22)"/>
    <!-- Front sheet -->
    <rect x="4.5" y="18.5" width="23" height="8.5" rx="1.5" fill="#F7F5EF"/>
    <!-- Document stamp -->
    <rect x="6.5" y="20.5" width="4.5" height="4.5" rx="1" fill="#1F1F22"/>
    <!-- Text hint lines -->
    <rect x="13" y="21" width="12" height="1.5" rx="0.75" fill="#A9A79F"/>
    <rect x="13" y="23.5" width="8" height="1.5" rx="0.75" fill="#A9A79F"/>
    
    <!-- Cast-Iron Paperweight -->
    <ellipse cx="16" cy="18.5" rx="11" ry="1.5" fill="#151517" opacity="0.45"/>
    <path d="M12 12V8.5C12 6.6 13.8 5 16 5C18.2 5 20 6.6 20 8.5V12" fill="none" stroke="#1F1F22" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M13.5 8C14.2 6.8 15.1 6.2 16 6.2C16.9 6.2 17.8 6.8 18.5 8" fill="none" stroke="#6B6964" stroke-width="1.2" stroke-linecap="round"/>
    <path d="M9.5 12H22.5L26 18.5H6L9.5 12Z" fill="url(#opt1Body)" stroke="#151517" stroke-width="0.75" stroke-linejoin="round"/>
    <line x1="10" y1="12.5" x2="22" y2="12.5" stroke="#FFFFFF" stroke-opacity="0.25" stroke-width="0.9" stroke-linecap="round"/>
    <path d="M14 14.5L16 16.5L18 14.5" fill="none" stroke="#F2D14B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="16" y1="13.5" x2="16" y2="15" stroke="#F2D14B" stroke-width="1.5" stroke-linecap="round"/>
  </g>
</svg>`;

// Definition of all required files
const JOBS = [
  // Web / PWA
  { name: 'fav16', size: 16, svg: svg16Source, dest: ['public/favicon-16x16.png'] },
  { name: 'fav32', size: 32, svg: svgOpt1Source, dest: ['public/favicon-32x32.png'] },
  { name: 'apple180', size: 180, svg: svgOpt1Source, dest: ['public/apple-touch-icon.png'] },
  { name: 'pwa192', size: 192, svg: svgOpt1Source, dest: ['public/icon-192.png'] },
  { name: 'pwa512', size: 512, svg: svgOpt1Source, dest: ['public/icon-512.png'] },
  { name: 'pwa512mask', size: 512, svg: svgMaskableSource, dest: ['public/icon-maskable-512.png'] },

  // Windows build resources
  { name: 'win24', size: 24, svg: svgOpt1Source, isIcoOnly: true },
  { name: 'win48', size: 48, svg: svgOpt1Source, isIcoOnly: true },
  { name: 'win64', size: 64, svg: svgOpt1Source, isIcoOnly: true },
  { name: 'win128', size: 128, svg: svgOpt1Source, isIcoOnly: true },
  { name: 'win256', size: 256, svg: svgOpt1Source, dest: ['build-resources/icon.png'], isIcoOnly: false },

  // Android mipmaps
  // mdpi (1x)
  { name: 'and_mdpi', size: 48, svg: svgOpt1Source, dest: ['android/app/src/main/res/mipmap-mdpi/ic_launcher.png'] },
  { name: 'and_mdpi_round', size: 48, svg: svgRoundSource, dest: ['android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png'] },
  { name: 'and_mdpi_fore', size: 108, svg: svgForegroundSource, dest: ['android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png'] },

  // hdpi (1.5x)
  { name: 'and_hdpi', size: 72, svg: svgOpt1Source, dest: ['android/app/src/main/res/mipmap-hdpi/ic_launcher.png'] },
  { name: 'and_hdpi_round', size: 72, svg: svgRoundSource, dest: ['android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png'] },
  { name: 'and_hdpi_fore', size: 162, svg: svgForegroundSource, dest: ['android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png'] },

  // xhdpi (2x)
  { name: 'and_xhdpi', size: 96, svg: svgOpt1Source, dest: ['android/app/src/main/res/mipmap-xhdpi/ic_launcher.png'] },
  { name: 'and_xhdpi_round', size: 96, svg: svgRoundSource, dest: ['android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png'] },
  { name: 'and_xhdpi_fore', size: 216, svg: svgForegroundSource, dest: ['android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png'] },

  // xxhdpi (3x)
  { name: 'and_xxhdpi', size: 144, svg: svgOpt1Source, dest: ['android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png'] },
  { name: 'and_xxhdpi_round', size: 144, svg: svgRoundSource, dest: ['android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png'] },
  { name: 'and_xxhdpi_fore', size: 324, svg: svgForegroundSource, dest: ['android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png'] },

  // xxxhdpi (4x)
  { name: 'and_xxxhdpi', size: 192, svg: svgOpt1Source, dest: ['android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png'] },
  { name: 'and_xxxhdpi_round', size: 192, svg: svgRoundSource, dest: ['android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png'] },
  { name: 'and_xxxhdpi_fore', size: 432, svg: svgForegroundSource, dest: ['android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png'] },
];

const renderedBuffers = new Map();

const PORT = 3889;
const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/upload')) {
    const urlObj = new URL(req.url, `http://localhost:${PORT}`);
    const name = urlObj.searchParams.get('name');
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      renderedBuffers.set(name, buffer);
      res.writeHead(200);
      res.end('ok');
    });
  } else if (req.url === '/done') {
    res.writeHead(200);
    res.end('all done');
    server.close();
    finishGeneration();
  } else {
    // Serve HTML page that executes canvas drawing and uploads
    const clientJobsJson = JSON.stringify(JOBS.map(j => ({ name: j.name, size: j.size, svg: j.svg })));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<canvas id="c"></canvas>
<script>
const jobs = ${clientJobsJson};

async function run() {
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');

  for (const job of jobs) {
    canvas.width = job.size;
    canvas.height = job.size;
    ctx.clearRect(0, 0, job.size, job.size);

    const blob = new Blob([job.svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    await new Promise((resolve, reject) => {
      img.onload = () => {
        ctx.drawImage(img, 0, 0, job.size, job.size);
        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = reject;
      img.src = url;
    });

    const pngBlob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    await fetch('/upload?name=' + encodeURIComponent(job.name), {
      method: 'POST',
      body: pngBlob
    });
  }

  await fetch('/done');
}

run().catch(e => console.error(e));
</script>
</body>
</html>`);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Starting headless rasterization server on port ${PORT}...`);
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  execFile(edgePath, [
    '--headless=new',
    '--disable-gpu',
    `http://127.0.0.1:${PORT}`
  ]);
});

function finishGeneration() {
  console.log('Rasterization completed. Writing files to destinations...');

  // 1. Write individual PNGs
  for (const job of JOBS) {
    const buf = renderedBuffers.get(job.name);
    if (!buf) {
      console.warn(`Warning: Buffer for ${job.name} missing!`);
      continue;
    }
    if (job.dest) {
      for (const destRel of job.dest) {
        const destAbs = path.join(rootDir, destRel);
        fs.mkdirSync(path.dirname(destAbs), { recursive: true });
        fs.writeFileSync(destAbs, buf);
        console.log(` -> Wrote ${destRel} (${job.size}x${job.size}, ${buf.length} bytes)`);
      }
    }
  }

  // 2. Build multi-size Windows icon.ico
  const icoEntries = [
    { size: 16, buffer: renderedBuffers.get('fav16') },
    { size: 24, buffer: renderedBuffers.get('win24') },
    { size: 32, buffer: renderedBuffers.get('fav32') },
    { size: 48, buffer: renderedBuffers.get('win48') },
    { size: 64, buffer: renderedBuffers.get('win64') },
    { size: 128, buffer: renderedBuffers.get('win128') },
    { size: 256, buffer: renderedBuffers.get('win256') },
  ].filter(e => !!e.buffer);

  const icoBuf = createICO(icoEntries);
  const icoPath = path.join(rootDir, 'build-resources/icon.ico');
  fs.mkdirSync(path.dirname(icoPath), { recursive: true });
  fs.writeFileSync(icoPath, icoBuf);
  console.log(` -> Wrote build-resources/icon.ico (${icoEntries.map(e => e.size).join(', ')}px, ${icoBuf.length} bytes)`);

  // 3. Update public/favicon.svg with Optic Badge SVG
  const faviconSvgDest = path.join(rootDir, 'public/favicon.svg');
  fs.writeFileSync(faviconSvgDest, svgOpt1Source, 'utf8');
  console.log(' -> Wrote public/favicon.svg');

  // 4. Update android ic_launcher_background.xml
  const androidBgXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#F2D14B</color>
</resources>
`;
  const bgPath = path.join(rootDir, 'android/app/src/main/res/values/ic_launcher_background.xml');
  fs.writeFileSync(bgPath, androidBgXml, 'utf8');
  console.log(' -> Updated android values/ic_launcher_background.xml (#F2D14B)');

  console.log('\nAll assets generated successfully!');
  process.exit(0);
}

