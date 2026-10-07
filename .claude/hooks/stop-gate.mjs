#!/usr/bin/env node
/**
 * Hook التوقف (Stop) — بوابة إنهاء الرد. إذا عُدّل كود في هذه الجولة يمنع الإنهاء مرة واحدة حتى:
 * 1) تُعالَج الاختصارات المرصودة أو تُذكر للمستخدم صراحةً (البند 11).
 * 2) ينجح فحص المشروع بعد آخر تعديل: node .claude/scripts/verify.mjs (البنود 8 و 13 و 16).
 * 3) يكون لكل ملف منطق عُدّل اختبارٌ يستورده (البند 13).
 * 4) يُحدَّث changelog.md (master_rules.md §2). حقيبة الحارس بلا سجلات: تاريخ المشروع القائم في Git.
 * «عُدّل في هذه الجولة» = ما سجّلته أدوات التعديل + ما تغيّر على القرص منذ بداية الجولة (sed، سكربتات، مولّدات).
 * stop_hook_active يمنع الحلقات اللانهائية: المنع مرة واحدة، ثم تبقى الحالة ظاهرة في سطر الحالة.
 */
import {
  emit, isCodeFile, loadSession, projectDir, readProjectState, readStdinJson, runHook, truncate,
} from './lib/common.mjs';
import { collectTests, isCovered, isLogicFile } from './lib/coverage.mjs';
import { changedSince, modifiedAt, readText, walkWasTruncated } from './lib/files.mjs';
import { changedPrints, fingerprint } from './lib/fingerprint.mjs';
import { GUARD_KIT } from './lib/kit.mjs';
import { PROTECTED_INSTRUCTION_PATHS } from './lib/patterns.mjs';
import {
  gateStatus, loadQuality, needsVerification, setOpenShortcuts, verifyCommand, verifyWindows,
} from './lib/quality.mjs';
import { scanFile } from './lib/shortcuts.mjs';

const list = (files) => truncate(files.join('، '), 300);

/*
 * حدود Hook التوقف: مهلته 15 ث، وجولة لمست آلاف الملفات (touch جماعي مثلاً) قد تُطيل إعادة الفحص حتى ينقطع
 * الـ Hook فيمرّ الرد دون أي فحص. ما لا يتسع له الوقت أو الحد يُعلَن «فحصاً جزئياً» ويوقف الإنهاء، ولا يُعد ناجحاً.
 */
const DEADLINE_MS = 8000;
const MAX_RESCAN = 300;
const MAX_LOGIC_CHECK = 100;
const startedAt = Date.now();
const late = () => Date.now() - startedAt > DEADLINE_MS;

/** ملفات هذه الجولة: أدوات التعديل + تعديلات القرص منذ بدايتها (خارج فترات تشغيل الفحص نفسه). */
function touchedThisTurn(root, session, quality) {
  const onDisk = session.turnStartedAt ? changedSince(root, session.turnStartedAt, verifyWindows(quality)) : [];
  return [...new Set([...session.edited, ...onDisk])];
}

/**
 * يعيد فحص الملفات من القرص ويحدّث سجل الاختصارات الدائم؛ يعيد ما رُصد في هذه الجولة وما زال قائماً.
 * الأولوية لما رُصد في هذه الجولة، وما لم يتسع له الوقت يُعد قائماً لا مُصلحاً.
 */
function openShortcuts(root, session, touched, quality, partial) {
  const ordered = [...new Set([...Object.keys(session.shortcuts), ...Object.keys(quality.shortcuts), ...touched.filter(needsVerification)])];
  const current = {};
  for (const rel of ordered.slice(0, MAX_RESCAN)) {
    if (late()) break;
    current[rel] = scanFile(rel, readText(root, rel) || '');
  }
  if (Object.keys(current).length < ordered.length) partial.add('الاختصارات');
  setOpenShortcuts(Object.fromEntries(Object.entries(current).map(([rel, found]) => [rel, found.map((f) => f.kind)])), root);
  return Object.entries(session.shortcuts).flatMap(([rel, kinds]) => {
    if (!(rel in current)) return [`${rel} (لم يُعد فحصه في الوقت المتاح)`];
    const still = current[rel].filter((f) => kinds.includes(f.kind));
    return still.length ? [`${rel} (${still.map((f) => f.label).join('؛ ')})`] : [];
  });
}

/** ملفات منطق عُدّلت ولا يغطيها اختبار، في حدود الوقت وعدد الملفات. */
function untestedLogic(root, logic, partial) {
  const tests = collectTests(root);
  const untested = [];
  for (const rel of logic.slice(0, MAX_LOGIC_CHECK)) {
    if (late()) break;
    if (modifiedAt(root, rel) && !isCovered(rel, tests, root)) untested.push(rel);
  }
  if (logic.length > MAX_LOGIC_CHECK || late()) partial.add('تغطية الاختبارات');
  return untested;
}

function partialProblem(parts, mode) {
  return `⏱️ فحص جزئي: لمست هذه الجولة ملفات كثيرة، فلم يتسع الوقت لإعادة فحص ${[...parts].join(' و')} فيها كلها. `
    + `راجع ما تغيّر (git status) وشغّل ${verifyCommand(mode)} قبل إنهاء الرد، وأخبر المستخدم إن كان التغيير الواسع مقصوداً.`;
}

// إعدادات شخصية يكتبها التطبيق نفسه (مثل «السماح دائماً» في Claude Code)، لا الوكيل
const SELF_WRITTEN = /^\.claude\/settings\.local\.json$/i;

/**
 * ملفات حوكمة تغيّرت على القرص في هذه الجولة دون أن تمر بأداة تعديل: كُتبت بأمر طرفية لم يتعرف عليه الحارس
 * (دالة ‎.NET، متغير يخفي المسار، سكربت)، فلم يُسأل المستخدم عنها. خط دفاع ثانٍ بعد lib/threats.mjs.
 * المقارنة بالمحتوى مع بصمة بداية الجولة (prompt-submit.mjs)، فانتقال Git بين الفروع لا يُحسب تغييراً.
 */
function governanceChangedByShell(root, session) {
  if (!session.governance) return [];
  return changedPrints(session.governance, fingerprint(root, PROTECTED_INSTRUCTION_PATHS))
    .filter((rel) => !session.edited.includes(rel) && !SELF_WRITTEN.test(rel));
}

function governanceProblem(files) {
  return `🛡️ تغيّر ${list(files)} بأمر طرفية لا بأداة التعديل، فلم يمرّ بموافقة المستخدم. `
    + 'أخبره صراحةً في ردك بما غيّرته في هذا الملف ولماذا، واعرض عليه التراجع عنه إن لم يكن هو من طلبه.';
}

// في الحقيبة لا Backlog ولا bugs_log.md: ما يُترك يُذكر للمستخدم وحده
const TRACK_SHORTCUT = GUARD_KIT ? '' : '، وسجّله في Backlog أو bugs_log.md ليُزال لاحقاً';
const TRACK_FAILURE = GUARD_KIT ? '' : 'فسجّل الخطأ في bugs_log.md و';

function shortcutsProblem(open) {
  return `🚩 اختصارات لم تُعالج (البند 11): ${truncate(open.join(' — '), 500)}. `
    + `أصلحها بالحل الصحيح الآن. وإن كان أحدها ضرورياً فعلاً فاذكره للمستخدم في ردك تحت عنوان «🚩 اختصارات مؤقتة» مع سببه${TRACK_SHORTCUT}.`;
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
    + `استثناءان يُذكران للمستخدم صراحةً في الرد: إذا استنفدت محاولات التصحيح (البند 8) ${TRACK_FAILURE}اكتب «🔴 الفحص: فاشل — <السبب>»؛ `
    + 'وإذا كان العمل متوقفاً بانتظار قراره فاكتب «🟠 الفحص: مؤجل — <السبب>».';
}

function untestedProblem(files) {
  return `🧪 ملفات منطق عُدّلت ولا يستوردها أي اختبار (البند 13): ${list(files)}. `
    + 'اكتب لكل منها اختباراً يغطي سلوكه (حالة ناجحة وحالة خطأ على الأقل) ثم أعد الفحص. '
    + 'إن كان الملف لا يحتاج اختباراً فعلاً (تهيئة أو ربط بلا منطق) فاذكر ذلك للمستخدم في ردك مع السبب.';
}

/**
 * سجلات التغييرات المقبولة. في مستودع القالب نفسه (قبل الإقلاع) السجل هو docs/template-changelog.md،
 * لأن changelog.md يُشحن فارغاً لمشروع المستخدم؛ وبعد الإقلاع لا يُقبل إلا changelog.md.
 */
const acceptedLogs = (kickedOff) => (kickedOff ? ['changelog.md'] : ['docs/template-changelog.md', 'changelog.md']);

function docsProblem(codeFiles, logs) {
  return `📋 التوثيق الإلزامي (master_rules.md §2): عدّلت ملفات كود في هذه الجولة (${list(codeFiles)}) دون تحديث ${logs[0]}. `
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
  // فحص ملفات الحوكمة أولاً: هو خط الدفاع الثاني، فلا يتأخر خلف مسح الاختصارات
  const governance = governanceChangedByShell(root, session);
  const problems = governance.length ? [governanceProblem(governance)] : [];
  const touched = touchedThisTurn(root, session, quality);
  const partial = new Set();
  // مشروع أكبر من حد المسح: ما لم يُمسح قد يكون عُدّل بأمر طرفية، فلا يُعدّ سليماً
  if (walkWasTruncated(root)) partial.add('الملفات المعدّلة بأوامر الطرفية');
  // يُحدَّث سجل الاختصارات في كل جولة، حتى لو أُصلح الاختصار بأمر طرفية أو خارج الجلسة
  const open = openShortcuts(root, session, touched, quality, partial);
  const codeFiles = touched.filter(isCodeFile);
  if (!codeFiles.length) return block(problems);

  if (open.length) problems.push(shortcutsProblem(open));

  const { mode } = readProjectState();
  const verifiable = touched.filter(needsVerification);
  if (verifiable.length) {
    const gate = gateStatus(mode, root);
    if (!['green', 'none'].includes(gate)) problems.push(verifyProblem(gate, mode, verifiable, quality));
    const logic = verifiable.filter(isLogicFile);
    if (logic.length && gate !== 'none') {
      const untested = untestedLogic(root, logic, partial);
      if (untested.length) problems.push(untestedProblem(untested));
    }
  }
  if (partial.size) problems.push(partialProblem(partial, mode));

  if (GUARD_KIT) return block(problems);
  const logs = acceptedLogs(readProjectState().kickedOff);
  const documented = logs.some((file) => session.edited.includes(file)
    || (session.turnStartedAt && modifiedAt(root, file) > session.turnStartedAt));
  if (!documented) problems.push(docsProblem(codeFiles, logs));
  block(problems);
});

function block(problems) {
  if (problems.length) emit({ decision: 'block', reason: problems.join('\n\n') });
}
