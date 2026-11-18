import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import fs from 'fs';

// https://vitejs.dev/config/
export default defineConfig({
  base: './', // Essential for Tauri desktop packaging and relative asset loading
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'pdf-lib', 'jszip', 'upng-js'],
  },
  plugins: [
    {
      name: 'serve-website-static-assets',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url && req.url.startsWith('/website/')) {
            const cleanUrl = req.url.split('?')[0];
            const filePath = path.resolve(__dirname, '.' + cleanUrl);
            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
              if (cleanUrl.endsWith('.css')) {
                res.setHeader('Content-Type', 'text/css');
                res.end(fs.readFileSync(filePath));
                return;
              }
              if (cleanUrl.endsWith('.woff2')) {
                res.setHeader('Content-Type', 'font/woff2');
                res.end(fs.readFileSync(filePath));
                return;
              }
            }
          }
          next();
        });
      },
    },
    react(),
    VitePWA({
      registerType: 'prompt', // Prompt-based service worker update flow
      includeAssets: [
        'favicon.svg',
        'icon-192.png',
        'icon-512.png',
        'icon-maskable-512.png',
        'fonts/*.woff2',
        'standard_fonts/*',
        'cmaps/*.bcmap',
      ],
      manifest: {
        name: 'Paperweight',
        short_name: 'Paperweight',
        description: 'Runs fully on your device. Offline document and image workspace.',
        theme_color: '#151517',
        background_color: '#151517',
        display: 'standalone',
        orientation: 'any',
        scope: './',
        start_url: './',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,pfb,ttf,bcmap}'],
        // Connect-src 'none' means runtime fetches will be internal to the SW cache
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: {
        enabled: false, // Don't interfere during active development
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/installer-output/**', '**/android/**', '**/android-output/**', '**/dist/**'],
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
