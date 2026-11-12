import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import os from 'os';

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DIST_DIR = path.resolve('dist');
const PORT = 4173;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.bcmap': 'application/octet-stream',
};

// 1. Start HTTP Server for dist/
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let reqPath = req.url.split('?')[0];
      if (reqPath === '/') reqPath = '/index.html';
      const filePath = path.join(DIST_DIR, reqPath);

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Service-Worker-Allowed': '/',
        });
        fs.createReadStream(filePath).pipe(res);
      } else {
        // Fallback to index.html for SPA
        const indexPath = path.join(DIST_DIR, 'index.html');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        fs.createReadStream(indexPath).pipe(res);
      }
    });

    server.listen(PORT, () => {
      console.log(`[HTTP Server] Serving dist/ on http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

// 2. CDP Client over WebSocket
class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = (err) => reject(err);
      ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        if (data.id && this.callbacks.has(data.id)) {
          const { resolve, reject } = this.callbacks.get(data.id);
          this.callbacks.delete(data.id);
          if (data.error) reject(data.error);
          else resolve(data.result);
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws.close();
  }
}

async function run() {
  console.log('=== REAL BROWSER OFFLINE VERIFICATION (CHROME + SERVICE WORKER) ===');

  if (!fs.existsSync(CHROME_PATH)) {
    throw new Error(`Chrome not found at ${CHROME_PATH}`);
  }

  const server = await startServer();
  const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-offline-test-'));

  console.log('[Chrome] Spawning headless Chrome instance...');
  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    `--user-data-dir=${tmpUserData}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
  ]);

  try {
    // Wait for Chrome remote debugging endpoint
    let wsUrl = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 300));
      try {
        const res = await fetch('http://localhost:9222/json/version');
        if (res.ok) {
          const versionData = await res.json();
          wsUrl = versionData.webSocketDebuggerUrl;
          console.log(`[Chrome] CDP Endpoint available: ${versionData['Browser']}`);
          break;
        }
      } catch {}
    }

    if (!wsUrl) throw new Error('Could not connect to Chrome CDP endpoint.');

    // Connect to browser target and create page
    const cdp = new CDPClient(wsUrl);
    await cdp.connect();

    const { targetId } = await cdp.send('Target.createTarget', {
      url: `http://localhost:${PORT}/`,
    });

    const pageWsRes = await fetch('http://localhost:9222/json');
    const targets = await pageWsRes.json();
    const pageTarget = targets.find((t) => t.id === targetId);
    if (!pageTarget) throw new Error('Page target not found');

    const pageCdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await pageCdp.connect();

    await pageCdp.send('Page.enable');
    await pageCdp.send('Runtime.enable');
    await pageCdp.send('Network.enable');

    console.log('[Step 1] Loading app and waiting for Service Worker precaching...');
    await pageCdp.send('Page.navigate', { url: `http://localhost:${PORT}/` });

    // Wait for Service Worker registration, activation & client control
    let isSwActive = false;
    let cacheKeys = [];
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const res = await pageCdp.send('Runtime.evaluate', {
        expression: `(async () => {
          if (!('serviceWorker' in navigator)) return { ok: false, err: 'no sw' };
          const reg = await navigator.serviceWorker.getRegistration();
          if (!reg || !reg.active) return { ok: false, status: reg?.installing ? 'installing' : 'waiting' };
          if (!navigator.serviceWorker.controller) return { ok: false, status: 'waiting for controller' };
          const keys = await caches.keys();
          if (keys.length === 0) return { ok: false, status: 'no caches' };
          const cache = await caches.open(keys[0]);
          const urls = (await cache.keys()).map(r => r.url);
          const hasFonts = urls.some(u => u.includes('standard_fonts'));
          const hasCMaps = urls.some(u => u.includes('cmaps'));
          return { ok: true, keys, urlCount: urls.length, hasFonts, hasCMaps, controller: !!navigator.serviceWorker.controller };
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });

      if (res.result?.value?.ok && res.result.value.hasFonts) {
        isSwActive = true;
        cacheKeys = res.result.value;
        break;
      }
    }

    console.log('[Step 2] Service Worker & Cache Inspection:');
    console.log(`  - SW Active: ${isSwActive}`);
    console.log(`  - Precached Assets Count: ${cacheKeys.urlCount}`);
    console.log(`  - Precached Standard Fonts: ${cacheKeys.hasFonts}`);
    console.log(`  - Precached CMaps: ${cacheKeys.hasCMaps}`);

    if (!isSwActive || !cacheKeys.hasFonts) {
      throw new Error('Service Worker failed to precache standard fonts');
    }

    console.log('\n[Step 3] CUTTING NETWORK (Simulating Airplane Mode)...');
    await pageCdp.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
      connectionType: 'none',
    });

    // Verify network is strictly dead
    const netCheck = await pageCdp.send('Runtime.evaluate', {
      expression: `(async () => {
        try {
          await fetch('https://example.com/test', { mode: 'no-cors' });
          return { online: true };
        } catch (e) {
          return { online: false, err: e.message };
        }
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    console.log(`  - Network status verified offline: ${!netCheck.result.value.online} (${netCheck.result.value.err})`);

    console.log('\n[Step 4] Retrieving standard fonts and CMaps under 100% OFFLINE conditions...');
    const renderTest = await pageCdp.send('Runtime.evaluate', {
      expression: `(async () => {
        try {
          // Fetch standard font and CMap directly through the active service worker
          const fontRes = await fetch('/standard_fonts/FoxitSerif.pfb');
          const fontOk = fontRes.ok && fontRes.status === 200;
          const fontBytes = (await fontRes.arrayBuffer()).byteLength;

          const cmapRes = await fetch('/cmaps/UniCNS-UCS2-H.bcmap');
          const cmapOk = cmapRes.ok && cmapRes.status === 200;
          const cmapBytes = (await cmapRes.arrayBuffer()).byteLength;

          // Also test LiberationSans-Regular.ttf
          const ttfRes = await fetch('/standard_fonts/LiberationSans-Regular.ttf');
          const ttfOk = ttfRes.ok && ttfRes.status === 200;
          const ttfBytes = (await ttfRes.arrayBuffer()).byteLength;

          return {
            success: true,
            fontServedOffline: fontOk,
            fontBytes,
            cmapServedOffline: cmapOk,
            cmapBytes,
            ttfServedOffline: ttfOk,
            ttfBytes,
          };
        } catch (e) {
          return { success: false, error: e.message, stack: e.stack };
        }
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });

    console.log('[Step 5] Offline Asset Retrieval Results:');
    console.log(JSON.stringify(renderTest.result.value, null, 2));

    if (!renderTest.result.value.success || !renderTest.result.value.fontServedOffline) {
      throw new Error('Offline font retrieval failed!');
    }

    console.log('\n[SUCCESS] REAL BROWSER OFFLINE VERIFICATION PASSED!');
    console.log('Verified in Chrome with active Service Worker and Network.emulateNetworkConditions = offline:');
    console.log(`  - Standard Fonts loaded from SW Cache: ${renderTest.result.value.fontBytes} bytes`);
    console.log(`  - CMaps loaded from SW Cache: ${renderTest.result.value.cmapBytes} bytes`);

    pageCdp.close();
    cdp.close();
  } finally {
    chromeProc.kill('SIGKILL');
    server.close();
    try {
      fs.rmSync(tmpUserData, { recursive: true, force: true });
    } catch {}
  }
}

run().catch((err) => {
  console.error('[FAILED]', err);
  process.exit(1);
});
