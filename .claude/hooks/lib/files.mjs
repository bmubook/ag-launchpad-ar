/**
 * المرور على ملفات المشروع مع تجاهل مجلدات البناء والاعتماديات — يشترك فيه size-report.mjs و health-report.mjs.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.output', 'coverage',
  '.dart_tool', '.gradle', 'Pods', '.venv', 'venv', '__pycache__', 'vendor', '.turbo', '.cache', '.firebase', '.expo',
]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

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
