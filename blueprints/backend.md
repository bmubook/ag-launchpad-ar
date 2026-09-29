<div dir="rtl">

# ⚙️ مخطط الباك إند وقاعدة البيانات — Firebase

## 1. متى تختار هذا المخطط / متى لا تختاره

| ✅ اختره عندما | ❌ لا تختره عندما |
|:---|:---|
| تحتاج قاعدة بيانات و API لتطبيق موجود أو لعدة واجهات | تريد واجهة للمستخدم أيضاً — ابدأ بـ `web.md` أو مخطط جوال (يتضمن الخلفية) |
| خدمة بيانات أو أتمتة (إرسال بريد، معالجة ملفات، تكامل مع خدمات دفع) | معالجة بيانات ضخمة أو تعلّم آلي ثقيل — يحتاج تصميماً مخصصاً |
| تريد خلفية بلا خوادم تديرها بنفسك (Serverless) | تقارير علاقية معقدة جداً — البديل ضمن Firebase: Data Connect (PostgreSQL مُدار) بقرار موثّق |

## 2. الحزمة التقنية

| الطبقة | التقنية | لماذا | التوثيق الرسمي |
|:---|:---|:---|:---|
| قاعدة البيانات | Cloud Firestore | مستندات مرنة، فهارس، تحديث فوري | https://firebase.google.com/docs/firestore |
| المصادقة | Firebase Authentication | جاهزة وآمنة ومتكاملة مع قواعد الأمان | https://firebase.google.com/docs/auth |
| منطق الخادم و API | Cloud Functions for Firebase (TypeScript) | دوال تُستدعى من التطبيق أو عبر HTTPS أو عند أحداث قاعدة البيانات — تتطلب خطة Blaze | https://firebase.google.com/docs/functions |
| الوصول الإداري | Firebase Admin SDK (داخل الدوال فقط) | عمليات موثوقة تتجاوز قواعد العميل بأمان | https://firebase.google.com/docs/admin/setup |
| تخزين الملفات | Cloud Storage for Firebase + Storage Rules | رفع الصور والملفات بصلاحيات — راجع متطلبات الخطة | https://firebase.google.com/docs/storage |
| التحقق من البيانات | Zod | تحقق حتمي من كل طلب يصل للدوال (البندان 23 و28) | https://zod.dev |
| التجربة المحلية | Firebase Local Emulator Suite | الدوال والقاعدة والمصادقة والقواعد محلياً | https://firebase.google.com/docs/emulator-suite |
| البديل العلاقي | Firebase Data Connect | PostgreSQL مُدار داخل Firebase عند الحاجة لعلاقات معقدة — بقرار ADR | https://firebase.google.com/docs/data-connect |

## 3. سياسة الإصدارات
- المتطلبات الدنيا: Node.js بالإصدار الذي تدعمه Cloud Functions حالياً (راجع التوثيق)، و Firebase CLI، و JDK 21 أو أحدث للمحاكيات (Firebase CLI الحالي يرفض الإصدارات الأقدم — ثبّت Eclipse Temurin 21 من https://adoptium.net). قارنها بنتيجة `/env-audit`.
- أنشئ هيكل الدوال بالأمر الرسمي `firebase init` واختر TypeScript، ولا تعتمد على أرقام إصدارات من الذاكرة (البند 4).

## 4. هيكل المجلدات

```
functions/
├── src/
│   ├── index.ts           ← تصدير الدوال فقط
│   ├── api/v1/            ← دوال HTTPS مقسّمة حسب الميزة بإصدار v1 (البند 28)
│   ├── triggers/          ← دوال تعمل عند أحداث Firestore أو المصادقة
│   ├── services/          ← منطق الأعمال
│   ├── repositories/      ← كل قراءة وكتابة لـ Firestore هنا
│   └── validation/        ← مخططات Zod
└── test/
firestore.rules            ← قواعد الأمان (البند 18 — تُعدَّل عبر /db-change فقط)
firestore.indexes.json     ← الفهارس
storage.rules              ← قواعد تخزين الملفات
firebase.json · .firebaserc
scripts/migrations/        ← سكربتات تحديث شكل البيانات الموجودة، مؤرخة وتُجرَّب على المحاكي أولاً
tests/rules/               ← اختبارات قواعد الأمان
```

## 5. خط الأساس الأمني
- **قواعد مغلقة افتراضياً** لكل مجموعة، ثم صلاحيات المالك فقط، مع التحقق من شكل البيانات المكتوبة:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /projects/{projectId} {
      allow read, delete: if request.auth != null
        && request.auth.uid == resource.data.ownerId;
      allow create, update: if request.auth != null
        && request.auth.uid == request.resource.data.ownerId
        && request.resource.data.name is string
        && request.resource.data.name.size() <= 200;
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```
- &rlm;**Admin SDK يتجاوز القواعد:** يُستخدم داخل Cloud Functions فقط، بعد التحقق من هوية المستدعي (`request.auth` في الدوال القابلة للاستدعاء `onCall`، أو التحقق من ID Token عبر Admin SDK في دوال HTTPS `onRequest`) ومن صلاحيته، ثم التحقق من المدخلات بـ Zod — بهذا الترتيب.
- **ملف حساب الخدمة (Service Account) سرّ حقيقي:** لا يُرفع إلى Git ولا يُطبع في السجلات. داخل Cloud Functions لا تحتاجه أصلاً (الصلاحيات تُمنح تلقائياً).
- **الأسرار** (مفاتيح خدمات الدفع والبريد) عبر Secret Manager في Cloud Functions، لا في الكود ولا في `.env` المرفوع.
- حد للطلبات (Rate Limiting) و App Check على الدوال العامة والمكلفة.
- المعرّفات: معرّفات Firestore التلقائية + حقل `createdAt` بقيمة `serverTimestamp()` (البند 28).

## 6. خط أساس الجودة (ما ينفّذه `/quality-setup`)
| الأداة | الاختيار |
|:---|:---|
| المدقق والمنسّق | ESLint + Prettier داخل `functions/` |
| الاختبارات | Vitest أو Jest لمنطق الأعمال + اختبار الدوال على المحاكي |
| اختبارات قواعد الأمان | `@firebase/rules-unit-testing`: مستخدم لا يقرأ بيانات غيره، وزائر لا يكتب شيئاً |
| CI | `.github/workflows/ci.yml`: تثبيت ← lint ←&rlm; test ←&rlm; `firebase emulators:exec "npm run test:rules"` ←&rlm; build — خطوة اختبارات القواعد في CI تحتاج تثبيت Java (`actions/setup-java` بالإصدار 21) و Firebase CLI (`npm install -g firebase-tools`) على المشغّل قبلها |
| الاعتماديات | `.github/dependabot.yml` لـ npm و github-actions |

## 7. النشر
1. أنشئ مشروع Firebase، ورقِّه إلى خطة Blaze إذا احتجت Cloud Functions، وفعّل **تنبيه الميزانية** فوراً.
2. اختبر كل شيء على المحاكي: `firebase emulators:start`.
3. انشر بعد موافقتك: القواعد والفهارس `firebase deploy --only firestore:rules,firestore:indexes`، ثم الدوال `firebase deploy --only functions` — لا تعديل يدوي من لوحة التحكم (البند 18).
4. فعّل النسخ الاحتياطي لـ Firestore (Backups أو Point-in-time recovery) وجرّب الاستعادة مرة واحدة.

## 8. أخطاء المبتدئين الشائعة وكيف يمنعها المخطط
| الخطأ | الوقاية |
|:---|:---|
| قواعد «وضع الاختبار» تكشف كل البيانات | قواعد مغلقة افتراضياً + `/db-change` + اختبارات القواعد + `/launch-check` |
| تعديل القواعد من لوحة التحكم فيختلف الإنتاج عن المستودع | القواعد ملفات في المستودع تُنشر بـ CLI فقط (البند 18) |
| دالة عامة بلا تحقق من الهوية يستغلها أي شخص | ترتيب: هوية ← صلاحية ← مدخلات في كل دالة |
| فاتورة مفاجئة من حلقة كتابة لا تنتهي في Trigger | تنبيه الميزانية + اختبار الـ Triggers على المحاكي أولاً |
| مفاتيح خدمات خارجية داخل الكود | Secret Manager + Hook الحارس الأمني |

## 9. المراحل المقترحة
| # | المرحلة | أهم المهام |
|:---:|:---|:---|
| 1 | التأسيس | العصف الذهني، اعتماد المخطط، `/quality-setup`، المحاكيات المحلية |
| 2 | نموذج البيانات والأمان | المجموعات، قواعد الأمان واختباراتها، المصادقة |
| 3 | المنطق و API | الدوال ميزة ميزة مع اختباراتها وتوثيقها (البند 25) |
| 4 | التكاملات | خدمات خارجية، Triggers، حدود الطلبات، App Check |
| 5 | الفحص والنشر | `/launch-check`، النشر، النسخ الاحتياطي، المراقبة |

</div>
