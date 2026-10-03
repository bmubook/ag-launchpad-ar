/**
 * ملفات المشروع على القرص — يشترك فيه size-report.mjs و health-report.mjs وبوابة الإثبات.
 * changedSince يكمّل سجل أدوات التعديل: تعديل بأمر طرفية (sed، سكربت، مولّد كود) لا يمر بـ Hook ما بعد التعديل.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isCodeFile } from './common.mjs';

const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.output', 'coverage',
  '.dart_tool', '.gradle', 'Pods', '.venv', 'venv', '__pycache__', 'vendor', '.turbo', '.cache', '.firebase', '.expo',
]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SCAN = 5000;

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

/** يولّد المسارات النسبية (بشرطات أمامية) لكل ملفات المشروع عدا المتجاهَلة وملفات الحالة. */
export function* walkFiles(root, dir = root) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = relative(root, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name) && rel !== '.claude/state') yield* walkFiles(root, full);
    } else if (entry.isFile()) {
      yield rel;
    }
  }
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

/**
 * ملفات تستوجب الفحص عُدّلت على القرص بعد اللحظة since.
 * windows: فترات تشغيل الفحص نفسه [بداية، نهاية] — ما كتبته الأدوات أثناءها (مثل next build) لا يُحسب تعديلاً.
 */
export function changedSince(root, since, windows = []) {
  if (!since) return [];
  const changed = [];
  let seen = 0;
  for (const rel of walkFiles(root)) {
    if (++seen > MAX_SCAN) break;
    if (!needsVerification(rel)) continue;
    let mtime;
    try { mtime = statSync(join(root, rel)).mtimeMs; } catch { continue; }
    if (mtime > since && !windows.some(([start, end]) => mtime >= start && mtime <= end)) changed.push(rel);
  }
  return changed;
}

/** وقت آخر تعديل لملف، أو 0 إذا لم يوجد. */
export function modifiedAt(root, relPath) {
  try { return statSync(join(root, relPath)).mtimeMs; } catch { return 0; }
}
