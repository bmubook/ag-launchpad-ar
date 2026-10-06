#!/usr/bin/env node
/**
 * Hook ما بعد التعديل (PostToolUse):
 * 1) يسجّل الملف المعدّل في قائمة الجولة الحالية (يستخدمها stop-gate.mjs).
 * 2) يراقب سقف حجم الملف حسب نوعه (البند 14 — rules_code_quality.md) ويُنبّه الوكيل.
 * 3) يكشف الاختصارات في النص المضاف (البند 11): TODO، اختبار معطّل، خطأ مكتوم، فحص معطّل، بيانات وهمية...
 * 4) يسجّل التعديل «غير مفحوص» لبوابة الإثبات، وينبّه عند بلوغ حد الخطوة (البند 8).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  addContext, loadSession, projectDir, readProjectState, readStdinJson, runHook, saveSession, toProjectRelative,
} from './lib/common.mjs';
import { ceilingFor, ceilingStatus, countLines } from './lib/ceilings.mjs';
import { hostTraits } from './lib/host.mjs';
import { CONFIG_FILE, GUARD_KIT } from './lib/kit.mjs';
import { PROTECTED_INSTRUCTION_PATHS } from './lib/patterns.mjs';
import { detectChecks, needsVerification, recordPendingEdit, setOpenShortcuts, verifyCommand } from './lib/quality.mjs';
import { NO_ASSERTION, isAssertionlessTest, scanFile, scanShortcuts } from './lib/shortcuts.mjs';

function readFile(relPath) {
  try { return readFileSync(resolve(projectDir(), relPath), 'utf8'); } catch { return ''; }
}

/**
 * في الحقيبة سقف الحجم معطّل ما لم يُفعَّل (ceilings في .claude/launchpad.json): ملفات المشاريع القائمة كبيرة غالباً،
 * وتنبيه عند كل تعديل يدفع الوكيل إلى إعادة هيكلة لم يطلبها أحد.
 */
const ceilingsOn = () => !GUARD_KIT || readProjectState().ceilings;

function currentStatus(relPath, fullText) {
  const rule = ceilingsOn() ? ceilingFor(relPath) : null;
  if (!rule || !fullText) return { rule, lines: 0, status: null };
  const lines = countLines(fullText);
  return { rule, lines, status: ceilingStatus(lines, rule) };
}

function ceilingMessage(relPath, lines, rule, status) {
  if (status === 'hard') {
    return `🚨 تجاوز سقف الحجم (البند 14): ${relPath} أصبح ${lines} سطراً، والسقف الأقصى لـ${rule.label} هو ${rule.hard}. `
      + 'يجب تقسيمه إلى وحدات متخصصة (Modular Architecture) قبل إضافة أي ميزة جديدة، مع إبلاغ المستخدم لأنها إشارة تضخم (البند 29). '
      + 'لا تقسّم تقسيماً شكلياً — قسّم فقط بما يحسّن القراءة والصيانة.';
  }
  return `⚠️ اقتراب من سقف الحجم (البند 14): ${relPath} بلغ ${lines} سطراً (نطاق ${rule.label}: ${rule.soft}–${rule.hard}). `
    + 'خطّط للتقسيم إذا كان التعديل القادم سيضيف منطقاً جديداً لهذا الملف.';
}

/** النص الذي أضافه هذا التعديل (Write: المحتوى كله، Edit/MultiEdit: النصوص الجديدة فقط). */
function addedText(toolInput) {
  if (typeof toolInput.content === 'string') return toolInput.content;
  if (Array.isArray(toolInput.edits)) return toolInput.edits.map((e) => e.new_string || '').join('\n');
  return toolInput.new_string || toolInput.new_source || '';
}

function shortcutMessage(relPath, found) {
  return `🚩 اختصار مرصود (البند 11) في ${relPath}: ${found.map((f) => f.label).join('؛ ')}. `
    + 'أصلحه الآن بالحل الصحيح. إن كان ضرورياً فعلاً فاذكره للمستخدم صراحةً في ردك تحت «🚩 اختصارات مؤقتة» مع سببه وموعد إزالته، ولا تخفِه.';
}

function stepLimitMessage(pending) {
  return `⏸️ حد الخطوة (البند 8): عدّلت ${pending.files.length} ملفاً (نحو ${pending.lines} سطراً) منذ آخر فحص ناجح. `
    + `توقف عن إضافة كود جديد وشغّل الآن: ${verifyCommand('prototype')} — الأخطاء المتراكمة فوق بعضها أصعب تشخيصاً من خطأ واحد حديث.`;
}

const NO_GATE_MESSAGE = 'ℹ️ لا توجد بوابة فحص بعد: المشروع بلا أوامر lint/test، فهذا الكود لن يُفحص آلياً. '
  + (GUARD_KIT
    ? `لم يجد الحارس أوامر فحص يعرفها: أخبر المستخدم أن يكتبها في ${CONFIG_FILE} (الحقل checks)، ولا تكتبها أنت دون طلبه.`
    : 'نفّذ /quality-setup قبل بناء الميزات (البنود 13 و 16)، ونبّه المستخدم إن اختار التأجيل.');

/** في أداة بلا نافذة موافقة مسبقة (Cursor) يمرّ تعديل ملف الحوكمة، فيُلزَم الوكيل بإبلاغ المستخدم به. */
function governanceMessage(relPath) {
  return `🛡️ عدّلت ${relPath} وهو من ملفات الحوكمة/طبقة الإنفاذ (البند 6). هذه البيئة لا تطلب موافقة المستخدم قبل التعديل، `
    + 'فأخبره صراحةً في ردك بما غيّرته في هذا الملف ولماذا.';
}

const ROADMAP_SOURCES = new Set(['project_map.md', 'changelog.md']);
const ROADMAP_CREATED = '🗺️ أُنشئت خارطة الطريق docs/roadmap.html، وتتحدث تلقائياً كلما تغيّر project_map.md. '
  + 'أخبر المستخدم في ردك بجملة واحدة أنه يرى منها أين وصل مشروعه: يفتحها بالنقر المزدوج، أو تفتحها له بالأمر node .claude/scripts/roadmap.mjs --open.';

/**
 * خارطة الطريق تتبع project_map.md؛ أول إنشاء لها يُبلَّغ به المستخدم. أي فشل هنا لا يوقف الجلسة.
 * الاستيراد عند الحاجة فقط: حقيبة الحارس لا تحمل سكربتات الخارطة.
 */
async function refreshRoadmap() {
  try {
    const { writeRoadmap } = await import('../scripts/roadmap/page.mjs');
    return writeRoadmap(projectDir()).created ? ROADMAP_CREATED : null;
  } catch {
    return null;
  }
}

/**
 * أسطر هذا التعديل لحد الخطوة. أداة ترسل محتوى الملف كاملاً حتى عند تغيير سطر واحد (Cursor)
 * يُحسب لها الفرق عن آخر حجم معروف للملف في الجلسة، لا الملف كله في كل مرة.
 */
function editedLines(input, session, relPath, added, fullText) {
  if (!hostTraits(input.host).fullContentEdits || typeof input.tool_input?.content !== 'string') return countLines(added);
  const total = countLines(fullText);
  const previous = session.sizes[relPath];
  session.sizes[relPath] = total;
  return previous === undefined ? total : Math.max(1, Math.abs(total - previous));
}

runHook(async () => {
  const input = await readStdinJson();
  const toolInput = input.tool_input || {};
  const relPath = toProjectRelative(toolInput.file_path || toolInput.notebook_path);
  if (!relPath) return;

  const fullText = readFile(relPath);
  const added = addedText(toolInput);
  const { rule, lines, status } = currentStatus(relPath, fullText);
  const messages = [];

  const session = loadSession(input.session_id);
  if (!session.edited.includes(relPath)) session.edited.push(relPath);
  const newCeilingStatus = Boolean(status) && session.warned[relPath] !== status;
  if (status) session.warned[relPath] = status;
  else delete session.warned[relPath];
  if (newCeilingStatus || status === 'hard') messages.push(ceilingMessage(relPath, lines, rule, status));
  if (!hostTraits(input.host).approvalPrompt && PROTECTED_INSTRUCTION_PATHS.some((re) => re.test(relPath))) messages.push(governanceMessage(relPath));
  if (ROADMAP_SOURCES.has(relPath) && readProjectState().kickedOff) {
    const note = await refreshRoadmap();
    if (note) messages.push(note);
  }

  if (needsVerification(relPath)) {
    const found = scanShortcuts(relPath, added);
    if (isAssertionlessTest(relPath, fullText)) found.push(NO_ASSERTION);
    if (found.length) {
      session.shortcuts[relPath] = [...new Set([...(session.shortcuts[relPath] || []), ...found.map((f) => f.kind)])];
      messages.push(shortcutMessage(relPath, found));
    }
    // سجل دائم بين الجولات: يبقى ظاهراً في سطر الحالة حتى يُزال الاختصار فعلاً من الملف
    setOpenShortcuts({ [relPath]: scanFile(relPath, fullText).map((f) => f.kind) });

    const state = readProjectState();
    const changed = editedLines(input, session, relPath, added, fullText);
    const { shouldWarn, pending } = recordPendingEdit(relPath, changed, state.mode === 'prototype' ? 2 : 1);
    if (detectChecks().length) {
      if (shouldWarn) messages.push(stepLimitMessage(pending));
    } else if ((state.kickedOff || GUARD_KIT) && ceilingFor(relPath) && !session.warned['#no-gate']) {
      session.warned['#no-gate'] = 'shown';
      messages.push(NO_GATE_MESSAGE);
    }
  }

  saveSession(input.session_id, session);
  if (messages.length) addContext('PostToolUse', messages.join('\n\n'));
});
