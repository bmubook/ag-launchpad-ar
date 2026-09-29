<div dir="rtl">

# 🌐 مخطط تطبيق الويب — Next.js + Firebase

## 1. متى تختار هذا المخطط / متى لا تختاره

| ✅ اختره عندما | ❌ لا تختره عندما |
|:---|:---|
| موقع أو تطبيق ويب متجاوب فيه تسجيل دخول وبيانات (متجر، حجوزات، لوحة تحكم، منصة محتوى) | موقع تعريفي ثابت بلا بيانات — صفحة HTML/CSS على Firebase Hosting تكفي |
| تحتاج SEO (ظهور في محركات البحث) وسرعة تحميل | تطبيق جوال أصلي هو المطلوب — استخدم `flutter.md` أو `react-native.md` |
| تريد تحديثاً فورياً للبيانات (دردشة، طلبات، إشعارات) دون برمجة خادم | تقارير مالية معقدة تحتاج استعلامات علاقية كثيرة — ناقش البديل في العصف الذهني |

**البديل الأبسط:** أداة داخلية صغيرة بلا SEO ← Vite + React (صفحة واحدة) مع Firebase ونشر على Firebase Hosting المجاني.

## 2. الحزمة التقنية

| الطبقة | التقنية | لماذا | التوثيق الرسمي |
|:---|:---|:---|:---|
| الإطار | Next.js (App Router) + TypeScript | واجهة وخادم معاً، وعرض من الخادم لسرعة و SEO | https://nextjs.org/docs |
| قاعدة البيانات | Cloud Firestore | مستندات مرنة بلا SQL، وتحديث فوري للواجهة | https://firebase.google.com/docs/firestore |
| المصادقة | Firebase Authentication | بريد وكلمة مرور، Google، Apple — جاهزة وآمنة | https://firebase.google.com/docs/auth |
| الحماية | Firestore Security Rules + App Check | القواعد تحدد من يقرأ ويكتب ماذا؛ App Check يمنع الطلبات من غير تطبيقك | https://firebase.google.com/docs/firestore/security/get-started |
| كود الخادم | Firebase Admin SDK (في Server Actions و Route Handlers فقط) | عمليات الخادم الموثوقة والتحقق من الجلسات | https://firebase.google.com/docs/admin/setup |
| التحقق من البيانات | Zod | تحقق حتمي من كل مدخل على الخادم (البندان 23 و28) | https://zod.dev |
| التنسيق | CSS مع `tokens.css` (البند 32) — Tailwind اختياري بشرط قراءة المتغيرات نفسها | مصدر واحد للألوان والخطوط والتباعد | https://nextjs.org/docs/app/getting-started/css |
| تعدد اللغات و RTL | next-intl | ملفات `ar.json` و `en.json` واتجاه RTL (البند 30) | https://next-intl.dev |
| التجربة المحلية | Firebase Local Emulator Suite | تجربة المصادقة وقاعدة البيانات والقواعد محلياً دون لمس بيانات حقيقية | https://firebase.google.com/docs/emulator-suite |
| الاستضافة | Firebase App Hosting (خطة Blaze) — أو Vercel كبديل مجاني | نشر مباشر من GitHub مع دعم كامل لـ Next.js | https://firebase.google.com/docs/app-hosting |

## 3. سياسة الإصدارات
- المتطلبات الدنيا: Node.js بالإصدار الذي يشترطه توثيق Next.js الحالي، و Firebase CLI، و Java (للمحاكيات — راجع الإصدار المطلوب في توثيق المحاكيات). قارنها بنتيجة `/env-audit`.
- لا تثبّت أرقام الإصدارات من هذا الملف. أنشئ المشروع بالأمر الرسمي الحالي من توثيق Next.js، واتبع دليل Firebase الرسمي للويب حرفياً في التهيئة (الواجهات البرمجية تتغير بين الإصدارات).

## 4. هيكل المجلدات

```
src/
├── app/                    ← الصفحات والمسارات (App Router) — ملف لكل صفحة
│   ├── (auth)/             ← صفحات الدخول والتسجيل
│   ├── (app)/              ← الصفحات المحمية بعد الدخول
│   └── layout.tsx          ← يستورد tokens.css ويضبط lang="ar" و dir="rtl"
├── components/             ← مكونات ذرية: ui/ (أزرار، حقول) ثم features/
├── lib/
│   ├── firebase/client.ts  ← تهيئة Firebase للمتصفح (من متغيرات NEXT_PUBLIC_FIREBASE_*)
│   ├── firebase/admin.ts   ← Admin SDK — للخادم فقط، لا يُستورد في أي مكوّن عميل
│   └── validation/         ← مخططات Zod
├── services/               ← طبقة الخدمات: كل قراءة وكتابة لـ Firestore هنا لا داخل الصفحات
├── styles/tokens.css       ← متغيرات التصميم (البند 32)
└── locales/ar.json, en.json
firestore.rules             ← قواعد الأمان (البند 18 — تُعدَّل عبر /db-change فقط)
firestore.indexes.json      ← الفهارس
firebase.json               ← إعدادات Firebase والمحاكيات
tests/                      ← اختبارات الوحدة + rules/ (اختبارات القواعد) + e2e/
```
الأسقف: منطق ≤ 250 سطراً، مكونات ≤ 400، CSS ≤ 500 (البند 14).

## 5. خط الأساس الأمني
- **إعدادات العميل ليست سراً لكنها خارج الكود:** قيم `apiKey` و `projectId` وأخواتها معرّفات عامة بطبيعتها — الحماية الحقيقية في **قواعد الأمان**. ضعها في `.env` بمتغيرات `NEXT_PUBLIC_FIREBASE_*` (البند 5).
- **حساب الخدمة (Service Account) سرّ حقيقي:** ملف JSON يمنح صلاحيات كاملة على المشروع. لا يُرفع إلى Git أبداً، ولا يُوضع في متغير يبدأ بـ `NEXT_PUBLIC_`، ولا يُستخدم إلا في كود الخادم.
- **قواعد مغلقة افتراضياً، ثم صلاحيات بأقل قدر:** لا تستخدم أبداً «وضع الاختبار» (Test Mode) الذي يفتح القاعدة للجميع.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /orders/{orderId} {
      allow read, update, delete: if request.auth != null
        && request.auth.uid == resource.data.ownerId;
      allow create: if request.auth != null
        && request.auth.uid == request.resource.data.ownerId;
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```
- **التحقق على الخادم:** كل Server Action يتحقق من هوية المستخدم وصلاحيته (جلسة httpOnly عبر Admin SDK — Session Cookies)، ومن المدخلات بـ Zod. لا تثق بأي قيمة قادمة من المتصفح.
- **الجلسات:** يدير Firebase Auth جلسة المتصفح بنفسه؛ لا تخزّن التوكنز يدوياً في `localStorage`. للصفحات المحمية من الخادم استخدم Session Cookies بـ httpOnly (البند 28): https://firebase.google.com/docs/auth/admin/manage-cookies
- **App Check:** فعّله قبل الإطلاق لمنع الطلبات من خارج تطبيقك: https://firebase.google.com/docs/app-check
- **المعرّفات:** معرّفات Firestore التلقائية للمستندات + حقل `createdAt` بقيمة `serverTimestamp()` للترتيب الزمني (البند 28).

## 6. خط أساس الجودة (ما ينفّذه `/quality-setup`)
| الأداة | الاختيار |
|:---|:---|
| المدقق | ESLint بإعداد Next.js الرسمي |
| المنسّق | Prettier |
| اختبارات الوحدة | Vitest + React Testing Library |
| اختبارات قواعد الأمان | `@firebase/rules-unit-testing` على المحاكي: مستخدم لا يقرأ بيانات غيره، وزائر لا يكتب شيئاً |
| اختبار شامل (E2E) | Playwright — اختبار دخاني واحد: الصفحة الرئيسية تعمل |
| أوامر | `lint`، `test`، `test:rules`، `build`، `check` في `package.json` |
| CI | `.github/workflows/ci.yml`: `npm ci` ← lint ← test ← `firebase emulators:exec "npm run test:rules"` ← build — خطوة اختبارات القواعد في CI تحتاج تثبيت Java (`actions/setup-java`) و Firebase CLI (`npm install -g firebase-tools`) على المشغّل قبلها |
| الاعتماديات | `.github/dependabot.yml` لـ npm و github-actions |

## 7. النشر
1. أنشئ مشروع Firebase من https://console.firebase.google.com ، وفعّل المصادقة و Firestore.
2. انشر قواعد الأمان والفهارس بعد اختبارها على المحاكي وموافقتك: `firebase deploy --only firestore:rules,firestore:indexes`.
3. **Firebase App Hosting (موحّد مع Firebase):** اربط مستودع GitHub من لوحة التحكم؛ يتطلب خطة Blaze — فعّل تنبيه الميزانية فوراً. المتغيرات السرية عبر Secret Manager لا في الكود.
4. **بديل مجاني:** Vercel — اربط المستودع وأضف متغيرات `NEXT_PUBLIC_FIREBASE_*` في إعداداته.
5. أضف نطاق موقعك إلى **Authorized domains** في إعدادات المصادقة.

## 8. أخطاء المبتدئين الشائعة وكيف يمنعها المخطط
| الخطأ | الوقاية |
|:---|:---|
| ترك قواعد «وضع الاختبار» فتصبح البيانات مكشوفة للجميع | قواعد مغلقة افتراضياً + اختبارات القواعد + `/launch-check` + مُراجع الأمن |
| رفع ملف حساب الخدمة إلى GitHub | `.gitignore` + Hook الحارس الأمني |
| قراءة مجموعة كاملة في كل صفحة فترتفع التكلفة ويبطؤ التطبيق | استعلامات بفلترة و `limit` وتقسيم صفحات في `services/` |
| تعديل القواعد من لوحة التحكم فيختلف الإنتاج عن المستودع | `firestore.rules` في المستودع و `/db-change` فقط (البند 18) |
| نصوص عربية مكتوبة داخل المكونات | `locales/ar.json` (البند 30) |

## 9. المراحل المقترحة
| # | المرحلة | أهم المهام |
|:---:|:---|:---|
| 1 | التأسيس | العصف الذهني، اعتماد المخطط، `/quality-setup`، ملف `tokens.css`، تدفق المستخدم والهيكل الأولي |
| 2 | البيانات والمصادقة | مشروع Firebase، نموذج البيانات، قواعد الأمان واختباراتها، التسجيل والدخول والخروج |
| 3 | الميزات الأساسية للـ MVP | ميزة ميزة مع اختباراتها |
| 4 | الواجهات والتجاوب | المكونات الذرية، 375px، الوصولية، RTL |
| 5 | الفحص والإطلاق | `/launch-check`، App Check، النشر، المراقبة |

</div>
