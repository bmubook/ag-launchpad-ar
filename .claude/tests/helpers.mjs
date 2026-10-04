// أدوات مشتركة لاختبارات طبقة الإنفاذ: مشروع مؤقت، تشغيل السكربتات، وتجميع النتائج.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = process.argv[2] || fileURLToPath(new URL('../..', import.meta.url));
export const results = [];
export let tmp;
/** ترويسة فهرس التدفقات كما تُشحن في project_map.md: جمل العقد الأربع بين اسم التدفق والأعمدة الثلاثة الأخيرة. */
export const FLOW_HEADER = '| # | التدفق | من يبدأ | النتيجة المحفوظة | من يحق له التغيير | ما يرفضه الاختبار | المرحلة | الاختبار | الحالة |';

export function freshProject({ kicked = false, mode = 'production', extraChangelogRows = 0, bugs = [], missing = [], learning = null, suggestions = null, backlog = [], flows = [] } = {}) {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = mkdtempSync(join(tmpdir(), 'aglp-'));
  cpSync(join(REPO, '.claude'), join(tmp, '.claude'), { recursive: true, filter: (s) => !s.includes(join('.claude', 'state')) && !s.endsWith('settings.local.json') });
  for (const f of ['master_rules.md', 'rules_security.md', 'rules_code_quality.md', 'rules_workflow.md', 'rules_ui.md', 'decisions_log.md']) {
    if (!missing.includes(f)) writeFileSync(join(tmp, f), `# ${f}\n`);
  }
  const map = [
    '<div dir="rtl">', '', '## 1. بيانات المشروع الأساسية:',
    `* **اسم المشروع:** ${kicked ? 'متجر راهو' : '[يُملأ من المستخدم]'}`,
    `* **طبيعة المشروع:** ${kicked ? 'تطبيق ويب متجاوب' : '[يُملأ من المستخدم]'}`,
    `* **اسم النداء (Call Sign):** ${kicked ? 'يا مدير' : '[يُملأ من المستخدم — مثال: "يا مدير"]'}`,
    `* **وضع التشغيل النشط:** ${mode} (افتراضي)`,
    `* **مستوى الخبرة:** ${kicked ? 'مبتدئ تماماً' : '[يُحدَّد عند الإقلاع]'}`,
    `* **وضع التعلّم:** ${learning ?? '[يُحدَّد عند الإقلاع]'}`,
    `* **اقتراحات التطوير:** ${suggestions ?? '[يُحدَّد عند الإقلاع]'}`,
    '> ▶ **المرحلة النشطة حالياً:** المرحلة 2', '',
    '## 12. أفكار التطوير المستقبلية (Backlog):', '', '| # | الفكرة | التصنيف | الأولوية | المصدر | الحالة |', '| :-: | :-- | :-- | :-: | :-- | :-- |',
    ...(backlog.length ? backlog : ['| - | لا توجد أفكار بعد | - | - | - | - |']), '',
    '## 13. فهرس التدفقات (Flow Index):', '', FLOW_HEADER, '| :---: | :--- | :--- | :--- | :--- | :--- | :---: | :--- | :---: |',
    ...(flows.length ? flows : ['| - | لا توجد تدفقات بعد | - | - | - | - | - | - | - |']), '', '</div>',
  ].join('\n');
  writeFileSync(join(tmp, 'project_map.md'), map);
  const rows = Array.from({ length: 3 + extraChangelogRows }, (_, i) =>
    `| 2026-09-${String(i + 1).padStart(2, '0')} 10:00 | v1.${i}.0 | feat | PM | a.js | feat(x): تغيير رقم ${i + 1} | main | - |`);
  writeFileSync(join(tmp, 'changelog.md'), ['# سجل', '', '## جدول التغييرات', '',
    '| التاريخ | الإصدار | النوع | الهوية | الملفات | الوصف | Git | Score |',
    '| :--- | :---: | :---: | :--- | :--- | :--- | :--- | :--- |', ...rows, ''].join('\n'));
  const bugRows = bugs.length ? bugs : ['| - | - | - | - | لا توجد أخطاء مسجلة حتى الآن | ✅ نظيف |'];
  if (!missing.includes('bugs_log.md')) {
    writeFileSync(join(tmp, 'bugs_log.md'), ['# الأخطاء', '', '## ملخص الأخطاء النشطة (Active Bugs Summary)', '',
      '| # | التاريخ | الأولوية | الملف المتسبب | وصف مختصر للمشكلة | الحالة |', '| :--- | :--- | :---: | :--- | :--- | :--- |', ...bugRows, '', '---'].join('\n'));
  }
  return tmp;
}

export function runNode(script, input, { args = [] } = {}) {
  const r = spawnSync('node', [join(tmp, script), ...args], {
    input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: tmp.replace(/\\/g, '/') }, timeout: 90000,
  });
  let json = null; try { json = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch { /* plain */ }
  return { code: r.status, out: r.stdout, err: r.stderr, json };
}

export function check(name, cond, detail = '') { results.push({ name, ok: Boolean(cond), detail: cond ? '' : detail }); }
export const decision = (r) => r.json?.hookSpecificOutput?.permissionDecision || null;
export const reason = (r) => r.json?.hookSpecificOutput?.permissionDecisionReason || '';
export const ctx = (r) => r.json?.hookSpecificOutput?.additionalContext || '';

/** يطبع النتائج ويُنهي العملية برمز 1 عند أي فشل. */
export function report() {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  const failed = results.filter((x) => !x.ok);
  for (const x of results) console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.name}${x.ok ? '' : `\n      → ${String(x.detail).slice(0, 400)}`}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
