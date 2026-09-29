<div dir="rtl">

# 🌐 مخطط تطبيق الويب — Next.js + Supabase

## 1. متى تختار هذا المخطط / متى لا تختاره

| ✅ اختره عندما | ❌ لا تختره عندما |
|:---|:---|
| موقع أو تطبيق ويب متجاوب فيه تسجيل دخول وبيانات (متجر، حجوزات، لوحة تحكم، منصة محتوى) | موقع تعريفي ثابت بلا بيانات — صفحة HTML/CSS بسيطة أو أداة مواقع ثابتة تكفي |
| تحتاج SEO (ظهور في محركات البحث) وسرعة تحميل | تطبيق جوال أصلي هو المطلوب — استخدم `flutter.md` أو `react-native.md` |
| تريد الواجهة والخادم في مشروع واحد | أداة داخلية صغيرة جداً بلا SEO — البديل الأبسط: Vite + React (تطبيق صفحة واحدة) مع Supabase |

## 2. الحزمة التقنية

| الطبقة | التقنية | لماذا | التوثيق الرسمي |
|:---|:---|:---|:---|
| الإطار | Next.js (App Router) + TypeScript | واجهة وخادم معاً، عرض من الخادم لسرعة وSEO، وأكبر مجتمع React | https://nextjs.org/docs |
| قاعدة البيانات والمصادقة | Supabase (PostgreSQL + Auth + Storage) | قاعدة حقيقية مع RLS ومصادقة جاهزة | https://supabase.com/docs |
| ربط Supabase بـ Next.js | `@supabase/supabase-js` + `@supabase/ssr` | جلسات عبر الكوكيز بدل localStorage (البند 28) | https://supabase.com/docs/guides/auth/server-side/nextjs |
| التحقق من البيانات | Zod | تحقق حتمي من كل مدخل على الخادم (البندان 23 و28) | https://zod.dev |
| حالة الخادم في الواجهة | TanStack Query — عند الحاجة فقط | للبيانات التفاعلية في مكونات العميل؛ مكونات الخادم تكفي غالباً | https://tanstack.com/query |
| التنسيق | CSS مع `tokens.css` (البند 32) — Tailwind اختياري بشرط قراءة المتغيرات نفسها | مصدر واحد للألوان والخطوط والتباعد | https://nextjs.org/docs/app/getting-started/css |
| تعدد اللغات و RTL | next-intl (أو مكتبة i18n رسمية الدعم لـ App Router) | ملفات `ar.json` و `en.json` واتجاه RTL (البند 30) | https://next-intl.dev |
| الاستضافة | Vercel | نشر مباشر من GitHub ودعم كامل لـ Next.js | https://vercel.com/docs |

## 3. سياسة الإصدارات
- المتطلب الأدنى: Node.js بالإصدار الذي يشترطه توثيق Next.js الحالي (تحقق منه، وقارنه بنتيجة `/env-audit`).
- لا تثبّت أرقام الإصدارات من هذا الملف. أنشئ المشروع بالأمر الرسمي الحالي من توثيق Next.js، واتبع دليل Supabase الرسمي لـ Next.js حرفياً في إعداد العميل والجلسات (أسماء الملفات تتغير بين الإصدارات).

## 4. هيكل المجلدات

```
src/
├── app/                    ← الصفحات والمسارات (App Router) — ملف لكل صفحة
│   ├── (auth)/             ← صفحات الدخول والتسجيل
│   ├── (app)/              ← الصفحات المحمية بعد الدخول
│   └── layout.tsx          ← يستورد tokens.css ويضبط lang="ar" و dir="rtl"
├── components/             ← مكونات ذرية: ui/ (أزرار، حقول) ثم features/
├── lib/
│   ├── supabase/           ← عميل المتصفح وعميل الخادم (حسب دليل Supabase)
│   └── validation/         ← مخططات Zod
├── services/               ← طبقة الخدمات: كل استعلامات البيانات هنا لا داخل الصفحات
├── styles/tokens.css       ← متغيرات التصميم (البند 32)
└── locales/ar.json, en.json
supabase/migrations/        ← ملفات الهجرة فقط (البند 18)
tests/                      ← اختبارات الوحدة + e2e/
```
الأسقف: منطق ≤ 250 سطراً، مكونات ≤ 400، CSS ≤ 500 (البند 14).

## 5. خط الأساس الأمني
- **المفاتيح:** المتغيرات التي تبدأ بـ `NEXT_PUBLIC_` تصل للمتصفح — ضع فيها رابط Supabase والمفتاح العام (publishable/anon) فقط. مفتاح `service_role` أو المفتاح السري لا يُستخدم إلا في كود الخادم، ولا يوضع أبداً بمتغير يبدأ بـ `NEXT_PUBLIC_`.
- **RLS افتراضياً مغلق** على كل جدول، ثم سياسات بأقل صلاحية:

```sql
alter table public.orders enable row level security;
create policy "owner can read own orders" on public.orders
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "owner can insert own orders" on public.orders
  for insert to authenticated with check ((select auth.uid()) = user_id);
```
- **التحقق من الصلاحية على الخادم** في كل عملية تعديل (Server Actions / Route Handlers) — لا تثق بأي قيمة قادمة من المتصفح، وتحقق منها بـ Zod.
- **الجلسات:** عبر الكوكيز كما يضبطها `@supabase/ssr` — لا توكنز في localStorage.
- المعرّفات: UUID v7 (البند 28) — إن لم تدعمه نسخة PostgreSQL لديك فولّده في التطبيق.

## 6. خط أساس الجودة (ما ينفّذه `/quality-setup`)
| الأداة | الاختيار |
|:---|:---|
| المدقق | ESLint بإعداد Next.js الرسمي |
| المنسّق | Prettier |
| اختبارات الوحدة | Vitest + React Testing Library (دليل Next.js الرسمي لـ Vitest) |
| اختبار شامل (E2E) | Playwright — اختبار دخاني واحد: الصفحة الرئيسية تعمل |
| أوامر | `lint`، `test`، `build`، `check` في `package.json` |
| CI | `.github/workflows/ci.yml`: `npm ci` ← lint ← test ← build |
| الاعتماديات | `.github/dependabot.yml` لـ npm و github-actions |

## 7. النشر
1. ارفع المشروع إلى GitHub (مستودع خاص أو عام).
2. اربطه بـ Vercel، وأضف متغيرات البيئة في إعدادات المشروع هناك (لا في الكود).
3. طبّق الهجرات على مشروع Supabase السحابي بأداة Supabase CLI بعد اختبارها محلياً.
4. أضف نطاق Vercel إلى إعدادات روابط إعادة التوجيه (Redirect URLs) في مصادقة Supabase.

## 8. أخطاء المبتدئين الشائعة وكيف يمنعها المخطط
| الخطأ | الوقاية |
|:---|:---|
| نسيان RLS فتصبح بيانات الجميع مكشوفة | سياسة "مغلق افتراضياً" + فحص `/launch-check` + مُراجع الأمن |
| وضع المفتاح السري في متغير `NEXT_PUBLIC_` | قاعدة القسم 5 + Hook الحارس الأمني |
| استعلامات قاعدة البيانات داخل مكونات الواجهة مباشرة | طبقة `services/` (البند 28) |
| ألوان وخطوط مكتوبة يدوياً في كل مكان | `tokens.css` + مُراجع الواجهات |
| نصوص عربية مكتوبة داخل المكونات | `locales/ar.json` (البند 30) |

## 9. المراحل المقترحة
| # | المرحلة | أهم المهام |
|:---:|:---|:---|
| 1 | التأسيس | العصف الذهني، اعتماد المخطط، `/quality-setup`، ملف `tokens.css`، تدفق المستخدم والهيكل الأولي |
| 2 | قاعدة البيانات والمصادقة | الجداول بالهجرات، RLS، التسجيل والدخول والخروج |
| 3 | الميزات الأساسية للـ MVP | ميزة ميزة مع اختباراتها |
| 4 | الواجهات والتجاوب | المكونات الذرية، 375px، الوصولية، RTL |
| 5 | الفحص والإطلاق | `/launch-check`، النشر على Vercel، المراقبة |

</div>
