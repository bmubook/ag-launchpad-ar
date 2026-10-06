/**
 * بوابة الإثبات (البنود 8، 13، 16): حالة «ما عُدّل ولم يُفحص بعد» والاختصارات المفتوحة.
 * تُشارك بين verify.mjs و post-edit.mjs و stop-gate.mjs و session-start.mjs و statusline.mjs و health-report.mjs.
 * الحالة في .claude/state/quality.json (مستثناة من Git) وتبقى بين الجلسات.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectDir } from './common.mjs';
import { detectChecks, planChecks, readJson } from './checks.mjs';
import { changedSince, needsVerification } from './files.mjs';
import { verifyCommand } from './kit.mjs';

export { detectChecks, planChecks, needsVerification, verifyCommand };

const STATE_FILE = '.claude/state/quality.json';
const HISTORY_LIMIT = 30;

/** حد الخطوة: أقصى ما يُعدَّل بين فحصين ناجحين قبل تنبيه الوكيل بالتوقف والتحقق. */
export const STEP_LIMIT = { files: 8, lines: 200 };

export const isRulesFile = (relPath) => /\.rules$/i.test(relPath || '');

const emptyPending = () => ({ files: [], lines: 0, lastEditAt: 0, warnedLines: 0 });
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function loadQuality(root = projectDir()) {
  const data = readJson(join(root, STATE_FILE)) || {};
  const pending = data.pending && Array.isArray(data.pending.files) ? { ...emptyPending(), ...data.pending } : emptyPending();
  return {
    verify: isObject(data.verify) ? data.verify : null,
    pending,
    redSeen: Boolean(data.redSeen),
    greenTests: Number.isFinite(data.greenTests) ? data.greenTests : null,
    history: Array.isArray(data.history) ? data.history : [],
    shortcuts: isObject(data.shortcuts) ? data.shortcuts : {},
  };
}

export function saveQuality(quality, root = projectDir()) {
  try {
    mkdirSync(join(root, '.claude', 'state'), { recursive: true });
    writeFileSync(join(root, STATE_FILE), JSON.stringify(quality), 'utf8');
  } catch { /* الحالة اختيارية: الفشل هنا لا يوقف الجلسة */ }
}

/**
 * فترات تشغيل الفحص [بداية، نهاية]: ما تكتبه أدوات المشروع أثناءها (next build، tsc) ليس تعديلاً من الوكيل.
 * at تُسجَّل بعد انتهاء آخر خطوة، فالهامش صغير عمداً: تعديل يأتي بعد الفحص مباشرة يجب أن يُحسب.
 */
export function verifyWindows(quality) {
  return quality.history.filter((h) => Number.isFinite(h.at) && Number.isFinite(h.ms)).map((h) => [h.at - h.ms - 20, h.at + 20]);
}

/** يسجّل تعديلاً لم يُفحص بعد، ويعيد true إذا بلغ التراكم حد الخطوة (مرة لكل عتبة). */
export function recordPendingEdit(relPath, lines, limitFactor = 1) {
  const quality = loadQuality();
  const { pending } = quality;
  if (!pending.files.includes(relPath)) pending.files.push(relPath);
  pending.lines += lines;
  pending.lastEditAt = Date.now();
  const lineLimit = STEP_LIMIT.lines * limitFactor;
  const overLimit = pending.files.length >= STEP_LIMIT.files * limitFactor || pending.lines >= lineLimit;
  const shouldWarn = overLimit && pending.lines - pending.warnedLines >= lineLimit / 2;
  if (shouldWarn) pending.warnedLines = pending.lines;
  saveQuality(quality);
  return { shouldWarn, pending };
}

/** يحدّث سجل الاختصارات المفتوحة لملف (من فحص نصه الكامل): قائمة فارغة تحذفه. */
export function setOpenShortcuts(entries, root = projectDir()) {
  const quality = loadQuality(root);
  for (const [relPath, kinds] of Object.entries(entries)) {
    if (kinds.length) quality.shortcuts[relPath] = kinds;
    else delete quality.shortcuts[relPath];
  }
  saveQuality(quality, root);
  return quality.shortcuts;
}

/** يسجّل نتيجة تشغيل verify.mjs: النجاح يصفّر المعلّق، والفشل يُبقيه. run.testRed = فشل يخص الاختبارات. */
export function recordVerifyRun(run, root = projectDir()) {
  const quality = loadQuality(root);
  const redFirst = run.ok ? quality.redSeen : false;
  const previousTests = quality.greenTests;
  quality.verify = { ...run, redFirst };
  quality.redSeen = run.ok ? false : quality.redSeen || Boolean(run.testRed);
  if (run.ok) {
    quality.pending = emptyPending();
    if (Number.isFinite(run.tests)) quality.greenTests = run.tests;
  }
  quality.history = [...quality.history, { at: run.at, ok: run.ok, level: run.level, ms: run.ms, tests: run.tests ?? null }].slice(-HISTORY_LIMIT);
  saveQuality(quality, root);
  return { redFirst, previousTests };
}

/** الملفات غير المفحوصة منذ آخر فحص: ما سجّلته أدوات التعديل + ما تغيّر على القرص (أوامر الطرفية). */
export function unverifiedFiles(root = projectDir(), quality = loadQuality(root)) {
  const since = quality.verify?.at || 0;
  return [...new Set([...quality.pending.files, ...changedSince(root, since, verifyWindows(quality))])];
}

/**
 * حالة البوابة لوضع التشغيل: production يتطلب فحصاً كاملاً، و prototype يكفيه السريع.
 * تعيد: 'none' (لا أوامر فحص) | 'green' | 'red' | 'stale' (تعديلات بعد آخر فحص) | 'partial' (سريع والمطلوب كامل) | 'never'.
 */
export function gateStatus(mode = 'production', root = projectDir()) {
  if (!detectChecks(root).length) return 'none';
  const quality = loadQuality(root);
  const { verify, pending } = quality;
  if (!verify) return pending.files.length ? 'stale' : 'never';
  if (!verify.ok) return 'red';
  if (unverifiedFiles(root, quality).length) return 'stale';
  return mode !== 'prototype' && verify.level !== 'full' ? 'partial' : 'green';
}
