/**
 * اكتشاف أوامر الفحص لمشاريع غير Node و Flutter: Python و Go و Rust و Java/Kotlin و .NET و PHP و Ruby و Swift.
 * المبدأ: لا يُشغَّل إلا ما يضمن المشروع نفسه وجوده: أداة الأساس في اللغة (go vet، cargo test، dotnet build)،
 * أو أداة مُعدّة صراحةً في ملفاته (ruff في pyproject.toml، phpstan.neon). تخمين أداة غير مثبتة يُفشل البوابة
 * دون خطأ في الكود، فما لا يُكتشف بيقين يكتبه صاحب المشروع في .claude/launchpad.json (lib/checks.mjs).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const WINDOWS = process.platform === 'win32';
const LABELS = { format: 'التنسيق', lint: 'التدقيق', types: 'الأنواع', test: 'الاختبارات', build: 'البناء' };

const has = (dir, ...names) => names.some((name) => existsSync(join(dir, name)));
const read = (dir, name) => { try { return readFileSync(join(dir, name), 'utf8'); } catch { return ''; } };
const list = (dir) => { try { return readdirSync(dir); } catch { return []; } };
const json = (dir, name) => { try { return JSON.parse(read(dir, name)); } catch { return null; } };

/** خطوة بالشكل الذي يفهمه verify.mjs؛ الاسم مسبوق باللغة (python:test) فلا يتصادم مع خطوات Node. */
function step(stack, kind, cmd, dir, extra = {}) {
  return { name: `${stack.id}:${kind}`, label: `${LABELS[kind]} (${stack.title})`, cmd, cwd: dir, fullOnly: kind === 'build', ...extra };
}

/** هل في المجلد، أو في مجلد فرعي واحد تحته، ملف يطابق النمط؟ يكفي لمعرفة وجود اختبارات دون مسح المشروع. */
function hasFile(dir, pattern, depth = 1) {
  return list(dir).some((name) => pattern.test(name)
    || (depth > 0 && !name.startsWith('.') && hasFile(join(dir, name), pattern, depth - 1)));
}

const PYTHON = { id: 'python', title: 'Python' };

/** تشغيل وحدات Python في بيئة المشروع: uv أو Poetry أو Pipenv أو بيئة .venv، وإلا مفسّر النظام. */
function pythonModule(dir) {
  if (has(dir, 'uv.lock')) return 'uv run python -m';
  if (has(dir, 'poetry.lock')) return 'poetry run python -m';
  if (has(dir, 'Pipfile.lock', 'Pipfile')) return 'pipenv run python -m';
  for (const venv of ['.venv', 'venv']) {
    const python = WINDOWS ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python');
    if (has(dir, python)) return `"${python}" -m`;
  }
  return WINDOWS ? 'python -m' : 'python3 -m';
}

function pythonSteps(dir) {
  if (!has(dir, 'pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile')) return [];
  const config = ['pyproject.toml', 'setup.cfg', 'tox.ini'].map((name) => read(dir, name)).join('\n');
  const requirements = list(dir).filter((name) => /^requirements.*\.txt$/i.test(name)).map((name) => read(dir, name)).join('\n');
  const py = pythonModule(dir);
  const steps = [];
  if (/\[tool\.ruff\.format\]/.test(config)) steps.push(step(PYTHON, 'format', `${py} ruff format --check .`, dir, { fix: `${py} ruff format .` }));
  else if (/\[tool\.black\]/.test(config)) steps.push(step(PYTHON, 'format', `${py} black --check .`, dir, { fix: `${py} black .` }));
  if (/\[tool\.ruff[\].]/.test(config) || has(dir, 'ruff.toml', '.ruff.toml')) steps.push(step(PYTHON, 'lint', `${py} ruff check .`, dir));
  else if (/^\[flake8\]/m.test(config) || has(dir, '.flake8')) steps.push(step(PYTHON, 'lint', `${py} flake8`, dir));
  if (/\[tool\.mypy\]|^\[mypy\]/m.test(config) || has(dir, 'mypy.ini', '.mypy.ini')) steps.push(step(PYTHON, 'types', `${py} mypy .`, dir));
  const pytest = /\[tool\.pytest\.ini_options\]|^\[(tool:)?pytest\]/m.test(config) || has(dir, 'pytest.ini', 'conftest.py')
    || /\bpytest\b/i.test(`${config}\n${requirements}\n${read(dir, 'Pipfile')}`);
  if (pytest) steps.push(step(PYTHON, 'test', `${py} pytest -q`, dir));
  else if (['tests', 'test'].some((name) => hasFile(join(dir, name), /^test.*\.py$/))) steps.push(step(PYTHON, 'test', `${py} unittest discover`, dir));
  return steps;
}

const GO = { id: 'go', title: 'Go' };

function goSteps(dir) {
  if (!has(dir, 'go.mod')) return [];
  const golangci = list(dir).some((name) => /^\.golangci\.(ya?ml|toml|json)$/.test(name));
  return [
    // gofmt -l ينجح دائماً ويطبع أسماء الملفات غير المنسّقة؛ لذلك أي مخرج يُعد فشلاً
    step(GO, 'format', 'gofmt -l .', dir, { failOnOutput: true, fix: 'gofmt -w .' }),
    step(GO, 'lint', golangci ? 'golangci-lint run' : 'go vet ./...', dir),
    step(GO, 'test', 'go test ./...', dir),
    step(GO, 'build', 'go build ./...', dir),
  ];
}

const RUST = { id: 'rust', title: 'Rust' };

function rustSteps(dir) {
  if (!has(dir, 'Cargo.toml')) return [];
  const steps = [];
  if (has(dir, 'rustfmt.toml', '.rustfmt.toml')) steps.push(step(RUST, 'format', 'cargo fmt --check', dir, { fix: 'cargo fmt' }));
  steps.push(has(dir, 'clippy.toml', '.clippy.toml')
    ? step(RUST, 'lint', 'cargo clippy --all-targets -- -D warnings', dir)
    : step(RUST, 'types', 'cargo check --all-targets', dir));
  steps.push(step(RUST, 'test', 'cargo test', dir), step(RUST, 'build', 'cargo build', dir));
  return steps;
}

const MAVEN = { id: 'maven', title: 'Maven' };
const GRADLE = { id: 'gradle', title: 'Gradle' };

/** غلاف الأداة داخل المشروع (mvnw / gradlew) يضمن الإصدار الذي يعتمده؛ وإلا فالأداة من PATH. */
function wrapper(dir, name, fallback) {
  if (WINDOWS) return [`${name}.cmd`, `${name}.bat`].find((file) => has(dir, file)) || fallback;
  return has(dir, name) ? `./${name}` : fallback;
}

function jvmSteps(dir) {
  if (has(dir, 'pom.xml')) {
    const mvn = wrapper(dir, 'mvnw', 'mvn');
    return [step(MAVEN, 'test', `${mvn} -B test`, dir), step(MAVEN, 'build', `${mvn} -B -q package -DskipTests`, dir)];
  }
  if (has(dir, 'build.gradle', 'build.gradle.kts')) {
    const gradle = wrapper(dir, 'gradlew', 'gradle');
    return [step(GRADLE, 'test', `${gradle} test`, dir), step(GRADLE, 'build', `${gradle} assemble`, dir)];
  }
  return [];
}

const DOTNET = { id: 'dotnet', title: '.NET' };

function dotnetSteps(dir) {
  const names = list(dir);
  const solutions = names.filter((name) => /\.slnx?$/i.test(name));
  const projects = names.filter((name) => /\.(cs|fs|vb)proj$/i.test(name));
  // أكثر من حل أو مشروع في الجذر: لا يعرف dotnet أيها يبني (MSB1011)، فيُكتب الأمر في الإعداد
  const target = solutions.length === 1 ? solutions[0] : !solutions.length && projects.length === 1 ? projects[0] : null;
  if (!target) return [];
  const steps = [];
  if (has(dir, '.editorconfig')) {
    steps.push(step(DOTNET, 'format', `dotnet format "${target}" --verify-no-changes`, dir, { fix: `dotnet format "${target}"` }));
  }
  steps.push(step(DOTNET, 'types', `dotnet build "${target}"`, dir), step(DOTNET, 'test', `dotnet test "${target}" --no-build`, dir));
  return steps;
}

const PHP = { id: 'php', title: 'PHP' };

function phpSteps(dir) {
  if (!has(dir, 'composer.json')) return [];
  const scripts = json(dir, 'composer.json')?.scripts || {};
  const steps = [];
  if (scripts.lint) steps.push(step(PHP, 'lint', 'composer run-script lint', dir));
  if (has(dir, 'phpstan.neon', 'phpstan.neon.dist', 'phpstan.dist.neon')) {
    steps.push(step(PHP, 'types', 'php vendor/bin/phpstan analyse --no-progress', dir));
  }
  if (scripts.test) steps.push(step(PHP, 'test', 'composer run-script test', dir));
  else if (has(dir, 'phpunit.xml', 'phpunit.xml.dist', 'phpunit.dist.xml')) steps.push(step(PHP, 'test', 'php vendor/bin/phpunit', dir));
  return steps;
}

const RUBY = { id: 'ruby', title: 'Ruby' };

function rubySteps(dir) {
  if (!has(dir, 'Gemfile')) return [];
  const steps = [];
  if (has(dir, '.rubocop.yml')) steps.push(step(RUBY, 'lint', 'bundle exec rubocop', dir));
  if (has(dir, '.rspec', join('spec', 'spec_helper.rb'))) steps.push(step(RUBY, 'test', 'bundle exec rspec', dir));
  else if (has(dir, 'Rakefile') && hasFile(join(dir, 'test'), /_test\.rb$|^test_.*\.rb$/)) steps.push(step(RUBY, 'test', 'bundle exec rake test', dir));
  return steps;
}

const SWIFT = { id: 'swift', title: 'Swift' };

function swiftSteps(dir) {
  if (!has(dir, 'Package.swift')) return [];
  return [step(SWIFT, 'types', 'swift build', dir), step(SWIFT, 'test', 'swift test', dir)];
}

/** خطوات اللغات الأخرى في مجلد، بالترتيب: Python، Go، Rust، Java/Kotlin، .NET، PHP، Ruby، Swift. */
export function stackSteps(dir) {
  return [pythonSteps, goSteps, rustSteps, jvmSteps, dotnetSteps, phpSteps, rubySteps, swiftSteps].flatMap((detect) => detect(dir));
}
