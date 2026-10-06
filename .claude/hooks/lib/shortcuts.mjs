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

// كل نمط يجمع صيغ اللغات المدعومة: JS/TS و Dart و Python و Go و Rust و Java/Kotlin و C# و PHP و Ruby و Swift
export const SHORTCUTS = [
  { kind: 'placeholder', label: PLACEHOLDER, files: ANY_CODE,
    re: /(\/\/|\/\*|#|<!--)[^\n]*\b(TODO|FIXME|HACK|XXX)\b|not implemented|implement(ed)? later|UnimplementedError|NotImplemented(Error|Exception)|\b(todo|unimplemented)!\(|(بقية|باقي) الكود|rest of (the )?code/i },
  // TODO() في Kotlin دالة ترمي استثناء؛ حساسة لحالة الأحرف حتى لا تُحسب todo() في تطبيق مهام
  { kind: 'placeholder', label: PLACEHOLDER, files: /\.kts?$/i, re: /\bTODO\(/ },
  { kind: 'checks-off', label: 'تعطيل فحص (ts-ignore / eslint-disable / ignore)', files: ANY_CODE,
    re: /@ts-(ignore|nocheck)\b|eslint-disable\b|\/\/\s*ignore(_for_file)?:|#\s*type:\s*ignore|#\s*noqa\b|(istanbul|v8|c8) ignore|#\s*(pylint|pyright):\s*(disable|ignore)|\/\/\s*nolint\b|#!?\[allow\(|@SuppressWarnings\b|@Suppress\(|#pragma warning disable|@phpstan-ignore|@psalm-suppress|rubocop:disable|swiftlint:disable/ },
  { kind: 'config-loosened', label: 'إرخاء إعدادات الفحص أو البناء (ignoreBuildErrors / strict: false)', files: /\.(json|[cm]?[jt]s|toml|ini|cfg|csproj|props)$/i,
    re: /ignore(BuildErrors|DuringBuilds)\s*:\s*true|"(strict|noImplicitAny|strictNullChecks)"\s*:\s*false|passWithNoTests|ignore_errors\s*=\s*[Tt]rue|<TreatWarningsAsErrors>\s*false|<Nullable>\s*disable/ },
  { kind: 'test-skip', label: 'اختبار معطّل أو محصور (skip / only)', files: ANY_CODE,
    re: /\b(it|test|describe)\.(skip|only|todo)\s*\(|\b(xit|xdescribe|xtest|fit|fdescribe)\s*\(|\bskip:\s*(true|['"])|@pytest\.mark\.skip|@(unittest\.)?skip\b|\bt\.Skip(Now|f)?\(|#\[ignore\b|@(Disabled|Ignore)\b|\[Ignore\b|\bSkip\s*=\s*"|markTest(Skipped|Incomplete)\(|^\s*(xit|xdescribe|xcontext|xspecify)\s|\bXCTSkip(If|Unless)?\b/m },
  { kind: 'swallowed-error', label: 'خطأ مكتوم (catch فارغ)', files: ANY_CODE,
    re: /catch\s*(\([^)]*\))?\s*\{\s*(\/\/[^\n]*\s*)?\}|\.catch\(\s*\(?[\w\s,]*\)?\s*=>\s*(\{\s*\}|null|undefined)\s*\)|except[^:\n]*:\s*(#[^\n]*)?\s*pass\b|\bif\s+err\s*!=\s*nil\s*\{\s*\}|\b_\s*=\s*err\b|\brescue\b[^\n]*\n\s*end\b|\brescue\s+nil\b/ },
  { kind: 'any-type', label: 'نوع any يعطّل فحص الأنواع', files: TS, where: inProductionCode,
    re: /:\s*any\b(?!\w)|\bas\s+any\b|<any>/ },
  { kind: 'test-branch', label: 'سلوك خاص ببيئة الاختبار داخل كود التطبيق', files: ANY_CODE, where: inProductionCode,
    re: /process\.env\.NODE_ENV\s*[!=]==?\s*['"]test['"]|process\.env\.(VITEST|JEST_WORKER_ID)\b|import\.meta\.env\.VITEST\b|PYTEST_CURRENT_TEST|['"]pytest['"]\s+in\s+sys\.modules|\btesting\.Testing\(\)|flag\.Lookup\(\s*"test\.v"\s*\)/ },
  { kind: 'fake-data', label: 'بيانات وهمية خارج الاختبارات', files: ANY_CODE, where: inProductionCode,
    re: /\b(mock|fake|dummy)[A-Z_][A-Za-z0-9_]*\s*(:[^=\n]+)?:?=\s*[[{]|lorem ipsum/i },
  { kind: 'trivial-assert', label: 'تأكيد شكلي لا يختبر شيئاً', files: ANY_CODE, where: isTestPath,
    re: /expect\(\s*(true|false|1|0|null)\s*\)\s*\.\s*(toBe|toEqual|toStrictEqual)\(\s*\1\s*\)|expect\(\s*(true|1)\s*\)\s*\.\s*(toBeTruthy|toBeDefined)\(\s*\)|assert\(\s*true\s*\)|expect\(\s*true\s*,\s*(isTrue|true)\s*\)|\bassert\s+(True|true)\b|\bassert!\(\s*true\s*\)|\b[Aa]ssert(True|\.True|\.IsTrue|That)?\(\s*(true|True)\s*\)|XCTAssertTrue\(\s*true\s*\)|expect\(\s*true\s*\)\.to\b/ },
  // القراءة العامة (allow read: if true) قد تكون مقصودة لملفات عامة؛ الكتابة المفتوحة ليست مقصودة أبداً
  { kind: 'open-rules', label: 'قاعدة أمان تفتح الكتابة للجميع («وضع الاختبار»)', files: RULES,
    re: /allow\s+[\w,\s]*\b(write|create|update|delete)\b[\w,\s]*:\s*if\s+true\s*;|request\.time\s*<\s*timestamp\.date/ },
];

const HAS_TEST_CASE = /\b(it|test|testWidgets)\s*\(|^\s*def test_|^func Test\w*\(|#\[test\]|@Test\b|\[(Fact|Theory|Test|TestMethod)\b|\bfunction test\w*\s*\(|^\s*it\s+["']|\bfunc test\w*\s*\(/m;
const HAS_ASSERTION = /\bexpect\s*\(|\bassert|\.should\b|\bverify\s*\(|\bexpectLater\s*\(|\bAssert\.|\bXCTAssert|\bt\.(Error|Errorf|Fatal|Fatalf|Fail|FailNow)\b|\brequire\.\w+\(|\bmust_\w+/;

/** الاختصارات الموجودة في نص (مضاف أو ملف كامل) لمسار نسبي: [{ kind, label }]، نوع واحد مرة واحدة. */
export function scanShortcuts(relPath, text) {
  const path = String(relPath || '');
  if (!text || /^\.(claude|agents)\//.test(path)) return [];
  const found = SHORTCUTS
    .filter((s) => s.files.test(path) && (!s.where || s.where(path)) && s.re.test(text))
    .map(({ kind, label }) => ({ kind, label }));
  return found.filter((item, index) => found.findIndex((other) => other.kind === item.kind) === index);
}

/** ملف اختبار كامل فيه حالات اختبار وليس فيه أي تأكيد. */
export function isAssertionlessTest(relPath, fullText) {
  return isTestPath(relPath || '') && ANY_CODE.test(relPath || '')
    && HAS_TEST_CASE.test(fullText || '') && !HAS_ASSERTION.test(fullText || '');
}

export const NO_ASSERTION = { kind: 'no-assertion', label: 'ملف اختبار بلا أي تأكيد (expect / assert)' };

/** فحص ملف كامل: الأنماط + ملف الاختبار الخالي من التأكيدات. */
export function scanFile(relPath, fullText) {
  const found = scanShortcuts(relPath, fullText);
  if (isAssertionlessTest(relPath, fullText)) found.push(NO_ASSERTION);
  return found;
}

export const isTestFile = (relPath) => isTestPath(relPath || '');
