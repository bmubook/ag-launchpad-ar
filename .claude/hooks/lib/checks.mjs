/**
 * اكتشاف أوامر فحص المشروع لبوابة الإثبات: Node (package.json) و Flutter (pubspec.yaml) و functions/،
 * واللغات الأخرى في lib/stacks.mjs. الأسماء المعتمدة من /quality-setup: format:check و lint و typecheck و test و test:rules و build.
 * ما يكتبه صاحب المشروع في .claude/launchpad.json (الحقل checks) يحل محل الاكتشاف كله.
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { projectDir } from './common.mjs';
import { readGuardConfig } from './kit.mjs';
import { stackSteps } from './stacks.mjs';

export function readJson(path) {
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

/** Next.js 15.5+ يولّد أنواع المسارات (LayoutProps و PageProps) في .next/types؛ نسخة جديدة من المشروع لا تحويها بعد. */
function hasNextTypegen(dir) {
  const version = readJson(join(dir, 'node_modules', 'next', 'package.json'))?.version || '';
  const [major, minor] = version.split('.').map(Number);
  return major > 15 || (major === 15 && minor >= 5);
}

function implicitTypesCommand(dir) {
  if (!existsSync(join(dir, 'tsconfig.json')) || !existsSync(join(dir, 'node_modules', 'typescript'))) return null;
  const tsc = 'npx --no-install tsc --noEmit';
  return hasNextTypegen(dir) ? `npx --no-install next typegen && ${tsc}` : tsc;
}

function nodeSteps(dir, prefix) {
  const scripts = readJson(join(dir, 'package.json'))?.scripts || {};
  const pm = packageManager(dir);
  const steps = [];
  for (const def of NODE_STEPS) {
    const script = def.scripts.find((s) => scripts[s] && !/no test specified/i.test(scripts[s]));
    const cmd = script ? `${pm} run ${script}` : def.name === 'types' ? implicitTypesCommand(dir) : null;
    if (!cmd) continue;
    const fix = def.name === 'format' && scripts.format ? `${pm} run format` : null;
    steps.push({ ...def, name: prefix + def.name, cmd, cwd: dir, fix });
  }
  if (!steps.length && scripts.check) steps.push({ name: `${prefix}check`, label: 'الفحص', cmd: `${pm} run check`, cwd: dir });
  return steps;
}

function flutterSteps(dir) {
  const steps = [
    { name: 'format', label: 'التنسيق', cmd: 'dart format --output=none --set-exit-if-changed .', cwd: dir, fix: 'dart format .' },
    { name: 'lint', label: 'التدقيق', cmd: 'flutter analyze', cwd: dir },
  ];
  if (existsSync(join(dir, 'test'))) steps.push({ name: 'test', label: 'الاختبارات', cmd: 'flutter test', cwd: dir });
  if (existsSync(join(dir, 'tests', 'rules', 'package.json'))) {
    steps.push({ name: 'rules', label: 'قواعد الأمان', cmd: 'firebase emulators:exec "npm --prefix tests/rules test"', cwd: dir, rulesOnly: true });
  }
  return steps;
}

const STEP_LABELS = { format: 'التنسيق', lint: 'التدقيق', types: 'الأنواع', test: 'الاختبارات', rules: 'قواعد الأمان', build: 'البناء' };

/**
 * أوامر صاحب المشروع: {"checks": [{"step": "test", "run": "pytest -q"}]}. step واحدة من STEP_LABELS (غيرها فحص عام)،
 * و label و cwd (مجلد داخل المشروع) و fix و failOnOutput اختيارية. أمر صالح واحد يكفي ليحل محل الاكتشاف التلقائي.
 */
function configuredChecks(root) {
  const entries = readGuardConfig(root).checks;
  if (!Array.isArray(entries)) return null;
  const steps = [];
  entries.forEach((entry, index) => {
    const cmd = typeof entry?.run === 'string' ? entry.run.trim() : '';
    const cwd = resolve(root, typeof entry?.cwd === 'string' ? entry.cwd : '.');
    const inside = relative(root, cwd);
    if (!cmd || inside.startsWith('..') || isAbsolute(inside)) return;
    const kind = STEP_LABELS[entry.step] ? entry.step : 'check';
    const label = typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : STEP_LABELS[kind] || `الفحص ${index + 1}`;
    steps.push({
      name: `config${index + 1}:${kind}`, label, cmd, cwd, fullOnly: kind === 'build', rulesOnly: kind === 'rules',
      fix: typeof entry.fix === 'string' ? entry.fix : null, failOnOutput: entry.failOnOutput === true,
    });
  });
  return steps.length ? steps : null;
}

/** كل خطوات الفحص المتاحة في المشروع (الجذر ثم functions/). مصفوفة فارغة = لا بوابة فحص بعد. */
export function detectChecks(root = projectDir()) {
  const configured = configuredChecks(root);
  if (configured) return configured;
  const steps = [];
  if (existsSync(join(root, 'pubspec.yaml'))) steps.push(...flutterSteps(root));
  else if (existsSync(join(root, 'package.json'))) steps.push(...nodeSteps(root, ''));
  steps.push(...stackSteps(root));
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
