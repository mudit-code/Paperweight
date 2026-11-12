import fs from 'fs';
import path from 'path';

const root = 'D:/Paperweight';
const outPath = 'C:/Users/desktop/.gemini/antigravity/brain/bb0302b6-c15b-4ef0-bbdd-977ab42cd870/icon_showcase.html';

const old16B64 = fs.readFileSync(path.join(root, 'logo assests/icon-16.png')).toString('base64');
const old32B64 = fs.readFileSync(path.join(root, 'logo assests/icon-32.png')).toString('base64');

const svg16 = fs.readFileSync(path.join(root, 'logo assests/paperweight-small-16px.svg'), 'utf8');
const svgOpt1 = fs.readFileSync(path.join(root, 'logo assests/paperweight-small-opt1.svg'), 'utf8');
const svgOpt2 = fs.readFileSync(path.join(root, 'logo assests/paperweight-small-opt2.svg'), 'utf8');
const svgOpt3 = fs.readFileSync(path.join(root, 'logo assests/paperweight-small-opt3.svg'), 'utf8');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Paperweight Small Icon Optical Showcase</title>
  <script src="https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js"></script>
  <style>
    .pixelated {
      image-rendering: -moz-crisp-edges;
      image-rendering: -webkit-crisp-edges;
      image-rendering: pixelated;
      image-rendering: crisp-edges;
    }
    .checkered-bg {
      background-image: 
        linear-gradient(45deg, rgba(0,0,0,0.06) 25%, transparent 25%),
        linear-gradient(-45deg, rgba(0,0,0,0.06) 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, rgba(0,0,0,0.06) 75%),
        linear-gradient(-45deg, transparent 75%, rgba(0,0,0,0.06) 75%);
      background-size: 16px 16px;
      background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
    }
    .svg-wrapper svg {
      width: 100%;
      height: 100%;
      display: block;
    }
  </style>
</head>
<body class="bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 p-4 sm:p-6 font-sans antialiased transition-colors duration-200">
  <div class="max-w-4xl mx-auto space-y-6">

    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-stone-200 dark:border-stone-800">
      <div>
        <div class="flex items-center gap-2">
          <span class="px-2 py-0.5 rounded text-xs font-mono font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            OPTICAL SIZING
          </span>
          <span class="text-xs text-stone-500 font-mono">16px &bull; 24px &bull; 32px &bull; 48px</span>
        </div>
        <h1 class="text-xl sm:text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-50 mt-1">
          Paperweight Small Icons Redesign
        </h1>
        <p class="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
          Eliminating subpixel blur & ensuring instant recognition at the smallest display sizes.
        </p>
      </div>

      <!-- Quick Theme Switcher -->
      <div class="flex items-center gap-1.5 p-1 rounded-xl bg-stone-200/80 dark:bg-stone-800/80 self-start sm:self-auto text-xs font-medium">
        <button id="themeLightBtn" class="px-3 py-1.5 rounded-lg bg-white dark:bg-transparent text-stone-900 dark:text-stone-400 shadow-xs dark:shadow-none transition-all cursor-pointer">
          Light Mode
        </button>
        <button id="themeDarkBtn" class="px-3 py-1.5 rounded-lg bg-transparent dark:bg-stone-700 text-stone-600 dark:text-stone-100 transition-all cursor-pointer">
          Dark Mode
        </button>
      </div>
    </div>

    <!-- BEFORE vs AFTER SPOTLIGHT (At 16x16) -->
    <div class="p-5 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-sm space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-bold uppercase tracking-wider text-amber-600 dark:text-amber-500 font-mono">
            At 16 × 16 px (Browser Tab & Tray Size)
          </h2>
          <p class="text-xs text-stone-500 dark:text-stone-400">
            Side-by-side comparison between the raw 512px downsample and our recreated optical design.
          </p>
        </div>
        <span class="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/20">
          True 1:1 &amp; 8× Zoom
        </span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Old Downsampled (Problem) -->
        <div class="p-4 rounded-xl border border-red-500/30 bg-red-500/5 space-y-3">
          <div class="flex items-center justify-between text-xs">
            <span class="font-bold text-red-600 dark:text-red-400 flex items-center gap-1.5">
              <span>✕</span> Old Downsampled Icon
            </span>
            <span class="text-stone-400 font-mono text-[11px]">icon-16.png</span>
          </div>

          <div class="flex items-center gap-5 py-2">
            <!-- 1:1 Actual size -->
            <div class="flex flex-col items-center gap-1.5 shrink-0">
              <div class="w-10 h-10 rounded-lg bg-stone-100 dark:bg-stone-800 flex items-center justify-center border border-stone-200 dark:border-stone-700">
                <img src="data:image/png;base64,${old16B64}" alt="Old 16px" width="16" height="16" class="pixelated" />
              </div>
              <span class="text-[10px] font-mono text-stone-500">1:1 Actual</span>
            </div>

            <!-- 8x Zoomed in -->
            <div class="flex flex-col items-center gap-1.5 shrink-0">
              <div class="w-28 h-28 rounded-lg bg-stone-100 dark:bg-stone-800 flex items-center justify-center border border-stone-200 dark:border-stone-700 overflow-hidden checkered-bg">
                <img src="data:image/png;base64,${old16B64}" alt="Old 16px zoomed" width="112" height="112" class="pixelated" />
              </div>
              <span class="text-[10px] font-mono text-stone-500">8× Zoom</span>
            </div>

            <div class="flex-1 text-xs text-stone-600 dark:text-stone-400 space-y-1">
              <p class="font-semibold text-red-600 dark:text-red-400 text-xs">Issues at small size:</p>
              <ul class="list-disc list-inside text-[11px] space-y-0.5 text-stone-500 dark:text-stone-400">
                <li>Micro-text "PDF" turns into muddy gray blur.</li>
                <li>Speed lines and 0.2px strokes create visual noise.</li>
                <li>Handle is too thin, fading out completely.</li>
              </ul>
            </div>
          </div>
        </div>

        <!-- New Optically Recreated (Solution) -->
        <div class="p-4 rounded-xl border border-emerald-500/40 bg-emerald-500/5 space-y-3">
          <div class="flex items-center justify-between text-xs">
            <span class="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <span>✓</span> Recreated Optical Icon
            </span>
            <span class="text-stone-400 font-mono text-[11px]">Option 1 (Pixel-Tuned)</span>
          </div>

          <div class="flex items-center gap-5 py-2">
            <!-- 1:1 Actual size -->
            <div class="flex flex-col items-center gap-1.5 shrink-0">
              <div class="w-10 h-10 rounded-lg bg-stone-100 dark:bg-stone-800 flex items-center justify-center border border-stone-200 dark:border-stone-700">
                <div class="w-4 h-4 svg-wrapper">
                  ${svg16}
                </div>
              </div>
              <span class="text-[10px] font-mono text-stone-500">1:1 Actual</span>
            </div>

            <!-- 8x Zoomed in -->
            <div class="flex flex-col items-center gap-1.5 shrink-0">
              <div class="w-28 h-28 rounded-lg bg-stone-100 dark:bg-stone-800 flex items-center justify-center border border-stone-200 dark:border-stone-700 overflow-hidden checkered-bg p-2">
                <div class="w-full h-full svg-wrapper">
                  ${svg16}
                </div>
              </div>
              <span class="text-[10px] font-mono text-stone-500">8× Zoom</span>
            </div>

            <div class="flex-1 text-xs text-stone-600 dark:text-stone-400 space-y-1">
              <p class="font-semibold text-emerald-600 dark:text-emerald-400 text-xs">Optical optimizations:</p>
              <ul class="list-disc list-inside text-[11px] space-y-0.5 text-stone-500 dark:text-stone-400">
                <li>Bold, sculpted handle readable instantly.</li>
                <li>High-contrast linen paper sheet with amber mark.</li>
                <li>Clean silhouette with zero subpixel fuzz.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- THE 3 RECREATED DESIGN OPTIONS -->
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-base font-bold text-stone-900 dark:text-stone-100">
          Recreated Small Icon Design Variations
        </h2>
        <span class="text-xs text-stone-500">Choose your preferred design</span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-5">

        <!-- VARIANT 1: OPTIC BADGE (RECOMMENDED) -->
        <div class="p-5 rounded-2xl bg-white dark:bg-stone-900 border-2 border-amber-500/70 shadow-md space-y-4 flex flex-col justify-between relative overflow-hidden">
          <div class="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-amber-500 text-white font-mono text-[10px] font-bold uppercase tracking-wider shadow-2xs">
            Recommended
          </div>

          <div class="space-y-1.5">
            <h3 class="font-bold text-base text-stone-900 dark:text-stone-100">
              Option 1: Optic Badge
            </h3>
            <p class="text-xs text-stone-500 dark:text-stone-400 leading-relaxed">
              Preserves the iconic warm amber squircle. Scaled-up cast-iron weight (+25%), thick sculpted handle, and clean linen paper sheets for razor-sharp recognition.
            </p>
          </div>

          <!-- Size Ladder Preview -->
          <div class="py-3 px-3 rounded-xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 space-y-3">
            <span class="text-[10px] font-mono uppercase tracking-wider text-stone-400 font-semibold block">
              Scale Ladder (16px to 64px)
            </span>
            <div class="flex items-end justify-between gap-1.5">
              <div class="flex flex-col items-center gap-1">
                <div class="w-4 h-4 svg-wrapper">${svg16}</div>
                <span class="text-[9px] font-mono text-stone-400">16</span>
              </div>
              <div class="flex flex-col items-center gap-1">
                <div class="w-6 h-6 svg-wrapper">${svgOpt1}</div>
                <span class="text-[9px] font-mono text-stone-400">24</span>
              </div>
              <div class="flex flex-col items-center gap-1">
                <div class="w-8 h-8 svg-wrapper">${svgOpt1}</div>
                <span class="text-[9px] font-mono text-stone-400">32</span>
              </div>
              <div class="flex flex-col items-center gap-1">
                <div class="w-12 h-12 svg-wrapper">${svgOpt1}</div>
                <span class="text-[9px] font-mono text-stone-400">48</span>
              </div>
              <div class="flex flex-col items-center gap-1">
                <div class="w-16 h-16 svg-wrapper">${svgOpt1}</div>
                <span class="text-[9px] font-mono text-stone-400">64</span>
              </div>
            </div>
          </div>

          <div class="text-[11px] font-mono text-stone-500 dark:text-stone-400 pt-1 border-t border-stone-100 dark:border-stone-800">
            Best for: App Favicon, Desktop Shortcut, Mobile App Icon.
          </div>
        </div>

        <!-- VARIANT 2: FRAMELESS MARK -->
        <div class="p-5 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-sm space-y-4 flex flex-col justify-between">
          <div class="space-y-1.5">
            <h3 class="font-bold text-base text-stone-900 dark:text-stone-100">
              Option 2: Frameless Mark
            </h3>
            <p class="text-xs text-stone-500 dark:text-stone-400 leading-relaxed">
              No outer squircle box. The cast-iron weight and paper sheets fill 100% of the canvas. Maximum surface area and zero wasted padding pixels.
            </p>
          </div>

          <!-- Size Ladder Preview -->
          <div class="py-3 px-3 rounded-xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 space-y-3">
            <span class="text-[10px] font-mono uppercase tracking-wider text-stone-400 font-semibold block">
              Scale Ladder (16px to 64px)
            </span>
            <div class="flex items-end justify-between gap-1.5">
              <div class="flex flex-col items-center gap-1">
                <div class="w-4 h-4 svg-wrapper">${svgOpt2}</div>
                <span class="text-[9px] font-mono text-stone-400">16</span>
              </div>
              <div class="flex flex-col items-center gap-1">
                <div class="w-6 h-6 svg-wrapper">${svgOpt2}</div>
                <span class="text-[9px] font-mono text-stone-400">24</span>
              </div>
              <div class="flex flex-col items-center gap-1">
                <div class="w-8 h-8 svg-wrapper">${svgOpt2}</div>
                <span class="text-[9px] font-mono text-stone-400">32</span>
              </div>
              <div class="flex flex-col items-center gap-1">
                <div class="w-12 h-12 svg-wrapper">${svgOpt2}</div>
                <span class="text-[9px] font-mono text-stone-400">48</span>
              </div>
              <div class="flex flex-col items-center gap-1">
                <div class="w-16 h-16 svg-wrapper">${svgOpt2}</div>
                <span class="text-[9px] font-mono text-stone-400">64</span>
              </div>
            </div>
          </div>

          <div class="text-[11px] font-mono text-stone-500 dark:text-stone-400 pt-1 border-t border-stone-100 dark:border-stone-800">
            Best for: Browser Tabs, Status Bar, Taskbar Tray.
          </div>
        </div>

        <!-- VARIANT 3: PAPER SEAL -->
        <div class="p-5 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-sm space-y-4 flex flex-col justify-between">
          <div class="space-y-1.5">
            <h3 class="font-bold text-base text-stone-900 dark:text-stone-100">
              Option 3: Paper Seal
            </h3>
            <p class="text-xs text-stone-500 dark:text-stone-400 leading-relaxed">
              A crisp folded document page with the amber cast-iron paperweight stamped cleanly in the center. Distinct, physical document metaphor.
            </p>
          </div>

          <!-- Size Ladder Preview -->
          <div class="py-3 px-3 rounded-xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 space-y-3">
            <span class="text-[10px] font-mono uppercase tracking-wider text-stone-400 font-semibold block">
              Scale Ladder (16px to 64px)
            </span>
            <div class="flex items-end justify-between gap-1.5">
              <div class="flex flex-col items-center gap-1">
                <div class="w-4 h-4 svg-wrapper">${svgOpt3}</div>
                <span class="text-[9px] font-mono text-stone-400">16</span>
              </div>
              <div class="flex flex-col items-center gap-1">
                <div class="w-6 h-6 svg-wrapper">${svgOpt3}</div>
                <span class="text-[9px] font-mono text-stone-400">24</span>
              </div>
              <div class="flex flex-col items-center gap-1">
                <div class="w-8 h-8 svg-wrapper">${svgOpt3}</div>
                <span class="text-[9px] font-mono text-stone-400">32</span>
              </div>
              <div class="flex flex-col items-center gap-1">
                <div class="w-12 h-12 svg-wrapper">${svgOpt3}</div>
                <span class="text-[9px] font-mono text-stone-400">48</span>
              </div>
              <div class="flex flex-col items-center gap-1">
                <div class="w-16 h-16 svg-wrapper">${svgOpt3}</div>
                <span class="text-[9px] font-mono text-stone-400">64</span>
              </div>
            </div>
          </div>

          <div class="text-[11px] font-mono text-stone-500 dark:text-stone-400 pt-1 border-t border-stone-100 dark:border-stone-800">
            Best for: File Association icons, document badges.
          </div>
        </div>

      </div>
    </div>

    <!-- REAL-WORLD CONTEXT SIMULATION -->
    <div class="p-5 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-sm space-y-4">
      <h2 class="text-sm font-bold uppercase tracking-wider text-stone-600 dark:text-stone-300 font-mono">
        Real-World Context Simulation
      </h2>

      <!-- Simulated Chrome Browser Tab -->
      <div class="space-y-1.5">
        <span class="text-[11px] font-mono text-stone-400 font-semibold">1. Browser Tab (16 × 16 px Favicon in context)</span>
        <div class="h-10 px-3 bg-stone-200 dark:bg-stone-950 rounded-t-xl flex items-center">
          <div class="h-8 px-3.5 bg-white dark:bg-stone-900 rounded-t-lg border-t border-x border-stone-300 dark:border-stone-700 flex items-center gap-2 max-w-xs shadow-xs">
            <div class="w-4 h-4 svg-wrapper shrink-0">
              ${svg16}
            </div>
            <span class="text-xs font-medium text-stone-800 dark:text-stone-200 truncate">
              Paperweight &bull; Private Document Studio
            </span>
            <span class="text-stone-400 text-xs ml-auto">&times;</span>
          </div>
        </div>
      </div>

      <!-- Simulated Windows Taskbar -->
      <div class="space-y-1.5 pt-2">
        <span class="text-[11px] font-mono text-stone-400 font-semibold">2. Windows Taskbar (24 × 24 px App Icon in context)</span>
        <div class="h-12 px-4 bg-stone-900 text-white rounded-xl flex items-center gap-3 border border-stone-800">
          <!-- Start icon -->
          <div class="w-6 h-6 flex items-center justify-center text-sky-400">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 2.2L6.5 1.3V7.5H0V2.2ZM0 8.5H6.5V14.7L0 13.8V8.5ZM7.5 1.2L16 0V7.5H7.5V1.2ZM7.5 8.5H16V16L7.5 14.8V8.5Z"/></svg>
          </div>
          <div class="h-6 w-px bg-stone-800" />
          <!-- Active Paperweight Taskbar item -->
          <div class="h-10 px-3 rounded-lg bg-stone-800 border-b-2 border-amber-500 flex items-center gap-2.5 shadow-sm">
            <div class="w-6 h-6 svg-wrapper shrink-0">
              ${svgOpt1}
            </div>
            <span class="text-xs font-medium text-stone-200 hidden sm:inline">Paperweight</span>
          </div>
        </div>
      </div>

    </div>

  </div>

  <script>
    const themeLightBtn = document.getElementById('themeLightBtn');
    const themeDarkBtn = document.getElementById('themeDarkBtn');

    themeLightBtn.addEventListener('click', () => {
      document.documentElement.classList.remove('dark');
      themeLightBtn.className = 'px-3 py-1.5 rounded-lg bg-white text-stone-900 shadow-xs cursor-pointer';
      themeDarkBtn.className = 'px-3 py-1.5 rounded-lg bg-transparent text-stone-600 cursor-pointer';
    });

    themeDarkBtn.addEventListener('click', () => {
      document.documentElement.classList.add('dark');
      themeDarkBtn.className = 'px-3 py-1.5 rounded-lg bg-stone-700 text-stone-100 shadow-xs cursor-pointer';
      themeLightBtn.className = 'px-3 py-1.5 rounded-lg bg-transparent text-stone-400 cursor-pointer';
    });
  </script>
</body>
</html>`;

fs.writeFileSync(outPath, html, 'utf8');
console.log('Showcase HTML generated successfully at ' + outPath);

