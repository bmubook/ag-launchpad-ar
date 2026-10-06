// اختبارات دعم OpenCode 2: تطبيع المدخلات (--host=opencode)، قارئ الرقع، الجسر بسياق OpenCode مزيّف، وتطابق ملفات .opencode.
// أشكال الأحداث والمدخلات كما سجّلها مسبار حقيقي لـ OpenCode 2.0.24 على Windows.
// تُشغَّل ضمن hooks.test.mjs، أو وحدها: node .claude/tests/opencode.test.mjs
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REPO, check, ctx, decision, freshProject, reason, report, runNode, tmp } from './helpers.mjs';

const lib = (name) => import(pathToFileURL(join(REPO, '.claude/hooks/lib', name)).href);
const { findPatchText, parsePatch } = await lib('patch.mjs');
const { createBridge, rulesLoader, runHook, singleFileCalls, strongestDecision } = await lib('opencode.mjs');
const { hostTraits } = await lib('host.mjs');
const OPENCODE = { args: ['--host=opencode'] };
const write = (file, content) => { mkdirSync(dirname(join(tmp, file)), { recursive: true }); writeFileSync(join(tmp, file), content); };
const hook = (script, payload) => runNode(`.claude/hooks/${script}`, { session_id: 'ses_test', ...payload }, OPENCODE);
const guard = (tool_name, tool_input) => hook('guard-secrets.mjs', { hook_event_name: 'PreToolUse', tool_name, tool_input });
const silent = (r) => r.out === '' && r.code === 0;

// ---------- قارئ الرقع وتفكيكها (دوال نقية)
const PATCH = ['*** Begin Patch', '*** Add File: src/new.js', '+export const a = 1;', '*** Update File: src/old.js', '@@ export', ' const keep = 1;',
  '-const gone = 2;', '+const added = 3;', '*** Update File: src/from.js', '*** Move to: src/to.js', '+moved', '*** Delete File: AGENTS.md', '*** End Patch'].join('\n');
const ops = parsePatch(PATCH);
check('OC patch: every file section is parsed in order', ops.map((o) => `${o.op}:${o.path}`).join(',') === 'add:src/new.js,update:src/old.js,update:src/from.js,delete:AGENTS.md', JSON.stringify(ops));
check('OC patch: added lines only, without the + marker', ops[0].added === 'export const a = 1;' && ops[1].added === 'const added = 3;', JSON.stringify(ops));
check('OC patch: the move target is kept', ops[2].moveTo === 'src/to.js');
check('OC patch: text found whatever the input field is called', findPatchText({ patchText: PATCH }) === PATCH && findPatchText({ x: { y: PATCH } }) === PATCH);
check('OC patch: input without a patch → nothing', findPatchText({ path: 'a.js' }) === '' && parsePatch('').length === 0);
const calls = singleFileCalls('patch', { patchText: PATCH });
check('OC calls: a patch becomes one call per file (move = delete + write)', calls.map((c) => `${c.tool}:${c.input.path}`).join(',')
  === 'write:src/new.js,edit:src/old.js,delete:src/from.js,write:src/to.js,delete:AGENTS.md', JSON.stringify(calls));
check('OC calls: other tools pass through as one call', JSON.stringify(singleFileCalls('read', { path: 'a' })) === '[{"tool":"read","input":{"path":"a"}}]');
const ask = { hookSpecificOutput: { permissionDecision: 'ask', permissionDecisionReason: 'a' } };
const deny = { hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'd' } };
check('OC decision: deny beats ask across files, nothing → null', strongestDecision([ask, null, deny]).permissionDecisionReason === 'd' && strongestDecision([null, {}]) === null);
check('OC traits: OpenCode asks for approval and receives session context; unknown tools get the safest traits',
  hostTraits('opencode').approvalPrompt && hostTraits('opencode').sessionContext && !hostTraits('mystery').approvalPrompt && hostTraits().rulesLoaded);

// ---------- الـ Hooks بمدخلات OpenCode
freshProject({ kicked: true });
write('.env', 'X=1\n');
let r = guard('read', { path: join(tmp, '.env') });
check('OC guard: read .env → deny (Claude Code shape for the bridge)', decision(r) === 'deny' && reason(r).includes('حماية الأسرار'), r.out + r.err);
check('OC guard: relative path is resolved too', decision(guard('read', { path: '.env' })) === 'deny');
check('OC guard: grep whose include matches env files → deny', decision(guard('grep', { pattern: 'KEY', path: tmp, include: '.env*' })) === 'deny');
check('OC guard: shell reading .env → deny', decision(guard('shell', { command: 'Get-Content .env' })) === 'deny');
check('OC guard: harmless shell and reads → silent', silent(guard('shell', { command: 'node -v' })) && silent(guard('read', { path: join(tmp, 'project_map.md') })));
r = guard('edit', { path: join(tmp, 'AGENTS.md'), oldString: 'a', newString: 'b' });
check('OC guard: governance edit → ask (OpenCode shows its approval window, unlike Cursor)', decision(r) === 'ask', r.out + r.err);
check('OC guard: deleting the plugin → ask', decision(guard('delete', { path: join(tmp, '.opencode/plugins/ag-launchpad.js') })) === 'ask');
check('OC guard: editing opencode.json → ask', decision(guard('write', { path: join(tmp, 'opencode.json'), content: '{}' })) === 'ask');
write('AGENTS.md', '# a\n');
r = hook('post-edit.mjs', { hook_event_name: 'PostToolUse', tool_name: 'edit', tool_input: { path: join(tmp, 'AGENTS.md'), oldString: 'a', newString: 'b' } });
check('OC post-edit: no after-the-fact governance notice (approval was asked before)', !ctx(r).includes('ملفات الحوكمة'), r.out + r.err);
const big = Array.from({ length: 260 }, (_, i) => `export const v${i} = ${i};`).join('\n');
write('src/big.js', big);
r = hook('post-edit.mjs', { hook_event_name: 'PostToolUse', tool_name: 'write', tool_input: { path: join(tmp, 'src/big.js'), content: big } });
check('OC post-edit: size ceiling warning reaches the bridge', ctx(r).includes('🚨'), r.out + r.err);
r = hook('prompt-submit.mjs', { hook_event_name: 'UserPromptSubmit', prompt: 'مرحبا' });
check('OC prompt-submit: first prompt adds no summary (the bridge injects session-start instead)', silent(r), r.out + r.err);
r = hook('session-start.mjs', { hook_event_name: 'SessionStart', source: 'startup' });
check('OC session-start: summary without the "read the rules yourself" line', ctx(r).includes('🧭') && !ctx(r).includes('📚'), r.out + r.err);
r = runNode('.claude/hooks/session-start.mjs', { session_id: 'c', cursor_version: '3.12.17' }, { args: ['--host=cursor'] });
check('OC regression: Cursor summary still tells the agent to read the rules', JSON.stringify(r.json).includes('📚'), r.out + r.err);

// ---------- الجسر: سياق OpenCode مزيّف، و run مزيّف يعيد مخرجات Hooks محددة
function fakeOpenCode() {
  const hooks = {};
  const prompts = [];
  const queue = [];
  let wake = null;
  const register = (domain) => async (name, fn) => { hooks[`${domain}.${name}`] = fn; };
  return {
    hooks, prompts,
    emit(event) { queue.push(event); wake?.(); },
    ctx: {
      session: { hook: register('session'), prompt: async (input) => { prompts.push(input); } },
      tool: { hook: register('tool') },
      permission: { hook: register('permission') },
      event: {
        async *subscribe({ signal }) {
          while (!signal.aborted) {
            if (!queue.length) await new Promise((resolve) => { wake = resolve; });
            while (queue.length) yield queue.shift();
          }
        },
      },
    },
  };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const ranScripts = [];
let gateOutput = { decision: 'block', reason: 'شغّل الفحص' };
const fakeRun = async (script, payload) => {
  ranScripts.push({ script, payload });
  if (script === 'session-start.mjs') return { hookSpecificOutput: { additionalContext: '🧭 ملخص' } };
  if (script === 'prompt-submit.mjs') return { hookSpecificOutput: { additionalContext: '🔄 نقطة تفتيش' } };
  if (script === 'guard-secrets.mjs') return payload.tool_input.path === '.env' ? deny : payload.tool_input.path === 'AGENTS.md' ? ask : null;
  if (script === 'post-edit.mjs') return { hookSpecificOutput: { additionalContext: `⚠️ ${payload.tool_input.path}` } };
  if (script === 'stop-gate.mjs') return payload.stop_hook_active ? null : gateOutput;
  return null;
};
write('master_rules.md', '# القواعد العليا\n');
const oc = fakeOpenCode();
const stopBridge = await createBridge(oc.ctx, { run: fakeRun, root: tmp });
check('OC bridge: registers prompt, context, tool and permission hooks', ['session.prompt', 'session.context', 'tool.execute.before', 'tool.execute.after', 'permission.evaluate']
  .every((name) => typeof oc.hooks[name] === 'function'), Object.keys(oc.hooks).join(','));

await oc.hooks['session.prompt']({ sessionID: 's1', prompt: { text: 'ابدأ' } });
const system = [{ type: 'text', text: 'harness' }];
await oc.hooks['session.context']({ sessionID: 's1', system });
const injected = system.slice(1).map((part) => part.text).join('\n');
check('OC bridge: rules, summary and turn note reach the model as system parts', system.every((p) => p.type === 'text')
  && injected.includes('القواعد العليا') && injected.includes('🧭 ملخص') && injected.includes('🔄 نقطة تفتيش'), injected.slice(0, 300));
const subagent = [];
await oc.hooks['session.context']({ sessionID: 'child', system: subagent });
check('OC bridge: a session without a user prompt (subagent) gets nothing injected', subagent.length === 0);

let thrown = null;
try { await oc.hooks['tool.execute.before']({ tool: 'read', id: 'c1', sessionID: 's1', input: { path: '.env' } }); } catch (error) { thrown = error; }
check('OC bridge: guard deny → the tool call throws with the reason', thrown?.message === 'd');
await oc.hooks['tool.execute.before']({ tool: 'edit', id: 'c2', sessionID: 's1', input: { path: 'AGENTS.md', oldString: 'a', newString: 'b' } });
const evaluation = { source: { id: 'c2' }, effect: 'allow' };
await oc.hooks['permission.evaluate'](evaluation);
check('OC bridge: guard ask → OpenCode approval window with the reason', evaluation.effect === 'ask' && evaluation.message === 'a');
const other = { source: { id: 'c9' }, effect: 'allow' };
await oc.hooks['permission.evaluate'](other);
check('OC bridge: other permission checks are left alone', other.effect === 'allow' && other.message === undefined);
check('OC bridge: tools outside the guard list are not checked', await oc.hooks['tool.execute.before']({ tool: 'webfetch', id: 'c3', input: {} }) === undefined
  && !ranScripts.some((x) => x.payload.tool_name === 'webfetch'));

const result = { output: { output: 'Created' }, content: [{ type: 'text', text: 'Created' }] };
await oc.hooks['tool.execute.after']({ tool: 'patch', id: 'c4', sessionID: 's1', status: 'completed', input: { patchText: PATCH }, result });
check('OC bridge: post-edit notes for every patched file are appended to the tool result', result.content.length === 2
  && ['src/new.js', 'src/old.js', 'src/to.js'].every((f) => result.content[1].text.includes(f)) && !result.content[1].text.includes('AGENTS.md'), JSON.stringify(result.content));
const failed = { content: [] };
await oc.hooks['tool.execute.after']({ tool: 'write', id: 'c5', sessionID: 's1', status: 'error', input: { path: 'a.js' }, result: failed });
check('OC bridge: failed edits are not reported', failed.content.length === 0);

oc.emit({ type: 'session.execution.succeeded', data: { sessionID: 's1' } });
await tick();
check('OC bridge: unfinished work → one automatic follow-up message with the reason', oc.prompts.length === 1
  && oc.prompts[0].sessionID === 's1' && oc.prompts[0].text.includes('⚙️') && oc.prompts[0].text.includes('شغّل الفحص'), JSON.stringify(oc.prompts));
const promptsBefore = ranScripts.filter((x) => x.script === 'prompt-submit.mjs').length;
await oc.hooks['session.prompt']({ sessionID: 's1', prompt: { text: oc.prompts[0].text } });
check('OC bridge: the follow-up does not start a new turn', ranScripts.filter((x) => x.script === 'prompt-submit.mjs').length === promptsBefore);
oc.emit({ type: 'session.execution.succeeded', data: { sessionID: 's1' } });
await tick();
check('OC bridge: after one follow-up the gate runs with stop_hook_active (no loop)', oc.prompts.length === 1
  && ranScripts.filter((x) => x.script === 'stop-gate.mjs').at(-1).payload.stop_hook_active === true);
oc.emit({ type: 'session.execution.succeeded', data: { sessionID: 'child' } });
await tick();
check('OC bridge: subagent sessions are not gated', !ranScripts.some((x) => x.script === 'stop-gate.mjs' && x.payload.session_id === 'child'));
gateOutput = null;
await oc.hooks['session.prompt']({ sessionID: 's1', prompt: { text: 'رسالة جديدة' } });
oc.emit({ type: 'session.execution.succeeded', data: { sessionID: 's1' } });
await tick();
check('OC bridge: a new user prompt resets the gate, and a passing gate sends nothing', oc.prompts.length === 1
  && ranScripts.filter((x) => x.script === 'stop-gate.mjs').at(-1).payload.stop_hook_active === false);
stopBridge();

// ---------- Node.js على الماك: تطبيق سطح المكتب المفتوح من Dock لا يرث PATH الطرفية
const { findNode } = await lib('node-path.mjs');
const onDisk = (...paths) => (candidate) => paths.includes(candidate);
const mac = { platform: 'darwin', home: '/Users/sara', env: { PATH: '/usr/bin:/bin' }, list: () => [] };
check('OC node (mac): Homebrew on Apple silicon is found without PATH', findNode({ ...mac, exists: onDisk('/opt/homebrew/bin/node') }) === '/opt/homebrew/bin/node');
check('OC node (mac): the newest nvm version wins', findNode({ ...mac, list: () => ['v18.20.4', 'v22.21.0', 'v20.9.0'],
  exists: onDisk('/Users/sara/.nvm/versions/node/v18.20.4/bin/node', '/Users/sara/.nvm/versions/node/v22.21.0/bin/node') }) === '/Users/sara/.nvm/versions/node/v22.21.0/bin/node');
check('OC node (mac): fnm under Application Support is found', findNode({ ...mac, exists: onDisk('/Users/sara/Library/Application Support/fnm/aliases/default/bin/node') })?.includes('fnm'));
check('OC node: PATH comes first when it has node', findNode({ ...mac, env: { PATH: '/custom/bin' }, exists: onDisk('/custom/bin/node', '/opt/homebrew/bin/node') }) === '/custom/bin/node');
check('OC node (windows): the default installer folder is found', findNode({ platform: 'win32', home: 'C:\\Users\\u', env: { Path: '', ProgramFiles: 'C:\\Program Files' }, list: () => [],
  exists: onDisk('C:\\Program Files\\nodejs\\node.exe') }) === 'C:\\Program Files\\nodejs\\node.exe');
check('OC node: nothing installed → null', findNode({ ...mac, exists: () => false }) === null);
const noNode = fakeOpenCode();
await createBridge(noNode.ctx, { root: tmp, node: null });
await noNode.hooks['session.prompt']({ sessionID: 'n1', prompt: { text: 'مرحبا' } });
const noNodeSystem = [];
await noNode.hooks['session.context']({ sessionID: 'n1', system: noNodeSystem });
check('OC bridge without Node: the agent is told protection is off and how to fix it, rules still load', noNodeSystem.some((p) => p.text.includes('nodejs.org'))
  && noNodeSystem.some((p) => p.text.includes('القواعد العليا')), JSON.stringify(noNodeSystem).slice(0, 300));
check('OC bridge without Node: tool calls are not blocked (fail open)', await noNode.hooks['tool.execute.before']({ tool: 'read', id: 'x', input: { path: '.env' } }) === undefined);
check('OC runHook without Node → null', await runHook('guard-secrets.mjs', {}, tmp, null) === null);

// ---------- runHook الحقيقي ومحمّل القواعد
r = await runHook('guard-secrets.mjs', { session_id: 's', tool_name: 'read', tool_input: { path: '.env' } }, tmp);
check('OC runHook: spawns the real guard with --host=opencode and parses its JSON', r?.hookSpecificOutput?.permissionDecision === 'deny', JSON.stringify(r));
check('OC runHook: a missing script fails open (null)', await runHook('missing.mjs', {}, tmp) === null);
const rules = rulesLoader(tmp);
const first = rules();
write('rules_security.md', '# أمن محدّث\n');
check('OC rules: governing files are joined, and a change on disk is picked up', first.includes('master_rules.md') && rules().includes('أمن محدّث'));

// ---------- ملفات .opencode في المستودع
const skills = readdirSync(join(REPO, '.claude/skills')).filter((s) => existsSync(join(REPO, '.claude/skills', s, 'SKILL.md')));
const commands = readdirSync(join(REPO, '.opencode/commands')).map((f) => f.replace(/\.md$/, ''));
check('OC files: one slash command per skill, no extras', skills.sort().join(',') === commands.sort().join(','), `${skills} vs ${commands}`);
check('OC files: each command loads its own skill and passes the arguments', commands.every((name) => {
  const text = readFileSync(join(REPO, '.opencode/commands', `${name}.md`), 'utf8');
  return /^---\r?\ndescription: ".+"\r?\n---\r?\n/.test(text) && text.includes(`\`${name}\``) && text.includes('$ARGUMENTS');
}));
const agents = readdirSync(join(REPO, '.claude/agents'));
check('OC files: each reviewer is a read-only subagent pointing at its Claude Code definition', agents.every((file) => {
  const path = join(REPO, '.opencode/agents', file);
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  return text.includes('mode: subagent') && /action: edit\r?\n\s+resource: "\*"\r?\n\s+effect: deny/.test(text) && text.includes(`.claude/agents/${file}`);
}), agents.join(','));
const plugin = await import(pathToFileURL(join(REPO, '.opencode/plugins/ag-launchpad.js')).href);
check('OC files: the plugin uses the V2 shape (default export with id and setup)', plugin.default?.id === 'ag-launchpad' && typeof plugin.default.setup === 'function');

/** مطابقة صلاحيات OpenCode 2 كما وثّقها: * أي عدد من الأحرف و ? حرف واحد، بلا حساسية لحالة الأحرف، والقاعدة الأخيرة المطابقة تفوز. */
const { permissions } = JSON.parse(readFileSync(join(REPO, 'opencode.json'), 'utf8'));
const toRegex = (glob) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
const effect = (action, resource) => permissions.filter((rule) => rule.action === action && toRegex(rule.resource).test(resource)).at(-1)?.effect || 'allow';
check('OC config: real env files cannot be read or edited, in any folder', ['.env', '.env.local', 'apps/web/.env', 'apps/web/.env.production']
  .every((file) => effect('read', file) === 'deny' && effect('edit', file) === 'deny'));
check('OC config: env templates and ordinary files stay readable', ['.env.example', 'apps/.env.sample', 'src/app.js', 'README.md'].every((file) => effect('read', file) === 'allow'));
check('OC config: service account keys cannot be read', effect('read', 'keys/app-firebase-adminsdk-x1.json') === 'deny');
check('OC config: destructive git and rm -rf ask first', ['git push --force origin main', 'git reset --hard HEAD~1', 'rm -rf src'].every((c) => effect('shell', c) === 'ask')
  && effect('shell', 'git status') === 'allow');

if (process.argv[1] === fileURLToPath(import.meta.url)) report();
