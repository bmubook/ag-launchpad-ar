/**
 * كاشف الاختصارات (البند 11 — rules_code_quality.md): أنماط تجعل الكود «يعمل» اليوم ويُكتشف خلله بعد أسابيع.
 * يُستخدم في post-edit.mjs (النص المضاف)، و stop-gate.mjs (هل ما زال الاختصار في الملف؟)، و health-report.mjs (المشروع كله).
 */
const TS = /\.(m?tsx?|cts)$/i;
const RULES = /\.rules$/i;
const ANY_CODE = /\.(m?[jt]sx?|c[jt]s|vue|svelte|astro|dart|py|go|rb|php|java|kts?|swift|rs|cs)$/i;

const TEST_FILE = /(^|\/)(tests?|__tests__|spec|e2e)\/|\.(test|spec)\.[a-z0-9]+$|_test\.(dart|go|py)$|(^|\/)test_[^/]+\.py$|(^|\/)tests?\.py$|_spec\.rb$/i;
// أعراف Java و Kotlin و C# و Swift و PHP: FooTest.java و FooTests.cs ومشروع MyApp.Tests/. حساسة لحالة الأحرف عمداً: Latest.java ليس اختباراً
const TEST_CLASS = /[A-Za-z0-9]Tests?\.(cs|java|kts?|swift|php)$|(^|\/)[^/]+\.Tests?\//;
const FIXTURE_FILE = /(^|\/)(mocks?|__mocks__|fixtures?|seeds?|stories)\/|\.stories\.[a-z]+$|(^|\/)seed\.[a-z]+$/i;
const CONFIG_FILE = /(^|\/)[^/]*\.config\.[a-z0-9]+$|(^|\/)(vitest|jest)\.setup\.[a-z]+$|(^|\/)conftest\.py$/i;

const isTestPath = (path) => TEST_FILE.test(path) || TEST_CLASS.test(path);
const inProductionCode = (path) => !isTestPath(path) && !FIXTURE_FILE.test(path) && !CONFIG_FILE.test(path);
const PLACEHOLDER = 'كود ناقص أو مؤجل (TODO / Not implemented)';
// النص الممسوح محدود: الكود المكتوب بيد بشر أو وكيل لا يتجاوزه، وما فوقه ملفات مولّدة
const MAX_SCAN_CHARS = 512 * 1024;

const MARKED_WORD = /\b(TODO|FIXME|HACK|XXX)\b/gi;
const COMMENT_MARK = /\/\/|\/\*|#|<!--/;
const PLACEHOLDER_TEXT = /not implemented|implement(ed)? later|UnimplementedError|NotImplemented(Error|Exception)|\b(todo|unimplemented)!\(|(بقية|باقي) الكود|rest of (the )?code/i;

/**
 * TODO وأخواتها داخل تعليق: تُبحث الكلمة أولاً، ثم علامة التعليق في الـ 300 حرف قبلها من سطرها.
 * نمط واحد (علامة، ثم أي نص، ثم الكلمة) كان يتضاعف زمنه مع مربع طول السطر، فيتجاوز الـ Hook مهلته ويمرّ الرد دون فحص.
 */
function markedComment(text) {
  let lineStart = 0;
  let scanned = 0;
  for (const match of text.matchAll(MARKED_WORD)) {
    const newline = text.slice(scanned, match.index).lastIndexOf('\n');
    if (newline !== -1) lineStart = scanned + newline + 1;
    scanned = match.index;
    if (COMMENT_MARK.test(text.slice(Math.max(lineStart, match.index - 300), match.index))) return true;
  }
  return false;
}

const OPEN_RULE = /allow\s{1,20}([\w, \t]{1,100}):\s{0,20}if\s{1,20}true\s{0,20};/g;
const OPEN_METHOD = /\b(write|create|update|delete)\b/;

// كل نمط يجمع صيغ اللغات المدعومة: JS/TS و Dart و Python و Go و Rust و Java/Kotlin و C# و PHP و Ruby و Swift.
// زمن كل نمط خطي مع حجم النص: مسافات بحد أعلى، وتكرار متداخل ممنوع (tests/redos.test.mjs)
export const SHORTCUTS = [
  { kind: 'placeholder', label: PLACEHOLDER, files: ANY_CODE, match: (text) => PLACEHOLDER_TEXT.test(text) || markedComment(text) },
  // TODO() في Kotlin دالة ترمي استثناء؛ حساسة لحالة الأحرف حتى لا تُحسب todo() في تطبيق مهام
  { kind: 'placeholder', label: PLACEHOLDER, files: /\.kts?$/i, re: /\bTODO\(/ },
  { kind: 'checks-off', label: 'تعطيل فحص (ts-ignore / eslint-disable / ignore)', files: ANY_CODE,
    re: /@ts-(ignore|nocheck)\b|eslint-disable\b|\/\/[ \t]*ignore(_for_file)?:|#[ \t]*type:[ \t]*ignore|#[ \t]*noqa\b|(istanbul|v8|c8) ignore|#[ \t]*(pylint|pyright):[ \t]*(disable|ignore)|\/\/[ \t]*nolint\b|#!?\[allow\(|@SuppressWarnings\b|@Suppress\(|#pragma warning disable|@phpstan-ignore|@psalm-suppress|rubocop:disable|swiftlint:disable/ },
  { kind: 'config-loosened', label: 'إرخاء إعدادات الفحص أو البناء (ignoreBuildErrors / strict: false)', files: /\.(json|[cm]?[jt]s|toml|ini|cfg|csproj|props)$/i,
    re: /ignore(BuildErrors|DuringBuilds)\s{0,20}:\s{0,20}true|"(strict|noImplicitAny|strictNullChecks)"\s{0,20}:\s{0,20}false|passWithNoTests|ignore_errors[ \t]*=[ \t]*[Tt]rue|<TreatWarningsAsErrors>\s{0,20}false|<Nullable>\s{0,20}disable/ },
  { kind: 'test-skip', label: 'اختبار معطّل أو محصور (skip / only)', files: ANY_CODE,
    re: /\b(it|test|describe)\.(skip|only|todo)\s{0,20}\(|\b(xit|xdescribe|xtest|fit|fdescribe)\s{0,20}\(|\bskip:\s{0,20}(true|['"])|@pytest\.mark\.skip|@(unittest\.)?skip\b|\bt\.Skip(Now|f)?\(|#\[ignore\b|@(Disabled|Ignore)\b|\[Ignore\b|\bSkip\s{0,20}=\s{0,20}"|markTest(Skipped|Incomplete)\(|^[ \t]*(xit|xdescribe|xcontext|xspecify)[ \t]|\bXCTSkip(If|Unless)?\b/m },
  { kind: 'swallowed-error', label: 'خطأ مكتوم (catch فارغ)', files: ANY_CODE,
    re: /catch[ \t]{0,20}(\([^)\n]{0,200}\))?\s{0,200}\{\s{0,200}(\/\/[^\n]{0,500}\n\s{0,200})?\}|\.catch\(\s{0,20}(\([\w\s,]{0,100}\)|\w{1,50})?\s{0,20}=>\s{0,20}(\{\s{0,20}\}|null|undefined)\s{0,20}\)|except\b[^:\n]{0,200}:\s{0,100}(#[^\n]{0,500}\n\s{0,100})?pass\b|\bif\s{1,20}err\s{0,20}!=\s{0,20}nil\s{0,20}\{\s{0,200}\}|\b_\s{0,20}=\s{0,20}err\b|^[ \t]*rescue\b[^\n]{0,200}\n[ \t]*end\b|\brescue[ \t]+nil\b/m },
  { kind: 'any-type', label: 'نوع any يعطّل فحص الأنواع', files: TS, where: inProductionCode,
    re: /:\s*any\b(?!\w)|\bas\s+any\b|<any>/ },
  { kind: 'test-branch', label: 'سلوك خاص ببيئة الاختبار داخل كود التطبيق', files: ANY_CODE, where: inProductionCode,
    re: /process\.env\.NODE_ENV\s*[!=]==?\s*['"]test['"]|process\.env\.(VITEST|JEST_WORKER_ID)\b|import\.meta\.env\.VITEST\b|PYTEST_CURRENT_TEST|['"]pytest['"]\s+in\s+sys\.modules|\btesting\.Testing\(\)|flag\.Lookup\(\s*"test\.v"\s*\)/ },
  { kind: 'fake-data', label: 'بيانات وهمية خارج الاختبارات', files: ANY_CODE, where: inProductionCode,
    re: /\b(mock|fake|dummy)[A-Z_][A-Za-z0-9_]{0,60}\s{0,20}(:[^=\n]{1,200})?:?=\s{0,20}[[{]|lorem ipsum/i },
  { kind: 'trivial-assert', label: 'تأكيد شكلي لا يختبر شيئاً', files: ANY_CODE, where: isTestPath,
    re: /expect\(\s*(true|false|1|0|null)\s*\)\s*\.\s*(toBe|toEqual|toStrictEqual)\(\s*\1\s*\)|expect\(\s*(true|1)\s*\)\s*\.\s*(toBeTruthy|toBeDefined)\(\s*\)|assert\(\s*true\s*\)|expect\(\s*true\s*,\s*(isTrue|true)\s*\)|\bassert\s+(True|true)\b|\bassert!\(\s*true\s*\)|\b[Aa]ssert(True|\.True|\.IsTrue|That)?\(\s*(true|True)\s*\)|XCTAssertTrue\(\s*true\s*\)|expect\(\s*true\s*\)\.to\b/ },
  // القراءة العامة (allow read: if true) قد تكون مقصودة لملفات عامة؛ الكتابة المفتوحة ليست مقصودة أبداً
  { kind: 'open-rules', label: 'قاعدة أمان تفتح الكتابة للجميع («وضع الاختبار»)', files: RULES,
    match: (text) => /request\.time\s{0,20}<\s{0,20}timestamp\.date/.test(text) || [...text.matchAll(OPEN_RULE)].some((rule) => OPEN_METHOD.test(rule[1])) },
];

const HAS_TEST_CASE = /\b(it|test|testWidgets)\s{0,20}\(|^[ \t]*def test_|^func Test\w*\(|#\[test\]|@Test\b|\[(Fact|Theory|Test|TestMethod)\b|\bfunction test\w*\s{0,20}\(|^[ \t]*it[ \t]+["']|\bfunc test\w*\s{0,20}\(/m;
const HAS_ASSERTION = /\bexpect\s*\(|\bassert|\.should\b|\bverify\s*\(|\bexpectLater\s*\(|\bAssert\.|\bXCTAssert|\bt\.(Error|Errorf|Fatal|Fatalf|Fail|FailNow)\b|\brequire\.\w+\(|\bmust_\w+/;

const bounded = (text) => (text.length > MAX_SCAN_CHARS ? text.slice(0, MAX_SCAN_CHARS) : text);

/** الاختصارات الموجودة في نص (مضاف أو ملف كامل) لمسار نسبي: [{ kind, label }]، نوع واحد مرة واحدة. */
export function scanShortcuts(relPath, text) {
  const path = String(relPath || '');
  if (!text || /^\.(claude|agents)\//.test(path)) return [];
  const sample = bounded(text);
  const found = SHORTCUTS
    .filter((s) => s.files.test(path) && (!s.where || s.where(path)) && (s.match ? s.match(sample) : s.re.test(sample)))
    .map(({ kind, label }) => ({ kind, label }));
  return found.filter((item, index) => found.findIndex((other) => other.kind === item.kind) === index);
}

/** ملف اختبار كامل فيه حالات اختبار وليس فيه أي تأكيد. */
export function isAssertionlessTest(relPath, fullText) {
  const sample = bounded(fullText || '');
  return isTestPath(relPath || '') && ANY_CODE.test(relPath || '') && HAS_TEST_CASE.test(sample) && !HAS_ASSERTION.test(sample);
}

export const NO_ASSERTION = { kind: 'no-assertion', label: 'ملف اختبار بلا أي تأكيد (expect / assert)' };

/** فحص ملف كامل: الأنماط + ملف الاختبار الخالي من التأكيدات. */
export function scanFile(relPath, fullText) {
  const found = scanShortcuts(relPath, fullText);
  if (isAssertionlessTest(relPath, fullText)) found.push(NO_ASSERTION);
  return found;
}

export const isTestFile = (relPath) => isTestPath(relPath || '');
