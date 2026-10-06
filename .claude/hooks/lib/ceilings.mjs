/**
 * جدول أسقف حجم الملفات — مطابق للبند 14 في rules_code_quality.md.
 * soft = الحد الأدنى للسقف (بداية التنبيه)، hard = السقف الأقصى (تقسيم إلزامي).
 * ملفات الإعدادات والهجرات و Markdown و JSON بلا سقف صارم (تُرجع null).
 */
const EXTENSION_GROUPS = [
  { kind: 'styles', label: 'ملفات التنسيق (CSS/SCSS)', soft: 400, hard: 500, ext: ['css', 'scss', 'sass', 'less', 'styl'] },
  { kind: 'templates', label: 'ملفات القوالب والواجهات (HTML/JSX/TSX/Dart)', soft: 300, hard: 400, ext: ['html', 'htm', 'jsx', 'tsx', 'vue', 'svelte', 'astro', 'dart'] },
  { kind: 'logic', label: 'ملفات المنطق البرمجي (JS/TS/Python)', soft: 200, hard: 250, ext: ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'py', 'go', 'rb', 'php', 'java', 'kt', 'kts', 'swift', 'rs', 'cs'] },
];

const TESTS = { kind: 'tests', label: 'ملفات الاختبارات', soft: 300, hard: 400 };

const TEST_PATTERNS = [
  /(^|\/)(tests?|__tests__|spec)\//i,
  /\.(test|spec)\.[a-z0-9]+$/i,
  /_test\.(dart|go|py)$/i,
  /(^|\/)test_[^/]+\.py$/i,
  /(^|\/)tests?\.py$/i,
  /_spec\.rb$/i,
  // FooTest.java و FooTests.cs و MyApp.Tests/ — حساسة لحالة الأحرف كما في lib/shortcuts.mjs
  /[A-Za-z0-9]Tests?\.(cs|java|kts?|swift|php)$|(^|\/)[^/]+\.Tests?\//,
];

const UNCAPPED_PATTERNS = [
  /(^|\/)[^/]*\.config\.[a-z0-9]+$/i,
  /(^|\/)migrations\//i,
  /\.(json|jsonc|ya?ml|toml|ini|lock|sql|md|mdx|txt|env|example|d\.ts)$/i,
  /(^|\/)(node_modules|dist|build|\.next|coverage|\.dart_tool|vendor)\//i,
];

/** يعيد قاعدة السقف لمسار نسبي بشرطات أمامية، أو null إذا لم يكن للملف سقف. */
export function ceilingFor(relPath) {
  const path = String(relPath || '');
  if (UNCAPPED_PATTERNS.some((re) => re.test(path))) return null;
  if (TEST_PATTERNS.some((re) => re.test(path))) return TESTS;
  const ext = (path.match(/\.([a-z0-9]+)$/i) || [])[1];
  if (!ext) return null;
  return EXTENSION_GROUPS.find((group) => group.ext.includes(ext.toLowerCase())) || null;
}

export function countLines(text) {
  if (!text) return 0;
  const lines = text.split(/\r?\n/);
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

/** 'hard' إذا تجاوز السقف الأقصى، 'soft' إذا بلغ الحد الأدنى، وإلا null. */
export function ceilingStatus(lines, rule) {
  if (!rule) return null;
  if (lines > rule.hard) return 'hard';
  if (lines >= rule.soft) return 'soft';
  return null;
}
