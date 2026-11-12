/**
 * Paperweight Promotional Video Engine (1080p @ 60 FPS Canvas Compositor)
 * Built exclusively from real Desktop & Android Paperweight app screenshots.
 * Powers both the landing page preview (index.html) and cinema theater (video.html),
 * including interactive scrubbing, chapter navigation, and 1080p .webm export.
 */

(function () {
  'use strict';

  var DURATION = 36.0;
  var SCENES = [
    {
      id: 'scanner',
      tag: '01 / 06 · SCAN TO PDF',
      title: 'Edge-detected document scanner',
      subtitle: 'Auto-crop tilted receipts and photos into clean offline PDFs.',
      start: 0,
      end: 6,
    },
    {
      id: 'compressor',
      tag: '02 / 06 · COMPRESS',
      title: 'Calibrated batch compressor',
      subtitle: 'Desktop & Android run on the exact same local compression engine.',
      start: 6,
      end: 12,
    },
    {
      id: 'viewer',
      tag: '03 / 06 · PDF VIEWER',
      title: '60 FPS vector zoom & search',
      subtitle: 'Instant page thumbnails, high-DPI clarity, and yellow/blue search matches.',
      start: 12,
      end: 18,
    },
    {
      id: 'resizer',
      tag: '04 / 06 · RESIZE BY CROPPING',
      title: 'Exact dimensions & KB limits',
      subtitle: 'Lock width, height, and file size ceiling in px, inches, or cm.',
      start: 18,
      end: 24,
    },
    {
      id: 'merge-convert',
      tag: '05 / 06 · MERGE & CONVERT',
      title: 'Combine PDFs & switch formats',
      subtitle: 'Reorder pages visually or extract crisp PNG/JPEG pages offline.',
      start: 24,
      end: 30,
    },
    {
      id: 'library-cta',
      tag: '06 / 06 · LIBRARY & v0.2.19',
      title: 'Drafts, processed history & zero cloud',
      subtitle: 'Resume unfinished work cleanly on Windows 10/11 and Android 8.0+.',
      start: 30,
      end: 36,
    },
  ];

  var SCREEN_FILES = {
    scannerDesktop: 'assets/screens/01-scanner-desktop.png',
    compressorDesktop: 'assets/screens/02-compressor-desktop.png',
    resizerDesktop: 'assets/screens/03-resizer-desktop.png',
    mergerDesktop: 'assets/screens/04-merger-desktop.png',
    converterDesktop: 'assets/screens/05-converter-desktop.png',
    viewerDesktop: 'assets/screens/06-pdfviewer-desktop.png',
    libraryDesktop: 'assets/screens/07-library-desktop.png',
    compressorMobile: 'assets/screens/08-compressor-mobile.png',
    libraryMobile: 'assets/screens/09-library-mobile.png',
  };

  class PromoMotionGraphic {
    constructor(canvasId) {
      this.canvas = document.getElementById(canvasId);
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');

      this.width = 1920;
      this.height = 1080;
      this.canvas.width = this.width;
      this.canvas.height = this.height;

      this.currentTime = 0;
      this.isPlaying = true;
      this.playbackRate = 1.0;
      this.lastTimestamp = performance.now();
      this.isRecording = false;
      this.mediaRecorder = null;
      this.recordedChunks = [];
      this.isMuted = true;
      this.audioCtx = null;
      this.audioDest = null;
      this.lastPlayedScene = -1;

      this.playBtn = document.getElementById('promo-play-btn');
      this.muteBtn = document.getElementById('promo-mute-btn');
      this.progressBar = document.getElementById('promo-progress');
      this.timelineBar = document.getElementById('promo-timeline');
      this.timeDisplay = document.getElementById('promo-time');
      this.recordBtn = document.getElementById('promo-record-btn');
      this.recordBanner = document.getElementById('promo-recording-banner');
      this.fullscreenBtn = document.getElementById('promo-fs-btn');
      this.chapterButtons = document.querySelectorAll('.chapter-pill');

      this.screens = {};
      this.loadScreens();
      this.bindEvents();
      this.startLoop();
    }

    loadScreens() {
      var self = this;
      var keys = Object.keys(SCREEN_FILES);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var img = new Image();
        img.decoding = 'async';
        img.onload = function () {
          self.renderFrame();
        };
        img.src = SCREEN_FILES[key];
        this.screens[key] = img;
      }
      this.renderFrame();
    }

    initAudio() {
      if (this.audioCtx) return;
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.audioCtx = new AudioCtx();
      this.audioDest = this.audioCtx.createMediaStreamDestination();
    }

    playSceneChime(sceneIndex) {
      if (this.isMuted || !this.audioCtx) return;
      try {
        var ctx = this.audioCtx;
        var now = ctx.currentTime;
        var chords = [
          [220, 277.18, 329.63],
          [246.94, 311.13, 369.99],
          [261.63, 329.63, 392.0],
          [293.66, 369.99, 440.0],
          [329.63, 415.3, 493.88],
          [392.0, 493.88, 587.33],
        ];
        var chord = chords[sceneIndex % chords.length];
        for (var i = 0; i < chord.length; i++) {
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(chord[i], now);
          gain.gain.setValueAtTime(0.001, now);
          gain.gain.exponentialRampToValueAtTime(0.04 / chord.length, now + 0.08);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
          osc.connect(gain);
          gain.connect(ctx.destination);
          if (this.audioDest) gain.connect(this.audioDest);
          osc.start(now);
          osc.stop(now + 1.15);
        }
      } catch (err) {}
    }

    bindEvents() {
      var self = this;

      if (this.playBtn) {
        this.playBtn.addEventListener('click', function () {
          self.togglePlay();
        });
      }

      this.canvas.addEventListener('click', function () {
        self.togglePlay();
      });

      if (this.muteBtn) {
        this.muteBtn.addEventListener('click', function () {
          self.initAudio();
          self.isMuted = !self.isMuted;
          self.muteBtn.textContent = self.isMuted ? '🔇 Audio Off' : '🔊 Audio On';
          if (!self.isMuted && self.audioCtx && self.audioCtx.state === 'suspended') {
            self.audioCtx.resume();
          }
        });
      }

      if (this.timelineBar) {
        this.timelineBar.addEventListener('click', function (e) {
          var rect = self.timelineBar.getBoundingClientRect();
          var ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          self.seekTo(ratio * DURATION);
        });
      }

      this.chapterButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var idx = parseInt(btn.getAttribute('data-scene'), 10);
          if (!isNaN(idx) && SCENES[idx]) {
            self.seekTo(SCENES[idx].start);
          }
        });
      });

      if (this.recordBtn) {
        this.recordBtn.addEventListener('click', function () {
          self.startRecording();
        });
      }

      if (this.fullscreenBtn) {
        this.fullscreenBtn.addEventListener('click', function () {
          var card = self.canvas.closest('.player-card') || self.canvas.parentElement;
          if (!document.fullscreenElement) {
            card.requestFullscreen().catch(function () {});
          } else {
            document.exitFullscreen().catch(function () {});
          }
        });
      }

      var s1 = document.getElementById('promo-speed-1');
      var s15 = document.getElementById('promo-speed-15');
      var s2 = document.getElementById('promo-speed-2');
      if (s1 && s15 && s2) {
        s1.addEventListener('click', function () { self.setSpeed(1.0, s1); });
        s15.addEventListener('click', function () { self.setSpeed(1.5, s15); });
        s2.addEventListener('click', function () { self.setSpeed(2.0, s2); });
      }

      window.addEventListener('keydown', function (e) {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        if (e.code === 'Space') {
          e.preventDefault();
          self.togglePlay();
        } else if (e.code === 'ArrowRight') {
          e.preventDefault();
          self.seekTo(Math.min(DURATION, self.currentTime + 3));
        } else if (e.code === 'ArrowLeft') {
          e.preventDefault();
          self.seekTo(Math.max(0, self.currentTime - 3));
        }
      });
    }

    setSpeed(rate, activeBtn) {
      this.playbackRate = rate;
      document.querySelectorAll('.speed-pill').forEach(function (b) {
        b.classList.remove('active');
      });
      activeBtn.classList.add('active');
    }

    togglePlay() {
      this.isPlaying = !this.isPlaying;
      if (this.playBtn) {
        this.playBtn.textContent = this.isPlaying ? '⏸ Pause' : '▶ Play';
      }
      this.initAudio();
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
    }

    seekTo(time) {
      this.currentTime = Math.max(0, Math.min(DURATION, time));
      this.renderFrame();
      this.updateUI();
    }

    startLoop() {
      var self = this;
      var tick = function (timestamp) {
        var dt = Math.max(0, Math.min(0.1, (timestamp - self.lastTimestamp) / 1000));
        self.lastTimestamp = timestamp;

        if (self.isPlaying) {
          self.currentTime = Math.max(0, self.currentTime + dt * self.playbackRate);
          if (self.currentTime >= DURATION) {
            if (self.isRecording) {
              self.stopRecording();
            } else {
              self.currentTime = 0;
            }
          }
        }

        self.renderFrame();
        self.updateUI();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    updateUI() {
      if (this.progressBar) {
        this.progressBar.style.width = ((this.currentTime / DURATION) * 100).toFixed(2) + '%';
      }
      if (this.timeDisplay) {
        var cSec = Math.floor(this.currentTime % 60);
        var tSec = Math.floor(DURATION % 60);
        this.timeDisplay.textContent =
          '0:' + (cSec < 10 ? '0' : '') + cSec + ' / 0:' + (tSec < 10 ? '0' : '') + tSec;
      }

      var curIdx = SCENES.findIndex(
        function (s) {
          return this.currentTime >= s.start && this.currentTime < s.end;
        },
        this
      );
      if (curIdx !== -1 && curIdx !== this.lastPlayedScene) {
        this.lastPlayedScene = curIdx;
        this.playSceneChime(curIdx);
      }

      this.chapterButtons.forEach(function (btn, idx) {
        btn.classList.toggle('active', idx === curIdx);
      });
    }

    // -----------------------------------------------------------------------
    // Render Pipeline
    // -----------------------------------------------------------------------

    renderFrame() {
      var ctx = this.ctx;
      var w = this.width;
      var h = this.height;
      var t = this.currentTime;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1.0;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, w, h);

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Studio obsidian gradient backdrop matching Paperweight brand identity
      var bg = ctx.createRadialGradient(w * 0.5, h * 0.42, 80, w * 0.5, h * 0.5, w * 0.78);
      bg.addColorStop(0, '#1e1d1a');
      bg.addColorStop(0.55, '#141416');
      bg.addColorStop(1, '#0d0d0f');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Subtle architectural grid
      ctx.save();
      ctx.strokeStyle = 'rgba(236, 234, 228, 0.03)';
      ctx.lineWidth = 1;
      for (var gx = 80; gx < w; gx += 120) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
      }
      for (var gy = 80; gy < h; gy += 120) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }
      ctx.restore();

      var safeT = Math.max(0, Math.min(DURATION - 0.0001, Number.isFinite(t) ? t : 0));
      var sceneIdx = Math.max(0, Math.min(SCENES.length - 1, Math.floor(safeT / 6.0)));
      var localT = Math.max(0, safeT - sceneIdx * 6.0);
      var scene = SCENES[sceneIdx] || SCENES[0];
      var enter = sceneIdx === 0 && safeT < 0.6 ? 1.0 : this.easeOutCubic(Math.min(1, localT / 0.55));
      var exit = localT > 5.45 ? this.easeOutCubic(Math.max(0, (6.0 - localT) / 0.55)) : 1;
      var alpha = Math.min(enter, exit);

      this.renderHeaderBar(ctx, w, scene, alpha);

      ctx.save();
      ctx.globalAlpha = alpha;
      if (sceneIdx === 0) {
        this.renderSceneScanner(ctx, w, h, localT);
      } else if (sceneIdx === 1) {
        this.renderSceneCompressor(ctx, w, h, localT);
      } else if (sceneIdx === 2) {
        this.renderScenePdfViewer(ctx, w, h, localT);
      } else if (sceneIdx === 3) {
        this.renderSceneResizer(ctx, w, h, localT);
      } else if (sceneIdx === 4) {
        this.renderSceneMergeConvert(ctx, w, h, localT);
      } else {
        this.renderSceneLibraryCTA(ctx, w, h, localT);
      }
      ctx.restore();
    }

    renderHeaderBar(ctx, w, scene, alpha) {
      ctx.save();
      ctx.globalAlpha = 0.96;

      // Top-left brand mark
      this.drawMiniBrandLogo(ctx, 76, 44, 40);
      ctx.fillStyle = '#ECEAE4';
      ctx.font = '700 26px "Space Grotesk", -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Paperweight', 128, 72);

      // Top-right offline badge
      ctx.fillStyle = '#1F1F22';
      ctx.strokeStyle = 'rgba(242, 209, 75, 0.35)';
      ctx.lineWidth = 1.5;
      this.roundRect(ctx, w - 340, 44, 264, 42, 21, true, true);
      ctx.fillStyle = '#F2D14B';
      ctx.beginPath();
      ctx.arc(w - 314, 65, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ECEAE4';
      ctx.font = '600 15px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.fillText('v0.2.19 · 100% OFFLINE', w - 298, 71);

      // Scene Tag & Headline Strip cleanly separated from canvas edges
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#F2D14B';
      ctx.font = '700 16px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(scene.tag, 76, 136);

      ctx.fillStyle = '#ECEAE4';
      ctx.font = '700 44px "Space Grotesk", -apple-system, sans-serif';
      ctx.fillText(scene.title, 76, 188);

      ctx.fillStyle = '#A9A79F';
      ctx.font = '400 22px "Space Grotesk", -apple-system, sans-serif';
      ctx.fillText(scene.subtitle, 76, 224);

      ctx.restore();
    }

    // Scene 1: Real Document Scanner Editor with Quad Edge Detection Focus
    renderSceneScanner(ctx, w, h, localT) {
      var slideY = (1 - this.easeOutCubic(Math.min(1, localT / 0.7))) * 24;
      var focusProg = this.easeInOutSine(Math.min(1, Math.max(0, (localT - 1.0) / 3.8)));

      this.drawDesktopFrame(
        ctx,
        this.screens.scannerDesktop,
        104,
        262 + slideY - focusProg * 8,
        1200,
        784,
        {
          zoom: 1.0,
          caption: 'Scan Studio — Perspective Quad & Enhancement Tools',
        }
      );

      // Right-hand real workflow highlights aligned symmetrically
      this.drawInfoStack(ctx, 1344, 310, 496, [
        { k: 'EDGE DETECTION', v: 'Automatic Quad Crop & Unwarp', accent: true },
        { k: 'FILTERS', v: 'Magic B&W · Contrast · Color' },
        { k: 'PRIVACY', v: 'Zero external uploads · Save directly to PDF' },
      ], localT);
    }

    // Scene 2: Real Compressor Desktop + Real Android Mobile UI side-by-side
    renderSceneCompressor(ctx, w, h, localT) {
      var slide = (1 - this.easeOutCubic(Math.min(1, localT / 0.7))) * 24;
      var floatY = Math.sin(localT * 1.1) * 4;

      this.drawDesktopFrame(
        ctx,
        this.screens.compressorDesktop,
        76,
        268 + slide,
        1200,
        784,
        {
          zoom: 1.0,
          caption: 'Desktop Compressor · 40% Target Calibration',
        }
      );

      // Live Android Mobile App Frame cleanly framed with breathing room below
      var phonePop = this.easeOutCubic(Math.min(1, Math.max(0, (localT - 0.35) / 0.75)));
      ctx.save();
      ctx.globalAlpha *= phonePop;
      this.drawPhoneFrame(
        ctx,
        this.screens.compressorMobile,
        1390,
        260 + (1 - phonePop) * 28 + floatY,
        342,
        740,
        'Android App · -58% to -81% Saved'
      );
      ctx.restore();
    }

    // Scene 3: Real 60 FPS PDF Viewer (Vector crispness + Yellow/Blue search highlights)
    renderScenePdfViewer(ctx, w, h, localT) {
      var enter = this.easeOutCubic(Math.min(1, localT / 0.7));
      var floatY = this.easeInOutSine(Math.min(1, Math.max(0, (localT - 0.8) / 3.8))) * -8;

      this.drawDesktopFrame(
        ctx,
        this.screens.viewerDesktop,
        104,
        262 + (1 - enter) * 24 + floatY,
        1220,
        796,
        {
          zoom: 1.0,
          caption: 'Hardware-Accelerated PDF Viewer · Search "offline" (1/6)',
        }
      );

      this.drawInfoStack(ctx, 1364, 316, 476, [
        { k: 'ZOOM CRISP', v: 'Native High-DPI Rendering', accent: true },
        { k: 'TEXT FIND', v: 'Blue Active + Gold Matches' },
        { k: 'NAVIGATION', v: 'Instant Thumbnail Rail & Shortcuts' },
      ], localT);
    }

    // Scene 4: Real Exact Cropper & Image Resizer
    renderSceneResizer(ctx, w, h, localT) {
      var enter = this.easeOutCubic(Math.min(1, localT / 0.7));
      var floatY = this.easeInOutSine(Math.min(1, Math.max(0, (localT - 0.9) / 3.5))) * -8;

      this.drawDesktopFrame(
        ctx,
        this.screens.resizerDesktop,
        104,
        262 + (1 - enter) * 24 + floatY,
        1200,
        784,
        {
          zoom: 1.0,
          caption: 'Exact Pixel / CM / Inch Cropper · 1200 × 1200 px',
        }
      );

      this.drawInfoStack(ctx, 1344, 316, 496, [
        { k: 'EXACT TARGETS', v: '1200 × 1200 px · ≤ 200 KB', accent: true },
        { k: 'NO STRETCHING', v: 'Rule-of-Thirds Interactive Framing' },
        { k: 'FORM READY', v: 'Pixels, Inches & Centimeters at 300 DPI' },
      ], localT);
    }

    // Scene 5: Real PDF Merger & Format Converter Showcase
    renderSceneMergeConvert(ctx, w, h, localT) {
      var enter = this.easeOutCubic(Math.min(1, localT / 0.65));
      var shift = this.easeInOutSine(Math.min(1, Math.max(0, (localT - 2.0) / 1.5)));

      ctx.save();
      this.drawDesktopFrame(
        ctx,
        this.screens.mergerDesktop,
        76 - shift * 14,
        268 + (1 - enter) * 22,
        920,
        609,
        {
          zoom: 1.0,
          caption: 'PDF Merger · Reorder & Combine Pages',
        }
      );

      this.drawDesktopFrame(
        ctx,
        this.screens.converterDesktop,
        916 - shift * 14,
        420 + (1 - enter) * 22 - shift * 18,
        928,
        614,
        {
          zoom: 1.0,
          caption: 'Converter · PDF ↔ PNG / JPEG / WebP',
        }
      );
      ctx.restore();
    }

    // Scene 6: Classified Library + Cross-Platform v0.2.19 Call-to-Action
    renderSceneLibraryCTA(ctx, w, h, localT) {
      var enter = this.easeOutCubic(Math.min(1, localT / 0.7));

      this.drawDesktopFrame(
        ctx,
        this.screens.libraryDesktop,
        76,
        270 + (1 - enter) * 22,
        1100,
        722,
        {
          zoom: 1.0,
          caption: 'Desktop Library · Recently Processed & Drafts',
        }
      );

      this.drawPhoneFrame(
        ctx,
        this.screens.libraryMobile,
        1204,
        266 + (1 - enter) * 28,
        326,
        706,
        'Android Library'
      );

      // Right download summary column aligned cleanly
      ctx.save();
      var cardX = 1560;
      var cardY = 270;
      var cardW = 284;

      ctx.fillStyle = '#1E1E22';
      ctx.strokeStyle = 'rgba(242, 209, 75, 0.45)';
      ctx.lineWidth = 2;
      this.roundRect(ctx, cardX, cardY, cardW, 290, 18, true, true);

      this.drawMiniBrandLogo(ctx, cardX + 26, cardY + 26, 44);
      ctx.fillStyle = '#ECEAE4';
      ctx.font = '700 28px "Space Grotesk", -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Paperweight', cardX + 26, cardY + 114);

      ctx.fillStyle = '#F2D14B';
      ctx.font = '700 15px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText('v0.2.19 · FREE', cardX + 26, cardY + 144);

      ctx.fillStyle = '#A9A79F';
      ctx.font = '400 16px "Space Grotesk", -apple-system, sans-serif';
      ctx.fillText('Android 8.0+ APK (7.5 MB)', cardX + 26, cardY + 194);
      ctx.fillText('Windows x64 EXE (139.5 MB)', cardX + 26, cardY + 224);

      ctx.fillStyle = '#F2D14B';
      this.roundRect(ctx, cardX + 26, cardY + 244, cardW - 52, 30, 8, true, false);
      ctx.fillStyle = '#151517';
      ctx.font = '700 14px "Space Grotesk", -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No Cloud · Airplane Safe', cardX + cardW / 2, cardY + 264);
      ctx.restore();
    }

    // -----------------------------------------------------------------------
    // Compositing Primitives for Real Screenshots
    // -----------------------------------------------------------------------

    drawDesktopFrame(ctx, img, x, y, width, height, opts) {
      opts = opts || {};
      var barH = 34;
      var radius = 14;

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
      ctx.shadowBlur = 44;
      ctx.shadowOffsetY = 18;

      ctx.fillStyle = '#141312';
      ctx.strokeStyle = 'rgba(236, 234, 228, 0.16)';
      ctx.lineWidth = 1.5;
      this.roundRect(ctx, x, y, width, height, radius, true, true);
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      // Clean caption chrome bar
      ctx.fillStyle = '#1B1A18';
      this.roundRectTop(ctx, x, y, width, barH, radius);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.beginPath();
      ctx.moveTo(x, y + barH);
      ctx.lineTo(x + width, y + barH);
      ctx.stroke();

      ctx.fillStyle = '#F2D14B';
      ctx.beginPath();
      ctx.arc(x + 20, y + barH / 2, 4.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#A9A79F';
      ctx.font = '600 13px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(opts.caption || 'Paperweight Desktop', x + 36, y + 21);

      // Clipped viewport drawing full unclipped app UI cleanly
      var viewY = y + barH;
      var viewH = height - barH;
      ctx.beginPath();
      ctx.moveTo(x, viewY);
      ctx.lineTo(x + width, viewY);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.closePath();
      ctx.clip();

      if (img && img.complete && img.naturalWidth > 0) {
        var zoom = opts.zoom || 1;
        var scale = Math.min(width / img.naturalWidth, viewH / img.naturalHeight) * zoom;
        var drawW = img.naturalWidth * scale;
        var drawH = img.naturalHeight * scale;
        var dx = x + (width - drawW) * 0.5;
        var dy = viewY + (viewH - drawH) * 0.5;
        ctx.drawImage(img, dx, dy, drawW, drawH);
      } else {
        ctx.fillStyle = '#141312';
        ctx.fillRect(x, viewY, width, viewH);
      }
      ctx.restore();
    }

    drawPhoneFrame(ctx, img, x, y, width, height, label) {
      var bezel = 12;
      var radius = 32;

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.72)';
      ctx.shadowBlur = 40;
      ctx.shadowOffsetY = 18;

      // Outer metallic charcoal handset frame
      ctx.fillStyle = '#25252A';
      ctx.strokeStyle = 'rgba(236, 234, 228, 0.25)';
      ctx.lineWidth = 2;
      this.roundRect(ctx, x, y, width, height, radius, true, true);
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      // Screen clip
      var sx = x + bezel;
      var sy = y + bezel;
      var sw = width - bezel * 2;
      var sh = height - bezel * 2;
      this.roundRect(ctx, sx, sy, sw, sh, radius - 8, false, false);
      ctx.clip();

      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, sx, sy, sw, sh);
      } else {
        ctx.fillStyle = '#141312';
        ctx.fillRect(sx, sy, sw, sh);
      }

      // Subtle punch-hole camera dot at top center
      ctx.fillStyle = 'rgba(15, 15, 18, 0.85)';
      ctx.beginPath();
      ctx.arc(x + width / 2, sy + 16, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (label) {
        ctx.save();
        ctx.fillStyle = '#F2D14B';
        ctx.font = '600 13px ui-monospace, Menlo, Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(label, x + width / 2, y + height + 26);
        ctx.restore();
      }
    }

    drawInfoStack(ctx, x, y, width, items, localT) {
      ctx.save();
      for (var i = 0; i < items.length; i++) {
        var delay = 0.25 + i * 0.22;
        var p = this.easeOutCubic(Math.min(1, Math.max(0, (localT - delay) / 0.5)));
        var cy = y + i * 138 + (1 - p) * 18;

        ctx.globalAlpha = p;
        ctx.fillStyle = '#1E1E22';
        ctx.strokeStyle = items[i].accent ? 'rgba(242, 209, 75, 0.55)' : '#34343A';
        ctx.lineWidth = 1.5;
        this.roundRect(ctx, x, cy, width, 114, 14, true, true);

        ctx.fillStyle = items[i].accent ? '#F2D14B' : '#A9A79F';
        ctx.font = '700 13px ui-monospace, Menlo, Consolas, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(items[i].k, x + 22, cy + 38);

        ctx.fillStyle = '#ECEAE4';
        ctx.font = '700 21px "Space Grotesk", -apple-system, sans-serif';
        ctx.fillText(items[i].v, x + 22, cy + 74);
      }
      ctx.restore();
    }

    drawMiniBrandLogo(ctx, x, y, size) {
      var s = size / 64;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(s, s);
      ctx.fillStyle = '#F2EEE3';
      this.roundRect(ctx, 8, 44, 48, 12, 3, true, false);
      ctx.fillStyle = '#CFC9B8';
      this.roundRect(ctx, 12, 38, 40, 10, 3, true, false);
      ctx.strokeStyle = '#F2D14B';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(22, 16);
      ctx.lineTo(22, 12);
      ctx.arc(26, 12, 4, Math.PI, Math.PI * 1.5);
      ctx.lineTo(38, 8);
      ctx.arc(38, 12, 4, Math.PI * 1.5, 0);
      ctx.lineTo(42, 16);
      ctx.stroke();

      ctx.fillStyle = '#F2D14B';
      ctx.beginPath();
      ctx.moveTo(18, 18);
      ctx.lineTo(46, 18);
      ctx.lineTo(52, 38);
      ctx.lineTo(12, 38);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // -----------------------------------------------------------------------
    // 1080p WebM Recorder Export
    // -----------------------------------------------------------------------

    startRecording() {
      if (this.isRecording) return;
      this.initAudio();
      var self = this;

      try {
        var stream = this.canvas.captureStream(60);
        if (this.audioDest && this.audioDest.stream) {
          var audioTracks = this.audioDest.stream.getAudioTracks();
          if (audioTracks.length > 0) stream.addTrack(audioTracks[0]);
        }

        var mimes = [
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm',
        ];
        var chosenMime = mimes.find(function (m) {
          return MediaRecorder.isTypeSupported(m);
        }) || '';

        this.mediaRecorder = new MediaRecorder(stream, {
          mimeType: chosenMime,
          videoBitsPerSecond: 10000000,
        });
        this.recordedChunks = [];
        this.mediaRecorder.ondataavailable = function (e) {
          if (e.data && e.data.size > 0) self.recordedChunks.push(e.data);
        };
        this.mediaRecorder.onstop = function () {
          var blob = new Blob(self.recordedChunks, { type: chosenMime || 'video/webm' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'Paperweight-Walkthrough-v0.2.19.webm';
          document.body.appendChild(a);
          a.click();
          setTimeout(function () {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }, 3000);

          if (self.recordBanner) self.recordBanner.classList.remove('active');
          if (self.recordBtn) {
            self.recordBtn.textContent = 'Export Video (.webm)';
            self.recordBtn.disabled = false;
          }
          self.isRecording = false;
        };

        this.isMuted = false;
        if (this.muteBtn) this.muteBtn.textContent = '🔊 Audio On';
        this.seekTo(0);
        this.isPlaying = true;
        this.isRecording = true;

        if (this.recordBanner) this.recordBanner.classList.add('active');
        if (this.recordBtn) {
          this.recordBtn.textContent = 'Recording 0:36...';
          this.recordBtn.disabled = true;
        }
        this.mediaRecorder.start(200);
      } catch (err) {
        alert('Browser does not support canvas video export: ' + err.message);
      }
    }

    stopRecording() {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
    }

    // -----------------------------------------------------------------------
    // Geometry & Easing Utilities
    // -----------------------------------------------------------------------

    easeOutCubic(x) {
      return 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
    }

    easeInOutSine(x) {
      var clamped = Math.max(0, Math.min(1, x));
      return -(Math.cos(Math.PI * clamped) - 1) / 2;
    }

    roundRect(ctx, x, y, w, h, r, fill, stroke) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
      if (fill) ctx.fill();
      if (stroke) ctx.stroke();
    }

    roundRectTop(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }
  }

  window.addEventListener('DOMContentLoaded', function () {
    window.promoEngine = new PromoMotionGraphic('promo-canvas');
  });
})();
