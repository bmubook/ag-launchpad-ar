#!/usr/bin/env node
/**
 * بوابة الإثبات (البنود 8، 13، 16): يشغّل فحوص المشروع فعلياً ويسجّل النتيجة ليقرأها Hook التوقف وسطر الحالة.
 * الاستخدام: node .claude/scripts/verify.mjs [--quick] [--rules] [--status] [--json]
 *   --quick   يتخطى خطوة البناء (يكفي في وضع prototype وأثناء العمل؛ وضع production يتطلب الفحص الكامل)
 *   --rules   يشغّل اختبارات قواعد الأمان على المحاكي (تُضاف تلقائياً إذا عُدّل ملف .rules منذ آخر فحص ناجح)
 *   --status  يعرض آخر نتيجة مسجّلة دون تشغيل شيء
 * رموز الخروج: 0 نجاح، 1 فشل، 2 لا توجد أوامر فحص في المشروع.
 */
import { spawnSync } from 'node:child_process';
import { relative } from 'node:path';
import { projectDir, readProjectState } from '../hooks/lib/common.mjs';
import { gateStatus, isRulesFile, loadQuality, planChecks, recordVerifyRun } from '../hooks/lib/quality.mjs';

const args = new Set(process.argv.slice(2));
const root = projectDir();
const STEP_TIMEOUT_MS = Number(process.env.AGLP_VERIFY_TIMEOUT_MS) || 10 * 60 * 1000;
const TAIL_LINES = 40;

const stripAnsi = (text) => String(text || '').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');

/** عدد الاختبارات الناجحة من مخرجات المشغّلات الشائعة (Vitest / Jest / Flutter / node:test)، أو null. */
function parsePassedTests(output) {
  const patterns = [
    /Tests:?\s+(?:\d+\s+(?:failed|skipped|todo)[,|\s]+)*(\d+)\s+passed/i,
    /\+(\d+)(?:\s+~\d+)?(?:\s+-\d+)?:\s+(?:All tests passed|Some tests failed)/,
    /^#\s*pass\s+(\d+)/m,
    /(\d+)\s+passed/i,
  ];
  for (const re of patterns) {
    const match = output.match(re);
    if (match) return Number(match[1]);
  }
  return null;
}

function runStep(step) {
  const started = Date.now();
  const result = spawnSync(step.cmd, {
    cwd: step.cwd, shell: true, encoding: 'utf8', timeout: STEP_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, CI: 'true', FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  const output = stripAnsi(`${result.stdout || ''}\n${result.stderr || ''}`);
  const timedOut = result.error?.code === 'ETIMEDOUT';
  return { ...step, ok: result.status === 0 && !result.error, ms: Date.now() - started, output, timedOut };
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)} ث`;

function statusLine(quality, mode) {
  const { verify, pending } = quality;
  const gate = gateStatus(mode, root);
  const labels = {
    none: 'لا توجد أوامر فحص في المشروع بعد — نفّذ /quality-setup.',
    never: 'لم يُشغَّل الفحص بعد.',
    green: '✅ آخر فحص ناجح ولا تعديلات بعده.',
    red: `🔴 آخر فحص فاشل عند «${verify?.failedLabel || verify?.failed || '؟'}».`,
    stale: `🟠 ${pending.files.length} ملفاً معدّلاً لم يُفحص منذ آخر فحص ناجح.`,
    partial: '🟠 آخر فحص سريع (دون البناء)، ووضع production يتطلب الفحص الكامل.',
  };
  return { gate, text: labels[gate] };
}

function printStatus() {
  const quality = loadQuality(root);
  const { gate, text } = statusLine(quality, readProjectState().mode);
  if (args.has('--json')) process.stdout.write(JSON.stringify({ gate, ...quality }, null, 2));
  else process.stdout.write(`🧪 بوابة الإثبات: ${text}\n`);
}

function toMarkdown(run, steps, notes) {
  const rows = steps.map((s) => `| ${s.label} | \`${s.cmd}\`${s.cwd === root ? '' : ` (${relative(root, s.cwd)})`} | ${s.ok ? '✅' : s.timedOut ? '⏱️ تجاوز المهلة' : '❌'} | ${seconds(s.ms)} |`);
  const lines = [
    `## 🧪 بوابة الإثبات — ${run.ok ? '✅ ناجح' : `❌ فاشل عند «${run.failedLabel}»`} (${run.level === 'full' ? 'فحص كامل' : 'فحص سريع دون البناء'}، ${seconds(run.ms)})`,
    '', '| الخطوة | الأمر | النتيجة | المدة |', '| :--- | :--- | :---: | :---: |', ...rows, '', ...notes,
  ];
  const failed = steps.find((s) => !s.ok);
  if (failed) {
    const tail = failed.output.trim().split(/\r?\n/).slice(-TAIL_LINES).join('\n');
    lines.push(`### آخر ${TAIL_LINES} سطراً من مخرجات «${failed.label}»`, '', '```', tail, '```', '',
      'أصلح السبب الجذري ثم أعد التشغيل (البند 22). لا تعطّل الفحص ولا تحذف الاختبار لتمريره (البند 11). بعد 3 محاولات فاشلة طبّق البند 8.');
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  if (args.has('--status')) return printStatus();

  const before = loadQuality(root);
  const rules = args.has('--rules') || before.pending.files.some(isRulesFile);
  const plan = planChecks({ quick: args.has('--quick'), rules }, root);
  if (!plan.steps.length) {
    process.stdout.write('⚠️ لا توجد أوامر فحص في المشروع (لا package.json بأوامر lint/test/build ولا pubspec.yaml). نفّذ /quality-setup لتجهيز أساس الجودة.\n');
    process.exitCode = 2;
    return;
  }

  const started = Date.now();
  const done = [];
  for (const step of plan.steps) {
    const result = runStep(step);
    done.push(result);
    if (!result.ok) break;
  }
  const failed = done.find((s) => !s.ok);
  const testOutput = done.filter((s) => /(^|:)test$/.test(s.name)).map((s) => s.output).join('\n');
  const run = {
    ok: !failed, level: plan.level, at: Date.now(), ms: Date.now() - started,
    failed: failed?.name || null, failedLabel: failed?.label || null,
    tests: testOutput ? parsePassedTests(testOutput) : null,
    steps: done.map(({ name, ok, ms }) => ({ name, ok, ms })),
  };
  const { redFirst, previousTests } = recordVerifyRun(run, root);

  const notes = [];
  if (run.ok && Number.isFinite(run.tests)) notes.push(`- الاختبارات الناجحة: ${run.tests}${Number.isFinite(previousTests) ? ` (في الفحص الناجح السابق: ${previousTests})` : ''}`);
  if (run.ok && Number.isFinite(run.tests) && Number.isFinite(previousTests) && run.tests < previousTests) {
    notes.push(`- ⚠️ عدد الاختبارات الناجحة نقص من ${previousTests} إلى ${run.tests}. إن حُذف اختبار أو عُطّل لتمرير الفحص فأعده (البند 11)، وإلا فاذكر السبب للمستخدم.`);
  }
  if (run.ok && redFirst) notes.push('- 🔴→🟢 شوهد الاختبار فاشلاً قبل أن ينجح (دليل أن الاختبار يكشف الخلل فعلاً).');
  if (run.ok && plan.level === 'quick' && readProjectState().mode !== 'prototype') {
    notes.push('- ℹ️ هذا فحص سريع. وضع production يتطلب الفحص الكامل قبل إنهاء المهمة: `node .claude/scripts/verify.mjs`');
  }
  if (notes.length) notes.push('');

  process.stdout.write(args.has('--json') ? JSON.stringify(run, null, 2) : toMarkdown(run, done, notes));
  process.exitCode = run.ok ? 0 : 1;
}

main();
