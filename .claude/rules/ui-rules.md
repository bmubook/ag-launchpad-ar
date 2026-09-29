---
paths:
  - "**/*.{html,htm,css,scss,sass,less,jsx,tsx,vue,svelte,astro,dart}"
  - "**/tokens.*"
  - "**/{styles,components,pages,screens,widgets,layouts,theme,ui}/**"
  - "**/locales/**"
  - "**/app/**/{page,layout}.{js,ts,jsx,tsx}"
---

# قواعد الواجهات — تحميل تلقائي عند العمل على ملفات الواجهات

<!-- يُحمَّل هذا الملف فقط عندما يقرأ Claude ملفاً يطابق الأنماط أعلاه، لإبقاء سياق الجلسة ضمن ميزانية CLAUDE.md. -->

> [!IMPORTANT]
> أنت تعمل الآن على ملفات واجهات. **قبل أي تعديل** اقرأ `rules_ui.md` كاملاً إن لم تكن قرأته في هذه الجلسة، والتزم بالمسار الإلزامي لبناء الواجهات بترتيبه الحتمي.

* مصدر القيم الوحيد: ملف المتغيرات المركزي (البند 32 — `tokens.css` للويب، `lib/core/theme/app_tokens.dart` لـ Flutter، `src/theme/tokens.ts` لـ React Native). لا ألوان ولا خطوط ولا تباعد مكتوبة يدوياً.
* RTL إلزامي: `dir="rtl"` و CSS Logical Properties (`margin-inline-start` لا `margin-left`)، و `line-height` ≥ 1.7.
* لا نصوص مكتوبة داخل المكونات — كل النصوص في `locales/ar.json` (البند 30).
* قبل اعتماد أي تعديل كبير على الواجهات: `/consensus-gate` (يُفعّل `ux-critic` تلقائياً).
