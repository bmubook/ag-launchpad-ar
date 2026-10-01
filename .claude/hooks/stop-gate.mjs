#!/usr/bin/env node
/**
 * Hook التوقف (Stop) — بوابة إنهاء الرد. إذا عُدّل كود في هذه الجولة يمنع الإنهاء مرة واحدة حتى:
 * 1) تُعالَج الاختصارات المرصودة أو تُذكر للمستخدم صراحةً (البند 11).
 * 2) ينجح فحص المشروع بعد آخر تعديل: node .claude/scripts/verify.mjs (البنود 8 و 13 و 16).
 * 3) يُحدَّث changelog.md (master_rules.md §2).
 * stop_hook_active يمنع الحلقات اللانهائية: المنع مرة واحدة، ثم يبقى أثر «غير مفحوص» ظاهراً في سطر الحالة.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  emit, isCodeFile, loadSession, projectDir, readProjectState, readStdinJson, runHook, truncate,
} from './lib/common.mjs';
import { gateStatus, loadQuality, needsVerification } from './lib/quality.mjs';
import { scanFile } from './lib/shortcuts.mjs';

/** الاختصارات التي رُصدت في هذه الجولة وما زالت في ملفاتها. */
function openShortcuts(shortcuts) {
  const open = [];
  for (const [relPath, kinds] of Object.entries(shortcuts)) {
    let text = '';
    try { text = readFileSync(resolve(projectDir(), relPath), 'utf8'); } catch { continue; }
    const still = scanFile(relPath, text).filter((f) => kinds.includes(f.kind));
    if (still.length) open.push(`${relPath} (${still.map((f) => f.label).join('؛ ')})`);
  }
  return open;
}

function shortcutsProblem(open) {
  return `🚩 اختصارات لم تُعالج (البند 11): ${truncate(open.join(' — '), 500)}. `
    + 'أصلحها بالحل الصحيح الآن. وإن كان أحدها ضرورياً فعلاً فاذكره للمستخدم في ردك تحت عنوان «🚩 اختصارات مؤقتة» مع سببه، وسجّله في Backlog أو bugs_log.md ليُزال لاحقاً.';
}

function verifyProblem(gate, mode, files) {
  const command = mode === 'prototype' ? 'node .claude/scripts/verify.mjs --quick' : 'node .claude/scripts/verify.mjs';
  const situation = {
    red: `آخر فحص فاشل عند «${loadQuality().verify?.failedLabel || '؟'}»`,
    partial: 'آخر فحص كان سريعاً دون البناء، ووضع production يتطلب الفحص الكامل',
    stale: 'لم يُشغَّل فحص المشروع بعد آخر تعديل',
    never: 'لم يُشغَّل فحص المشروع بعد',
  }[gate];
  return `🧪 بوابة الإثبات (البنود 8 و 13 و 16): عدّلت كوداً في هذه الجولة (${truncate(files.join('، '), 300)}) و${situation}. `
    + `شغّل الآن: ${command} — وأصلح السبب الجذري لأي فشل ثم أعد التشغيل حتى ينجح، ولا تصف العمل بأنه مكتمل قبل ذلك. `
    + 'استثناءان يُذكران للمستخدم صراحةً في الرد: إذا استنفدت محاولات التصحيح (البند 8) فسجّل الخطأ في bugs_log.md واكتب «🔴 الفحص: فاشل — <السبب>»؛ '
    + 'وإذا كان العمل متوقفاً بانتظار قراره فاكتب «🟠 الفحص: مؤجل — <السبب>».';
}

function docsProblem(codeFiles) {
  return `📋 التوثيق الإلزامي (master_rules.md §2): عدّلت ملفات كود في هذه الجولة (${truncate(codeFiles.join('، '), 300)}) دون تحديث changelog.md. `
    + 'نفّذ إجراء التوثيق الآن (مهارة /document): سجّل التعديل بصيغة Conventional Commits، وحدّث project_map.md و bugs_log.md و decisions_log.md عند الحاجة، '
    + 'ثم أنهِ ردك بختم التوثيق. استثناء وحيد: إذا كان التعديل لم يكتمل بعد (عمل جارٍ لم يعبر الفحص) أو أُلغي بالكامل، '
    + 'فلا تضف مدخلاً ناقصاً — اذكر ذلك صراحةً في الختم: ⬜ changelog (قيد التنفيذ — يُوثَّق عند الاكتمال).';
}

runHook(async () => {
  const input = await readStdinJson();
  if (input.stop_hook_active) return;

  const { edited, shortcuts } = loadSession(input.session_id);
  const codeFiles = edited.filter(isCodeFile);
  if (!codeFiles.length) return;

  const problems = [];
  const open = openShortcuts(shortcuts);
  if (open.length) problems.push(shortcutsProblem(open));

  const verifiable = edited.filter(needsVerification);
  if (verifiable.length) {
    const { mode } = readProjectState();
    const gate = gateStatus(mode);
    if (!['green', 'none'].includes(gate)) problems.push(verifyProblem(gate, mode, verifiable));
  }

  if (!edited.includes('changelog.md')) problems.push(docsProblem(codeFiles));
  if (problems.length) emit({ decision: 'block', reason: problems.join('\n\n') });
});
