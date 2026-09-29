<div dir="rtl">

# 📱 مخطط تطبيق الجوال — Flutter + Firebase

## 1. متى تختار هذا المخطط / متى لا تختاره

| ✅ اختره عندما | ❌ لا تختره عندما |
|:---|:---|
| تطبيق جوال لـ Android و iOS بكود واحد وأداء سلس وواجهات مخصصة | تحتاج موقع ويب قابلاً للبحث في Google — استخدم `web.md` |
| تريد أقوى تكامل مع Firebase (كلاهما من Google، مع أداة إعداد رسمية) | تعرف JavaScript وتريد مشاركة الكود مع موقع ويب — فكّر في `react-native.md` |
| لا يزعجك تعلّم لغة Dart (سهلة ومنظمة) | جهازك لا يتسع لأدوات Android Studio / Xcode المطلوبة للتجربة |

## 2. الحزمة التقنية

| الطبقة | التقنية | لماذا | التوثيق الرسمي |
|:---|:---|:---|:---|
| الإطار | Flutter + Dart | كود واحد للمنصتين، ومكونات Material جاهزة | https://docs.flutter.dev |
| ربط Firebase | FlutterFire (`firebase_core`) + أداة `flutterfire configure` | إعداد رسمي بأمر واحد يولّد `lib/firebase_options.dart` | https://firebase.google.com/docs/flutter/setup |
| المصادقة | `firebase_auth` | بريد، Google، Apple — مع حفظ الجلسة تلقائياً | https://firebase.google.com/docs/auth/flutter/start |
| قاعدة البيانات | `cloud_firestore` | مستندات مرنة، تحديث فوري، وعمل دون اتصال | https://firebase.google.com/docs/firestore/quickstart |
| إدارة الحالة | Riverpod (`flutter_riverpod`) | فصل واضح بين المنطق والواجهة، وسهل الاختبار | https://riverpod.dev |
| التنقل | `go_router` | مسارات واضحة وروابط عميقة، مدعوم من فريق Flutter | https://pub.dev/packages/go_router |
| التخزين الآمن | `flutter_secure_storage` | لأي قيمة حساسة إضافية تحتاج حفظها على الجهاز | https://pub.dev/packages/flutter_secure_storage |
| اللغات و RTL | `flutter_localizations` + ملفات ARB (gen-l10n) | العربية والإنجليزية مع اتجاه RTL تلقائي | https://docs.flutter.dev/ui/internationalization |
| متغيرات التصميم | `lib/core/theme/app_tokens.dart` (البند 32) | ألوان وخطوط وتباعد من مصدر واحد عبر `ThemeData` و `ColorScheme` | https://docs.flutter.dev/cookbook/design/themes |
| التجربة المحلية | Firebase Local Emulator Suite | تجربة المصادقة والقاعدة والقواعد دون لمس بيانات حقيقية | https://firebase.google.com/docs/emulator-suite |

## 3. سياسة الإصدارات
- المتطلبات الدنيا: Flutter SDK مستقر حديث (يتضمن Dart)، و Android Studio للمحاكي، و Xcode على Mac فقط لبناء iOS، و Firebase CLI + FlutterFire CLI، و Java للمحاكيات. تحقق بنتيجة `/env-audit` وبالأمر `flutter doctor`.
- أضف الحزم دائماً بالأمر `flutter pub add <الحزمة>` ليختار الإصدار المتوافق — لا تكتب أرقاماً من الذاكرة. راجع صفحة كل حزمة على pub.dev قبل إضافتها (البند 19).

## 4. هيكل المجلدات

```
lib/
├── main.dart                 ← التهيئة فقط (Firebase + ProviderScope + Router)
├── firebase_options.dart     ← تولّده أداة flutterfire configure — لا تعدّله يدوياً
├── core/
│   ├── theme/app_tokens.dart ← متغيرات التصميم (البند 32)
│   └── router/app_router.dart
├── features/
│   └── <feature>/
│       ├── data/             ← المستودعات (Repositories): كل استدعاءات Firestore هنا
│       ├── application/      ← Providers ومنطق الحالة
│       └── presentation/     ← الشاشات والـ Widgets فقط
└── l10n/app_ar.arb, app_en.arb
test/                         ← اختبارات الوحدة والـ Widgets
integration_test/             ← اختبار شامل للمسار الرئيسي
firestore.rules               ← قواعد الأمان (البند 18 — تُعدَّل عبر /db-change فقط)
firestore.indexes.json · firebase.json
```
الأسقف: ملفات الواجهة (Dart) ≤ 400 سطر (البند 14) — قسّم الشاشة الكبيرة إلى Widgets.

## 5. خط الأساس الأمني
- **التطبيق عام بطبيعته:** أي قيمة داخله يمكن استخراجها. قيم `firebase_options.dart` معرّفات عامة وليست أسراراً — الحماية الحقيقية في **قواعد الأمان**. لا تضع أي مفتاح سري آخر أو ملف حساب خدمة داخل التطبيق أبداً.
- **قواعد مغلقة افتراضياً** مع صلاحيات المالك فقط (المثال في `web.md` القسم 5 ينطبق حرفياً)، ولا «وضع اختبار» أبداً.
- العمليات الحساسة (دفع، صلاحيات إدارية) تُنفَّذ على الخادم عبر Cloud Functions، لا داخل التطبيق.
- فعّل **App Check** (`firebase_app_check`) قبل الإطلاق.
- خزّن أي أسرار إضافية بـ `flutter_secure_storage` لا بـ SharedPreferences.
- **لا ترفع ملفات التوقيع** (`*.jks`، `key.properties`) إلى Git أبداً — القالب يستثنيها في `.gitignore`.

## 6. خط أساس الجودة (ما ينفّذه `/quality-setup`)
| الأداة | الاختيار |
|:---|:---|
| المدقق | `flutter analyze` مع حزمة `flutter_lints` (مفعّلة في المشاريع الجديدة) |
| المنسّق | `dart format .` |
| الاختبارات | `flutter test` — اختبار Widget للشاشة الرئيسية + اختبار وحدة لمنطق حقيقي |
| اختبارات قواعد الأمان | `@firebase/rules-unit-testing` على المحاكي في مجلد `tests/rules/` — وهو مشروع Node صغير مستقل بملف `package.json` خاص به، لأن مشروع Flutter نفسه لا يستخدم npm |
| اختبار شامل | `integration_test` للمسار الرئيسي |
| CI | `.github/workflows/ci.yml`: تثبيت Flutter ← `flutter pub get` ← `dart format --set-exit-if-changed .` ← `flutter analyze` ← `flutter test`، ثم مهمة ثانية لاختبارات القواعد: Node + Java (`actions/setup-java`) + Firebase CLI ← `firebase emulators:exec "npm --prefix tests/rules test"` |
| الاعتماديات | `.github/dependabot.yml` لـ `pub` و github-actions |

## 7. النشر
1. أنشئ مشروع Firebase وفعّل المصادقة و Firestore، ثم نفّذ `flutterfire configure` في جذر المشروع.
2. انشر القواعد والفهارس بعد اختبارها وموافقتك: `firebase deploy --only firestore:rules,firestore:indexes`.
3. Android: `flutter build appbundle` ثم الرفع إلى Google Play Console (حساب مطوّر مطلوب).
4. iOS: يتطلب جهاز Mac و Xcode وحساب Apple Developer، ثم `flutter build ipa` والرفع عبر App Store Connect.
5. اتبع دليل Flutter الرسمي للنشر لكل منصة خطوة بخطوة (التوقيع، الأيقونات، الأذونات).

## 8. أخطاء المبتدئين الشائعة وكيف يمنعها المخطط
| الخطأ | الوقاية |
|:---|:---|
| ترك قواعد «وضع الاختبار» | قواعد مغلقة افتراضياً + اختبارات القواعد + `/launch-check` |
| وضع المنطق داخل الـ Widgets فيصعب الاختبار | فصل `data/` و `application/` و `presentation/` |
| نسيان حالات التحميل والخطأ فيتجمّد التطبيق | `AsyncValue` في Riverpod يفرض معالجة الحالات الثلاث |
| قراءة مجموعات كاملة فترتفع التكلفة | استعلامات بفلترة و `limit` داخل المستودعات |
| رفع ملف التوقيع إلى GitHub | `.gitignore` + Hook الحارس الأمني |

## 9. المراحل المقترحة
| # | المرحلة | أهم المهام |
|:---:|:---|:---|
| 1 | التأسيس | العصف الذهني، اعتماد المخطط، `/quality-setup`، `app_tokens.dart`، تدفق الشاشات |
| 2 | البيانات والمصادقة | مشروع Firebase و `flutterfire configure`، نموذج البيانات، قواعد الأمان واختباراتها، التسجيل والدخول |
| 3 | الميزات الأساسية للـ MVP | ميزة ميزة مع اختباراتها |
| 4 | الواجهات والتجربة | الحالات (تحميل/فارغ/خطأ)، RTL، الوصولية، أحجام الشاشات |
| 5 | الفحص والنشر | `/launch-check`، App Check، البناء والتوقيع، الرفع للمتجر |

</div>
