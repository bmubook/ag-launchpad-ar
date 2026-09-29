---
name: new-migration
description: "Database migration — ينشئ ملف هجرة SQL جديداً مؤرخاً (البند 18) في supabase/migrations/ أو migrations/ بمفاتيح UUID v7 وأعمدة timestamptz وفهارس وتفعيل RLS إلزامي بسياسات أقل صلاحية، ثم يختبره محلياً ويوثّقه. استخدمه لأي تعديل على جداول قاعدة البيانات أو علاقاتها أو صلاحياتها."
argument-hint: "[وصف التعديل على قاعدة البيانات]"
---

# /new-migration — هجرة قاعدة بيانات آمنة

> **المرجع:** البند 18 (قفل الهجرات — `rules_workflow.md`)، والبند 5 (RLS — `rules_security.md`)، والبند 28 (UUID v7 — `rules_code_quality.md`)، والبنود 7 و 8 و 13 و 15 و 16.

- وصف التعديل: `$ARGUMENTS`. إذا كان فارغاً فاسأل المستخدم عن التعديل المطلوب قبل أي خطوة.
- تحقّق من الفرع أولاً (البند 15): إذا كنت على `main` أو `master` فأنشئ فرعاً مؤقتاً: `git switch -c feat/db-<name>`.

---

## الخطوات

### 1. حدّد المنصة وأنشئ الملف
1. اقرأ صف "قاعدة البيانات" في القسم 5 (Tech Stack) من `project_map.md`، وتحقّق من وجود أداة هجرات في المشروع:

   | الحالة | مجلد الهجرات | طريقة الإنشاء |
   |:---|:---|:---|
   | Supabase | `supabase/migrations/` | `supabase migration new <name>` إذا كان Supabase CLI مثبتاً، وإلا يدوياً |
   | PostgreSQL أو MySQL أو SQLite دون أداة هجرات | `migrations/` | يدوياً |
   | أداة هجرات قائمة في المشروع (Prisma أو Drizzle أو Knex أو Alembic) | مجلد الأداة | أمر الإنشاء الرسمي للأداة بعد مراجعة توثيقها الرسمي |
   | Firebase أو MongoDB (غير SQL) | لا ينطبق | توقف: هذه المهارة لملفات SQL. قواعد الحماية والفهارس تُحفظ في ملفات داخل المستودع (مثل `firestore.rules`) وتُنشر بالأداة الرسمية |
   | غير محدد | لا ينطبق | توقف واقترح `/kickoff` أو اسأل المستخدم |

2. تحقّق من Supabase CLI عبر Bash: `supabase --version`.
3. اسم الهجرة: snake_case إنجليزي يصف التعديل، مثل `create_notes_table` أو `add_status_to_orders`.
4. الإنشاء اليدوي: احصل على الطابع الزمني UTC عبر `date -u "+%Y%m%d%H%M%S"` وأنشئ الملف `<المجلد>/<الطابع>_<الاسم>.sql`. تأكد أن الطابع أحدث من آخر ملف في المجلد حتى يبقى الترتيب صحيحاً.

### 2. قواعد لا استثناء فيها

| ❌ ممنوع | ✅ البديل |
|:---|:---|
| تعديل ملف هجرة طُبّق على أي قاعدة بيانات أو دخل في commit | هجرة جديدة تصحّح أو تتراجع |
| تعديل الجداول من لوحات التحكم (مثل Table Editor و SQL Editor في Supabase Studio) | ملف هجرة |
| أوامر SQL منفردة، أو أدوات MCP تنفّذ SQL مباشرة على مشروع بعيد | ملف هجرة يُختبر محلياً |
| تطبيق الهجرة على قاعدة الإنتاج مباشرة | اختبار محلي ثم نشر يوافق عليه المستخدم صراحة |

- الاستثناء الوحيد: ملف أنشأته في هذه المهمة ولم يُطبَّق بعد على أي قاعدة بيانات. عند الشك اعتبره مطبَّقاً.

### 3. اكتب محتوى الهجرة
1. **ترويسة عربية** في أعلى الملف: الغرض، والتاريخ، والقرار المرتبط في `decisions_log.md` (أو `لا يوجد`).
2. **استراتيجية المفتاح الأساسي (البند 28 — UUID v7):** لا تخمّن.
   - حدّد إصدار PostgreSQL: في Supabase اقرأ `major_version` تحت `[db]` في `supabase/config.toml`، وفي غيره نفّذ `show server_version;` على قاعدة البيانات المحلية أو اسأل المستخدم. تأكد أن الإصدار المحلي يطابق الإنتاج.
   - افتح التوثيق الرسمي لذلك الإصدار بأداة WebFetch: `https://www.postgresql.org/docs/<major>/functions-uuid.html`.

   | نتيجة التحقق | الاستراتيجية |
   |:---|:---|
   | التوثيق يؤكد وجود الدالة `uuidv7()` (متوفرة أصلاً منذ PostgreSQL 18) | `id uuid primary key default uuidv7()` |
   | الإصدار أقدم | توليد UUID v7 في التطبيق بمكتبة موثوقة (البند 21) مع `id uuid primary key` دون قيمة افتراضية، أو إضافة (Extension) يؤكد توثيق المنصة الرسمي توفرها |
   | تعذّر الحسم | توقف واسأل المستخدم. لا تعُد بصمت إلى `gen_random_uuid()` (UUID v4) |

   - وثّق الاستراتيجية المختارة في `decisions_log.md` أول مرة.
3. **قائمة فحص الجداول الجديدة:**

   | العنصر | القاعدة |
   |:---|:---|
   | الأوقات | `timestamptz` دائماً، مثل `created_at timestamptz not null default now()`. لا تضف `updated_at` دون Trigger يحدّثه |
   | المفاتيح الأجنبية | `references` مع `on delete` صريح، وفهرس لكل عمود FK |
   | الفهارس | للأعمدة المستخدمة في الفلترة والترتيب |
   | RLS (البند 5) | `alter table <table> enable row level security;` لكل جدول جديد دون استثناء |
   | السياسات | سياسة مستقلة لكل عملية (`select` و `insert` و `update` و `delete`) لأقل دور ممكن (`to authenticated`)، مشروطة بملكية الصف. لا `using (true)` في عمليات الكتابة، ولا صلاحيات لـ `anon` إلا بقرار موثّق |
   | التعليقات | `comment on table` و `comment on column` للأعمدة غير البديهية |
   | الأسماء | snake_case إنجليزية، والجداول بصيغة الجمع |
   | التراجع | قسم Rollback معلّق في نهاية الملف لا يُنفَّذ تلقائياً |

4. **مثال مرجعي (Supabase على PostgreSQL 18):** الدالة `auth.uid()` خاصة بـ Supabase؛ في PostgreSQL العادي ابنِ السياسات على الأدوار وفق التوثيق الرسمي.

   ```sql
   -- =====================================================================
   -- الهجرة: إنشاء جدول الملاحظات notes
   -- الغرض: تخزين ملاحظات كل مستخدم مع عزل كامل بين المستخدمين
   -- التاريخ: 2026-09-29 (UTC 20260929110500)
   -- القرار المرتبط: decisions_log.md — القرار #3
   -- =====================================================================

   create table public.notes (
     id uuid primary key default uuidv7(),
     user_id uuid not null references auth.users (id) on delete cascade,
     title text not null check (char_length(title) between 1 and 200),
     body text not null default '',
     created_at timestamptz not null default now()
   );

   create index notes_user_id_idx on public.notes (user_id);

   alter table public.notes enable row level security;

   create policy "notes_select_own" on public.notes
     for select to authenticated
     using ((select auth.uid()) = user_id);

   create policy "notes_insert_own" on public.notes
     for insert to authenticated
     with check ((select auth.uid()) = user_id);

   create policy "notes_update_own" on public.notes
     for update to authenticated
     using ((select auth.uid()) = user_id)
     with check ((select auth.uid()) = user_id);

   create policy "notes_delete_own" on public.notes
     for delete to authenticated
     using ((select auth.uid()) = user_id);

   comment on table public.notes is 'ملاحظات المستخدمين — كل مستخدم يرى ملاحظاته فقط (RLS)';
   comment on column public.notes.user_id is 'مالك الملاحظة — مرجع إلى auth.users';

   -- ---------------------------------------------------------------------
   -- التراجع (Rollback) — للتوثيق فقط ولا يُنفَّذ تلقائياً.
   -- بعد التطبيق لا تعدّل هذا الملف؛ أنشئ هجرة جديدة تحتوي:
   -- drop table if exists public.notes;
   -- ---------------------------------------------------------------------
   ```

### 4. راجع واختبر محلياً فقط
1. **المراجعة (البند 7):** تعديل قاعدة البيانات تعديل بنيوي. في `production` شغّل `/consensus-gate` قبل الاختبار. في `prototype` أجرِ مراجعة أمنية سريعة: هل RLS مفعّل؟ هل السياسات بأقل صلاحية؟
2. **الاختبار المحلي في Supabase** (يتطلب Docker):
   ```bash
   supabase start
   supabase migration up --local
   ```
   - لإعادة بناء القاعدة المحلية من الصفر بكل الهجرات: `supabase db reset` (يمسح بيانات القاعدة المحلية فقط — أخبر المستخدم قبل تشغيله).
   - في غير Supabase طبّق الهجرة بأداة المشروع على قاعدة بيانات محلية أو تطويرية فقط.
3. **تحقّق من النتيجة:** لا أخطاء في التطبيق، وRLS مفعّل على كل جدول جديد، ومستخدم لا يقرأ صفوف مستخدم آخر (اختبار آلي وفق البند 13 متى أمكن). شغّل كل الاختبارات الموجودة (البند 16).
4. **عند الفشل:** 3 محاولات كحد أقصى (5 في `prototype`)، ثم سجّل الخطأ في `bugs_log.md` وتراجع وفق البند 15.
5. **إذا تعذّر الاختبار المحلي** (Docker غير متوفر مثلاً): أبلغ المستخدم بأن الهجرة غير مختبرة، ولا تطبّقها على أي قاعدة، ولا تعتبر التعديل ناجحاً قبل اختباره.
6. **الإنتاج:** لا تشغّل `supabase db push` ولا أي أداة تطبّق الهجرة على مشروع بعيد إلا بعد نجاح الاختبار المحلي وموافقة صريحة من المستخدم.

### 5. وثّق واختم
1. **`project_map.md` — قسم مخطط قاعدة البيانات (القسم 8):** أضف صفاً لكل جدول جديد أو حدّث صفه، واستبدل صف `[يُملأ لاحقاً]` إن كان الوحيد. مثال:
   `| notes | id, user_id, title, body, created_at | uuid, uuid, text, text, timestamptz | user_id → auth.users | RLS ✅ (4 سياسات للمالك فقط) · فهرس user_id |`
2. **`decisions_log.md`:** سجّل قرارات المخطط بقالب ADR: استراتيجية المفتاح الأساسي، والعلاقات وسلوك الحذف (`on delete`)، وأي إضافة (Extension)، وأي تكرار مقصود للبيانات (Denormalization).
3. **`changelog.md`:** نفّذ إجراء `/document`:

   | التعديل | الوصف |
   |:---|:---|
   | جدول أو عمود جديد | `feat(db): ` + الوصف |
   | سياسات حماية فقط | `security(rls): ` + الوصف |
   | إعادة هيكلة دون تغيير السلوك | `refactor(db): ` + الوصف |

4. اختم الرد بختم التوثيق حرفياً مع ✅ أو ⬜ بصدق:

   `📋 التوثيق: ✅ changelog | ✅ project_map | ⬜ bugs_log (لا أخطاء) | ⬜ decisions_log (لا قرارات جديدة)`
