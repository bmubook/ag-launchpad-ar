// اختبارات حالات الحافة لبوابة الإثبات، مأخوذة من تجربة القالب على مشروع Next.js حقيقي:
// تعديل بأوامر الطرفية، ملف منطق بلا اختبار، اختصارات تبقى بعد تجاهل المنع، اختبار يفشل في TypeScript قبل أن يُشغَّل.
// تُشغَّل ضمن hooks.test.mjs، أو وحدها: node .claude/tests/gate.test.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, ctx, freshProject, report, runNode, tmp } from './helpers.mjs';

const write = (file, content) => { mkdirSync(dirname(join(tmp, file)), { recursive: true }); writeFileSync(join(tmp, file), content); };
const post = (file, content, session = 'e') => {
  write(file, content);
  return runNode('.claude/hooks/post-edit.mjs', { session_id: session, tool_name: 'Write', tool_input: { file_path: join(tmp, file), content } });
};
const stop = (session = 'e') => runNode('.claude/hooks/stop-gate.mjs', { session_id: session, hook_event_name: 'Stop', stop_hook_active: false });
const blockReason = (r) => (r.json?.decision === 'block' ? r.json.reason : '');
const verify = (...args) => runNode('.claude/scripts/verify.mjs', '', { args });
const newTurn = (session = 'e') => runNode('.claude/hooks/prompt-submit.mjs', { session_id: session });
const statusline = () => runNode('.claude/statusline.mjs', { workspace: { project_dir: tmp } }).out;
const quality = () => JSON.parse(readFileSync(join(tmp, '.claude/state/quality.json'), 'utf8'));

/** مشروع Node وهمي: كل أمر يقرأ tools/cfg.json لينجح أو يفشل، ويطبع مخرجاً مخصصاً إن وُجد. */
function nodeProject(scripts = ['format:check', 'format', 'lint', 'test']) {
  write('tools/step.mjs', [
    "import { readFileSync } from 'node:fs';",
    "const cfg = JSON.parse(readFileSync('tools/cfg.json', 'utf8'));",
    'const name = process.argv[2];',
    "if (cfg.out?.[name]) console.log(cfg.out[name]);",
    "if (name === 'test' && cfg.fail !== 'test') console.log(` Tests  ${cfg.tests || 1} passed`);",
    'process.exit(cfg.fail === name ? 1 : 0);', ''].join('\n'));
  write('tools/cfg.json', JSON.stringify({ fail: null }));
  write('package.json', JSON.stringify({ name: 'demo', private: true, scripts: Object.fromEntries(scripts.map((s) => [s, `node tools/step.mjs ${s}`])) }));
}
const setCfg = (cfg) => write('tools/cfg.json', JSON.stringify(cfg));
const covered = (name) => write(`tests/${name}.test.ts`, `import { ${name} } from '../src/${name}';\nit('${name}', () => { expect(${name}(2)).toBe(4); });\n`);

// ---------- تعديل بأوامر الطرفية (sed، سكربت) لا يمر بـ Hook ما بعد التعديل
freshProject({ kicked: true, mode: 'prototype' });
nodeProject();
covered('calc');
write('src/calc.ts', 'export const calc = (n: number) => n * 2;\n');
verify('--quick');
check('B: green after verify', statusline().includes('✅ مفحوص'), statusline());
newTurn();
write('src/calc.ts', 'export const calc = (n: number) => n * 3;\n');
check('B: disk edit after green → status 🟠 غير مفحوص (1)', statusline().includes('🟠 غير مفحوص (1)'), statusline());
let r = stop();
check('B: disk-only edit this turn → block asks to verify and document', blockReason(r).includes('بوابة الإثبات') && blockReason(r).includes('src/calc.ts') && blockReason(r).includes('التوثيق'), r.out);
write('changelog.md', '# سجل\n');
check('B: changelog edited on disk counts as documented', !blockReason(stop()).includes('التوثيق'), stop().out);
verify('--quick');
check('B: verify after disk edit → allow', stop().out === '', stop().out);
check('B: session start lists the disk-edited file when stale', (() => {
  write('src/calc.ts', 'export const calc = (n: number) => n * 4;\n');
  return ctx(runNode('.claude/hooks/session-start.mjs', { source: 'startup' })).includes('src/calc.ts');
})());

newTurn('w');
write('next-env.d.ts', '/// <reference types="next" />\n');
check('B: generated next-env.d.ts is not a code change', stop('w').out === '', stop('w').out);

freshProject({ kicked: true });
nodeProject();
check('B: no turn start recorded → disk scan skipped (no false block)', stop('fresh').out === '');

// ---------- ملف منطق بلا اختبار
freshProject({ kicked: true, mode: 'prototype' });
nodeProject();
post('src/discount.ts', 'export const discount = (n: number) => n / 2;\n');
verify('--quick');
write('changelog.md', '# سجل\n');
runNode('.claude/hooks/post-edit.mjs', { session_id: 'e', tool_input: { file_path: join(tmp, 'changelog.md') } });
r = stop();
check('U: logic file without any test → block names it', blockReason(r).includes('لا يستوردها أي اختبار') && blockReason(r).includes('src/discount.ts'), r.out);
write('tests/pricing.test.ts', "import { discount } from '@/discount';\nit('halves', () => { expect(discount(4)).toBe(2); });\n");
verify('--quick');
check('U: a test importing it (alias path) → allow', stop().out === '', stop().out);
newTurn();
post('src/components/Card.tsx', 'export const Card = () => null;\n');
post('src/types.ts', 'export type Id = string;\n');
verify('--quick');
runNode('.claude/hooks/post-edit.mjs', { session_id: 'e', tool_input: { file_path: join(tmp, 'changelog.md') } });
check('U: components and type files do not require a test', stop().out === '', stop().out);

// ---------- الاختصارات تبقى ظاهرة بعد تجاهل المنع
freshProject({ kicked: true, mode: 'prototype' });
nodeProject();
covered('pay');
post('src/pay.ts', 'export function pay(n: number) {\n  // TODO: validate\n  try { return n * 2; } catch {}\n}\n', 'k');
check('P: open shortcut persisted', JSON.stringify(quality().shortcuts['src/pay.ts']) === '["placeholder","swallowed-error"]', JSON.stringify(quality().shortcuts));
verify('--quick');
runNode('.claude/hooks/stop-gate.mjs', { session_id: 'k', stop_hook_active: true });
check('P: status line keeps 🚩 1 after the agent ignored the block', statusline().includes('🚩 1') && statusline().includes('✅ مفحوص'), statusline());
check('P: next session start names the file', ctx(runNode('.claude/hooks/session-start.mjs', { source: 'startup' })).includes('🚩 اختصارات مفتوحة') , '');
newTurn('k');
write('src/pay.ts', 'export function pay(n: number) {\n  return n * 2;\n}\n');
verify('--quick');
stop('k');
check('P: fixed on disk → stop refreshes the record, badge gone', !statusline().includes('🚩'), statusline() + JSON.stringify(quality().shortcuts));

// ---------- مخرجات verify: اختبار كُتب قبل الكود يفشل في TypeScript، وفشل التنسيق وحده
freshProject({ kicked: true });
nodeProject(['format:check', 'format', 'lint', 'typecheck', 'test']);
setCfg({ fail: 'typecheck', out: { typecheck: "tests/unit/estimate/calc.test.ts(6,8): error TS2307: Cannot find module '@/services/estimate/calc'" } });
verify();
check('V2: types failure inside a test file counts as a red test', quality().redSeen === true, JSON.stringify(quality()));
setCfg({ fail: null });
check('V2: then green → 🔴→🟢 evidence note', verify().out.includes('🔴→🟢'));
setCfg({ fail: 'typecheck', out: { typecheck: "src/app/page.tsx(3,1): error TS2304: Cannot find name 'x'" } });
verify();
check('V2: types failure in app code is not a red test', quality().redSeen === false);
setCfg({ fail: 'format:check' });
r = verify();
check('V2: format-only failure → hint with the fix command, not counted as a retry', r.out.includes('npm run format') && r.out.includes('لا يُحسب من محاولات التصحيح'), r.out);

// ---------- Next.js: أنواع المسارات تُولَّد قبل tsc
freshProject({ kicked: true });
write('package.json', JSON.stringify({ scripts: { lint: 'eslint', build: 'next build' } }));
write('tsconfig.json', '{}');
write('node_modules/typescript/package.json', '{"version":"5.9.0"}');
write('node_modules/next/package.json', '{"version":"16.3.7"}');
const typesCmd = () => { write('.claude/probe.mjs', "import { detectChecks } from './hooks/lib/checks.mjs';\nprocess.stdout.write(JSON.stringify(detectChecks().find((s) => s.name === 'types')));\n"); return runNode('.claude/probe.mjs', '').json?.cmd || ''; };
check('N: Next 16 → next typegen before tsc', typesCmd() === 'npx --no-install next typegen && npx --no-install tsc --noEmit', typesCmd());
write('node_modules/next/package.json', '{"version":"14.2.0"}');
check('N: Next 14 (no typegen) → plain tsc', typesCmd() === 'npx --no-install tsc --noEmit', typesCmd());

// ---------- بداية الجلسة في prototype تقترح الفحص السريع
freshProject({ kicked: true, mode: 'prototype' });
nodeProject();
check('M: prototype never-run line suggests --quick', ctx(runNode('.claude/hooks/session-start.mjs', { source: 'startup' })).includes('verify.mjs --quick قبل أول تعديل'));

// ---------- ملف حوكمة تغيّر بأمر طرفية (كشفتها تجربة حية في OpenCode: دالة ‎.NET أضافت سطراً إلى AGENTS.md دون موافقة)
freshProject({ kicked: true });
newTurn('g1');
write('AGENTS.md', '# a\nسطر تجربة\n');
const shellEdit = blockReason(stop('g1'));
check('G: governance file changed outside the edit tools → block, tell the user and offer to undo', shellEdit.includes('🛡️')
  && shellEdit.includes('AGENTS.md') && shellEdit.includes('التراجع'), shellEdit);
newTurn('g2');
post('.claude/skills/x-guide/SKILL.md', '# دليل\n', 'g2');
check('G: the same kind of file edited through the edit tool → no notice (approval was asked)', stop('g2').out === '', stop('g2').out);
newTurn('g3');
write('.claude/settings.local.json', '{"permissions":{"allow":["Bash(npm test)"]}}');
check('G: settings.local.json written by the app itself ("always allow") → no notice', stop('g3').out === '', stop('g3').out);
write('CLAUDE.md', '# changed\n');
check('G: no turn start recorded → no scan, no false notice', stop('g-fresh').out === '', stop('g-fresh').out);
// انتقال Git بين الفروع أو الدمج يعيد كتابة الملفات بالمحتوى نفسه (كشفه نشر v4.8.0): لا تنبيه إلا لتغيّر المحتوى
write('AGENTS.md', '# a\n');
newTurn('g4');
write('AGENTS.md', '# a\n');
write('.claude/hooks/guard-secrets.mjs', readFileSync(join(tmp, '.claude/hooks/guard-secrets.mjs')));
check('G: same content rewritten (git checkout / merge) → no notice', stop('g4').out === '', stop('g4').out);
newTurn('g5');
write('.claude/skills/x-guide/SKILL.md', '# دليل معدّل\n');
const shellRewrite = blockReason(stop('g5'));
check('G: content really changed by a shell command → notice names that file only', shellRewrite.includes('x-guide')
  && !shellRewrite.includes('AGENTS.md'), shellRewrite);
newTurn('g6');
write('.agents/new-rule.md', 'تعليمات جديدة\n');
check('G: a new governance file created by a shell command → notice', blockReason(stop('g6')).includes('.agents/new-rule.md'), stop('g6').out);

if (process.argv[1] === fileURLToPath(import.meta.url)) report();
