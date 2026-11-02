<div dir="rtl">

# &rlm;/db-change — مسار Supabase (PostgreSQL)

> يُتبع هذا الملف بدل الأقسام 2–5 في `SKILL.md` حين يكون صف «قاعدة البيانات» في القسم 5 من `project_map.md` هو Supabase. المرجع: `blueprints/supabase.md` القسم 5.
> **المبدأ:** كل تغيير هجرة SQL مؤرخة في المستودع، تُختبر على القاعدة المحلية، وتُنشر بموافقة. لا تعديل من لوحة التحكم، ولا اختبار ولا سكربت على قاعدة الإنتاج.

## 1. صنّف التعديل
| التعديل | ما يلزم |
|:---|:---|
| جدول جديد | الجدول + RLS + سحب المنح ثم منح ما يلزم فقط + سياسة لكل عملية + فهارس أعمدة السياسات + اختبارات |
| عمود جديد | يُتتبَّع في كل الطبقات: الهجرة ← التحقق (Zod) ← الإدراج والتعديل في `services/` ← الواجهة. وإن كان حساساً (دور، حالة، رصيد، وقت) فلا يدخل منح التعديل، أو يحرسه زناد |
| دالة (RPC) أو زناد | الهوية من `auth.uid()` مع رفض صريح إذا كانت NULL، و `search_path` مثبّت، والمنح صريحة، واختبار لكل دور |
| حاوية ملفات (Storage) | حاوية خاصة + سياسات `storage.objects` لكل عملية في هجرة (القسم 2-ب) + اختبار الغريب |
| تغيير صلاحيات | اختبارات تثبت المسموح والممنوع قبل التعديل وبعده |
| حذف أو تحويل بيانات قائمة | تجربة جافة تعرض العدد وعينة، ثم رمز تأكيد، ثم نسخة احتياطية، ثم موافقة منفصلة |

## 2. اكتب الهجرة
1. &rlm;`supabase migration new <اسم_وصفي>` ثم اكتب SQL في الملف المولَّد داخل `supabase/migrations/`.
2. وثّق الجدول في القسم 8 من `project_map.md`: الأعمدة وأنواعها، والعلاقات، ومن يقرأ ومن يكتب.
3. **أ. مثال جدول خاص بمالكه** — المنح تحدد الأعمدة التي يكتبها التطبيق، والسياسات تحدد الصفوف:

```sql
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  created_at timestamptz not null default now()
);
create index notes_user_id_idx on public.notes (user_id);
alter table public.notes enable row level security;

-- الزائر لا شيء، والمسجّل يكتب title (و user_id عند الإنشاء فقط)؛ created_at يختمه الخادم
revoke all on public.notes from anon, authenticated;
grant select, delete on public.notes to authenticated;
grant insert (user_id, title) on public.notes to authenticated;
grant update (title) on public.notes to authenticated;

create policy "notes: owner reads" on public.notes for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "notes: owner creates" on public.notes for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "notes: owner edits" on public.notes for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "notes: owner deletes" on public.notes for delete to authenticated
  using ((select auth.uid()) = user_id);
```

4. **ب. حاوية ملفات خاصة** — كل مستخدم في مجلد باسم معرّفه، ولا يصل لملفات غيره:

```sql
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', false);
create policy "avatars: owner reads" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: owner uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: owner replaces" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: owner deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
```

   حاوية عامة (`public = true`) فقط لملفات يراها الجميع عمداً (صور المنتجات)، ولا يكتب فيها إلا صاحب المجلد أيضاً.

**قبل الانتقال للاختبار، راجع:**

| ❌ ممنوع | ✅ المطلوب |
|:---|:---|
| جدول في `public` بلا `enable row level security` | RLS في الهجرة نفسها التي تنشئ الجدول |
| الاكتفاء بالسياسات مع بقاء المنح الافتراضية | `revoke all ... from anon, authenticated` ثم منح ما تحتاجه الشاشات فقط، بالأعمدة للكتابة |
| `using (true)` أو سياسة بلا `to <دور>` | شرط ملكية أو صلاحية، والدور صريح |
| صلاحية من `user_metadata` أو من معامل يرسله التطبيق | جدول صلاحيات محروس أو `app_metadata`، والهوية من `auth.uid()` |
| عرض (View) عادي فوق جدول محمي | `with (security_invoker = true)` |
| دالة `security definer` في `public` أو بلا `search_path` أو تقبل NULL هوية | مخطط خاص، و `set search_path = ''`، و `v := auth.uid(); if v is null then raise exception 'not authenticated'; end if;`، و `revoke all on function ... from public, anon` |
| تعديل الرصيد أو الدور أو الحالة من التطبيق | دالة محروسة في معاملة، أو خارج منح التعديل |

## 3. اختبر على القاعدة المحلية (إلزامي)
1. **المراجعة (البند 7):** RLS والمنح تعديل أمني: `/consensus-gate` في `production`، ومراجعة أمنية سريعة في `prototype`.
2. **اختبار pgTAP** في `supabase/tests/database/<الجدول>_test.sql` لكل جدول أو دالة جديدة، دون إضافات خارجية. كل باب في الجدول له حالة: الزائر، والغريب في القراءة والإنشاء والتعديل والحذف، والمالك، والأعمدة المحروسة:

```sql
begin;
select plan(12);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'stranger@test.local');
insert into public.notes (user_id, title) values ('11111111-1111-1111-1111-111111111111', 'سر المالك');

-- كل جداول public عليها RLS، ولا عرض فيها يتخطاها
select is_empty($$ select 1 from pg_tables where schemaname = 'public' and not rowsecurity $$, 'RLS على كل جداول public');
select is_empty($$ select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
  and not coalesce(c.reloptions, '{}') && array['security_invoker=true', 'security_invoker=on'] $$, 'كل عرض في public بـ security_invoker');

-- الزائر
set local role anon;
select throws_ok($$ select 1 from public.notes $$, '42501', null, 'الزائر لا يقرأ');
select throws_ok($$ insert into public.notes (title) values ('زائر') $$, '42501', null, 'الزائر لا يكتب');
reset role;

-- الغريب
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is_empty($$ select 1 from public.notes $$, 'الغريب لا يرى ملاحظة غيره');
select throws_ok($$ insert into public.notes (user_id, title) values ('11111111-1111-1111-1111-111111111111', 'انتحال') $$,
  '42501', 'new row violates row-level security policy for table "notes"', 'السياسة ترفض الكتابة باسم غيره');
select is_empty($$ update public.notes set title = 'عبث' returning 1 $$, 'الغريب يعدّل صفر صفوف');
select is_empty($$ delete from public.notes returning 1 $$, 'الغريب يحذف صفر صفوف');

-- المالك
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select lives_ok($$ insert into public.notes (title) values ('ملاحظة جديدة') $$, 'المالك ينشئ ملاحظته');
select isnt_empty($$ select 1 from public.notes $$, 'المالك يرى ملاحظاته');
select throws_ok($$ update public.notes set user_id = '22222222-2222-2222-2222-222222222222' $$, '42501', null, 'المالك لا ينقل صفه لغيره');
select throws_ok($$ update public.notes set created_at = now() - interval '1 year' $$, '42501', null, 'الوقت يختمه الخادم');

select * from finish();
rollback;
```

   - `plan(N)` يساوي عدد الحالات؛ عدّله مع كل حالة تضيفها.
   - حالة رفض بنص رسالة السياسة (لا بالرمز وحده) تثبت أن **السياسة** رفضت، لا غياب المنح.
   - حاوية ملفات: ملف مستقل `supabase/tests/database/avatars_test.sql` بالمستخدمَين أنفسهم:

```sql
begin;
select plan(3);
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'stranger@test.local');
-- الحاوية نفسها أنشأتها الهجرة؛ supabase db reset يطبّقها قبل الاختبار
insert into storage.objects (bucket_id, name) values ('avatars', '11111111-1111-1111-1111-111111111111/a.png');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is_empty($$ select 1 from storage.objects where bucket_id = 'avatars' $$, 'الغريب لا يرى ملفات غيره');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('avatars', '11111111-1111-1111-1111-111111111111/x.png') $$,
  '42501', 'new row violates row-level security policy for table "objects"', 'الغريب لا يرفع في مجلد غيره');
select is_empty($$ delete from storage.objects where bucket_id = 'avatars' returning 1 $$, 'الغريب لا يحذف ملفات غيره');

select * from finish();
rollback;
```
3. شغّل: `supabase start` (مرة واحدة، يحتاج Docker) ثم `node .claude/scripts/verify.mjs --rules`. البوابة تشغّل `supabase db reset --local && supabase test db --local` على القاعدة المحلية، ثم كل اختبارات المشروع (البند 16). ثم `supabase db lint`.
4. **عند الفشل:** 3 محاولات (5 في `prototype`)، ثم `bugs_log.md` والترجيع (البند 15).
5. **إذا تعذّر التشغيل** (Docker غير مثبت أو متوقف): أبلغ المستخدم أن الحماية **غير مختبرة**، مع رابط Docker الرسمي، ولا تنشر.

## 4. النشر — بموافقة صريحة فقط
اعرض نتيجة الاختبارات، ثم اختم بخيارين مرقّمين: `1. **انشر الآن**` و `2. **لاحقاً**`. عند الموافقة:
1. &rlm;`supabase db push` (المشروع مربوط بـ `supabase link`).
2. اطلب من المستخدم فتح **Security Advisor** في لوحة Supabase، ونقل أي تنبيه إليك (🔍 تحقق بنفسك).
3. تحقق من الإنتاج بالمفتاح العام كما يراه المهاجم: طلب قراءة بلا جلسة يعيد خطأ صلاحية أو `[]`.

ثم أكمل من القسم 6 في `SKILL.md` (التوثيق)، بأنواع الوصف نفسها.

</div>
