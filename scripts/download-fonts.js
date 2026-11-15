import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fontsDir = path.resolve(__dirname, '../public/fonts');

if (!fs.existsSync(fontsDir)) {
  fs.mkdirSync(fontsDir, { recursive: true });
}

// Self-hosted open-source woff2 fonts (zero runtime network requests):
// 1. Space Grotesk (Variable UI & Display sans-serif)
// 2. IBM Plex Mono (400, 500, 600, 700 weights for metadata, sizes, shortcuts, filenames)
const fonts = [
  {
    name: 'space-grotesk-variable.woff2',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/space-grotesk:vf@latest/latin-wght-normal.woff2',
  },
  {
    name: 'ibm-plex-mono-400.woff2',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/ibm-plex-mono@latest/latin-400-normal.woff2',
  },
  {
    name: 'ibm-plex-mono-500.woff2',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/ibm-plex-mono@latest/latin-500-normal.woff2',
  },
  {
    name: 'ibm-plex-mono-600.woff2',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/ibm-plex-mono@latest/latin-600-normal.woff2',
  },
  {
    name: 'ibm-plex-mono-700.woff2',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/ibm-plex-mono@latest/latin-700-normal.woff2',
  },
];

const legacyFonts = ['serif-variable.woff2', 'sans-variable.woff2', 'mono-variable.woff2'];

async function downloadFont(font) {
  const dest = path.join(fontsDir, font.name);
  console.log(`Downloading ${font.name}...`);
  const res = await fetch(font.url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText} (${font.url})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 4).toString('ascii') !== 'wOF2') {
    throw new Error(`Invalid WOFF2 magic header for ${font.name}`);
  }
  fs.writeFileSync(dest, buf);
  console.log(`Saved ${font.name} (${buf.byteLength} bytes)`);
}

async function main() {
  for (const oldName of legacyFonts) {
    const oldPath = path.join(fontsDir, oldName);
    if (fs.existsSync(oldPath)) {
      fs.unlinkSync(oldPath);
      console.log(`Removed legacy font ${oldName}`);
    }
  }
  for (const font of fonts) {
    await downloadFont(font);
  }
  console.log('Space Grotesk + IBM Plex Mono bundled cleanly to public/fonts/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
