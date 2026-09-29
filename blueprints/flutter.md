<div dir="rtl">

# 📱 مخطط تطبيق الجوال — Flutter + Supabase

## 1. متى تختار هذا المخطط / متى لا تختاره

| ✅ اختره عندما | ❌ لا تختره عندما |
|:---|:---|
| تطبيق جوال لـ Android و iOS بكود واحد وأداء سلس وواجهات مخصصة | تحتاج موقع ويب قابلاً للبحث في Google — استخدم `web.md` |
| تريد تصميماً مطابقاً تماماً على كل الأجهزة | تعرف JavaScript وتريد مشاركة الكود مع موقع ويب — فكّر في `react-native.md` |
| لا يزعجك تعلّم لغة Dart (سهلة ومنظمة) | جهازك لا يتسع لأدوات Android Studio / Xcode المطلوبة للتجربة |

## 2. الحزمة التقنية

| الطبقة | التقنية | لماذا | التوثيق الرسمي |
|:---|:---|:---|:---|
| الإطار | Flutter + Dart | كود واحد للمنصتين، ومكونات Material جاهزة | https://docs.flutter.dev |
| إدارة الحالة | Riverpod (`flutter_riverpod`) | فصل واضح بين المنطق والواجهة، وسهل الاختبار | https://riverpod.dev |
| التنقل | `go_router` | مسارات واضحة وروابط عميقة، مدعوم من فريق Flutter | https://pub.dev/packages/go_router |
| الخلفية | `supabase_flutter` | مصادقة وقاعدة بيانات و RLS وتخزين ملفات | https://supabase.com/docs/reference/dart/introduction |
| التخزين الآمن | `flutter_secure_storage` | لأي قيمة حساسة إضافية تحتاج حفظها على الجهاز | https://pub.dev/packages/flutter_secure_storage |
| اللغات و RTL | `flutter_localizations` + ملفات ARB (gen-l10n) | العربية والإنجليزية مع اتجاه RTL تلقائي | https://docs.flutter.dev/ui/internationalization |
| متغيرات التصميم | `lib/core/theme/app_tokens.dart` (البند 32) | ألوان وخطوط وتباعد من مصدر واحد عبر `ThemeData` و `ColorScheme` | https://docs.flutter.dev/cookbook/design/themes |
| التحقق من المدخلات | مدققات النماذج (`Form` + `validator`) مع دوال تحقق مشتركة | رسائل خطأ واضحة قبل إرسال أي بيانات | https://docs.flutter.dev/cookbook/forms/validation |

## 3. سياسة الإصدارات
- المتطلب الأدنى: Flutter SDK مستقر حديث (يتضمن Dart)، مع Android Studio للمحاكي، و Xcode على Mac فقط لبناء iOS. تحقق بنتيجة `/env-audit` وبالأمر `flutter doctor`.
- أضف الحزم دائماً بالأمر `flutter pub add <الحزمة>` ليختار الإصدار المتوافق — لا تكتب أرقاماً من الذاكرة. راجع صفحة كل حزمة على pub.dev قبل إضافتها (البند 19).

## 4. هيكل المجلدات

```
lib/
├── main.dart                 ← التهيئة فقط (Supabase + ProviderScope + Router)
├── core/
│   ├── theme/app_tokens.dart ← متغيرات التصميم (البند 32)
│   ├── router/app_router.dart
│   └── config/env.dart       ← قراءة القيم من --dart-define
├── features/
│   └── <feature>/
│       ├── data/             ← المستودعات (Repositories): كل استدعاءات Supabase هنا
│       ├── application/      ← Providers ومنطق الحالة
│       └── presentation/     ← الشاشات والـ Widgets فقط
└── l10n/app_ar.arb, app_en.arb
test/                         ← اختبارات الوحدة والـ Widgets
integration_test/             ← اختبار شامل للمسار الرئيسي
supabase/migrations/          ← الهجرات فقط (البند 18)
```
الأسقف: ملفات الواجهة (Dart) ≤ 400 سطر (البند 14) — قسّم الشاشة الكبيرة إلى Widgets.

## 5. خط الأساس الأمني
- **التطبيق عام بطبيعته:** أي قيمة داخل التطبيق يمكن استخراجها. لذلك لا تضع إلا رابط Supabase والمفتاح العام (publishable/anon)، وتعتمد الحماية الحقيقية على **RLS** في قاعدة البيانات. مفتاح `service_role` لا يدخل التطبيق أبداً.
- مرّر القيم وقت البناء: `flutter run --dart-define-from-file=env.json` مع إضافة `env.json` إلى `.gitignore` وتوفير `env.example.json` بقيم فارغة.
- **RLS مغلق افتراضياً** على كل جدول مع سياسات المالك (المثال في `web.md` القسم 5 ينطبق حرفياً).
- جلسة Supabase تديرها `supabase_flutter` تلقائياً؛ خزّن أي أسرار إضافية بـ `flutter_secure_storage` لا بـ SharedPreferences.
- **لا ترفع ملفات التوقيع** (`*.jks`، `key.properties`) إلى Git أبداً.

## 6. خط أساس الجودة (ما ينفّذه `/quality-setup`)
| الأداة | الاختيار |
|:---|:---|
| المدقق | `flutter analyze` مع حزمة `flutter_lints` (مفعّلة في المشاريع الجديدة) |
| المنسّق | `dart format .` |
| الاختبارات | `flutter test` — اختبار Widget للشاشة الرئيسية + اختبار وحدة لمنطق حقيقي |
| اختبار شامل | `integration_test` للمسار الرئيسي |
| CI | `.github/workflows/ci.yml`: تثبيت Flutter (إجراء GitHub موثوق) ← `flutter pub get` ← `dart format --set-exit-if-changed .` ← `flutter analyze` ← `flutter test` |
| الاعتماديات | `.github/dependabot.yml` لـ `pub` و github-actions |

## 7. النشر
1. Android: `flutter build appbundle` ثم الرفع إلى Google Play Console (حساب مطوّر مطلوب).
2. iOS: يتطلب جهاز Mac و Xcode وحساب Apple Developer، ثم `flutter build ipa` والرفع عبر App Store Connect.
3. اتبع دليل Flutter الرسمي للنشر لكل منصة خطوة بخطوة (التوقيع، الأيقونات، الأذونات).

## 8. أخطاء المبتدئين الشائعة وكيف يمنعها المخطط
| الخطأ | الوقاية |
|:---|:---|
| وضع المنطق داخل الـ Widgets فيصعب الاختبار | فصل `data/` و `application/` و `presentation/` |
| نسيان حالات التحميل والخطأ فيتجمّد التطبيق | `AsyncValue` في Riverpod يفرض معالجة الحالات الثلاث |
| نصوص عربية مكتوبة داخل الكود | ملفات ARB (البند 30) |
| رفع ملف التوقيع أو المفاتيح إلى GitHub | `.gitignore` + Hook الحارس الأمني |
| ألوان مكررة في كل شاشة | `app_tokens.dart` + `ThemeData` |

## 9. المراحل المقترحة
| # | المرحلة | أهم المهام |
|:---:|:---|:---|
| 1 | التأسيس | العصف الذهني، اعتماد المخطط، `/quality-setup`، `app_tokens.dart`، تدفق الشاشات |
| 2 | قاعدة البيانات والمصادقة | الهجرات، RLS، التسجيل والدخول، حماية المسارات |
| 3 | الميزات الأساسية للـ MVP | ميزة ميزة مع اختباراتها |
| 4 | الواجهات والتجربة | الحالات (تحميل/فارغ/خطأ)، RTL، الوصولية، أحجام الشاشات |
| 5 | الفحص والنشر | `/launch-check`، البناء والتوقيع، الرفع للمتجر |

</div>
