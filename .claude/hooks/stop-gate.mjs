#!/usr/bin/env node
/**
 * Hook التوقف (Stop) — بوابة إنهاء الرد. إذا عُدّل كود في هذه الجولة يمنع الإنهاء مرة واحدة حتى:
 * 1) تُعالَج الاختصارات المرصودة أو تُذكر للمستخدم صراحةً (البند 11).
 * 2) ينجح فحص المشروع بعد آخر تعديل: node .claude/scripts/verify.mjs (البنود 8 و 13 و 16).
 * 3) يكون لكل ملف منطق عُدّل اختبارٌ يستورده (البند 13).
 * 4) يُحدَّث changelog.md (master_rules.md §2).
 * «عُدّل في هذه الجولة» = ما سجّلته أدوات التعديل + ما تغيّر على القرص منذ بداية الجولة (sed، سكربتات، مولّدات).
 * stop_hook_active يمنع الحلقات اللانهائية: المنع مرة واحدة، ثم تبقى الحالة ظاهرة في سطر الحالة.
 */
import {
  emit, isCodeFile, loadSession, projectDir, readProjectState, readStdinJson, runHook, truncate,
} from './lib/common.mjs';
import { collectTests, isCovered, isLogicFile } from './lib/coverage.mjs';
import { changedSince, modifiedAt, readText } from './lib/files.mjs';
import {
  gateStatus, loadQuality, needsVerification, setOpenShortcuts, verifyCommand, verifyWindows,
} from './lib/quality.mjs';
import { scanFile } from './lib/shortcuts.mjs';

const list = (files) => truncate(files.join('، '), 300);

/** ملفات هذه الجولة: أدوات التعديل + تعديلات القرص منذ بدايتها (خارج فترات تشغيل الفحص نفسه). */
function touchedThisTurn(root, session, quality) {
  const onDisk = session.turnStartedAt ? changedSince(root, session.turnStartedAt, verifyWindows(quality)) : [];
  return [...new Set([...session.edited, ...onDisk])];
}

/** يعيد فحص الملفات من القرص ويحدّث سجل الاختصارات الدائم؛ يعيد ما رُصد في هذه الجولة وما زال قائماً. */
function openShortcuts(root, session, touched, quality) {
  const recheck = [...new Set([...touched.filter(needsVerification), ...Object.keys(quality.shortcuts)])];
  const current = Object.fromEntries(recheck.map((rel) => [rel, scanFile(rel, readText(root, rel) || '')]));
  setOpenShortcuts(Object.fromEntries(Object.entries(current).map(([rel, found]) => [rel, found.map((f) => f.kind)])), root);
  return Object.entries(session.shortcuts)
    .map(([rel, kinds]) => [rel, (current[rel] || []).filter((f) => kinds.includes(f.kind))])
    .filter(([, still]) => still.length)
    .map(([rel, still]) => `${rel} (${still.map((f) => f.label).join('؛ ')})`);
}

function shortcutsProblem(open) {
  return `🚩 اختصارات لم تُعالج (البند 11): ${truncate(open.join(' — '), 500)}. `
    + 'أصلحها بالحل الصحيح الآن. وإن كان أحدها ضرورياً فعلاً فاذكره للمستخدم في ردك تحت عنوان «🚩 اختصارات مؤقتة» مع سببه، وسجّله في Backlog أو bugs_log.md ليُزال لاحقاً.';
}

function verifyProblem(gate, mode, files, quality) {
  const situation = {
    red: `آخر فحص فاشل عند «${quality.verify?.failedLabel || '؟'}»`,
    partial: 'آخر فحص كان سريعاً دون البناء، ووضع production يتطلب الفحص الكامل',
    stale: 'لم يُشغَّل فحص المشروع بعد آخر تعديل',
    never: 'لم يُشغَّل فحص المشروع بعد',
  }[gate];
  return `🧪 بوابة الإثبات (البنود 8 و 13 و 16): عدّلت كوداً في هذه الجولة (${list(files)}) و${situation}. `
    + `شغّل الآن: ${verifyCommand(mode)} — وأصلح السبب الجذري لأي فشل ثم أعد التشغيل حتى ينجح، ولا تصف العمل بأنه مكتمل قبل ذلك. `
    + 'استثناءان يُذكران للمستخدم صراحةً في الرد: إذا استنفدت محاولات التصحيح (البند 8) فسجّل الخطأ في bugs_log.md واكتب «🔴 الفحص: فاشل — <السبب>»؛ '
    + 'وإذا كان العمل متوقفاً بانتظار قراره فاكتب «🟠 الفحص: مؤجل — <السبب>».';
}

function untestedProblem(files) {
  return `🧪 ملفات منطق عُدّلت ولا يستوردها أي اختبار (البند 13): ${list(files)}. `
    + 'اكتب لكل منها اختباراً يغطي سلوكه (حالة ناجحة وحالة خطأ على الأقل) ثم أعد الفحص. '
    + 'إن كان الملف لا يحتاج اختباراً فعلاً (تهيئة أو ربط بلا منطق) فاذكر ذلك للمستخدم في ردك مع السبب.';
}

function docsProblem(codeFiles) {
  return `📋 التوثيق الإلزامي (master_rules.md §2): عدّلت ملفات كود في هذه الجولة (${list(codeFiles)}) دون تحديث changelog.md. `
    + 'نفّذ إجراء التوثيق الآن (مهارة /document): سجّل التعديل بصيغة Conventional Commits، وحدّث project_map.md و bugs_log.md و decisions_log.md عند الحاجة، '
    + 'ثم أنهِ ردك بختم التوثيق. استثناء وحيد: إذا كان التعديل لم يكتمل بعد (عمل جارٍ لم يعبر الفحص) أو أُلغي بالكامل، '
    + 'فلا تضف مدخلاً ناقصاً — اذكر ذلك صراحةً في الختم: ⬜ changelog (قيد التنفيذ — يُوثَّق عند الاكتمال).';
}

runHook(async () => {
  const input = await readStdinJson();
  if (input.stop_hook_active) return;

  const root = projectDir();
  const session = loadSession(input.session_id);
  const quality = loadQuality(root);
  const touched = touchedThisTurn(root, session, quality);
  // يُحدَّث سجل الاختصارات في كل جولة، حتى لو أُصلح الاختصار بأمر طرفية أو خارج الجلسة
  const open = openShortcuts(root, session, touched, quality);
  const codeFiles = touched.filter(isCodeFile);
  if (!codeFiles.length) return;

  const problems = [];
  if (open.length) problems.push(shortcutsProblem(open));

  const verifiable = touched.filter(needsVerification);
  if (verifiable.length) {
    const { mode } = readProjectState();
    const gate = gateStatus(mode, root);
    if (!['green', 'none'].includes(gate)) problems.push(verifyProblem(gate, mode, verifiable, quality));
    const logic = verifiable.filter(isLogicFile);
    if (logic.length && gate !== 'none') {
      const tests = collectTests(root);
      const untested = logic.filter((rel) => modifiedAt(root, rel) && !isCovered(rel, tests));
      if (untested.length) problems.push(untestedProblem(untested));
    }
  }

  const documented = session.edited.includes('changelog.md')
    || (session.turnStartedAt && modifiedAt(root, 'changelog.md') > session.turnStartedAt);
  if (!documented) problems.push(docsProblem(codeFiles));
  if (problems.length) emit({ decision: 'block', reason: problems.join('\n\n') });
});
