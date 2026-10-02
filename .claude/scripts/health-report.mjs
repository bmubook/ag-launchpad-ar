#!/usr/bin/env node
/**
 * تقرير صحة المشروع (البنود 11، 13، 16، 29): مؤشرات تُحسب آلياً لكشف الديون التقنية قبل أن تتراكم.
 * لا يعدّل ملفات المشروع ولا يشغّل فحصه (ذلك عمل verify.mjs)؛ يحدّث فقط سجل الاختصارات في .claude/state.
 * الاستخدام: node .claude/scripts/health-report.mjs [--audit] [--json]
 *   --audit  يضيف فحص ثغرات الحزم عبر npm audit (يتطلب اتصالاً بالإنترنت)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { projectDir, readProjectFile, readProjectState, tableRows } from '../hooks/lib/common.mjs';
import { ceilingFor, ceilingStatus, countLines } from '../hooks/lib/ceilings.mjs';
import { collectTests, isCovered, isLogicFile } from '../hooks/lib/coverage.mjs';
import { needsVerification, readText, walkFiles } from '../hooks/lib/files.mjs';
import { gateStatus, loadQuality, setOpenShortcuts } from '../hooks/lib/quality.mjs';
import { isTestFile, scanFile } from '../hooks/lib/shortcuts.mjs';

const root = projectDir();
const args = new Set(process.argv.slice(2));
const SEVERE_SHORTCUTS = new Set(['open-rules', 'config-loosened', 'test-skip', 'no-assertion', 'test-branch']);

function scanProject() {
  const sizes = { soft: 0, hard: 0 };
  const shortcuts = [];
  const logic = [];
  let rulesFiles = 0;
  let rulesTested = false;
  for (const rel of walkFiles(root)) {
    if (!needsVerification(rel)) continue;
    const text = readText(root, rel);
    if (text === null) continue;
    const lines = countLines(text);
    const status = ceilingStatus(lines, ceilingFor(rel));
    if (status) sizes[status] += 1;
    for (const found of scanFile(rel, text)) shortcuts.push({ file: rel, ...found });
    if (/.rules$/i.test(rel)) rulesFiles += 1;
    if (isTestFile(rel) && (/rules/i.test(rel) || text.includes('rules-unit-testing'))) rulesTested = true;
    if (isLogicFile(rel)) logic.push({ file: rel, lines });
  }
  const tests = collectTests(root);
  const untested = logic.filter((f) => !isCovered(f.file, tests)).sort((a, b) => b.lines - a.lines);
  // مزامنة سجل الاختصارات الدائم (سطر الحالة وبداية الجلسة) مع ما في المشروع فعلاً
  const byFile = {};
  for (const s of shortcuts) (byFile[s.file] ||= []).push(s.kind);
  const known = loadQuality(root).shortcuts;
  setOpenShortcuts({ ...Object.fromEntries(Object.keys(known).map((rel) => [rel, []])), ...byFile }, root);
  return { sizes, shortcuts, logicCount: logic.length, untested, tests: tests.count, rulesFiles, rulesTested };
}

function auditDependencies() {
  if (!existsSync(join(root, 'package.json'))) return null;
  const result = spawnSync('npm audit --json', { cwd: root, shell: true, encoding: 'utf8', timeout: 90000, maxBuffer: 16 * 1024 * 1024 });
  try {
    const counts = JSON.parse(result.stdout).metadata.vulnerabilities;
    return { critical: counts.critical || 0, high: counts.high || 0, moderate: counts.moderate || 0 };
  } catch {
    return { error: true };
  }
}

function hasCi() {
  try { return readdirSync(join(root, '.github', 'workflows')).some((f) => /\.ya?ml$/i.test(f)); } catch { return false; }
}

function build() {
  const state = readProjectState();
  const quality = loadQuality(root);
  const gate = gateStatus(state.mode, root);
  const scan = scanProject();
  const out = [];
  const add = (name, value, status, advice = '—') => out.push({ name, value, status, advice });

  const gateText = { none: 'لا أوامر فحص', never: 'لم يُشغَّل', green: 'ناجح', red: `فاشل عند «${quality.verify?.failedLabel || '؟'}»`, stale: `${quality.pending.files.length} ملفاً غير مفحوص`, partial: 'فحص سريع فقط' }[gate];
  add('بوابة الإثبات', gateText, gate === 'green' ? 'ok' : gate === 'red' || gate === 'none' ? 'bad' : 'warn',
    gate === 'none' ? '/quality-setup' : gate === 'green' ? '—' : 'node .claude/scripts/verify.mjs');

  const testStep = quality.verify?.steps?.find((s) => /(^|:)test$/.test(s.name));
  if (testStep) add('مدة الاختبارات', `${Math.round(testStep.ms / 1000)} ث`, testStep.ms > 30000 ? 'warn' : 'ok', testStep.ms > 30000 ? 'تجاوزت 30 ثانية (البند 29): راجع الاختبارات البطيئة' : '—');

  const passed = quality.greenTests;
  add('الاختبارات', Number.isFinite(passed) ? `${passed} ناجحة في ${scan.tests} ملفاً` : `${scan.tests} ملف اختبار`, scan.tests === 0 ? 'bad' : 'ok', scan.tests === 0 ? 'لا اختبارات: /quality-setup ثم اختبار لكل معيار قبول' : '—');

  const ratio = scan.logicCount ? scan.untested.length / scan.logicCount : 0;
  add('ملفات منطق لا يغطيها اختبار', `${scan.untested.length} من ${scan.logicCount}`, scan.logicCount >= 4 && ratio > 0.5 ? 'warn' : 'ok', scan.untested.length ? 'ابدأ بأكبرها حجماً (القائمة أدناه)' : '—');

  const severe = scan.shortcuts.filter((s) => SEVERE_SHORTCUTS.has(s.kind)).length;
  add('الاختصارات (البند 11)', `${scan.shortcuts.length}${severe ? ` (منها ${severe} خطيرة)` : ''}`, severe ? 'bad' : scan.shortcuts.length ? 'warn' : 'ok', scan.shortcuts.length ? 'أزلها أو وثّق سبب كل واحد (القائمة أدناه)' : '—');

  add('أحجام الملفات (البند 14)', `${scan.sizes.hard} متجاوز، ${scan.sizes.soft} قريب`, scan.sizes.hard ? 'bad' : scan.sizes.soft ? 'warn' : 'ok', scan.sizes.hard || scan.sizes.soft ? 'node .claude/scripts/size-report.mjs' : '—');

  if (scan.rulesFiles) add('اختبارات قواعد الأمان', scan.rulesTested ? 'موجودة' : 'غير موجودة', scan.rulesTested ? 'ok' : 'bad', scan.rulesTested ? 'node .claude/scripts/verify.mjs --rules' : '/db-change: اختبارات القواعد إلزامية (البند 18)');

  add('الفحص الآلي عند الرفع (CI)', hasCi() ? 'موجود' : 'غير موجود', hasCi() ? 'ok' : 'warn', hasCi() ? '—' : '/quality-setup');

  const recent = tableRows(readProjectFile('changelog.md'), /جدول التغييرات/).slice(-20).map((c) => c[2]);
  const fixes = recent.filter((t) => t === 'fix').length;
  const feats = recent.filter((t) => t === 'feat').length;
  add('الإصلاح مقابل البناء (آخر 20 تغييراً)', `${fixes} إصلاحاً / ${feats} ميزة`, fixes >= 3 && fixes > feats ? 'warn' : 'ok', fixes >= 3 && fixes > feats ? 'الترقيع يغلب البناء: خطوات أصغر واختبار قبل كل ميزة' : '—');

  const bugs = tableRows(readProjectFile('bugs_log.md'), /ملخص الأخطاء النشطة/).filter((c) => !(c[c.length - 1] || '').includes('✅'));
  const critical = bugs.filter((c) => (c[2] || '').includes('🔴')).length;
  add('الأخطاء النشطة', `${bugs.length}${critical ? ` (منها ${critical} حرجة)` : ''}`, critical ? 'bad' : bugs.length ? 'warn' : 'ok', bugs.length ? '/fix قبل أي ميزة جديدة' : '—');

  if (args.has('--audit')) {
    const audit = auditDependencies();
    if (audit?.error) add('ثغرات الحزم', 'تعذّر الفحص', 'warn', 'شغّل npm audit يدوياً (يتطلب إنترنت)');
    else if (audit) add('ثغرات الحزم', `${audit.critical} حرجة، ${audit.high} عالية، ${audit.moderate} متوسطة`, audit.critical || audit.high ? 'bad' : audit.moderate ? 'warn' : 'ok', audit.critical || audit.high ? 'حدّث الحزم المصابة بعد فحص التوافق (البند 19)' : '—');
  }

  const bad = out.filter((i) => i.status === 'bad').length;
  const warn = out.filter((i) => i.status === 'warn').length;
  const verdict = bad ? '🔴 ديون تحتاج جولة صيانة قبل أي ميزة جديدة' : warn >= 3 ? '🟡 يحتاج عناية قريباً' : '🟢 سليم';
  return { verdict, bad, warn, indicators: out, shortcuts: scan.shortcuts, untested: scan.untested.slice(0, 8) };
}

function toMarkdown(report) {
  const icon = { ok: '✅', warn: '⚠️', bad: '🔴' };
  const lines = [
    `## 🩺 تقرير صحة المشروع — ${report.verdict}`, '',
    '| المؤشر | القيمة | الحالة | ما العمل |', '| :--- | :--- | :---: | :--- |',
    ...report.indicators.map((i) => `| ${i.name} | ${i.value} | ${icon[i.status]} | ${i.advice} |`),
  ];
  if (report.shortcuts.length) {
    lines.push('', `### 🚩 الاختصارات (${report.shortcuts.length})`, '', '| الملف | الاختصار |', '| :--- | :--- |',
      ...report.shortcuts.slice(0, 15).map((s) => `| \`${s.file}\` | ${s.label} |`));
    if (report.shortcuts.length > 15) lines.push(`| … | و${report.shortcuts.length - 15} أخرى |`);
  }
  if (report.untested.length) {
    lines.push('', '### 🧪 أكبر ملفات المنطق التي لا يستوردها أي اختبار', '', '| الملف | الأسطر |', '| :--- | :---: |',
      ...report.untested.map((f) => `| \`${f.file}\` | ${f.lines} |`));
  }
  return `${lines.join('\n')}\n`;
}

const report = build();
process.stdout.write(args.has('--json') ? JSON.stringify(report, null, 2) : toMarkdown(report));
