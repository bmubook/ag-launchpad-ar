/**
 * طبقة المضيف: Hooks القالب مكتوبة بصيغة Claude Code، وهذه الطبقة تجعلها تعمل داخل أدوات أخرى
 * (حالياً Cursor) دون تغيير منطقها: توحّد المدخلات إلى شكل Claude Code، وتترجم المخرجات إلى صيغة الأداة.
 * مدخلات ومخرجات Claude Code تمرّ كما هي. بلا اعتماديات، ولا تستورد common.mjs (هو من يستوردها).
 *
 * حقائق Cursor مأخوذة من تسجيل فعلي (3.12 على Windows):
 * - يشغّل الأمر عبر PowerShell، فيسبق المدخلات بـ BOM ويقرأ نصها بصفحة ترميز النظام (العربية تصل مشوّهة).
 * - لا يرسل stop_hook_active؛ يرسل loop_count و status. والتعديل يصل باسم الأداة Write.
 * - يحمّل .claude/settings.json أيضاً؛ فاستدعاء بصيغة Claude دون --host=cursor يُتجاهل حتى لا يعمل كل Hook مرتين.
 * - قرار ask غير مطبّق فيه، وسياق بداية الجلسة لا يصل للنموذج.
 */
const HOST_FLAG = '--host=';
const NON_ASCII = /[^\x00-\x7f]/;
const WINDOWS_CODEPAGES = [
  'windows-1256', 'windows-1252', 'windows-1251', 'windows-1250', 'windows-1253',
  'windows-1254', 'windows-1255', 'windows-1257', 'windows-1258', 'windows-874',
];
const NO_APPROVAL_PROMPT = 'لا تتوفر نافذة موافقة في هذه البيئة، فمُنع الإجراء احتياطاً. '
  + 'اشرح للمستخدم ما الذي مُنع ولماذا؛ وإن كان يريده فعلاً فلينفّذه بنفسه.';

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function reverseTable(codepage) {
  const decoder = new TextDecoder(codepage);
  const table = new Map();
  for (let byte = 0x80; byte <= 0xff; byte += 1) table.set(decoder.decode(Uint8Array.of(byte)), byte);
  return table;
}

function encodeWith(table, text) {
  const bytes = [];
  for (const char of text) {
    const code = char.codePointAt(0);
    const byte = code < 0x80 ? code : table.get(char);
    if (byte === undefined) return null;
    bytes.push(byte);
  }
  return Uint8Array.from(bytes);
}

/**
 * يعيد نصاً قُرئت بايتاته (UTF-8) بصفحة ترميز Windows إلى أصله. النص السليم يُعاد كما هو:
 * الإصلاح يُقبل فقط إذا أنتج UTF-8 صحيحاً، وهذا لا يحدث مع نص عربي سليم.
 */
export function repairMojibake(text) {
  if (!NON_ASCII.test(text)) return text;
  for (const codepage of WINDOWS_CODEPAGES) {
    try {
      const bytes = encodeWith(reverseTable(codepage), text);
      if (bytes) return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch { /* ليست هذه الصفحة، أو غير مدعومة في هذه النسخة من Node */ }
  }
  return text;
}

/** اسم الأداة بلغة Claude Code: Shell ← Bash، و Write يُحدَّد نوعه من شكل مدخلاته. */
function claudeToolName(name, toolInput) {
  if (name === 'Shell') return 'Bash';
  if (name !== 'Write') return name;
  if (Array.isArray(toolInput.edits)) return 'MultiEdit';
  if (typeof toolInput.content !== 'string' && typeof toolInput.new_string === 'string') return 'Edit';
  return 'Write';
}

function fromCursor(raw) {
  const toolInput = isObject(raw.tool_input) ? raw.tool_input : {};
  const interrupted = raw.status !== undefined && raw.status !== 'completed';
  return {
    ...raw,
    host: 'cursor',
    session_id: raw.session_id || raw.conversation_id,
    tool_name: claudeToolName(raw.tool_name, toolInput),
    tool_input: toolInput,
    // لا متابعة إجبارية بعد متابعة سابقة، ولا بعد إيقاف المستخدم أو خطأ في التشغيل
    stop_hook_active: Number(raw.loop_count) > 0 || interrupted,
  };
}

/**
 * يحلّل مدخلات الـ Hook الخام. يعيد { host, skip, input }:
 * host = 'claude' أو اسم الأداة، و skip = استدعاء مكرر يجب أن يخرج صامتاً.
 * input لغير Claude يحمل الحقل host؛ مدخلات Claude Code لا تُمس.
 */
export function parseHookInput(rawText, args = process.argv.slice(2)) {
  const text = String(rawText || '').replace(/^﻿/, '').trim();
  const flag = args.find((arg) => arg.startsWith(HOST_FLAG));
  const raw = parseObject(text);
  // الكشف من مفتاح في أعلى المدخلات تكتبه الأداة نفسها، لا من بحث نصي قد يطابق محتوى يكتبه النموذج فيُسكت الحارس
  const looksCursor = typeof raw.cursor_version === 'string';
  const host = flag ? flag.slice(HOST_FLAG.length) : (looksCursor ? 'cursor' : 'claude');
  if (host === 'claude') return { host, skip: false, input: raw };
  if (!flag) return { host, skip: true, input: raw };
  const repaired = parseObject(repairMojibake(text));
  const input = Object.keys(repaired).length ? repaired : raw;
  return { host, skip: false, input: host === 'cursor' ? fromCursor(input) : { ...input, host } };
}

/** مدخلات تالفة أو ليست كائناً تُعامل كفارغة (الفشل المفتوح). */
function parseObject(text) {
  try {
    const parsed = text ? JSON.parse(text) : {};
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function cursorPermission(specific) {
  const reason = specific.permissionDecisionReason || '';
  if (specific.permissionDecision === 'allow') return { permission: 'allow' };
  const message = specific.permissionDecision === 'ask' ? `${reason} ${NO_APPROVAL_PROMPT}` : reason;
  return { permission: 'deny', user_message: message, agent_message: message };
}

/** يترجم مخرجاً بصيغة Claude Code إلى صيغة الأداة المضيفة. */
export function toHostOutput(payload, host) {
  if (host !== 'cursor' || !isObject(payload)) return payload;
  if (payload.decision === 'block') return { followup_message: payload.reason };
  const specific = payload.hookSpecificOutput;
  if (!isObject(specific)) return payload;
  if (specific.permissionDecision) return cursorPermission(specific);
  if (typeof specific.additionalContext !== 'string') return payload;
  const context = { additional_context: specific.additionalContext };
  return specific.hookEventName === 'UserPromptSubmit' ? { continue: true, ...context } : context;
}
