/* الوضع الفاتح/الداكن: يتبع إعداد الجهاز افتراضياً، ويحفظ اختيار المستخدم إن غيّره يدوياً.
   التطبيق المبكر قبل الرسم موجود في <head> داخل SETUP_GUIDE.html لتفادي وميض الألوان. */
(function () {
  'use strict';

  const THEME_KEY = 'ag-launchpad-ar.theme';
  const toggle = document.getElementById('themeToggle');
  const icon = document.getElementById('themeIcon');

  function effectiveTheme() {
    const chosen = document.documentElement.dataset.theme;
    if (chosen) return chosen;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function syncIcon() {
    const dark = effectiveTheme() === 'dark';
    icon.textContent = dark ? '☀️' : '🌙';
    toggle.setAttribute('aria-label', dark ? 'التبديل إلى الوضع الفاتح' : 'التبديل إلى الوضع الداكن');
  }

  toggle.addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* التخزين غير متاح — يبقى الاختيار لهذه الزيارة فقط */ }
    syncIcon();
  });

  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncIcon);
  syncIcon();
})();
