import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const websiteDir = path.resolve(__dirname, '..', 'website');
const port = 3000;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.apk': 'application/vnd.android.package-archive',
};

const server = http.createServer((req, res) => {
  let reqPath = decodeURI(req.url.split('?')[0]);
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

  const filePath = path.join(websiteDir, reqPath);

  // Security: prevent path traversal
  if (!filePath.startsWith(websiteDir)) {
    res.writeHead(403);
    res.end('Access Denied');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<h1>404 Not Found</h1><p><a href="/">Return to Website</a></p>');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    // Support streaming for large downloads (exe, apk)
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(port, () => {
  console.log(`\n🌐 Paperweight Official Website & Download Portal`);
  console.log(`🚀 Serving live at: http://localhost:${port}/`);
  console.log(`🎬 Promotional Video Theater: http://localhost:${port}/video.html`);
  console.log(`📦 Downloads:`);
  console.log(`   - Windows EXE: http://localhost:${port}/downloads/Paperweight-Setup-0.2.19.exe`);
  console.log(`   - Android APK: http://localhost:${port}/downloads/Paperweight-v0.2.19.apk`);
  console.log(`\nPress Ctrl+C to stop.`);
});
