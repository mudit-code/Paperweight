(function () {
  var STORAGE_KEY = 'pw-website-theme';
  var root = document.documentElement;

  function getPreferredTheme() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (e) {}
    return 'dark';
  }

  function applyTheme(theme) {
    var resolved = theme === 'light' ? 'light' : 'dark';
    root.setAttribute('data-theme', resolved);

    var btn = document.getElementById('theme-toggle-btn');
    if (btn) {
      var isLight = resolved === 'light';
      btn.setAttribute('aria-pressed', String(isLight));
      btn.setAttribute('title', isLight ? 'Switch to dark mode' : 'Switch to light mode');
      btn.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');

      var sun = btn.querySelector('[data-icon="sun"]');
      var moon = btn.querySelector('[data-icon="moon"]');
      var label = btn.querySelector('[data-theme-label]');
      if (sun && moon) {
        sun.style.display = isLight ? 'none' : 'block';
        moon.style.display = isLight ? 'block' : 'none';
      }
      if (label) {
        label.textContent = isLight ? 'Dark' : 'Light';
      }
    }
  }

  applyTheme(getPreferredTheme());

  window.addEventListener('DOMContentLoaded', function () {
    applyTheme(root.getAttribute('data-theme') || getPreferredTheme());

    var btn = document.getElementById('theme-toggle-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch (e) {}
        applyTheme(next);
      });
    }
  });
})();
