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

/**
 * يُفحص النص بعد توحيد المسافات: كل سلسلة مسافات مسافة واحدة، والأسطر الفارغة المتتالية سطر واحد.
 * فلا يُخفى اختصار بحشو المسافات (مراجعة الأمن)، ولا تطول المسافات التي تتجاور في الأنماط فيبطؤ الفحص.
 */
const normalize = (text) => text.replace(/\r\n?/g, '\n').replace(/[ \t\f\v]+/g, ' ').replace(/\n(?: ?\n)+/g, '\n');

const MARKED_WORD = /\b(TODO|FIXME|HACK|XXX)\b/gi;
const COMMENT_MARK = /\/\/|\/\*|#|<!--/;
const PLACEHOLDER_TEXT = /not implemented|implement(ed)? later|UnimplementedError|NotImplemented(Error|Exception)|\b(todo|unimplemented)!\(|(بقية|باقي) الكود|rest of (the )?code/i;

/**
 * TODO وأخواتها داخل تعليق: تُبحث الكلمة أولاً، ثم أول علامة تعليق في سطرها. كل سطر يُفحص مرة واحدة،
 * فالزمن خطي مهما طال السطر؛ نمط واحد (علامة، ثم أي نص، ثم الكلمة) كان يتضاعف زمنه مع مربع طول السطر.
 */
function markedComment(text) {
  let lineEnd = -1;
  let mark = -1;
  for (const match of text.matchAll(MARKED_WORD)) {
    if (match.index > lineEnd) {
      const lineStart = text.lastIndexOf('\n', match.index) + 1;
      lineEnd = text.indexOf('\n', match.index);
      if (lineEnd === -1) lineEnd = text.length;
      const found = text.slice(lineStart, lineEnd).search(COMMENT_MARK);
      mark = found === -1 ? -1 : lineStart + found;
    }
    if (mark !== -1 && mark < match.index) return true;
  }
  return false;
}

const OPEN_STATEMENT = /^allow\s+([\w, ]+):\s*if\s+true\s*$/;
const OPEN_METHOD = /\b(write|create|update|delete)\b/;

/** قاعدة أمان تفتح الكتابة: كل جملة في ملف القواعد على حدة (الفاصل ; أو { أو })، وإن امتدت على أكثر من سطر. */
function openRule(text) {
  if (/request\.time\s*<\s*timestamp\.date/.test(text)) return true;
  return text.replace(/\s+/g, ' ').split(/[;{}]/).some((statement) => OPEN_METHOD.test(statement.trim().match(OPEN_STATEMENT)?.[1] || ''));
}

// كل نمط يجمع صيغ اللغات المدعومة: JS/TS و Dart و Python و Go و Rust و Java/Kotlin و C# و PHP و Ruby و Swift.
// زمن كل نمط خطي بلا حد للطول: الفراغات تأتي بعد نص ثابت فلا تتداخل مناطقها، وما بين القوسين لا يعبر قوساً آخر (tests/redos.test.mjs)
export const SHORTCUTS = [
  { kind: 'placeholder', label: PLACEHOLDER, files: ANY_CODE, match: (text) => PLACEHOLDER_TEXT.test(text) || markedComment(text) },
  // TODO() في Kotlin دالة ترمي استثناء؛ حساسة لحالة الأحرف حتى لا تُحسب todo() في تطبيق مهام
  { kind: 'placeholder', label: PLACEHOLDER, files: /\.kts?$/i, re: /\bTODO\(/ },
  { kind: 'checks-off', label: 'تعطيل فحص (ts-ignore / eslint-disable / ignore)', files: ANY_CODE,
    re: /@ts-(ignore|nocheck)\b|eslint-disable\b|\/\/[ \t]*ignore(_for_file)?:|#[ \t]*type:[ \t]*ignore|#[ \t]*noqa\b|(istanbul|v8|c8) ignore|#[ \t]*(pylint|pyright):[ \t]*(disable|ignore)|\/\/[ \t]*nolint\b|#!?\[allow\(|@SuppressWarnings\b|@Suppress\(|#pragma warning disable|@phpstan-ignore|@psalm-suppress|rubocop:disable|swiftlint:disable/ },
  { kind: 'config-loosened', label: 'إرخاء إعدادات الفحص أو البناء (ignoreBuildErrors / strict: false)', files: /\.(json|[cm]?[jt]s|toml|ini|cfg|csproj|props)$/i,
    re: /ignore(BuildErrors|DuringBuilds)\s*:\s*true|"(strict|noImplicitAny|strictNullChecks)"\s*:\s*false|passWithNoTests|ignore_errors[ \t]*=[ \t]*[Tt]rue|<TreatWarningsAsErrors>\s*false|<Nullable>\s*disable/ },
  { kind: 'test-skip', label: 'اختبار معطّل أو محصور (skip / only)', files: ANY_CODE,
    re: /\b(it|test|describe)\.(skip|only|todo)\s*\(|\b(xit|xdescribe|xtest|fit|fdescribe)\s*\(|\bskip:\s*(true|['"])|@pytest\.mark\.skip|@(unittest\.)?skip\b|\bt\.Skip(Now|f)?\(|#\[ignore\b|@(Disabled|Ignore)\b|\[Ignore\b|\bSkip\s*=\s*"|markTest(Skipped|Incomplete)\(|^[ \t]*(xit|xdescribe|xcontext|xspecify)[ \t]|\bXCTSkip(If|Unless)?\b/m },
  // except في Python و rescue في Ruby يبدآن السطر، فمطابقتهما من أوله تمنع تداخل المسح بين ظهورين في سطر واحد
  { kind: 'swallowed-error', label: 'خطأ مكتوم (catch فارغ)', files: ANY_CODE,
    // أسطر التعليق داخل catch الفارغ لا تعبر سطراً فيه catch آخر، وإلا أعاد كل ظهور مسح ما بعده (مراجعة الأمن)
    re: /catch\s*(?:\([^()\n]*\))?\s*\{\s*(?:\/\/(?![^\n]*\bcatch\b)[^\n]*\n\s*)*\}|\.catch\(\s*(?:(?:\([\w\s,]*\)|\w+)\s*)?=>\s*(?:\{\s*\}|null|undefined)\s*\)|^[ \t]*except\b[^:\n]*:\s*(?:#[^\n]*\n\s*)*pass\b|\bif\s+err\s*!=\s*nil\s*\{\s*\}|\b_\s*=\s*err\b|^[ \t]*rescue\b[^\n]*\n(?:[ \t]*(?:#[^\n]*)?\n)*[ \t]*end\b|\brescue\s+nil\b/m },
  { kind: 'any-type', label: 'نوع any يعطّل فحص الأنواع', files: TS, where: inProductionCode,
    re: /:\s*any\b(?!\w)|\bas\s+any\b|<any>/ },
  { kind: 'test-branch', label: 'سلوك خاص ببيئة الاختبار داخل كود التطبيق', files: ANY_CODE, where: inProductionCode,
    re: /process\.env\.NODE_ENV\s*[!=]==?\s*['"]test['"]|process\.env\.(VITEST|JEST_WORKER_ID)\b|import\.meta\.env\.VITEST\b|PYTEST_CURRENT_TEST|['"]pytest['"]\s+in\s+sys\.modules|\btesting\.Testing\(\)|flag\.Lookup\(\s*"test\.v"\s*\)/ },
  { kind: 'fake-data', label: 'بيانات وهمية خارج الاختبارات', files: ANY_CODE, where: inProductionCode,
    // نوع المتغير (بعد :) لا يعبر اسماً وهمياً آخر، فلا يتداخل المسح بين أسماء متتالية في سطر واحد
    re: /\b(mock|fake|dummy)[A-Z_][A-Za-z0-9_]*\s*(?::(?:(?!\b(?:mock|fake|dummy)[A-Z_])[^=\n])*)?:?=\s*[[{]|lorem ipsum/i },
  { kind: 'trivial-assert', label: 'تأكيد شكلي لا يختبر شيئاً', files: ANY_CODE, where: isTestPath,
    re: /expect\(\s*(true|false|1|0|null)\s*\)\s*\.\s*(toBe|toEqual|toStrictEqual)\(\s*\1\s*\)|expect\(\s*(true|1)\s*\)\s*\.\s*(toBeTruthy|toBeDefined)\(\s*\)|assert\(\s*true\s*\)|expect\(\s*true\s*,\s*(isTrue|true)\s*\)|\bassert\s+(True|true)\b|\bassert!\(\s*true\s*\)|\b[Aa]ssert(True|\.True|\.IsTrue|That)?\(\s*(true|True)\s*\)|XCTAssertTrue\(\s*true\s*\)|expect\(\s*true\s*\)\.to\b/ },
  // القراءة العامة (allow read: if true) قد تكون مقصودة لملفات عامة؛ الكتابة المفتوحة ليست مقصودة أبداً
  { kind: 'open-rules', label: 'قاعدة أمان تفتح الكتابة للجميع («وضع الاختبار»)', files: RULES, match: openRule },
];

const HAS_TEST_CASE = /\b(it|test|testWidgets)\s*\(|^[ \t]*def test_|^func Test\w*\(|#\[test\]|@Test\b|\[(Fact|Theory|Test|TestMethod)\b|\bfunction test\w*\s*\(|^[ \t]*it[ \t]+["']|\bfunc test\w*\s*\(/m;
const HAS_ASSERTION = /\bexpect\s*\(|\bassert|\.should\b|\bverify\s*\(|\bexpectLater\s*\(|\bAssert\.|\bXCTAssert|\bt\.(Error|Errorf|Fatal|Fatalf|Fail|FailNow)\b|\brequire\.\w+\(|\bmust_\w+/;

/** الاختصارات الموجودة في نص (مضاف أو ملف كامل) لمسار نسبي: [{ kind, label }]، نوع واحد مرة واحدة. */
export function scanShortcuts(relPath, text) {
  const path = String(relPath || '');
  if (!text || /^\.(claude|agents)\//.test(path)) return [];
  const sample = normalize(text);
  const found = SHORTCUTS
    .filter((s) => s.files.test(path) && (!s.where || s.where(path)) && (s.match ? s.match(sample) : s.re.test(sample)))
    .map(({ kind, label }) => ({ kind, label }));
  return found.filter((item, index) => found.findIndex((other) => other.kind === item.kind) === index);
}

/** ملف اختبار كامل فيه حالات اختبار وليس فيه أي تأكيد. */
export function isAssertionlessTest(relPath, fullText) {
  if (!isTestPath(relPath || '') || !ANY_CODE.test(relPath || '')) return false;
  const sample = normalize(fullText || '');
  return HAS_TEST_CASE.test(sample) && !HAS_ASSERTION.test(sample);
}

export const NO_ASSERTION = { kind: 'no-assertion', label: 'ملف اختبار بلا أي تأكيد (expect / assert)' };

/** فحص ملف كامل: الأنماط + ملف الاختبار الخالي من التأكيدات. */
export function scanFile(relPath, fullText) {
  const found = scanShortcuts(relPath, fullText);
  if (isAssertionlessTest(relPath, fullText)) found.push(NO_ASSERTION);
  return found;
}

export const isTestFile = (relPath) => isTestPath(relPath || '');
