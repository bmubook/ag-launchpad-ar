/**
 * بوابة الإثبات (البنود 8، 13، 16): اكتشاف أوامر فحص المشروع، وحالة «ما عُدّل ولم يُفحص بعد».
 * تُشارك بين verify.mjs و post-edit.mjs و stop-gate.mjs و session-start.mjs و health-report.mjs.
 * الحالة في .claude/state/quality.json (مستثناة من Git) وتبقى بين الجلسات.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isCodeFile, projectDir } from './common.mjs';

const STATE_FILE = '.claude/state/quality.json';
const HISTORY_LIMIT = 30;

/** حد الخطوة: أقصى ما يُعدَّل بين فحصين ناجحين قبل تنبيه الوكيل بالتوقف والتحقق. */
export const STEP_LIMIT = { files: 8, lines: 200 };

// ملفات لا يغطيها فحص المشروع: القالب نفسه، وإعدادات لا تُبنى ولا تُختبر
const NOT_VERIFIABLE = [
  /^\.(claude|agents|github|vscode|idea)\//, /^(setup-guide|blueprints|docs)\//, /^SETUP_GUIDE\.html$/,
  /(^|\/)\.(gitignore|gitattributes|editorconfig|npmrc|nvmrc|firebaserc|prettierignore|eslintignore|dockerignore|env\.[a-z]+)$/,
  /(^|\/)LICENSE$/i, /\.(png|jpe?g|gif|webp|avif|svg|ico|pdf|lock|log)$/i,
];

/** هل تعديل هذا الملف يستوجب إعادة فحص المشروع؟ */
export function needsVerification(relPath) {
  return isCodeFile(relPath) && !NOT_VERIFIABLE.some((re) => re.test(relPath));
}

export const isRulesFile = (relPath) => /\.rules$/i.test(relPath || '');

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function packageManager(dir) {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock'))) return 'bun';
  return 'npm';
}

const NODE_STEPS = [
  { name: 'format', label: 'التنسيق', scripts: ['format:check'] },
  { name: 'lint', label: 'التدقيق', scripts: ['lint'] },
  { name: 'types', label: 'الأنواع', scripts: ['typecheck', 'type-check', 'check-types'] },
  { name: 'test', label: 'الاختبارات', scripts: ['test'] },
  { name: 'rules', label: 'قواعد الأمان', scripts: ['test:rules'], rulesOnly: true },
  { name: 'build', label: 'البناء', scripts: ['build'], fullOnly: true },
];

function nodeSteps(dir, prefix) {
  const scripts = readJson(join(dir, 'package.json'))?.scripts || {};
  const pm = packageManager(dir);
  const steps = [];
  for (const def of NODE_STEPS) {
    const script = def.scripts.find((s) => scripts[s] && !/no test specified/i.test(scripts[s]));
    if (script) {
      steps.push({ ...def, name: prefix + def.name, cmd: `${pm} run ${script}`, cwd: dir });
    } else if (def.name === 'types' && existsSync(join(dir, 'tsconfig.json')) && existsSync(join(dir, 'node_modules', 'typescript'))) {
      steps.push({ ...def, name: prefix + def.name, cmd: 'npx --no-install tsc --noEmit', cwd: dir });
    }
  }
  if (!steps.length && scripts.check) steps.push({ name: `${prefix}check`, label: 'الفحص', cmd: `${pm} run check`, cwd: dir });
  return steps;
}

function flutterSteps(dir) {
  const steps = [
    { name: 'format', label: 'التنسيق', cmd: 'dart format --output=none --set-exit-if-changed .', cwd: dir },
    { name: 'lint', label: 'التدقيق', cmd: 'flutter analyze', cwd: dir },
  ];
  if (existsSync(join(dir, 'test'))) steps.push({ name: 'test', label: 'الاختبارات', cmd: 'flutter test', cwd: dir });
  if (existsSync(join(dir, 'tests', 'rules', 'package.json'))) {
    steps.push({ name: 'rules', label: 'قواعد الأمان', cmd: 'firebase emulators:exec "npm --prefix tests/rules test"', cwd: dir, rulesOnly: true });
  }
  return steps;
}

/** كل خطوات الفحص المتاحة في المشروع (الجذر ثم functions/). مصفوفة فارغة = لا بوابة فحص بعد. */
export function detectChecks(root = projectDir()) {
  const steps = [];
  if (existsSync(join(root, 'pubspec.yaml'))) steps.push(...flutterSteps(root));
  else if (existsSync(join(root, 'package.json'))) steps.push(...nodeSteps(root, ''));
  const functionsDir = join(root, 'functions');
  if (existsSync(join(functionsDir, 'package.json'))) steps.push(...nodeSteps(functionsDir, 'functions:'));
  return steps;
}

/**
 * خطة التشغيل: quick يتخطى البناء؛ اختبارات قواعد الأمان تُشغَّل فقط إذا عُدّل ملف .rules أو طُلبت.
 * level = 'full' إذا لم يُتخطَّ أي بناء (مشروع بلا خطوة بناء يُعد فحصه السريع كاملاً).
 */
export function planChecks({ quick = false, rules = false } = {}, root = projectDir()) {
  const all = detectChecks(root);
  const steps = all.filter((s) => (!s.fullOnly || !quick) && (!s.rulesOnly || rules));
  const skippedBuild = quick && all.some((s) => s.fullOnly);
  return { steps, level: skippedBuild ? 'quick' : 'full', available: all.length };
}

const emptyPending = () => ({ files: [], lines: 0, lastEditAt: 0, warnedLines: 0 });

export function loadQuality(root = projectDir()) {
  const data = readJson(join(root, STATE_FILE)) || {};
  const pending = data.pending && Array.isArray(data.pending.files) ? { ...emptyPending(), ...data.pending } : emptyPending();
  return {
    verify: data.verify && typeof data.verify === 'object' ? data.verify : null,
    pending,
    redSeen: Boolean(data.redSeen),
    greenTests: Number.isFinite(data.greenTests) ? data.greenTests : null,
    history: Array.isArray(data.history) ? data.history : [],
  };
}

export function saveQuality(quality, root = projectDir()) {
  try {
    mkdirSync(join(root, '.claude', 'state'), { recursive: true });
    writeFileSync(join(root, STATE_FILE), JSON.stringify(quality), 'utf8');
  } catch { /* الحالة اختيارية: الفشل هنا لا يوقف الجلسة */ }
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

/** يسجّل نتيجة تشغيل verify.mjs: النجاح يصفّر المعلّق، والفشل يُبقيه. */
export function recordVerifyRun(run, root = projectDir()) {
  const quality = loadQuality(root);
  const failedAtTests = !run.ok && /(^|:)(test|rules)$/.test(run.failed || '');
  const redFirst = run.ok ? quality.redSeen : false;
  const previousTests = quality.greenTests;
  quality.verify = { ...run, redFirst };
  quality.redSeen = run.ok ? false : quality.redSeen || failedAtTests;
  if (run.ok) {
    quality.pending = emptyPending();
    if (Number.isFinite(run.tests)) quality.greenTests = run.tests;
  }
  quality.history = [...quality.history, { at: run.at, ok: run.ok, level: run.level, ms: run.ms, tests: run.tests ?? null }].slice(-HISTORY_LIMIT);
  saveQuality(quality, root);
  return { redFirst, previousTests };
}

/**
 * حالة البوابة لوضع التشغيل: production يتطلب فحصاً كاملاً، و prototype يكفيه السريع.
 * تعيد: 'none' (لا أوامر فحص) | 'green' | 'red' | 'stale' (تعديلات بعد آخر فحص) | 'partial' (سريع والمطلوب كامل) | 'never'.
 */
export function gateStatus(mode = 'production', root = projectDir()) {
  if (!detectChecks(root).length) return 'none';
  const { verify, pending } = loadQuality(root);
  if (!verify) return pending.files.length ? 'stale' : 'never';
  if (!verify.ok) return 'red';
  if (pending.files.length) return 'stale';
  return mode !== 'prototype' && verify.level !== 'full' ? 'partial' : 'green';
}
