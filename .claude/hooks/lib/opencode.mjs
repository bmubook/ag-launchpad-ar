/**
 * جسر OpenCode 2: يربط أحداث إضافته بسكربتات Hooks القالب نفسها (بالعلَم --host=opencode)، فتبقى الحماية
 * في مكان واحد. تحمّله الإضافة .opencode/plugins/ag-launchpad.js. حقائق OpenCode من مسبار 2.0.24 على Windows:
 * - الترتيب: tool.execute.before ← permission evaluate (source.id = معرّف استدعاء الأداة) ← tool.execute.after.
 * - رمي خطأ في execute.before يمنع الأداة ويصل سببه للنموذج، وما يُضاف إلى result.content يقرؤه النموذج.
 * - ما يُضاف إلى event.system في session hook("context") يصل للنموذج دون أن يظهر للمستخدم، ويُعاد بناؤه مع كل طلب.
 * - لا حدث «توقف» قابل للمنع: بعد session.execution.succeeded تُرسل رسالة متابعة بـ session.prompt فيستأنف الوكيل.
 * - جلسات الوكلاء الفرعيين لا تمر بـ hook("prompt")، فلا يُحقن فيها شيء ولا تُفحص عند توقفها.
 */
import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findNode } from './node-path.mjs';
import { findPatchText, parsePatch } from './patch.mjs';

/** جذر المشروع من موضع هذا الملف (.claude/hooks/lib)، لا من مجلد الجلسة الذي قد يكون مجلداً فرعياً. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const NODE = findNode();
// ملفات البيئة تبقى محمية بصلاحيات opencode.json حتى دون Node؛ ما يتعطل هو بقية الحماية الآلية
const NODE_MISSING = '⚠️ إضافة AG Launchpad لم تجد Node.js على هذا الجهاز، فالحماية الآلية معطلة الآن: '
  + 'فحص الأوامر الخطرة، وتنبيهات الملفات، وبوابة الفحص قبل إعلان الانتهاء. أخبر المستخدم في ردك الأول بجملة واحدة: '
  + '«ثبّت Node.js 18 أو أحدث من nodejs.org ثم أعد تشغيل OpenCode»، والتزم بالقواعد ذاتياً حتى ذلك الحين.';
const HOOK_TIMEOUT_MS = 20000;
/** ما يستورده CLAUDE.md في Claude Code؛ هنا يُحقن نصه في سياق كل طلب فلا يعتمد على تذكّر النموذج. */
const RULE_FILES = ['CLAUDE.md', 'master_rules.md', 'rules_security.md', 'rules_code_quality.md', 'rules_workflow.md'];
const RULES_HEADER = '# ملفات القواعد الحاكمة — تحمّلها إضافة القالب تلقائياً في OpenCode فلا تُعد قراءتها من القرص. '
  + 'rules_ui.md وحده يُقرأ كاملاً قبل أي عمل على الواجهات.';
const GUARDED_TOOLS = new Set(['read', 'write', 'edit', 'patch', 'shell', 'grep']);
const EDIT_TOOLS = new Set(['write', 'edit', 'patch']);
const FOLLOW_UP_PREFIX = '⚙️ رسالة آلية من حماية القالب (لا تحتاج رداً منك):\n\n';

function parseJson(text) {
  try {
    return text.trim() ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** يشغّل سكربت Hook ويعيد مخرجه، أو null عند أي فشل — الفشل المفتوح كبقية الـ Hooks. */
export function runHook(script, payload, root = ROOT, node = NODE) {
  if (!node) return Promise.resolve(null);
  return new Promise((done) => {
    let out = '';
    const child = spawn(node, [join('.claude', 'hooks', script), '--host=opencode'], {
      cwd: root, windowsHide: true, env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    });
    const timer = setTimeout(() => child.kill(), HOOK_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', () => { clearTimeout(timer); done(null); });
    child.on('close', () => { clearTimeout(timer); done(parseJson(out)); });
    child.stdin.on('error', () => done(null));
    child.stdin.end(JSON.stringify(payload));
  });
}

export const contextOf = (output) => output?.hookSpecificOutput?.additionalContext || '';

/** أشد قرارات الحارس بين عدة ملفات: المنع ثم السؤال؛ null = يمرّ. */
export function strongestDecision(outputs) {
  const decisions = outputs.map((output) => output?.hookSpecificOutput).filter((specific) => specific?.permissionDecision);
  return decisions.find((d) => d.permissionDecision === 'deny') || decisions.find((d) => d.permissionDecision === 'ask') || null;
}

/** استدعاء أداة ← استدعاء لكل ملف بأسماء أدوات OpenCode؛ رقعة patch تُفكَّك إلى عملياتها. */
export function singleFileCalls(tool, input) {
  if (tool !== 'patch') return [{ tool, input: input || {} }];
  return parsePatch(findPatchText(input)).flatMap(({ op, path, moveTo, added }) => {
    if (op === 'delete') return [{ tool: 'delete', input: { path } }];
    if (op === 'add') return [{ tool: 'write', input: { path, content: added } }];
    if (moveTo) return [{ tool: 'delete', input: { path } }, { tool: 'write', input: { path: moveTo, content: added } }];
    return [{ tool: 'edit', input: { path, oldString: '', newString: added } }];
  });
}

function readRule(root, file) {
  try {
    const full = join(root, file);
    return { file, mtime: statSync(full).mtimeMs, text: readFileSync(full, 'utf8') };
  } catch {
    return null;
  }
}

/** نص ملفات القواعد، يُعاد بناؤه فقط إذا تغيّر أحدها على القرص. */
export function rulesLoader(root = ROOT) {
  let cache = { key: null, text: '' };
  return () => {
    const mtimes = RULE_FILES.map((file) => { try { return statSync(join(root, file)).mtimeMs; } catch { return 0; } });
    const key = mtimes.join('|');
    if (key === cache.key) return cache.text;
    const rules = RULE_FILES.map((file) => readRule(root, file)).filter(Boolean);
    cache = { key, text: rules.length ? [RULES_HEADER, ...rules.map((r) => `## ${r.file}\n\n${r.text}`)].join('\n\n') : '' };
    return cache.text;
  };
}

/** يستدعي onIdle عند انتهاء كل تنفيذ ناجح لأي جلسة. */
async function watchStops(ctx, signal, onIdle) {
  try {
    for await (const event of ctx.event.subscribe({ signal })) {
      if (event?.type === 'session.execution.succeeded' && event.data?.sessionID) onIdle(event.data.sessionID);
    }
  } catch {
    /* يُغلق الاشتراك عند إيقاف الإضافة أو إعادة تحميلها، ولا حالة تحتاج تنظيفاً */
  }
}

/** يسجّل الجسر في OpenCode ويعيد دالة الإيقاف. node و run قابلان للاستبدال في الاختبارات. */
export async function createBridge(ctx, { root = ROOT, node = NODE, run = (script, payload) => runHook(script, payload, root, node) } = {}) {
  const rules = rulesLoader(root);
  const sessions = new Map();
  const pendingAsks = new Map();
  const sessionOf = (id) => sessions.get(id) || sessions.set(id, {}).get(id);

  await ctx.session.hook('prompt', (event) => {
    const session = sessionOf(event.sessionID);
    // رسالة المتابعة التي أرسلها الجسر نفسه تكمل الجولة الجارية، فلا تبدأ جولة جديدة
    if (session.followUp) { session.followUp = false; return undefined; }
    session.continued = false;
    session.ready = (async () => {
      const base = { session_id: event.sessionID };
      if (session.summary === undefined) {
        session.summary = contextOf(await run('session-start.mjs', { ...base, hook_event_name: 'SessionStart', source: 'startup' }));
      }
      session.note = contextOf(await run('prompt-submit.mjs', { ...base, hook_event_name: 'UserPromptSubmit', prompt: event.prompt?.text || '' }));
    })();
    return session.ready;
  });

  await ctx.session.hook('context', async (event) => {
    const session = sessions.get(event.sessionID);
    if (!session || !Array.isArray(event.system)) return;
    await session.ready;
    const notes = [rules(), node ? '' : NODE_MISSING, session.summary, session.note];
    for (const text of notes) if (text) event.system.push({ type: 'text', text });
  });

  await ctx.tool.hook('execute.before', async (event) => {
    if (!GUARDED_TOOLS.has(event.tool)) return;
    const outputs = await Promise.all(singleFileCalls(event.tool, event.input).map((call) => run('guard-secrets.mjs', {
      hook_event_name: 'PreToolUse', session_id: event.sessionID, tool_name: call.tool, tool_input: call.input,
    })));
    const decision = strongestDecision(outputs);
    if (decision?.permissionDecision === 'deny') throw new Error(decision.permissionDecisionReason);
    if (decision) pendingAsks.set(event.id, decision.permissionDecisionReason);
  });

  // قرار ask من الحارس يصير نافذة موافقة OpenCode نفسها عند تقييم صلاحية الأداة ذاتها
  await ctx.permission.hook('evaluate', (event) => {
    const reason = pendingAsks.get(event.source?.id);
    if (reason === undefined) return;
    pendingAsks.delete(event.source.id);
    if (event.effect === 'deny') return;
    event.effect = 'ask';
    event.message = reason;
  });

  await ctx.tool.hook('execute.after', async (event) => {
    pendingAsks.delete(event.id);
    if (event.status !== 'completed' || !EDIT_TOOLS.has(event.tool)) return;
    const notes = [];
    // بالتتابع: كل استدعاء يحدّث ملف حالة الجلسة نفسه
    for (const call of singleFileCalls(event.tool, event.input).filter((c) => c.tool !== 'delete')) {
      const note = contextOf(await run('post-edit.mjs', {
        hook_event_name: 'PostToolUse', session_id: event.sessionID, tool_name: call.tool, tool_input: call.input,
      }));
      if (note) notes.push(note);
    }
    if (notes.length && Array.isArray(event.result?.content)) event.result.content.push({ type: 'text', text: notes.join('\n\n') });
  });

  async function onIdle(id) {
    const session = sessions.get(id);
    if (!session) return;
    const active = Boolean(session.continued);
    session.continued = false;
    const output = await run('stop-gate.mjs', { hook_event_name: 'Stop', session_id: id, stop_hook_active: active });
    if (output?.decision !== 'block' || !output.reason) return;
    session.continued = true;
    session.followUp = true;
    try {
      await ctx.session.prompt({ sessionID: id, text: FOLLOW_UP_PREFIX + output.reason });
    } catch {
      // لم تُرسل المتابعة: لا تُعامل رسالة المستخدم التالية كأنها رسالة الجسر
      session.followUp = false;
      session.continued = false;
    }
  }

  const controller = new AbortController();
  watchStops(ctx, controller.signal, onIdle);
  return () => controller.abort();
}
