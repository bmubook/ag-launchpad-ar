// اختبارات حقيبة الحارس: التركيب في مشروع قائم والتحديث والإزالة، وسلوك الحواجز بنسختها الخفيفة داخل المشروع.
// تُشغَّل ضمن hooks.test.mjs، أو وحدها: node .claude/tests/kit.test.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, check, report } from './helpers.mjs';

const made = [];
const USER_HOOK = { matcher: 'Write', hooks: [{ type: 'command', command: 'echo mine' }] };

/** مشروع قائم: CLAUDE.md خاص به، ومستودع Git، وإعدادات اختيارية، وأوامر فحص Node وهمية تقرأ tools/cfg.json. */
function project({ settings = null, node = true, git = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aglp-kit-'));
  made.push(dir);
  const put = (file, content) => { mkdirSync(dirname(join(dir, file)), { recursive: true }); writeFileSync(join(dir, file), content); };
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir.replace(/\\/g, '/') };
  const node$ = (script, input, args = []) => {
    const r = spawnSync('node', [join(dir, script), ...args], { input: JSON.stringify(input), encoding: 'utf8', env, cwd: dir });
    let json = null;
    try { json = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch { /* مخرج نصي */ }
    return { code: r.status, out: r.stdout + r.stderr, json };
  };
  put('CLAUDE.md', '# قواعد مشروعي\n');
  if (git) spawnSync('git', ['init', '-q'], { cwd: dir });
  if (settings) put('.claude/settings.json', JSON.stringify(settings, null, 2));
  if (node) {
    put('tools/check.mjs', "import { readFileSync } from 'node:fs';\nconst cfg = JSON.parse(readFileSync('tools/cfg.json', 'utf8'));\n"
      + "if (process.argv[2] === 'test') console.log(` Tests  ${cfg.tests} passed (${cfg.tests})`);\nprocess.exit(cfg.fail === process.argv[2] ? 1 : 0);\n");
    put('tools/cfg.json', JSON.stringify({ tests: 2, fail: null }));
    put('package.json', JSON.stringify({ name: 'shop', private: true, scripts: { lint: 'node tools/check.mjs lint', test: 'node tools/check.mjs test' } }));
  }
  return {
    dir, put,
    read: (file) => readFileSync(join(dir, file), 'utf8'),
    has: (file) => existsSync(join(dir, file)),
    json: (file) => JSON.parse(readFileSync(join(dir, file), 'utf8')),
    install: (...flags) => {
      const r = spawnSync('node', [join(REPO, '.claude/scripts/guard-install.mjs'), dir, ...flags], { encoding: 'utf8' });
      return { code: r.status, out: r.stdout + r.stderr };
    },
    hook: (name, input = {}) => node$(`.claude/launchpad/hooks/${name}.mjs`, { session_id: 'kit', ...input }),
    verify: (...args) => node$('.claude/launchpad/scripts/verify.mjs', {}, args),
    statusline: () => node$('.claude/launchpad/statusline.mjs', { workspace: { project_dir: dir } }).out,
    write(file, content) {
      put(file, content);
      return this.hook('post-edit', { tool_name: 'Write', tool_input: { file_path: join(dir, file), content } });
    },
  };
}
const ctx = (r) => r.json?.hookSpecificOutput?.additionalContext || '';
const blockReason = (r) => (r.json?.decision === 'block' ? r.json.reason : '');
const decision = (r) => r.json?.hookSpecificOutput?.permissionDecision || null;
const kitCommands = (settings) => Object.values(settings.hooks || {}).flat().flatMap((g) => g.hooks || []).filter((h) => h.command.includes('.claude/launchpad/'));

// ---------- التركيب في مشروع له إعداداته
const p = project({ settings: { hooks: { PostToolUse: [USER_HOOK] }, permissions: { allow: ['Bash(npm test)'] } } });
let r = p.install();
check('KIT: install → exit 0, summary names the detected checks and where the result shows', r.code === 0 && r.out.includes('🛡️') && r.out.includes('npm run test')
  && r.out.includes('في آخر كل رد') && r.out.includes('تطبيق سطح المكتب لا يعرض سطر الحالة'), r.out);
check('KIT: guard layer, agent rules and config created', p.has('.claude/launchpad/hooks/stop-gate.mjs') && p.has('.claude/launchpad/scripts/verify.mjs')
  && p.has('.claude/launchpad/statusline.mjs') && p.has('.claude/rules/launchpad-guard.md') && p.json('.claude/launchpad.json').mode === 'production');
check('KIT: the template beginner layer is not copied (no skills, rules files or roadmap)', !p.has('.claude/launchpad/skills') && !p.has('master_rules.md')
  && !p.has('.claude/launchpad/scripts/roadmap') && !p.has('project_map.md'));
check('KIT: CLAUDE.md untouched', p.read('CLAUDE.md') === '# قواعد مشروعي\n');
let settings = p.json('.claude/settings.json');
check('KIT: own hook and permission kept, kit hooks added for the five events', settings.hooks.PostToolUse[0].hooks[0].command === 'echo mine'
  && settings.permissions.allow.includes('Bash(npm test)') && kitCommands(settings).length === 5, JSON.stringify(settings).slice(0, 500));
check('KIT: secrets deny list and status line added', settings.permissions.deny.includes('Read(.env)') && settings.statusLine.command.includes('.claude/launchpad/statusline.mjs'));
check('KIT: destructive Git and rm -rf ask first, as in the full template', settings.permissions.ask.includes('Bash(git reset --hard:*)') && settings.permissions.ask.includes('Bash(rm -rf:*)'), JSON.stringify(settings.permissions.ask));
check('KIT: .gitignore gets the state folder', p.read('.gitignore').includes('.claude/state/'));
check('KIT: agent rules stay short (under 5 KB)', p.read('.claude/rules/launchpad-guard.md').length < 5000);

// ---------- الحواجز داخل المشروع
let start = ctx(p.hook('session-start', { source: 'startup' }));
check('KH: session start → guard line + gate, no kickoff, no beginner rules', start.includes('🛡️') && start.includes('.claude/launchpad/scripts/verify.mjs')
  && !start.includes('/kickoff') && !start.includes('/document') && !start.includes('project_map'), start);
check('KH: status line shows the guard, not /kickoff', p.statusline().includes('🛡️ الحارس') && !p.statusline().includes('/kickoff'), p.statusline());
for (let i = 0; i < 15; i += 1) r = p.hook('prompt-submit', { prompt: 'x' });
check('KH: no 15-message checkpoint (no governance files to re-read)', !ctx(r).includes('نقطة تفتيش'), ctx(r));
r = p.write('src/cart.js', `${Array.from({ length: 300 }, (_, i) => `export const v${i} = ${i};`).join('\n')}\n`);
check('KH: size ceiling off by default in existing projects', !ctx(r).includes('سقف الحجم'), ctx(r));
r = p.write('src/pay.js', 'export function pay() {\n  // TODO: validate the amount\n  return 1;\n}\n');
check('KH: shortcut detector works', ctx(r).includes('🚩'), ctx(r));
r = p.hook('stop-gate', { stop_hook_active: false });
check('KH: stop → verify demanded with the kit path, no changelog demand', blockReason(r).includes('node .claude/launchpad/scripts/verify.mjs')
  && blockReason(r).includes('🚩') && !blockReason(r).includes('التوثيق') && !blockReason(r).includes('bugs_log'), blockReason(r));
p.write('src/pay.js', 'export function pay(amount) {\n  if (amount <= 0) throw new RangeError("amount");\n  return amount;\n}\n');
p.put('tests/pay.test.js', "import { pay } from '../src/pay';\nimport { total } from '../src/cart';\nit('pays', () => { expect(pay(1)).toBe(1); });\n");
r = p.verify();
check('KH: kit verify runs the project checks and counts tests', r.code === 0 && r.out.includes('✅ ناجح') && r.out.includes('الاختبارات الناجحة: 2'), r.out);
check('KH: verified turn → stop is silent', p.hook('stop-gate', { stop_hook_active: false }).out === '', p.hook('stop-gate', { stop_hook_active: false }).out);
check('KH: status line badge follows the gate', p.statusline().includes('✅ مفحوص'), p.statusline());
p.put('.claude/launchpad.json', JSON.stringify({ mode: 'prototype', ceilings: true, checks: [] }));
p.hook('prompt-submit', { prompt: 'x' });
r = p.write('src/cart.js', `${Array.from({ length: 260 }, (_, i) => `export const w${i} = ${i};`).join('\n')}\n`);
check('KH: ceilings: true → size warnings come back', ctx(r).includes('سقف الحجم'), ctx(r));
check('KH: mode prototype → stop suggests --quick', blockReason(p.hook('stop-gate', { stop_hook_active: false })).includes('verify.mjs --quick'));

// ---------- حماية الحقيبة نفسها
const guard = (tool_name, tool_input) => decision(p.hook('guard-secrets', { tool_name, tool_input }));
check('KG: writing the kit hooks or its config asks the user', guard('Write', { file_path: join(p.dir, '.claude/launchpad/hooks/stop-gate.mjs'), content: '' }) === 'ask'
  && guard('Edit', { file_path: join(p.dir, '.claude/launchpad.json'), old_string: 'a', new_string: 'b' }) === 'ask');
check('KG: deleting the kit from the shell asks the user', guard('Bash', { command: 'rm -rf .claude/launchpad' }) === 'ask');
check('KG: reading the real env file is denied', guard('Read', { file_path: join(p.dir, '.env') }) === 'deny');
check('KG: ordinary project code passes silently', guard('Write', { file_path: join(p.dir, 'src/x.js'), content: 'export const x = 1;\n' }) === null);

// ---------- التحديث
p.put('.claude/launchpad/hooks/lib/stale.mjs', '// من إصدار قديم\n');
p.put('.claude/launchpad.json', JSON.stringify({ mode: 'prototype', checks: [] }));
r = p.install();
settings = p.json('.claude/settings.json');
check('KU: re-run → update message, hooks not duplicated', r.code === 0 && r.out.includes('حُدّثت') && kitCommands(settings).length === 5, r.out);
check('KU: files removed by a newer template do not linger', !p.has('.claude/launchpad/hooks/lib/stale.mjs'));
check('KU: the owner config is never overwritten', p.json('.claude/launchpad.json').mode === 'prototype' && r.out.includes('لم يُمس'), r.out);
check('KU: .gitignore block not repeated', p.read('.gitignore').split('.claude/state/').length === 2, p.read('.gitignore'));

// ---------- الإزالة
r = p.install('--remove');
settings = p.json('.claude/settings.json');
check('KR: remove → kit, agent rules and state gone', r.code === 0 && !p.has('.claude/launchpad') && !p.has('.claude/rules/launchpad-guard.md') && !p.has('.claude/state'), r.out);
check('KR: settings back to the owner own hook and permission only', JSON.stringify(settings) === JSON.stringify({ hooks: { PostToolUse: [USER_HOOK] }, permissions: { allow: ['Bash(npm test)'] } }), JSON.stringify(settings));
check('KR: modified config kept and reported', p.has('.claude/launchpad.json') && r.out.includes('.claude/launchpad.json'), r.out);
check('KR: a .gitignore the kit created is removed with it', !p.has('.gitignore'));
const ignored = project();
ignored.put('.gitignore', 'node_modules/\n');
ignored.install();
ignored.install('--remove');
check('KR: an existing .gitignore gets back exactly its own lines', ignored.read('.gitignore') === 'node_modules/\n', JSON.stringify(ignored.read('.gitignore')));
check('KR: removing twice → clear error', p.install('--remove').code === 1);

// ---------- مشروع بلا .claude ولا Git ولا أوامر فحص
const bare = project({ node: false, git: false });
r = bare.install();
check('KB: no checks found → summary says how to add them', r.code === 0 && r.out.includes('لم أجد أوامر فحص') && r.out.includes('"checks"'), r.out);
check('KB: new settings file gets the schema; no .gitignore outside Git', bare.json('.claude/settings.json').$schema?.includes('claude-code-settings') && !bare.has('.gitignore'));
start = ctx(bare.hook('session-start', { source: 'startup' }));
check('KB: session start tells the agent no checks exist yet', start.includes('لم يجد الحارس أوامر فحص') && start.includes('.claude/launchpad.json'), start);
check('KB: status line → ⚪ no checks', bare.statusline().includes('⚪ لا أوامر فحص'), bare.statusline());
r = bare.write('src/app.py', 'def run():\n    return 1\n');
check('KB: first code edit → one notice pointing to the config file', ctx(r).includes('.claude/launchpad.json'), ctx(r));
check('KB: the notice is not repeated', !ctx(bare.write('src/app2.py', 'def two():\n    return 2\n')).includes('.claude/launchpad.json'));
r = bare.install('--remove');
check('KB: remove leaves no trace (.claude was created by the kit)', r.code === 0 && !bare.has('.claude'), r.out);

// ---------- ما يرفضه أمر التركيب
const own = project({ settings: { statusLine: { type: 'command', command: 'echo my-line' } } });
r = own.install();
check('KS: an owner status line is kept and the summary says so', own.json('.claude/settings.json').statusLine.command === 'echo my-line' && r.out.includes('سطر الحالة الخاص بك'), r.out);
own.install('--remove');
check('KS: remove keeps the owner status line', own.json('.claude/settings.json').statusLine?.command === 'echo my-line');
const broken = project();
broken.put('.claude/settings.json', '{ "hooks": ');
r = broken.install();
check('KS: invalid settings.json → exit 1, nothing written', r.code === 1 && r.out.includes('JSON') && !broken.has('.claude/launchpad') && broken.read('.claude/settings.json') === '{ "hooks": ', r.out);
for (const shape of [{ hooks: [] }, { hooks: { Stop: {} } }, { permissions: { deny: 'Read(.env)' } }]) {
  const odd = project({ settings: shape });
  r = odd.install();
  check(`KS: settings of an unexpected shape ${JSON.stringify(shape)} → exit 1, nothing written`,
    r.code === 1 && r.out.includes('بشكل غير متوقع') && !odd.has('.claude/launchpad') && JSON.stringify(odd.json('.claude/settings.json')) === JSON.stringify(shape), r.out);
}
check('KS: template folder itself → refused', spawnSync('node', [join(REPO, '.claude/scripts/guard-install.mjs'), REPO], { encoding: 'utf8' }).status === 1);
const full = project();
full.put('master_rules.md', '#\n'); full.put('.claude/hooks/stop-gate.mjs', '');
check('KS: a full-template project → refused (guards already there)', full.install().code === 1);
// المجلد الشخصي فيه ~/.claude، أي إعدادات Claude Code لكل المشاريع
const home = project({ node: false, git: false });
r = spawnSync('node', [join(REPO, '.claude/scripts/guard-install.mjs'), home.dir], { encoding: 'utf8', env: { ...process.env, HOME: home.dir, USERPROFILE: home.dir } });
check('KS: the home folder → refused, nothing written', r.status === 1 && `${r.stdout}${r.stderr}`.includes('مجلدك الشخصي') && !home.has('.claude'), r.stdout + r.stderr);
const foreign = project();
foreign.put('.claude/launchpad/notes.txt', 'not the kit\n');
r = foreign.install();
check('KS: an existing .claude/launchpad not made by the kit → refused, untouched', r.code === 1 && r.out.includes('manifest') && foreign.read('.claude/launchpad/notes.txt') === 'not the kit\n' && !foreign.has('.claude/launchpad/hooks'), r.out);
check('KS: missing folder or unknown flag → exit 1 with usage', spawnSync('node', [join(REPO, '.claude/scripts/guard-install.mjs'), join(tmpdir(), 'aglp-missing-dir')], { encoding: 'utf8' }).status === 1
  && p.install('--remvoe').out.includes('خيار غير معروف'));

for (const dir of made) rmSync(dir, { recursive: true, force: true });
if (process.argv[1] === fileURLToPath(import.meta.url)) report();
