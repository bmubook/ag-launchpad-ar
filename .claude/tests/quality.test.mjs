// اختبارات بوابة الإثبات وكاشف الاختصارات وحد الخطوة — تُشغَّل ضمن hooks.test.mjs، أو وحدها:
// node .claude/tests/quality.test.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, ctx, freshProject, report, runNode, tmp } from './helpers.mjs';

const lines = (n) => Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';
const write = (file, content) => { mkdirSync(dirname(join(tmp, file)), { recursive: true }); writeFileSync(join(tmp, file), content); };
/** يحاكي أداة Write: يكتب الملف ثم يشغّل Hook ما بعد التعديل بمحتواه. */
const post = (file, content, session = 'q') => {
  write(file, content);
  return runNode('.claude/hooks/post-edit.mjs', { session_id: session, tool_name: 'Write', tool_input: { file_path: join(tmp, file), content } });
};
const stop = (session = 'q', extra = {}) => runNode('.claude/hooks/stop-gate.mjs', { session_id: session, hook_event_name: 'Stop', stop_hook_active: false, ...extra });
const verify = (...args) => runNode('.claude/scripts/verify.mjs', '', { args });
const newTurn = (session = 'q') => runNode('.claude/hooks/prompt-submit.mjs', { session_id: session });
const quality = () => JSON.parse(readFileSync(join(tmp, '.claude/state/quality.json'), 'utf8'));
const blockReason = (r) => (r.json?.decision === 'block' ? r.json.reason : '');

/** مشروع Node وهمي: أوامره تقرأ tools/cfg.json لتنجح أو تفشل حسب الطلب. */
function nodeProject(scripts = ['lint', 'test', 'build'], cfg = { tests: 3, fail: null }) {
  write('tools/step.mjs', [
    "import { readFileSync } from 'node:fs';",
    "const cfg = JSON.parse(readFileSync('tools/cfg.json', 'utf8'));",
    'const name = process.argv[2];',
    "if (name === 'test') console.log(cfg.fail === 'test' ? 'AssertionError: boom' : ` Tests  ${cfg.tests} passed (${cfg.tests})`);",
    'process.exit(cfg.fail === name ? 1 : 0);', ''].join('\n'));
  setCfg(cfg);
  write('package.json', JSON.stringify({ name: 'demo', private: true, scripts: Object.fromEntries(scripts.map((s) => [s, `node tools/step.mjs ${s}`])) }));
}
const setCfg = (cfg) => write('tools/cfg.json', JSON.stringify(cfg));

/** يستدعي دالة من quality.mjs داخل المشروع المؤقت ويعيد نتيجتها. */
function probe(expression) {
  write('.claude/probe.mjs', `import * as q from './hooks/lib/quality.mjs';\nprocess.stdout.write(JSON.stringify(${expression}));\n`);
  return runNode('.claude/probe.mjs', '').json;
}

// ---------- verify.mjs
freshProject({ kicked: true });
let r = verify();
check('V: no manifest → exit 2 + /quality-setup hint', r.code === 2 && r.out.includes('/quality-setup'), r.out + r.err);

nodeProject();
r = verify();
check('V: all green → exit 0, full level, steps listed', r.code === 0 && r.out.includes('✅ ناجح') && r.out.includes('فحص كامل') && r.out.includes('npm run build'), r.out + r.err);
check('V: state records ok/full/tests=3', (() => { const v = quality().verify; return v.ok && v.level === 'full' && v.tests === 3; })(), JSON.stringify(quality()));
r = verify('--quick');
check('V: --quick skips build → level quick + production note', r.code === 0 && !r.out.includes('npm run build') && r.out.includes('فحص سريع') && quality().verify.level === 'quick', r.out);
setCfg({ tests: 3, fail: 'test' });
r = verify();
check('V: failing tests → exit 1, tail shown, fail-fast before build', r.code === 1 && r.out.includes('فاشل عند «الاختبارات»') && r.out.includes('boom') && !r.out.includes('npm run build'), r.out);
check('V: red state keeps failed step', quality().verify.ok === false && quality().verify.failed === 'test', JSON.stringify(quality().verify));
r = verify('--status');
check('V: --status reports red without running', r.out.includes('🔴') && r.out.includes('الاختبارات'), r.out);
setCfg({ tests: 4, fail: null });
r = verify();
check('V: red then green → 🔴→🟢 evidence note + previous count', r.code === 0 && r.out.includes('🔴→🟢') && r.out.includes('الفحص الناجح السابق: 3'), r.out);
setCfg({ tests: 2, fail: null });
r = verify();
check('V: passed-test count dropped → warning', r.out.includes('نقص من 4 إلى 2'), r.out);
setCfg({ tests: 2, fail: 'lint' });
check('V: failing lint → stops at lint', verify().out.includes('فاشل عند «التدقيق»'));
check('V: history kept', quality().history.length === 6, String(quality().history.length));

freshProject({ kicked: true });
write('package.json', JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
check('V: npm placeholder test script is not a check', verify().code === 2);
write('package.json', JSON.stringify({ scripts: { check: 'node -e "process.exit(0)"' } }));
check('V: lone custom check script is used', verify().out.includes('npm run check'));

// ---------- اكتشاف الأوامر
freshProject({ kicked: true });
nodeProject(['format:check', 'lint', 'typecheck', 'test', 'test:rules', 'build']);
let plan = probe('q.planChecks({})');
check('D: default plan = format, lint, types, test, build (no rules)', plan.steps.map((s) => s.name).join() === 'format,lint,types,test,build' && plan.level === 'full', JSON.stringify(plan));
plan = probe('q.planChecks({ quick: true, rules: true })');
check('D: quick + rules = no build, with rules', plan.steps.map((s) => s.name).join() === 'format,lint,types,test,rules' && plan.level === 'quick', JSON.stringify(plan));
write('pnpm-lock.yaml', '');
check('D: pnpm lockfile → pnpm run', probe('q.detectChecks()')[0].cmd.startsWith('pnpm run '));
freshProject({ kicked: true });
write('pubspec.yaml', 'name: demo\n'); write('test/a_test.dart', ''); write('functions/package.json', JSON.stringify({ scripts: { lint: 'eslint', build: 'tsc' } }));
plan = probe('q.planChecks({ quick: true })');
check('D: Flutter + functions/ → analyze, test, functions:lint; quick skips functions build', plan.steps.map((s) => s.name).join() === 'format,lint,test,functions:lint' && plan.steps[1].cmd === 'flutter analyze', JSON.stringify(plan));
check('D: needsVerification excludes template and docs files', JSON.stringify(probe("['src/a.ts','firestore.rules','next.config.ts','.claude/hooks/x.mjs','README.md','.gitignore','docs/x.html','public/a.png'].map(q.needsVerification)")) === '[true,true,true,false,false,false,false,false]');

// ---------- بوابة التوقف
freshProject({ kicked: true });
nodeProject();
const coverA = "import { a } from '../src/a';\nit('a', () => { expect(a).toBeGreaterThan(0); });\n";
write('tests/a.test.ts', coverA);
check('G: clean edit in project with checks → silent', post('src/a.ts', 'export const a = 1;\n').out === '');
r = stop();
check('G: code edited, never verified → block names verify.mjs and /document', blockReason(r).includes('بوابة الإثبات') && blockReason(r).includes('node .claude/scripts/verify.mjs') && blockReason(r).includes('/document'), r.out);
check('G: stop_hook_active → allow', stop('q', { stop_hook_active: true }).out === '');
verify('--quick');
check('G: quick verify in production → block asks for full', blockReason(stop()).includes('الفحص الكامل'), stop().out);
verify();
check('G: full green, changelog missing → only docs problem', blockReason(stop()).includes('التوثيق الإلزامي') && !blockReason(stop()).includes('بوابة الإثبات'), stop().out);
runNode('.claude/hooks/post-edit.mjs', { session_id: 'q', tool_input: { file_path: join(tmp, 'changelog.md') } });
check('G: verified + documented → allow', stop().out === '', stop().out);
post('src/a.ts', 'export const a = 2;\n');
check('G: edit after green → stale → block', blockReason(stop()).includes('لم يُشغَّل فحص المشروع بعد آخر تعديل'), stop().out);
setCfg({ tests: 3, fail: 'test' }); verify();
check('G: red verify → block names failed step', blockReason(stop()).includes('فاشل عند «الاختبارات»'), stop().out);
newTurn();
check('G: new turn without edits → allow even while red', stop().out === '');
runNode('.claude/hooks/post-edit.mjs', { session_id: 'q', tool_input: { file_path: join(tmp, 'README.md') } });
check('G: docs-only turn → allow', stop().out === '');
newTurn(); write('.claude/settings.json', readFileSync(join(tmp, '.claude/settings.json'), 'utf8'));
runNode('.claude/hooks/post-edit.mjs', { session_id: 'q', tool_input: { file_path: join(tmp, '.claude/settings.json') } });
check('G: template file edit → docs required, no verify demand', blockReason(stop()).includes('التوثيق') && !blockReason(stop()).includes('بوابة الإثبات'), stop().out);

freshProject({ kicked: true, mode: 'prototype' });
nodeProject();
write('tests/a.test.ts', coverA);
post('src/a.ts', 'export const a = 1;\n', 'p');
check('G: prototype → block suggests --quick', blockReason(stop('p')).includes('verify.mjs --quick'), stop('p').out);
verify('--quick');
runNode('.claude/hooks/post-edit.mjs', { session_id: 'p', tool_input: { file_path: join(tmp, 'changelog.md') } });
check('G: prototype accepts quick verify', stop('p').out === '', stop('p').out);

// ---------- حد الخطوة
freshProject({ kicked: true });
nodeProject();
check('S: 150 lines since green → silent', post('src/b.ts', lines(150), 's').out === '');
r = post('src/c.ts', lines(60), 's');
check('S: 210 lines → ⏸️ step limit', ctx(r).includes('⏸️ حد الخطوة') && ctx(r).includes('verify.mjs --quick'), r.out);
check('S: next small edit → not repeated', post('src/d.ts', lines(5), 's').out === '');
check('S: +100 more lines → repeated', ctx(post('src/e.ts', lines(100), 's')).includes('⏸️'));
verify('--quick');
check('S: green verify resets pending', quality().pending.files.length === 0 && quality().pending.lines === 0, JSON.stringify(quality().pending));
check('S: after reset → silent again', post('src/f.ts', lines(50), 's').out === '');
freshProject({ kicked: true, mode: 'prototype' });
nodeProject();
post('src/b.ts', lines(150), 's');
check('S: prototype doubles the limit (210 lines silent)', post('src/c.ts', lines(60), 's').out === '');

// ---------- كاشف الاختصارات
freshProject({ kicked: true });
nodeProject();
const flagged = (file, content, needle) => { const o = post(file, content, 'c'); return ctx(o).includes('🚩') && ctx(o).includes(needle); };
const clean = (file, content) => !ctx(post(file, content, 'c')).includes('🚩');
check('C: TODO comment → flagged', flagged('src/a.ts', 'export function pay() {\n  // TODO: handle errors later\n}\n', 'كود ناقص'));
check('C: "TODO" as data, not a comment → clean', clean('src/status.ts', "export const STATUS = ['TODO', 'DONE'] as const;\n"));
check('C: throw Not implemented → flagged', flagged('src/b.ts', "export function refund() { throw new Error('Not implemented'); }\n", 'كود ناقص'));
check('C: empty catch → flagged', flagged('src/c.ts', 'try { run(); } catch (e) {}\n', 'خطأ مكتوم'));
check('C: handled catch → clean', clean('src/c2.ts', 'try { run(); } catch (error) { report(error); throw error; }\n'));
check('C: .catch(() => {}) → flagged', flagged('src/c3.ts', 'save().catch(() => {});\n', 'خطأ مكتوم'));
check('C: @ts-ignore → flagged', flagged('src/d.ts', '// @ts-ignore\nconst x: number = y;\n', 'تعطيل فحص'));
check('C: as any in app code → flagged', flagged('src/e.ts', 'const user = data as any;\n', 'any'));
check('C: as any in a test → clean', clean('tests/e.test.ts', "import { expect, it } from 'vitest';\nit('x', () => { expect((fn as any)()).toBe(2); });\n"));
check('C: mock data in app code → flagged', flagged('src/users.ts', "export const mockUsers = [{ id: 1, name: 'A' }];\n", 'بيانات وهمية'));
check('C: mock data in tests → clean', clean('tests/users.test.ts', "const mockUsers = [{ id: 1 }];\nit('x', () => { expect(mockUsers.length).toBe(1); });\n"));
check('C: NODE_ENV test branch in app code → flagged', flagged('src/auth.ts', "if (process.env.NODE_ENV === 'test') return true;\n", 'بيئة الاختبار'));
check('C: it.skip → flagged', flagged('tests/pay.test.ts', "it.skip('pays', () => { expect(pay()).toBe(1); });\n", 'اختبار معطّل'));
check('C: trivial assertion → flagged', flagged('tests/t.test.ts', "it('works', () => { expect(true).toBe(true); });\n", 'تأكيد شكلي'));
check('C: test file without assertions → flagged', flagged('tests/n.test.ts', "it('renders', () => { render(); });\n", 'بلا أي تأكيد'));
check('C: open security rule → flagged', flagged('firestore.rules', 'match /{document=**} { allow read, write: if true; }\n', 'تفتح الكتابة للجميع'));
check('C: public read-only rule → clean (may be intentional)', clean('storage.rules', 'match /public/{file} { allow get: if true; }\n'));
check('C: closed security rule → clean', clean('storage.rules', 'match /{allPaths=**} { allow read, write: if false; }\n'));
check('C: ignoreBuildErrors in next.config → flagged', flagged('next.config.ts', 'export default { typescript: { ignoreBuildErrors: true } };\n', 'إرخاء'));
check('C: strict false in tsconfig → flagged', flagged('tsconfig.json', '{ "compilerOptions": { "strict": false } }\n', 'إرخاء'));
check('C: Dart ignore + empty catch → flagged', flagged('lib/a.dart', '// ignore: avoid_print\ntry { run(); } catch (e) {}\n', 'تعطيل فحص'));
check('C: ordinary code → clean', clean('src/sum.ts', 'export const sum = (a: number, b: number): number => a + b;\n'));
check('C: template files are not scanned', clean('.claude/hooks/x.mjs', '// TODO: nothing\n'));

freshProject({ kicked: true });
nodeProject();
post('src/pay.ts', 'export function pay() {\n  // TODO: validate amount\n  return 1;\n}\n', 'k');
verify();
runNode('.claude/hooks/post-edit.mjs', { session_id: 'k', tool_input: { file_path: join(tmp, 'changelog.md') } });
r = stop('k');
check('C: shortcut still in file at stop → block lists it', blockReason(r).includes('اختصارات لم تُعالج') && blockReason(r).includes('src/pay.ts'), r.out);
write('src/pay.ts', 'export function pay(amount: number) {\n  if (amount <= 0) throw new RangeError("amount");\n  return amount;\n}\n');
check('C: shortcut removed from file → no shortcut problem', !blockReason(stop('k')).includes('اختصارات'), stop('k').out);

// ---------- بداية الجلسة وسطر الحالة
const start = () => ctx(runNode('.claude/hooks/session-start.mjs', { source: 'startup' }));
const statusline = () => runNode('.claude/statusline.mjs', { workspace: { project_dir: tmp } }).out;
freshProject({ kicked: true });
check('SSQ: no checks in project → no gate line, no badge', !start().includes('بوابة الإثبات:') && !statusline().includes('مفحوص'), start());
nodeProject();
check('SSQ: checks exist, never run → asks for a baseline run', start().includes('لم يُشغَّل فحص المشروع بعد'), start());
verify();
check('SSQ: green → ✅ line with test count + ✅ badge', start().includes('آخر فحص ناجح ✅ (3 اختباراً)') && statusline().includes('✅ مفحوص'), start() + statusline());
post('src/a.ts', 'export const a = 1;\n', 'z');
check('SSQ: unverified edit → 🟠 line names the file + badge with count', start().includes('🟠 بوابة الإثبات: 1 ملفاً') && start().includes('src/a.ts') && statusline().includes('🟠 غير مفحوص (1)'), start() + statusline());
setCfg({ tests: 3, fail: 'build' }); verify();
check('SSQ: red → 🔴 line (stability first) + 🔴 badge', start().includes('🔴 بوابة الإثبات: آخر فحص فاشل عند «البناء»') && statusline().includes('🔴 الفحص فاشل'), start() + statusline());

// ---------- تقرير الصحة
const health = (...args) => runNode('.claude/scripts/health-report.mjs', '', { args });
freshProject({ kicked: true });
nodeProject();
write('src/lib/price.ts', 'export const total = (a: number, b: number) => a + b;\n');
write('src/lib/tax.ts', 'export const tax = (a: number) => a * 0.15; // TODO: read the rate from settings\n');
write('tests/price.test.ts', "import { total } from '../src/lib/price';\nit('adds', () => { expect(total(1, 2)).toBe(3); });\n");
write('firestore.rules', 'match /{document=**} { allow read, write: if false; }\n');
r = health();
check('H: read-only and lists the indicators table', r.code === 0 && r.out.includes('🩺 تقرير صحة المشروع') && r.out.includes('| بوابة الإثبات | لم يُشغَّل |'), r.out + r.err);
check('H: shortcut listed with its file', r.out.includes('`src/lib/tax.ts`') && r.out.includes('كود ناقص'), r.out);
check('H: untested logic file listed, tested one not', r.out.includes('| `src/lib/tax.ts` | 1 |') && !r.out.includes('| `src/lib/price.ts`'), r.out);
check('H: rules file without rules tests → 🔴', r.out.includes('| اختبارات قواعد الأمان | غير موجودة | 🔴'), r.out);
verify();
write('.github/workflows/ci.yml', 'name: ci\n');
write('tests/rules/notes.test.ts', "import { assertFails } from '@firebase/rules-unit-testing';\nit('denies', async () => { await assertFails(read()); });\n");
write('src/lib/tax.ts', 'export const tax = (a: number, rate: number) => a * rate;\n');
write('tests/tax.test.ts', "import { tax } from '../src/lib/tax';\nit('applies rate', () => { expect(tax(100, 0.15)).toBe(15); });\n");
const healthy = health('--json').json;
check('H: healthy project → 🟢 verdict, no bad indicators', healthy?.verdict.includes('🟢') && healthy.bad === 0 && healthy.shortcuts.length === 0, JSON.stringify(healthy).slice(0, 600));
write('changelog.md', ['## جدول التغييرات', '', '| التاريخ | الإصدار | النوع | الهوية | الملفات | الوصف | Git | Score |', '| :--- | :---: | :---: | :--- | :--- | :--- | :--- | :--- |',
  ...['fix', 'fix', 'fix', 'feat'].map((type, i) => `| 2026-10-0${i + 1} 10:00 | v1.0.${i} | ${type} | PM | a.ts | ${type}(x): y | main | - |`), ''].join('\n'));
check('H: fixes outnumber features → patching signal', health().out.includes('الترقيع يغلب البناء'));

if (process.argv[1] === fileURLToPath(import.meta.url)) report();
