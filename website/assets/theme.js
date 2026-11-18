(function () {
  var STORAGE_KEY = 'paperweight-theme';
  var root = document.documentElement;

  function getSystemTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function getPreferredTheme() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('pw-website-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (e) {}
    return getSystemTheme();
  }

  function updateOnlineLinks(theme) {
    try {
      document.querySelectorAll('a[href*="mode=online"]').forEach(function (link) {
        var href = link.getAttribute('href');
        href = href.replace(/[?&]theme=[^&]+/, '');
        href += (href.includes('?') ? '&' : '?') + 'theme=' + theme;
        link.setAttribute('href', href);
      });
    } catch (e) {}
  }

  function applyTheme(theme) {
    var resolved = theme === 'dark' ? 'dark' : 'light';
    root.setAttribute('data-theme', resolved);

    var btn = document.getElementById('theme-toggle-btn');
    if (btn) {
      var isDark = resolved === 'dark';
      btn.setAttribute('aria-pressed', String(isDark));
      btn.setAttribute('title', isDark ? 'Switch to light mode' : 'Switch to dark mode');
      btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');

      var sun = btn.querySelector('.icon-sun');
      var moon = btn.querySelector('.icon-moon');
      if (sun && moon) {
        sun.style.display = isDark ? 'block' : 'none';
        moon.style.display = isDark ? 'none' : 'block';
      }
    }

    updateOnlineLinks(resolved);
  }

  // Initial apply
  var initialTheme = getPreferredTheme();
  applyTheme(initialTheme);

  // Listen to system theme changes until user manually toggles
  if (window.matchMedia) {
    var mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    var systemChangeHandler = function (e) {
      try {
        var userChoice = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('pw-website-theme');
        if (!userChoice) {
          applyTheme(e.matches ? 'dark' : 'light');
        }
      } catch (err) {}
    };
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', systemChangeHandler);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(systemChangeHandler);
    }
  }

  window.addEventListener('DOMContentLoaded', function () {
    applyTheme(root.getAttribute('data-theme') || getPreferredTheme());

    var btn = document.getElementById('theme-toggle-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        var current = root.getAttribute('data-theme') || getPreferredTheme();
        var next = current === 'dark' ? 'light' : 'dark';
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch (e) {}
        applyTheme(next);
      });
    }
  });
})();
