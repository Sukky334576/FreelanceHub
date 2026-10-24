/* Run before styles paint so a saved dark theme never flashes a white page. */
(function () {
  'use strict';
  var storageKey = 'freelancehub_theme';
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var preference = 'system';
  function valid(value) { return ['light', 'dark', 'system'].includes(value); }
  try {
    var saved = localStorage.getItem(storageKey);
    if (valid(saved)) preference = saved;
  } catch (_) { /* Private browsing can disallow storage; switching still works. */ }

  function apply() {
    var theme = preference === 'system' ? (media && media.matches ? 'dark' : 'light') : preference;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#121212' : '#164F57');
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      var label = theme === 'dark' ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด';
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      var icon = button.querySelector('i');
      if (icon) icon.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    });
    document.querySelectorAll('[data-theme-option]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.themeOption === preference));
    });
    window.dispatchEvent(new CustomEvent('app:themechange', {detail: {theme: theme, preference: preference}}));
  }
  function select(value) {
    if (!valid(value)) return;
    preference = value;
    try { localStorage.setItem(storageKey, preference); } catch (_) {}
    apply();
  }
  apply();
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.addEventListener('click', function () { select(root.dataset.theme === 'dark' ? 'light' : 'dark'); });
    });
    document.querySelectorAll('[data-theme-option]').forEach(function (button) {
      button.addEventListener('click', function () { select(button.dataset.themeOption); });
    });
    apply();
  });
  if (media) {
    var followSystem = function () { if (preference === 'system') apply(); };
    if (media.addEventListener) media.addEventListener('change', followSystem);
    else if (media.addListener) media.addListener(followSystem);
  }
  window.addEventListener('storage', function (event) {
    if (event.key !== storageKey && event.key !== null) return;
    preference = valid(event.newValue) ? event.newValue : 'system';
    apply();
  });
})();
