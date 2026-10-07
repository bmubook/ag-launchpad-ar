// اختبارات الفحص بأي لغة: اكتشاف أوامر Python و Go و Rust و Java و .NET و PHP و Ruby و Swift، وأوامر .claude/launchpad.json،
// وعدّ الاختبارات، وكاشف الاختصارات وأعراف التغطية في هذه اللغات، وسرد الملفات عبر Git.
// تُشغَّل ضمن hooks.test.mjs، أو وحدها: node .claude/tests/stacks.test.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, ctx, freshProject, report, runNode, tmp } from './helpers.mjs';

const WIN = process.platform === 'win32';
const write = (file, content = '') => { mkdirSync(dirname(join(tmp, file)), { recursive: true }); writeFileSync(join(tmp, file), content); };
/** يقيّم تعبيراً داخل المشروع المؤقت بعد استيراد وحدة من lib (الاسم المستعار m). */
function probe(module, expression) {
  write('.claude/probe.mjs', `import * as m from './hooks/lib/${module}.mjs';\nconst root = process.env.CLAUDE_PROJECT_DIR;\nprocess.stdout.write(JSON.stringify(${expression}));\n`);
  const r = runNode('.claude/probe.mjs', '');
  try { return JSON.parse(r.out); } catch { return { error: r.err || r.out }; }
}
const steps = () => probe('checks', 'm.detectChecks(root)');
const names = () => (Array.isArray(steps()) ? steps().map((s) => s.name).join() : JSON.stringify(steps()));
const cmd = (name) => (Array.isArray(steps()) ? steps().find((s) => s.name === name)?.cmd || '' : '');
const verify = (...args) => runNode('.claude/scripts/verify.mjs', '', { args });
const post = (file, content) => {
  write(file, content);
  return runNode('.claude/hooks/post-edit.mjs', { session_id: 'k', tool_name: 'Write', tool_input: { file_path: join(tmp, file), content } });
};
const flagged = (file, content, needle) => { const o = ctx(post(file, content)); return o.includes('🚩') && o.includes(needle); };
const clean = (file, content) => !ctx(post(file, content)).includes('🚩');

// ---------- Python
freshProject({ kicked: true });
write('pyproject.toml', '[project]\nname = "shop"\n\n[tool.ruff]\nline-length = 100\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n');
check('PY: ruff + pytest configured → python:lint, python:test', names() === 'python:lint,python:test', names());
check('PY: system interpreter by default', cmd('python:test') === `${WIN ? 'python' : 'python3'} -m pytest -q`, cmd('python:test'));
check('PY: labels name the language', steps()[1].label === 'الاختبارات (Python)', JSON.stringify(steps()));
write('uv.lock', '');
check('PY: uv.lock → uv run', cmd('python:lint') === 'uv run python -m ruff check .', cmd('python:lint'));
freshProject({ kicked: true });
write('requirements.txt', 'pytest==9.0\n');
write(WIN ? '.venv/Scripts/python.exe' : '.venv/bin/python');
check('PY: project .venv interpreter, quoted', cmd('python:test') === `"${WIN ? '.venv\\Scripts\\python.exe' : '.venv/bin/python'}" -m pytest -q`, cmd('python:test'));
freshProject({ kicked: true });
write('requirements.txt', 'flask\n');
check('PY: requirements without tests or tools → no checks guessed', names() === '', names());
write('tests/test_app.py', 'import unittest\n');
check('PY: test files without pytest → unittest discover', cmd('python:test').endsWith('-m unittest discover'), names());
freshProject({ kicked: true });
write('pyproject.toml', '[tool.black]\nline-length = 88\n\n[tool.mypy]\nstrict = true\n');
check('PY: black + mypy → format (with fix) and types', names() === 'python:format,python:types' && steps()[0].fix.endsWith('-m black .'), JSON.stringify(steps()));

// ---------- Go و Rust
freshProject({ kicked: true });
write('go.mod', 'module shop\n');
check('GO: gofmt, go vet, go test, go build', names() === 'go:format,go:lint,go:test,go:build' && cmd('go:lint') === 'go vet ./...', names());
check('GO: gofmt fails on any output; build only in the full check', steps()[0].failOnOutput === true && steps()[3].fullOnly === true, JSON.stringify(steps()));
write('.golangci.yml', 'run: {}\n');
check('GO: golangci config → golangci-lint', cmd('go:lint') === 'golangci-lint run', cmd('go:lint'));
freshProject({ kicked: true });
write('Cargo.toml', '[package]\nname = "shop"\n');
check('RS: cargo check, test, build (no fmt or clippy guessed)', names() === 'rust:types,rust:test,rust:build', names());
write('rustfmt.toml', ''); write('clippy.toml', '');
check('RS: rustfmt.toml + clippy.toml → fmt + clippy', names() === 'rust:format,rust:lint,rust:test,rust:build', names());

// ---------- Java و Kotlin و .NET
freshProject({ kicked: true });
write('pom.xml', '<project/>');
check('JVM: Maven → test + package', names() === 'maven:test,maven:build' && cmd('maven:test') === 'mvn -B test', names());
write(WIN ? 'mvnw.cmd' : 'mvnw');
// بمسار نسبي صريح: Claude Code يمنع cmd في Windows من البحث في المجلد الحالي
check('JVM: Maven wrapper preferred, by explicit relative path', cmd('maven:test') === `${WIN ? '.\\mvnw.cmd' : './mvnw'} -B test`, cmd('maven:test'));
freshProject({ kicked: true });
write('build.gradle.kts', '');
write(WIN ? 'gradlew.bat' : 'gradlew');
check('JVM: Gradle wrapper → test + assemble', cmd('gradle:test') === `${WIN ? '.\\gradlew.bat' : './gradlew'} test` && names() === 'gradle:test,gradle:build', names());
freshProject({ kicked: true });
write('Shop.sln', ''); write('.editorconfig', 'root = true\n');
check('NET: one solution → format, build, test --no-build', names() === 'dotnet:format,dotnet:types,dotnet:test' && cmd('dotnet:test') === 'dotnet test "Shop.sln" --no-build', names());
freshProject({ kicked: true });
write('A.csproj', ''); write('B.csproj', '');
check('NET: two projects, no solution → ambiguous, left to the config file', names() === '', names());

// ---------- PHP و Ruby و Swift
freshProject({ kicked: true });
write('composer.json', JSON.stringify({ scripts: { test: 'phpunit', lint: 'pint --test' } }));
write('phpstan.neon', '');
check('PHP: composer scripts + phpstan', names() === 'php:lint,php:types,php:test' && cmd('php:test') === 'composer run-script test', names());
freshProject({ kicked: true });
write('composer.json', '{}'); write('phpunit.xml', '<phpunit/>');
check('PHP: phpunit.xml without a test script → php vendor/bin/phpunit', cmd('php:test') === 'php vendor/bin/phpunit', names());
freshProject({ kicked: true });
write('Gemfile', ''); write('.rspec', ''); write('.rubocop.yml', '');
check('RB: rspec + rubocop', names() === 'ruby:lint,ruby:test' && cmd('ruby:test') === 'bundle exec rspec', names());
freshProject({ kicked: true });
write('package.json', JSON.stringify({ scripts: { test: 'jest' } })); write('Gemfile', "gem 'cocoapods'\n");
check('RB: React Native Gemfile (CocoaPods only) adds nothing to the Node checks', names() === 'test', names());
freshProject({ kicked: true });
write('Package.swift', '');
check('SW: swift build + swift test', names() === 'swift:types,swift:test', names());

// ---------- مشروع بلغتين، وأوامر .claude/launchpad.json
freshProject({ kicked: true });
write('package.json', JSON.stringify({ scripts: { lint: 'eslint .', test: 'vitest run' } }));
write('pyproject.toml', '[tool.pytest.ini_options]\n');
check('MIX: Node + Python → both, with distinct step names', names() === 'lint,test,python:test', names());
write('.claude/launchpad.json', JSON.stringify({ checks: [
  { step: 'test', run: 'pytest -q', label: 'اختبارات الخادم' }, { step: 'build', run: 'make' }, { run: '' }, { step: 'lint', run: 'x', cwd: '../outside' },
] }));
const configured = steps();
check('CFG: config checks replace detection; invalid and outside-project entries dropped',
  configured.length === 2 && configured[0].label === 'اختبارات الخادم' && configured[0].name === 'config1:test' && configured[1].fullOnly === true, JSON.stringify(configured));
write('.claude/launchpad.json', JSON.stringify({ checks: [] }));
check('CFG: empty list → automatic detection again', names() === 'lint,test,python:test', names());

freshProject({ kicked: true });
const echo = (text) => `node -e "process.stdout.write('${text}')"`;
write('.claude/launchpad.json', JSON.stringify({ checks: [{ step: 'format', run: echo('a.go'), failOnOutput: true, fix: 'gofmt -w .' }] }));
let r = verify();
check('V: failOnOutput → output means failure, with the format fix', r.code === 1 && r.out.includes('gofmt -w .'), r.out);
write('.claude/launchpad.json', JSON.stringify({ checks: [{ step: 'format', run: echo(''), failOnOutput: true }] }));
check('V: failOnOutput with no output → passes', verify().code === 0);
write('.claude/launchpad.json', JSON.stringify({ checks: [{ step: 'lint', run: 'aglp-tool-that-does-not-exist --check' }] }));
r = verify();
check('V: missing tool → 🧰 hint to install it or edit the config, not to change code', r.code === 1 && r.out.includes('🧰') && r.out.includes('.claude/launchpad.json'), r.out);
write('.claude/launchpad.json', JSON.stringify({ checks: [{ step: 'test', run: 'node -e "console.log(\'E   ModuleNotFoundError: No module named app\'); process.exit(1)"' }] }));
check('V: an import error inside the tests is a code failure, not a missing tool', !verify().out.includes('🧰'), verify().out);

// ---------- عدّ الاختبارات
const count = (text) => probe('test-count', `m.parsePassedTests(${JSON.stringify(text)})`);
check('TC: pytest', count('==== 5 passed in 0.12s ====') === 5);
check('TC: cargo sums every test binary', count('test result: ok. 3 passed; 0 failed\n\ntest result: ok. 2 passed; 0 failed') === 5);
check('TC: dotnet sums every test project', count('Passed!  - Failed:     0, Passed:     4, Skipped:     0\nPassed!  - Failed:     0, Passed:     2, Skipped:     0') === 6);
check('TC: Maven summary minus skipped (class lines ignored)',
  count('Tests run: 3, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.1 s - in a.FooTest\n[INFO] Tests run: 9, Failures: 0, Errors: 0, Skipped: 1\n') === 8);
check('TC: PHPUnit, RSpec, Minitest, unittest', count('OK (7 tests, 12 assertions)') === 7 && count('12 examples, 0 failures') === 12
  && count('8 runs, 20 assertions, 0 failures, 0 errors') === 8 && count('Ran 4 tests in 0.002s\n\nOK') === 4);
check('TC: XCTest takes the final total', count("Executed 2 tests, with 0 failures\nTest Suite 'All tests' passed\nExecuted 9 tests, with 0 failures") === 9);
check('TC: Vitest unchanged; go test has no count', count(' Tests  12 passed (12)') === 12 && count('ok  \tshop\t0.01s') === null);

// ---------- كاشف الاختصارات في اللغات الأخرى
freshProject({ kicked: true });
check('C: Go t.Skip → flagged', flagged('cart_test.go', 'func TestPay(t *testing.T) {\n\tt.Skip("later")\n\tif pay() != 1 { t.Errorf("x") }\n}\n', 'اختبار معطّل'));
check('C: Go ignored error → flagged', flagged('pay.go', 'func pay() {\n\t_ = err\n}\n', 'خطأ مكتوم'));
check('C: Go empty if err block → flagged', flagged('pay2.go', 'if err != nil {\n}\n', 'خطأ مكتوم'));
check('C: Go //nolint → flagged', flagged('pay3.go', 'x := 1 //nolint:errcheck\n', 'تعطيل فحص'));
check('C: Rust #[ignore] and todo!() → flagged', flagged('src/lib_test.rs', '#[test]\n#[ignore]\nfn pays() { assert!(pay()); }\n', 'اختبار معطّل') && flagged('src/pay.rs', 'fn pay() -> u32 { todo!() }\n', 'كود ناقص'));
check('C: Java @Disabled and assertTrue(true) → flagged', flagged('src/test/java/PayTest.java', '@Disabled\n@Test void pays() { assertTrue(true); }\n', 'اختبار معطّل') && flagged('src/test/java/PayTest.java', '@Test void pays() { assertTrue(true); }\n', 'تأكيد شكلي'));
check('C: Kotlin TODO() → flagged; todo() in a to-do app → clean', flagged('src/Pay.kt', 'fun pay(): Int = TODO()\n', 'كود ناقص') && clean('src/todos.ts', 'export const add = (todo: string) => todo(todo);\n'));
check('C: C# skipped fact and #pragma → flagged', flagged('Shop.Tests/PayTests.cs', '[Fact(Skip = "flaky")]\npublic void Pays() { Assert.Equal(1, Pay()); }\n', 'اختبار معطّل') && flagged('Shop/Pay.cs', '#pragma warning disable CS8618\n', 'تعطيل فحص'));
check('C: PHP markTestSkipped → flagged', flagged('tests/PayTest.php', 'public function testPays() { $this->markTestSkipped(); }\n', 'اختبار معطّل'));
check('C: Ruby xit and rescue nil → flagged', flagged('spec/pay_spec.rb', 'xit "pays" do\n  expect(pay).to eq(1)\nend\n', 'اختبار معطّل') && flagged('lib/pay.rb', 'value = pay rescue nil\n', 'خطأ مكتوم'));
check('C: Swift XCTSkip → flagged', flagged('Tests/PayTests.swift', 'func testPays() throws { throw XCTSkip("later") }\n', 'اختبار معطّل'));
check('C: Python test branch in app code → flagged', flagged('app/payments.py', 'if "pytest" in sys.modules:\n    return True\n', 'بيئة الاختبار'));
check('C: Python assert True in a test → flagged', flagged('tests/test_pay.py', 'def test_pays():\n    assert True\n', 'تأكيد شكلي'));
check('C: mypy ignore_errors in pyproject → flagged', flagged('pyproject.toml', '[tool.mypy]\nignore_errors = true\n', 'إرخاء'));
check('C: Go test without any assertion → flagged; with t.Errorf → clean',
  flagged('shop/pay_test.go', 'func TestPay(t *testing.T) {\n\tpay()\n}\n', 'بلا أي تأكيد') && clean('shop/pay2_test.go', 'func TestPay(t *testing.T) {\n\tif pay() != 1 {\n\t\tt.Errorf("want 1")\n\t}\n}\n'));
check('C: ordinary Go, Rust and Java code → clean', clean('shop/total.go', 'func Total(a, b int) int { return a + b }\n')
  && clean('src/total.rs', 'pub fn total(a: u32, b: u32) -> u32 { a + b }\n') && clean('src/main/java/Total.java', 'class Total { int sum(int a, int b) { return a + b; } }\n'));
check('C: test-file conventions (Latest.java is not a test)',
  JSON.stringify(probe('shortcuts', "['src/Latest.java','src/test/java/LatestTest.java','Shop.Tests/Pay.cs','spec/user_spec.rb','app/tests.py','src/LatestTest.java'].map(m.isTestFile)")) === '[false,true,true,true,true,true]');

// ---------- أعراف التغطية (ملف منطق عُدّل بلا اختبار)
freshProject({ kicked: true });
write('pkg/cart/cart.go', 'package cart\n'); write('pkg/cart/total_test.go', 'package cart\n');
write('pkg/pay/pay.go', 'package pay\n');
write('src/main/java/shop/TaxCalc.java', 'class TaxCalc {}\n'); write('src/test/java/shop/TaxCalcTest.java', 'class TaxCalcTest {}\n');
write('app/services/discount.py', ''); write('tests/test_checkout.py', 'from app.services.discount import apply\n');
write('src/inline.rs', 'fn a() {}\n#[cfg(test)]\nmod tests {}\n'); write('src/lonely.rs', 'fn b() {}\n');
write('Shop/Invoice.cs', ''); write('Shop.Tests/BillingTests.cs', 'var invoice = new Invoice();\n');
const covered = probe('coverage', "(() => { const t = m.collectTests(root); return ['pkg/cart/cart.go','pkg/pay/pay.go','src/main/java/shop/TaxCalc.java','app/services/discount.py','src/inline.rs','src/lonely.rs','Shop/Invoice.cs'].map((f) => m.isCovered(f, t, root)); })()");
check('COV: Go package test, Java FooTest, Python import, Rust #[cfg(test)], C# class name; untested ones stay untested',
  JSON.stringify(covered) === '[true,false,true,true,true,false,true]', JSON.stringify(covered));
check('COV: wiring files are not logic (__init__.py, lib.rs, Program.cs)',
  JSON.stringify(probe('coverage', "['app/__init__.py','src/lib.rs','Shop/Program.cs','app/services/discount.py'].map(m.isLogicFile)")) === '[false,false,false,true]');

// ---------- سرد الملفات عبر Git: ما يتجاهله .gitignore لا يُحسب تعديلاً
freshProject({ kicked: true });
const git = (...args) => spawnSync('git', args, { cwd: tmp, encoding: 'utf8' });
if (git('init', '-q').status === 0) {
  write('.gitignore', 'generated/\n.claude/\n'); write('src/a.ts', 'export const a = 1;\n'); write('generated/b.ts', 'export const b = 1;\n');
  write('.claude/launchpad.json', '{}');
  const changed = probe('files', 'm.changedSince(root, 1)');
  check('GIT: changedSince follows .gitignore (generated/ skipped, src/ kept)', changed.includes('src/a.ts') && !changed.some((f) => f.startsWith('generated/')), JSON.stringify(changed));
  const prints = probe('fingerprint', "Object.keys(m.fingerprint(root, [/^\\.claude\\/launchpad\\.json$/]))");
  check('GIT: governance fingerprint still sees a gitignored .claude/', JSON.stringify(prints) === '[".claude/launchpad.json"]', JSON.stringify(prints));
  // ملف تعليمات في مجلد متجاهَل: Claude Code يحمّله، فيبقى في البصمة (مراجعة الأمن)
  write('generated/CLAUDE.md', '# injected\n');
  const nested = probe('fingerprint', "Object.keys(m.fingerprint(root, [/(^|\\/)CLAUDE\\.md$/]))");
  check('GIT: an instruction file inside a gitignored folder is still fingerprinted', JSON.stringify(nested) === '["generated/CLAUDE.md"]', JSON.stringify(nested));
  // .git/info/exclude لا يظهر في المشروع، فلا يُخفى به ملف عن البوابة
  write('.git/info/exclude', 'hidden/\n'); write('hidden/c.ts', 'export const c = 1;\n');
  check('GIT: .git/info/exclude does not hide changes from the gate', probe('files', 'm.changedSince(root, 1)').includes('hidden/c.ts'));
  // وحدة فرعية: Git يسردها مساراً واحداً، فتُمسح ملفاتها من القرص
  write('libs/sub/d.ts', 'export const d = 1;\n');
  spawnSync('git', ['init', '-q'], { cwd: join(tmp, 'libs/sub') });
  write('.gitmodules', '[submodule "libs/sub"]\n\tpath = libs/sub\n\turl = ./libs/sub\n');
  check('GIT: files inside a submodule are still checked', probe('files', 'm.changedSince(root, 1)').includes('libs/sub/d.ts'));
  // core.fsmonitor أمر يشغّله Git نفسه؛ ضبطه بأمر طرفية لا يجعل الحارس ينفّذه مع كل Hook
  git('config', 'core.fsmonitor', 'node -e "require(\'fs\').writeFileSync(\'fsmonitor-ran\', \'x\')"');
  probe('files', 'm.changedSince(root, 1).length');
  check('GIT: the listing never runs core.fsmonitor', !existsSync(join(tmp, 'fsmonitor-ran')));
} else {
  check('GIT: git is available for the listing tests', false, git('--version').stderr);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) report();
