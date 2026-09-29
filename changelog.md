<div dir="rtl">

# سجل التغييرات الهندسي (Changelog)

يتم تحديث هذا الجدول تلقائياً من قبل الوكيل بعد نجاح الفحص في بيئة العزل (Sandbox في Antigravity، أو الفرع المؤقت والاختبارات في Claude Code) وقبل دمج التعديلات في الملفات الحية للمشروع.

---

## صيغة كتابة الوصف — Conventional Commits

يتبع هذا السجل معيار **Conventional Commits** لتوحيد وصف التغييرات وتسهيل تتبعها آلياً. الصيغة العامة:

```
<type>(scope): <description>
```

| النوع | المعنى | مثال |
| :--- | :--- | :--- |
| `feat` | ميزة جديدة | `feat(auth): إضافة تسجيل الدخول بـ Google` |
| `fix` | إصلاح خطأ | `fix(api): معالجة خطأ 500 عند إنشاء الحساب` |
| `refactor` | إعادة هيكلة بدون تغيير السلوك | `refactor(db): تحسين بنية استعلامات الجداول` |
| `security` | تحسين أمني أو سد ثغرة | `security(rules): إغلاق قواعد الأمان على مجموعة المستخدمين` |
| `docs` | تحديث التوثيق فقط | `docs(readme): تحديث تعليمات التثبيت` |
| `chore` | صيانة وتهيئة | `chore(init): إقلاع المشروع من القالب` |

> يُستخدم **الإصدار الدلالي (Semantic Versioning)** بصيغة `vMAJOR.MINOR.PATCH`:
> - &rlm;**MAJOR** — تغيير جذري غير متوافق مع الإصدارات السابقة
> - &rlm;**MINOR** — إضافة ميزة جديدة متوافقة
> - &rlm;**PATCH** — إصلاح خطأ أو تحسين بسيط

---

## جدول التغييرات

| التاريخ والوقت | الإصدار | نوع التغيير | الهوية النشطة | الملفات المتأثرة | نوع الإجراء ووصفه التقني المختصر | مرجع Git | نتيجة درجات الإجماع (Consensus Score) |
| :--- | :---: | :---: | :--- | :--- | :--- | :--- | :--- |
| 2026-07-05 18:35 | v3.0.1 | docs | Senior Project Manager | README.md, SETUP_GUIDE.md | docs(setup): إضافة تنبيه لتعديل اسم مجلد المشروع لمنع تكرار الاسم | local | - |
| 2026-07-05 18:51 | v3.1.0 | feat | UI/UX Expert | rules_ui.md, master_rules.md | feat(ui): إعادة هيكلة rules_ui.md شاملة — دمج المنهجيات السبع لـ UX/UI (بحث المستخدم، مسارات التدفق، نظام التصميم الذري، مبادئ التفاعل، التصميم التفصيلي، النماذج التجريبية، قياس UX) وإضافة البنود 18-23 | local | - |
| 2026-07-10 16:20 | v3.2.0 | feat | Senior Project Manager | .agents/AGENTS.md | feat(rules): إضافة ملف AGENTS.md لفرض التزام الوكيل تلقائياً ببروتوكولات المشروع | local | - |
| 2026-07-10 16:30 | v3.3.0 | feat | Senior Project Manager | master_rules.md, .agents/AGENTS.md, README.md | feat(rules): إضافة قاعدة RTL الإجبارية لتغليف الردود بـ div dir="rtl" لجميع الوكلاء وتوثيقها | local | - |
| 2026-07-10 17:59 | v3.3.1 | docs | Senior Project Manager | README.md, SETUP_GUIDE.md | docs(setup): توضيح استبدال اسم المجلد/المشروع باللغة الإنجليزية في تعليمات التثبيت | local | - |
| 2026-07-10 18:02 | v3.3.2 | docs | Senior Project Manager | README.md | docs(setup): تحسين وضوح تعليمات التثبيت باستخدام الكلمة النائبة <your-project-name> في الأوامر | local | - |
| 2026-07-24 21:52 | v3.3.3 | docs | Senior Project Manager | SETUP_GUIDE.md, SETUP_GUIDE.html | docs(setup): إضافة Flutter & Dart كخيار صريح لتطبيقات الجوال في ملفات الإقلاع | local | - |
| 2026-07-24 22:22 | v3.3.4 | fix | Senior Project Manager | README.md, SETUP_GUIDE.md, SETUP_GUIDE.html | fix(repo): تصحيح رابط المستودع إلى bmubook وفرض قراءة جميع الملفات الحاكمة التسعة في برومبت الإقلاع | local | - |
| 2026-09-29 13:35 | v4.0.0 | feat | Senior Project Manager | CLAUDE.md, .claude/**, blueprints/**, docs/glossary.md, master_rules.md, rules_*.md, project_map.md, README.md, SETUP_GUIDE.md, SETUP_GUIDE.html, setup-guide/**, .gitignore, .agents/AGENTS.md | feat(claude): إضافة دعم Claude Code الكامل بجانب Antigravity — CLAUDE.md،&rlm; Hooks إنفاذ آلي، 3 وكلاء مراجعة فرعيون، 15 مهارة (منها /next و/explain و/blueprint و/quality-setup و/launch-check و/fix)، اقتراحات تطوير بعد كل مهمة، وضع التعلّم وقاموس المصطلحات، 4 مخططات تقنية جاهزة، سطر حالة، إعادة تصميم مولّد الإقلاع كمعالج خطوة بخطوة (وضع فاتح/داكن، مراجعة قبل التوليد، حفظ تلقائي، وصولية WCAG AA) مع حقل مستوى الخبرة، إعادة ترقيم بنود الواجهات 18–23 → 31–36 | feat/claude-code-support | - |
| 2026-09-29 15:54 | v4.1.0 | feat | Backend & Security Engineer | blueprints/**, .claude/skills/db-change/**, .claude/skills/*, .claude/agents/security-critic.md, .claude/hooks/**, .claude/scripts/env-audit.mjs, .claude/settings.json, rules_*.md, .env.example, .gitignore, docs/glossary.md, README.md, SETUP_GUIDE.md, CLAUDE.md | feat(firebase): توحيد المعيار التقني على Firebase بدل Supabase لتبسيطه على المبتدئين — المخططات الأربعة، /db-change بدل /new-migration (قواعد الأمان والمحاكي)، حماية ملفات حساب الخدمة، فحص Firebase CLI و Java ومنافذ المحاكيات | main | - |
| 2026-09-29 16:01 | v4.1.1 | docs | Senior Project Manager | setup-guide/prompts.js, SETUP_GUIDE.md, README.md, CLAUDE.md, blueprints/*.md, .claude/skills/db-change/SKILL.md, .claude/skills/quality-setup/SKILL.md, .claude/skills/launch-check/SKILL.md, .claude/agents/performance-critic.md | docs(review): مراجعة ما بعد التحويل إلى Firebase — إزالة بقايا RLS من برومبت Antigravity، متطلبات CI لاختبارات القواعد (Java + Firebase CLI)، اختبارات القواعد لمشاريع Flutter، فحوص أداء Firestore، فحوص إطلاق Firebase | main | - |
| 2026-09-29 16:27 | v4.1.2 | fix | Senior Project Manager | .claude/hooks/session-start.mjs, .claude/scripts/env-audit.mjs, setup-guide/app.js, setup-guide/ui.js, SETUP_GUIDE.html, blueprints/*.md, .claude/skills/db-change/SKILL.md, .claude/skills/env-audit/SKILL.md, .claude/skills/quality-setup/SKILL.md, .claude/skills/blueprint/SKILL.md, README.md, SETUP_GUIDE.md | fix(beginner): نتائج تجربة القالب كمستخدم جديد — اشتراط JDK 21+ للمحاكيات وتنبيه الفحص البيئي له، إخفاء سجل تطوير القالب قبل الإقلاع، تقسيم مولّد الإقلاع (ui.js) ليبقى دون السقف؛ واجتازت أمثلة قواعد الأمان 18 اختباراً على محاكي Firestore الحقيقي | main | - |
| 2026-09-29 16:52 | v4.1.3 | docs | Senior Project Manager | README.md, docs/images/*, .claude/tests/hooks.test.mjs | docs(readme): صفحة تعكس ميزات المشروع — صور مولّد الإقلاع (فاتح/داكن)، قسم «مُختبر فعلياً»، إضافة اختبارات طبقة الإنفاذ للمستودع (108)، تصحيح جدول الميزات والصلاحيات | main | - |
| 2026-09-29 17:18 | v4.1.4 | docs | UI/UX Expert | README.md, SETUP_GUIDE.md, CLAUDE.md, master_rules.md, rules_*.md, blueprints/*.md, changelog.md, bugs_log.md, decisions_log.md, .agents/AGENTS.md, .claude/skills/*/SKILL.md, .claude/agents/*.md, .claude/rules/ui-rules.md | docs(rtl): إصلاح ترتيب القراءة على GitHub عند اختلاط الإنجليزية بالعربية — غلاف dir="rtl" للملفات التي تفتقده، وعلامة RLM لكل فقرة تبدأ بكلمة إنجليزية ولكل فاصلة أو سهم بين مصطلحين إنجليزيين في قائمة عربية (في ملفات التوثيق فقط)، ووصف المستودع ملفوف بعلامتي عزل الاتجاه | main | - |

</div>
