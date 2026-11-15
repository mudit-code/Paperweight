import fs from 'fs';
import path from 'path';
import http from 'http';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const splashTargets = [
  { file: 'android/app/src/main/res/drawable/splash.png', width: 480, height: 320, iconSize: 96, isDarkBg: true },
  { file: 'android/app/src/main/res/drawable-land-hdpi/splash.png', width: 800, height: 480, iconSize: 120, isDarkBg: true },
  { file: 'android/app/src/main/res/drawable-land-mdpi/splash.png', width: 480, height: 320, iconSize: 96, isDarkBg: true },
  { file: 'android/app/src/main/res/drawable-land-xhdpi/splash.png', width: 1280, height: 720, iconSize: 160, isDarkBg: true },
  { file: 'android/app/src/main/res/drawable-land-xxhdpi/splash.png', width: 1600, height: 960, iconSize: 200, isDarkBg: true },
  { file: 'android/app/src/main/res/drawable-land-xxxhdpi/splash.png', width: 1920, height: 1280, iconSize: 240, isDarkBg: true },
  { file: 'android/app/src/main/res/drawable-port-hdpi/splash.png', width: 480, height: 800, iconSize: 140, isDarkBg: true },
  { file: 'android/app/src/main/res/drawable-port-mdpi/splash.png', width: 320, height: 480, iconSize: 100, isDarkBg: true },
  { file: 'android/app/src/main/res/drawable-port-xhdpi/splash.png', width: 720, height: 1280, iconSize: 180, isDarkBg: true },
  { file: 'android/app/src/main/res/drawable-port-xxhdpi/splash.png', width: 960, height: 1600, iconSize: 230, isDarkBg: true },
  { file: 'android/app/src/main/res/drawable-port-xxxhdpi/splash.png', width: 1280, height: 1920, iconSize: 280, isDarkBg: true },
  // ic_splash_logo (Transparent background - Android 12+ SplashScreen API)
  { file: 'android/app/src/main/res/drawable/ic_splash_logo.png', width: 288, height: 288, iconSize: 200, isDarkBg: false },
  { file: 'android/app/src/main/res/drawable-mdpi/ic_splash_logo.png', width: 160, height: 160, iconSize: 110, isDarkBg: false },
  { file: 'android/app/src/main/res/drawable-hdpi/ic_splash_logo.png', width: 240, height: 240, iconSize: 165, isDarkBg: false },
  { file: 'android/app/src/main/res/drawable-xhdpi/ic_splash_logo.png', width: 320, height: 320, iconSize: 220, isDarkBg: false },
  { file: 'android/app/src/main/res/drawable-xxhdpi/ic_splash_logo.png', width: 480, height: 480, iconSize: 330, isDarkBg: false },
  { file: 'android/app/src/main/res/drawable-xxxhdpi/ic_splash_logo.png', width: 640, height: 640, iconSize: 440, isDarkBg: false },
  { file: 'android/app/src/main/res/drawable-nodpi/ic_splash_logo.png', width: 480, height: 480, iconSize: 330, isDarkBg: false },
];

// Clean transparent-background logo: NO squarish rect!
const cleanLogoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="Paperweight Logo">
  <defs>
    <linearGradient id="splashIron" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3A3A40"/>
      <stop offset="1" stop-color="#242428"/>
    </linearGradient>
  </defs>

  <!-- Stacked Paper Sheets -->
  <rect x="4" y="17.5" width="24" height="9.5" rx="1.5" fill="#E9E8E4" transform="rotate(-2 16 22)"/>
  <rect x="4.5" y="18.5" width="23" height="8.5" rx="1.5" fill="#F7F5EF"/>
  <rect x="6.5" y="20.5" width="4.5" height="4.5" rx="1" fill="#1F1F22"/>
  <rect x="13" y="21" width="12" height="1.5" rx="0.75" fill="#A9A79F"/>
  <rect x="13" y="23.5" width="8" height="1.5" rx="0.75" fill="#A9A79F"/>

  <!-- Cast-Iron Paperweight -->
  <ellipse cx="16" cy="18.5" rx="11" ry="1.5" fill="#151517" opacity="0.45"/>
  <path d="M12 12V8.5C12 6.6 13.8 5 16 5C18.2 5 20 6.6 20 8.5V12" fill="none" stroke="#48484E" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M13.5 8C14.2 6.8 15.1 6.2 16 6.2C16.9 6.2 17.8 6.8 18.5 8" fill="none" stroke="#8A8882" stroke-width="1.2" stroke-linecap="round"/>
  <path d="M9.5 12H22.5L26 18.5H6L9.5 12Z" fill="url(#splashIron)" stroke="#585860" stroke-width="0.75" stroke-linejoin="round"/>
  <line x1="10" y1="12.5" x2="22" y2="12.5" stroke="#FFFFFF" stroke-opacity="0.3" stroke-width="0.9" stroke-linecap="round"/>
  <path d="M14 14.5L16 16.5L18 14.5" fill="none" stroke="#F2D14B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  <line x1="16" y1="13.5" x2="16" y2="15" stroke="#F2D14B" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

const PORT = 3892;
const renderedBuffers = new Map();

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
    const clientJobsJson = JSON.stringify(splashTargets.map((t, idx) => ({
      id: String(idx),
      width: t.width,
      height: t.height,
      iconSize: t.iconSize,
      isDarkBg: t.isDarkBg,
      svg: cleanLogoSvg
    })));

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
    canvas.width = job.width;
    canvas.height = job.height;
    ctx.clearRect(0, 0, job.width, job.height);

    if (job.isDarkBg) {
      // Dark #151517 surface background
      ctx.fillStyle = '#151517';
      ctx.fillRect(0, 0, job.width, job.height);
    }

    // Load clean transparent SVG logo
    const blob = new Blob([job.svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    await new Promise((resolve, reject) => {
      img.onload = () => {
        const x = (job.width - job.iconSize) / 2;
        const y = (job.height - job.iconSize) / 2;
        ctx.drawImage(img, x, y, job.iconSize, job.iconSize);
        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = reject;
      img.src = url;
    });

    const pngBlob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    await fetch('/upload?name=' + encodeURIComponent(job.id), {
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
  console.log(`Starting headless splash rasterization on port ${PORT}...`);
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  execFile(edgePath, [
    '--headless=new',
    '--disable-gpu',
    `http://127.0.0.1:${PORT}`
  ]);
});

function finishGeneration() {
  console.log('Finished rasterizing clean splash images. Saving to res folders...');
  for (let idx = 0; idx < splashTargets.length; idx++) {
    const target = splashTargets[idx];
    const buf = renderedBuffers.get(String(idx));
    if (buf) {
      const dest = path.join(rootDir, target.file);
      fs.writeFileSync(dest, buf);
      console.log(`Updated splash asset: ${dest} (${target.width}x${target.height})`);
    }
  }
  console.log('All splash and ic_splash_logo assets updated successfully with transparent background!');
}
