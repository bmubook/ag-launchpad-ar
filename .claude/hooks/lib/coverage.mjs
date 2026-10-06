/**
 * تغطية الاختبارات بالتقريب: ملف المنطق «مُختبَر» إذا كان له ملف اختبار بالاسم نفسه أو استورده أحد ملفات الاختبار،
 * أو غطّاه عُرف لغته: اختبارات Go في المجلد نفسه، و #[cfg(test)] في ملف Rust، واسم الصنف في اختبارات Java و C# و PHP و Swift.
 * يستخدمه Hook التوقف (ملف منطق عُدّل بلا اختبار) وتقرير الصحة (أكبر الملفات غير المختبرة).
 */
import { ceilingFor } from './ceilings.mjs';
import { needsVerification, readText, walkFiles } from './files.mjs';
import { isTestFile } from './shortcuts.mjs';

const NOT_LOGIC = new RegExp([
  /(^|\/)(index|types?|constants?|config|env)\.[a-z]+$|\.d\.ts$|\.config\.[a-z0-9]+$|(^|\/)(tools|scripts)\//.source,
  // ملفات تهيئة وربط بلا منطق في اللغات الأخرى، وملفات تولّدها الأدوات
  /(^|\/)(__init__|manage|wsgi|asgi|settings|conftest)\.py$|_pb2\.py$|(^|\/)doc\.go$|(^|\/)(lib|mod)\.rs$|(^|\/)Program\.cs$|\.(pb|gen|generated)\.\w+$/.source,
].join('|'), 'i');
const DART_LOGIC_DIR = /(^|\/)(services?|repositories|providers?|data|domain|utils?|models?)\//i;
// FooTest.java يختبر Foo.java: تُزال اللاحقة من ملفات الاختبار وحدها، فلا يصير Latest.java «La»
const CLASS_TEST_SUFFIX = /Tests?(?=\.(cs|java|kts?|swift|php)$)/;
const CLASS_NAMED = /\.(cs|java|kts?|swift|php)$/i;

const dirOf = (rel) => rel.split('/').slice(0, -1).join('/');
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** اسم الملف دون المجلد واللاحقة وعلامات الاختبار: src/lib/tax.ts و tests/tax.test.ts و TaxTest.java ← tax */
export function stem(path) {
  const base = path.split('/').pop();
  const named = isTestFile(path) ? base.replace(CLASS_TEST_SUFFIX, '') : base;
  return named.replace(/\.(test|spec)(\.[a-z0-9]+)$/i, '$2').replace(/^test_|_test(?=\.)|_spec(?=\.rb$)/i, '')
    .replace(/\.[a-z0-9]+$/i, '').toLowerCase();
}

/** ملف منطق برمجي يُنتظر أن يغطيه اختبار (لا الواجهات ولا الأنواع ولا الإعدادات). */
export function isLogicFile(relPath) {
  if (!needsVerification(relPath) || isTestFile(relPath) || NOT_LOGIC.test(relPath)) return false;
  return ceilingFor(relPath)?.kind === 'logic' || (/\.dart$/i.test(relPath) && DART_LOGIC_DIR.test(relPath));
}

/** أسماء ملفات الاختبار ونصوصها مجمّعة (للبحث عن الاستيراد)، ومجلدات اختبارات Go. */
export function collectTests(root) {
  const stems = new Set();
  const goDirs = new Set();
  let text = '';
  for (const rel of walkFiles(root)) {
    if (!isTestFile(rel) || !needsVerification(rel)) continue;
    stems.add(stem(rel));
    if (/_test\.go$/i.test(rel)) goDirs.add(dirOf(rel));
    text += `${(readText(root, rel) || '').toLowerCase()}\n`;
  }
  return { stems, text, goDirs, count: stems.size };
}

/** root اختياري: به يُقرأ ملف Rust نفسه بحثاً عن اختباراته الداخلية. */
export function isCovered(relPath, tests, root = null) {
  const name = stem(relPath);
  if (tests.stems.has(name) || [`/${name}'`, `/${name}"`, `/${name}.`, `'${name}'`, `"${name}"`].some((n) => tests.text.includes(n))) return true;
  const word = escapeRegex(name);
  if (/\.py$/i.test(relPath)) return new RegExp(`\\b(?:from|import)\\s+[\\w.]*\\b${word}\\b`).test(tests.text);
  // اختبارات Go تخص الحزمة كلها: أي ملف _test.go في المجلد نفسه يغطي ملفاته
  if (/\.go$/i.test(relPath)) return Boolean(tests.goDirs?.has(dirOf(relPath)));
  if (/\.rs$/i.test(relPath)) return tests.text.includes(`::${name}`) || /#\[cfg\(test\)\]/.test((root && readText(root, relPath)) || '');
  if (CLASS_NAMED.test(relPath)) return new RegExp(`(^|[^a-z0-9_])${word}($|[^a-z0-9_])`).test(tests.text);
  return false;
}
