/**
 * تغطية الاختبارات بالتقريب: ملف المنطق «مُختبَر» إذا كان له ملف اختبار بالاسم نفسه أو استورده أحد ملفات الاختبار.
 * يستخدمه Hook التوقف (ملف منطق عُدّل بلا اختبار) وتقرير الصحة (أكبر الملفات غير المختبرة).
 */
import { ceilingFor } from './ceilings.mjs';
import { needsVerification, readText, walkFiles } from './files.mjs';
import { isTestFile } from './shortcuts.mjs';

const NOT_LOGIC = /(^|\/)(index|types?|constants?|config|env)\.[a-z]+$|\.d\.ts$|\.config\.[a-z0-9]+$|(^|\/)(tools|scripts)\//i;
const DART_LOGIC_DIR = /(^|\/)(services?|repositories|providers?|data|domain|utils?|models?)\//i;

/** اسم الملف دون المجلد واللاحقة وعلامات الاختبار: src/lib/tax.ts و tests/tax.test.ts ← tax */
export const stem = (path) => path.split('/').pop()
  .replace(/\.(test|spec)(\.[a-z0-9]+)$/i, '$2').replace(/^test_|_test(?=\.)/i, '').replace(/\.[a-z0-9]+$/i, '').toLowerCase();

/** ملف منطق برمجي يُنتظر أن يغطيه اختبار (لا الواجهات ولا الأنواع ولا الإعدادات). */
export function isLogicFile(relPath) {
  if (!needsVerification(relPath) || isTestFile(relPath) || NOT_LOGIC.test(relPath)) return false;
  return ceilingFor(relPath)?.kind === 'logic' || (/\.dart$/i.test(relPath) && DART_LOGIC_DIR.test(relPath));
}

/** أسماء ملفات الاختبار ونصوصها مجمّعة (للبحث عن الاستيراد). */
export function collectTests(root) {
  const stems = new Set();
  let text = '';
  for (const rel of walkFiles(root)) {
    if (!isTestFile(rel) || !needsVerification(rel)) continue;
    stems.add(stem(rel));
    text += `${(readText(root, rel) || '').toLowerCase()}\n`;
  }
  return { stems, text, count: stems.size };
}

export function isCovered(relPath, tests) {
  const name = stem(relPath);
  return tests.stems.has(name) || [`/${name}'`, `/${name}"`, `/${name}.`, `'${name}'`, `"${name}"`].some((n) => tests.text.includes(n));
}
