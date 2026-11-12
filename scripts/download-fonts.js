import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fontsDir = path.resolve(__dirname, '../public/fonts');

if (!fs.existsSync(fontsDir)) {
  fs.mkdirSync(fontsDir, { recursive: true });
}

// Direct raw links to variable woff2 fonts from reputable open-source font packages:
// 1. Serif: Fraunces (Variable font)
// 2. Sans: Plus Jakarta Sans (Variable font)
// 3. Mono: JetBrains Mono (Variable font)
const fonts = [
  {
    name: 'serif-variable.woff2',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/fraunces:vf@latest/latin-wght-normal.woff2',
  },
  {
    name: 'sans-variable.woff2',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/plus-jakarta-sans:vf@latest/latin-wght-normal.woff2',
  },
  {
    name: 'mono-variable.woff2',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/jetbrains-mono:vf@latest/latin-wght-normal.woff2',
  },
];

async function downloadFont(font) {
  const dest = path.join(fontsDir, font.name);
  console.log(`Downloading ${font.name} from ${font.url}...`);
  try {
    const res = await fetch(font.url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(dest, Buffer.from(arrayBuffer));
    console.log(`Saved ${font.name} (${arrayBuffer.byteLength} bytes)`);
  } catch (err) {
    console.error(`Failed to download ${font.name}:`, err);
    process.exit(1);
  }
}

async function main() {
  for (const font of fonts) {
    await downloadFont(font);
  }
  console.log('All variable fonts successfully downloaded to public/fonts/');
}

main();
