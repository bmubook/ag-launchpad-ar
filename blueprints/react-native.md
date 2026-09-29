<div dir="rtl">

# 📱 مخطط تطبيق الجوال — React Native (Expo) + Firebase

## 1. متى تختار هذا المخطط / متى لا تختاره

| ✅ اختره عندما | ❌ لا تختره عندما |
|:---|:---|
| تطبيق جوال لـ Android و iOS وتفضّل JavaScript/TypeScript | تحتاج رسومات وحركات معقدة جداً بأداء أقصى — Flutter أنسب (`flutter.md`) |
| تريد تجربة التطبيق فوراً على جوالك عبر تطبيق Expo Go | المطلوب موقع ويب قابل للبحث — استخدم `web.md` |
| تريد بناء ونشر للمتاجر دون إعداد معقد (EAS) | تحتاج مكتبة أصلية غير مدعومة في Expo (نادر — تحقق أولاً) |

## 2. الحزمة التقنية

| الطبقة | التقنية | لماذا | التوثيق الرسمي |
|:---|:---|:---|:---|
| الإطار | Expo + React Native + TypeScript | أسهل بداية للجوال، وتحديثات وأدوات بناء جاهزة | https://docs.expo.dev |
| التنقل | Expo Router | مسارات بالملفات مثل مواقع الويب | https://docs.expo.dev/router/introduction |
| ربط Firebase | Firebase JS SDK (الحزمة `firebase`) — يعمل داخل Expo Go دون بناء مخصص | أبسط طريق للمبتدئ؛ دليل Expo الرسمي يشرحه | https://docs.expo.dev/guides/using-firebase |
| المصادقة | Firebase Authentication مع حفظ الجلسة على الجهاز (حسب دليل Expo/Firebase) | بريد وكلمة مرور وحسابات اجتماعية | https://firebase.google.com/docs/auth |
| قاعدة البيانات | Cloud Firestore | مستندات مرنة وتحديث فوري | https://firebase.google.com/docs/firestore |
| التخزين الآمن | `expo-secure-store` | لأي قيمة حساسة إضافية على الجهاز | https://docs.expo.dev/versions/latest/sdk/securestore |
| اللغات و RTL | `expo-localization` + مكتبة ترجمة (مثل i18next) | العربية والإنجليزية ودعم RTL | https://docs.expo.dev/guides/localization |
| متغيرات التصميم | `src/theme/tokens.ts` (البند 32) | ألوان وخطوط وتباعد من مصدر واحد | — |
| التحقق من المدخلات | Zod | تحقق حتمي قبل الإرسال (البند 28) | https://zod.dev |

> 💡 إذا احتجت لاحقاً ميزات أصلية متقدمة (مثل الإشعارات عبر FCM) فالبديل هو React Native Firebase مع بناء مخصص (Development Build) — ناقشه كقرار موثّق عند الحاجة.

## 3. سياسة الإصدارات
- المتطلبات الدنيا: Node.js بالإصدار الذي يشترطه توثيق Expo الحالي، وتطبيق Expo Go على جوالك، و Firebase CLI و JDK 21 أو أحدث للمحاكيات (Firebase CLI الحالي يرفض الإصدارات الأقدم — ثبّت Eclipse Temurin 21 من https://adoptium.net).
- ثبّت الحزم بالأمر `npx expo install <الحزمة>` ليختار الإصدار المتوافق مع نسخة Expo — لا تستخدم أرقاماً من الذاكرة (البند 19).
- أنشئ المشروع بالأمر الرسمي الحالي من توثيق Expo، واتبع دليل Expo لـ Firebase حرفياً في التهيئة.

## 4. هيكل المجلدات

```
app/                        ← الشاشات والمسارات (Expo Router)
├── (auth)/                 ← الدخول والتسجيل
├── (tabs)/                 ← الشاشات الرئيسية بعد الدخول
└── _layout.tsx             ← التهيئة: السمة، اللغة، حماية المسارات
src/
├── components/             ← مكونات ذرية قابلة لإعادة الاستخدام
├── lib/firebase.ts         ← تهيئة Firebase من متغيرات EXPO_PUBLIC_FIREBASE_*
├── services/               ← كل قراءة وكتابة لـ Firestore هنا
├── theme/tokens.ts         ← متغيرات التصميم (البند 32)
└── locales/ar.json, en.json
firestore.rules             ← قواعد الأمان (البند 18 — تُعدَّل عبر /db-change فقط)
firestore.indexes.json · firebase.json
```
الأسقف: منطق ≤ 250 سطراً، شاشات ومكونات (TSX) ≤ 400 (البند 14).

## 5. خط الأساس الأمني
- **التطبيق عام بطبيعته:** متغيرات `EXPO_PUBLIC_FIREBASE_*` تُضمَّن داخل التطبيق — وهي معرّفات عامة وليست أسراراً؛ الحماية الحقيقية في **قواعد الأمان**. لا تضع أي مفتاح سري أو ملف حساب خدمة داخل التطبيق أبداً.
- **قواعد مغلقة افتراضياً** مع صلاحيات المالك فقط (المثال في `web.md` القسم 5)، ولا «وضع اختبار» أبداً.
- القيم الحساسة الإضافية في `expo-secure-store` لا في AsyncStorage.
- العمليات الحساسة (دفع، صلاحيات إدارية) تُنفَّذ على الخادم عبر Cloud Functions لا داخل التطبيق.
- فعّل **App Check** قبل الإطلاق وفق التوثيق الرسمي.

## 6. خط أساس الجودة (ما ينفّذه `/quality-setup`)
| الأداة | الاختيار |
|:---|:---|
| المدقق | ESLint بإعداد Expo الرسمي (`npx expo lint`) |
| المنسّق | Prettier |
| الاختبارات | Jest بإعداد `jest-expo` + React Native Testing Library — اختبار عرض لشاشة رئيسية واختبار لمنطق حقيقي |
| اختبارات قواعد الأمان | `@firebase/rules-unit-testing` على المحاكي في `tests/rules/` |
| فحص الأنواع | `tsc --noEmit` ضمن أمر `check` |
| CI | `.github/workflows/ci.yml`: `npm ci` ← lint ← فحص الأنواع ← test ← `firebase emulators:exec "npm run test:rules"` — خطوة اختبارات القواعد في CI تحتاج تثبيت Java (`actions/setup-java` بالإصدار 21) و Firebase CLI (`npm install -g firebase-tools`) على المشغّل قبلها |
| الاعتماديات | `.github/dependabot.yml` لـ npm و github-actions |

## 7. النشر
1. أنشئ مشروع Firebase، وسجّل تطبيق ويب داخله للحصول على قيم الإعداد، وضعها في `.env` بمتغيرات `EXPO_PUBLIC_FIREBASE_*`.
2. انشر القواعد والفهارس بعد اختبارها وموافقتك: `firebase deploy --only firestore:rules,firestore:indexes`.
3. استخدم **EAS Build** لبناء نسخ Android و iOS في السحابة (لا تحتاج Mac لبناء iOS)، ثم **EAS Submit** للنشر في المتاجر (حسابا مطوّر مطلوبان).
4. أضف متغيرات البيئة في إعدادات EAS لا في الكود.

## 8. أخطاء المبتدئين الشائعة وكيف يمنعها المخطط
| الخطأ | الوقاية |
|:---|:---|
| ترك قواعد «وضع الاختبار» | قواعد مغلقة افتراضياً + اختبارات القواعد + `/launch-check` |
| تثبيت حزمة بإصدار غير متوافق مع Expo | `npx expo install` دائماً |
| نسيان حالات التحميل والخطأ | قائمة حالات المكونات في `rules_ui.md` + مُراجع الواجهات |
| قراءة مجموعات كاملة فترتفع التكلفة | استعلامات بفلترة و `limit` في `services/` |
| اختبار التطبيق على جهاز واحد فقط | اختبار على Android و iOS وشاشة صغيرة قبل `/launch-check` |

## 9. المراحل المقترحة
| # | المرحلة | أهم المهام |
|:---:|:---|:---|
| 1 | التأسيس | العصف الذهني، اعتماد المخطط، `/quality-setup`، `tokens.ts`، تدفق الشاشات |
| 2 | البيانات والمصادقة | مشروع Firebase، نموذج البيانات، قواعد الأمان واختباراتها، التسجيل والدخول |
| 3 | الميزات الأساسية للـ MVP | ميزة ميزة مع اختباراتها |
| 4 | الواجهات والتجربة | الحالات، RTL، الوصولية، أحجام الشاشات |
| 5 | الفحص والنشر | `/launch-check`، App Check، EAS Build، الرفع للمتاجر |

</div>
