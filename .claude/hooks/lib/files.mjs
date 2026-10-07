/**
 * ملفات المشروع على القرص — يشترك فيه size-report.mjs و health-report.mjs وبوابة الإثبات وبصمة الحوكمة (lib/fingerprint.mjs).
 * changedSince يكمّل سجل أدوات التعديل: تعديل بأمر طرفية (sed، سكربت، مولّد كود) لا يمر بـ Hook ما بعد التعديل.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { isCodeFile } from './common.mjs';

export const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.output', 'coverage',
  '.dart_tool', '.gradle', 'Pods', '.venv', 'venv', '__pycache__', 'vendor', '.turbo', '.cache', '.firebase', '.expo',
  'target', '.mypy_cache', '.pytest_cache', '.ruff_cache', '.tox', '.nox', '.svelte-kit', '.parcel-cache', '.terraform', '.vs', '.idea',
]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_SCAN = 20000;
// Git يستبعد مخرجات البناء بنفسه (.gitignore)، فيتسع الحد لمستودعات المحترفين الكبيرة
const MAX_GIT_SCAN = 50000;

// ملفات لا يغطيها فحص المشروع: القالب نفسه، وإعدادات لا تُبنى ولا تُختبر، وملفات تولّدها الأدوات
const NOT_VERIFIABLE = [
  /^\.(claude|agents|cursor|github|vscode|idea)\//, /^(setup-guide|blueprints|docs)\//, /^SETUP_GUIDE\.html$/,
  /(^|\/)\.(gitignore|gitattributes|editorconfig|npmrc|nvmrc|firebaserc|prettierignore|eslintignore|dockerignore|cursorignore|env\.[a-z]+)$/,
  /(^|\/)LICENSE$/i, /\.(png|jpe?g|gif|webp|avif|svg|ico|pdf|lock|log|tsbuildinfo)$/i, /(^|\/)next-env\.d\.ts$/,
];

/** هل تعديل هذا الملف يستوجب إعادة فحص المشروع؟ */
export function needsVerification(relPath) {
  return isCodeFile(relPath) && !NOT_VERIFIABLE.some((re) => re.test(relPath));
}

// قائمة Git محفوظة لكل عملية: الـ Hook الواحد يسرد الملفات أكثر من مرة، والملفات لا تتغير بين المرات
const gitListings = new Map();
// الحجة المعتمدة لـ Git: core.fsmonitor أمر يشغّله Git نفسه، فيمكن أن يُضبط ليشغّل أي شيء مع كل Hook
const GIT_LIST = ['-c', 'core.fsmonitor=false', 'ls-files', '-z', '--cached', '--others', '--exclude-per-directory=.gitignore'];

/** على Windows يبحث النظام عن البرنامج في المجلد الحالي قبل PATH، فلا يُشغَّل git.exe موضوع في المشروع بدل Git. */
function withoutCurrentDirLookup(run) {
  if (process.platform !== 'win32') return run();
  const previous = process.env.NoDefaultCurrentDirectoryInExePath;
  process.env.NoDefaultCurrentDirectoryInExePath = '1';
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.NoDefaultCurrentDirectoryInExePath;
    else process.env.NoDefaultCurrentDirectoryInExePath = previous;
  }
}

/**
 * ملفات المشروع كما يعرفها Git: المتتبَّعة والجديدة، عدا ما تتجاهله ملفات .gitignore في المشروع نفسه.
 * أسرع من مسح القرص في المستودعات الكبيرة، ويستبعد مخرجات البناء في أي لغة (bin/ و obj/ في .NET مثلاً).
 * لا يُعتمد .git/info/exclude ولا ملف التجاهل العام: كلاهما لا يظهر في المشروع، فلا يُخفى به ملف عن البوابة.
 * null إذا لم يكن الجذر مستودع Git أو لم يتوفر git.
 */
function gitFiles(root) {
  if (gitListings.has(root)) return gitListings.get(root);
  let files = null;
  if (existsSync(join(root, '.git'))) {
    const result = withoutCurrentDirLookup(() => spawnSync('git', GIT_LIST, {
      cwd: root, encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 * 1024, windowsHide: true,
    }));
    if (!result.error && result.status === 0) files = result.stdout.split('\0').filter(Boolean);
  }
  gitListings.set(root, files);
  return files;
}

/** مسارات الوحدات الفرعية (submodules) داخل المشروع: Git يسرد الوحدة مساراً واحداً، فتُمسح ملفاتها من القرص. */
function submoduleDirs(root) {
  const text = readText(root, '.gitmodules') || '';
  return text.split(/\r?\n/)
    .map((line) => line.trim().match(/^path\s*=\s*(.+)$/)?.[1])
    .filter(Boolean)
    .map((path) => resolve(root, path))
    .filter((dir) => {
      const inside = relative(root, dir);
      return inside && !inside.startsWith('..') && !isAbsolute(inside);
    });
}

const inIgnoredDir = (rel) => rel.startsWith('.claude/state/') || rel.split('/').slice(0, -1).some((part) => IGNORED_DIRS.has(part));

/** مسح القرص بحد أقصى لعدد الملفات (budget.left)، مع تخطي المجلدات المتجاهَلة. budget.truncated = بقي ما لم يُمسح. */
export function* walkDisk(root, dir, budget) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (budget.truncated) return;
    const full = join(dir, entry.name);
    const rel = relative(root, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name) && rel !== '.claude/state') yield* walkDisk(root, full, budget);
    } else if (entry.isFile()) {
      if (budget.left <= 0) {
        budget.truncated = true;
        return;
      }
      budget.left -= 1;
      yield rel;
    }
  }
}

// مشاريع لم يكتمل مسحها لكثرة ملفاتها: Hook التوقف يعلن «فحصاً جزئياً» بدل أن يعدّ ما لم يُمسح غير معدَّل
const truncatedWalks = new Set();
export const walkWasTruncated = (root) => truncatedWalks.has(root);

/** يولّد المسارات النسبية (بشرطات أمامية) لملفات المشروع عدا المتجاهَلة وملفات الحالة: من Git إن أمكن، وإلا من القرص. */
export function* walkFiles(root) {
  const listed = gitFiles(root);
  const budgets = [];
  if (!listed) {
    budgets.push({ left: MAX_SCAN });
    yield* walkDisk(root, root, budgets[0]);
  } else {
    const kept = listed.filter((rel) => !inIgnoredDir(rel));
    if (kept.length > MAX_GIT_SCAN) truncatedWalks.add(root);
    yield* kept.slice(0, MAX_GIT_SCAN);
    for (const dir of submoduleDirs(root)) {
      budgets.push({ left: MAX_SCAN });
      yield* walkDisk(root, dir, budgets[budgets.length - 1]);
    }
  }
  if (budgets.some((budget) => budget.truncated)) truncatedWalks.add(root);
}

/** نص الملف، أو null إذا كان أكبر من 2MB أو غير قابل للقراءة. */
export function readText(root, relPath) {
  try {
    const full = join(root, relPath);
    return statSync(full).size > MAX_FILE_BYTES ? null : readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}

// أوقات التعديل محفوظة لكل عملية: Hook التوقف يسأل عنها مرتين (ملفات الجولة، وما بعد آخر فحص)
const fileStats = new Map();

/** { mtime, isFile } لمسار نسبي، أو null إذا لم يوجد. */
function statOf(root, rel) {
  const full = join(root, rel);
  if (!fileStats.has(full)) {
    let entry = null;
    try {
      const stats = statSync(full);
      entry = { mtime: stats.mtimeMs, isFile: stats.isFile() };
    } catch { /* حُذف منذ سرده */ }
    fileStats.set(full, entry);
  }
  return fileStats.get(full);
}

/**
 * ملفات تستوجب الفحص عُدّلت على القرص بعد اللحظة since.
 * windows: فترات تشغيل الفحص نفسه [بداية، نهاية] — ما كتبته الأدوات أثناءها (مثل next build) لا يُحسب تعديلاً.
 */
export function changedSince(root, since, windows = []) {
  if (!since) return [];
  const changed = [];
  for (const rel of walkFiles(root)) {
    if (!needsVerification(rel)) continue;
    // isFile: Git يسرد الوحدات الفرعية (submodules) كمسارات، ووقت تعديل المجلد ليس تعديلاً لكود
    const stats = statOf(root, rel);
    if (!stats?.isFile || stats.mtime <= since) continue;
    if (!windows.some(([start, end]) => stats.mtime >= start && stats.mtime <= end)) changed.push(rel);
  }
  return changed;
}

/** وقت آخر تعديل لملف، أو 0 إذا لم يوجد. */
export function modifiedAt(root, relPath) {
  try { return statSync(join(root, relPath)).mtimeMs; } catch { return 0; }
}
